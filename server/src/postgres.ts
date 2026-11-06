import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { config } from './config.js';
import { decrypt, encrypt, randomId } from './crypto.js';
import { getSetting, setSetting } from './db.js';
import { lastLine, run } from './docker.js';

/**
 * The shared Postgres server: one container Dockyard runs itself, on a private network that
 * apps are joined to when they add the shared Postgres add-on. Each such app gets its own
 * database and role on it. The container is started the first time it is needed and kept
 * running with a restart policy, like the Cloudflare connector.
 */
export const POSTGRES_CONTAINER = 'dockyard-postgres';
// The Debian image rather than Alpine: it has openssl, used to make the server's TLS certificate.
// From 18 on, the image keeps the cluster under /var/lib/postgresql/<major>/, so the volume is
// mounted one level up; that layout is what lets a later major be upgraded in place.
const IMAGE = 'postgres:18';
const VOLUME = 'dockyard-postgres-data';
// A self-signed certificate made once per install, so direct connections are encrypted.
const TLS_VOLUME = 'dockyard-postgres-tls';
const POSTGRES_UID = '999';
const SUPERUSER = 'postgres';
const PASSWORD_SETTING = 'shared_postgres_password_enc';
// When set, the server is also published on this port of the machine Dockyard runs on, for pgAdmin and the like.
const ACCESS_PORT_SETTING = 'shared_postgres_access_port';

export interface SharedDatabase {
  name: string;
  user: string;
  password: string;
  host: string;
  port: number;
  url: string;
}

/**
 * The database an app owns on the shared server. Everything is derived from the app id, so a
 * preview can get its own database without anything being stored, and provisioning again after
 * the server was reset sets the same password the app already has in its environment.
 */
export function sharedDatabase(appId: string): SharedDatabase {
  const name = `app_${appId.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
  const password = crypto.createHmac('sha256', config.secret).update(`shared-postgres/${appId}`).digest('hex').slice(0, 32);
  return {
    name,
    user: name,
    password,
    host: POSTGRES_CONTAINER,
    port: 5432,
    url: `postgres://${name}:${password}@${POSTGRES_CONTAINER}:5432/${name}`,
  };
}

export function sharedDatabaseEnv(appId: string): Record<string, string> {
  const d = sharedDatabase(appId);
  return { DATABASE_URL: d.url, PGHOST: d.host, PGPORT: String(d.port), PGUSER: d.user, PGPASSWORD: d.password, PGDATABASE: d.name };
}

function superuserPassword(): string {
  const stored = getSetting(PASSWORD_SETTING);
  if (stored) return decrypt(stored);
  const password = randomId(32);
  setSetting(PASSWORD_SETTING, encrypt(password));
  return password;
}

/**
 * The private network apps and the server share. Not an "internal" Docker network: Docker does
 * not publish host ports for a container that is only on internal networks, which local access
 * needs. An early build created it internal; such a network is replaced, keeping its members.
 */
async function ensureDataNetwork(): Promise<void> {
  const inspect = await run(['network', 'inspect', '--format', '{{.Internal}}\t{{range .Containers}}{{.Name}} {{end}}', config.dataNetwork]);
  if (inspect.code === 0) {
    const [internal, members = ''] = inspect.stdout.trim().split('\t');
    if (internal !== 'true') return;
    const names = members.split(' ').filter(Boolean);
    for (const name of names) await run(['network', 'disconnect', '-f', config.dataNetwork, name]);
    const remove = await run(['network', 'rm', config.dataNetwork]);
    if (remove.code !== 0) throw new Error(`Could not replace network ${config.dataNetwork}: ${lastLine(remove.stderr)}`);
    await createDataNetwork();
    for (const name of names) await run(['network', 'connect', config.dataNetwork, name]);
    return;
  }
  await createDataNetwork();
}

async function createDataNetwork(): Promise<void> {
  const create = await run(['network', 'create', config.dataNetwork]);
  if (create.code !== 0) throw new Error(`Could not create network ${config.dataNetwork}: ${lastLine(create.stderr)}`);
}

export type PostgresState = 'running' | 'stopped' | 'missing';

export async function postgresState(): Promise<PostgresState> {
  const res = await run(['inspect', '--format', '{{.State.Running}}', POSTGRES_CONTAINER]);
  if (res.code !== 0) return 'missing';
  return res.stdout.trim() === 'true' ? 'running' : 'stopped';
}

async function waitReady(timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await run(['exec', POSTGRES_CONTAINER, 'pg_isready', '-U', SUPERUSER], { timeoutMs: 5_000 });
    if (res.code === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error('The shared Postgres server did not become ready in time. Check its logs with: docker logs dockyard-postgres');
}

/** Starts the shared server if it is not running, and returns once it accepts connections. */
export async function ensurePostgres(log: (line: string) => void = () => undefined): Promise<void> {
  await ensureDataNetwork();
  const state = await postgresState();
  if (state === 'running') {
    await waitReady();
    return;
  }
  if (state === 'stopped') {
    log(`Starting the shared Postgres server (${POSTGRES_CONTAINER}).`);
    const start = await run(['start', POSTGRES_CONTAINER]);
    if (start.code !== 0) throw new Error(`Could not start ${POSTGRES_CONTAINER}: ${lastLine(start.stderr)}`);
  } else {
    log(`Creating the shared Postgres server (${POSTGRES_CONTAINER}, ${IMAGE}).`);
    await createContainer(log);
  }
  await waitReady();
}

/** The port on the machine Dockyard runs on that the server is published on, or null when apps alone can reach it. */
export function accessPort(): number | null {
  const value = getSetting(ACCESS_PORT_SETTING);
  return value ? Number(value) : null;
}

/** The image is close to half a gigabyte; pulling it inside `docker run` can outlast that call's timeout on a slow link. */
async function ensureImage(log: (line: string) => void): Promise<void> {
  const present = await run(['image', 'inspect', '--format', '{{.Id}}', IMAGE]);
  if (present.code === 0) return;
  log(`Pulling ${IMAGE}.`);
  const pull = await run(['pull', IMAGE], { timeoutMs: 900_000 });
  if (pull.code !== 0) throw new Error(`Could not pull ${IMAGE}: ${lastLine(pull.stderr)}`);
}

/** Makes the certificate once; the volume keeps it across recreations, so clients that pinned it stay happy. */
async function ensureTls(): Promise<void> {
  const check = await run(['run', '--rm', '-v', `${TLS_VOLUME}:/tls`, '--entrypoint', 'sh', IMAGE, '-c', 'test -s /tls/server.key && test -s /tls/server.crt']);
  if (check.code === 0) return;
  const script = [
    'openssl req -x509 -newkey rsa:2048 -nodes -days 3650 -subj /CN=dockyard-postgres -keyout /tls/server.key -out /tls/server.crt',
    `chown ${POSTGRES_UID}:${POSTGRES_UID} /tls/server.key /tls/server.crt`,
    'chmod 600 /tls/server.key',
  ].join(' && ');
  const res = await run(['run', '--rm', '-v', `${TLS_VOLUME}:/tls`, '--entrypoint', 'sh', IMAGE, '-c', script], { timeoutMs: 120_000 });
  if (res.code !== 0) throw new Error(`Could not make the server's TLS certificate: ${lastLine(res.stderr)}`);
}

async function createContainer(log: (line: string) => void = () => undefined): Promise<void> {
  await ensureImage(log);
  await ensureDataNetwork();
  await ensureTls();
  const port = accessPort();
  const res = await run(
    [
      'run', '-d', '--name', POSTGRES_CONTAINER, '--restart', 'unless-stopped', '--network', config.dataNetwork,
      '--label', 'dockyard.role=postgres',
      ...(port ? ['-p', `${port}:5432`] : []),
      '-e', 'POSTGRES_PASSWORD', '-e', `POSTGRES_USER=${SUPERUSER}`,
      '-v', `${VOLUME}:/var/lib/postgresql`,
      '-v', `${TLS_VOLUME}:/tls:ro`,
      '--health-cmd', `pg_isready -U ${SUPERUSER}`, '--health-interval', '10s', '--health-timeout', '3s', '--health-retries', '5',
      IMAGE,
      'postgres', '-c', 'ssl=on', '-c', 'ssl_cert_file=/tls/server.crt', '-c', 'ssl_key_file=/tls/server.key',
    ],
    { env: { POSTGRES_PASSWORD: superuserPassword() }, timeoutMs: 180_000 },
  );
  if (res.code !== 0) throw new Error(`Could not start the shared Postgres server: ${lastLine(res.stderr)}`);
}

/**
 * Turns direct access on or off by recreating the container with or without the port binding; the
 * data is in the volume, so nothing is lost, but apps lose their connections for a few seconds.
 * Published on every interface: the machine's own addresses and any hostname that points at it.
 */
export async function setAccessPort(port: number | null): Promise<void> {
  if (port !== null && (!Number.isInteger(port) || port < 1 || port > 65535)) throw new Error('The port must be between 1 and 65535.');
  const previous = accessPort();
  setSetting(ACCESS_PORT_SETTING, port === null ? null : String(port));
  if ((await postgresState()) === 'missing') return;
  await run(['stop', '-t', '30', POSTGRES_CONTAINER], { timeoutMs: 60_000 });
  await run(['rm', '-f', POSTGRES_CONTAINER]);
  try {
    await createContainer();
  } catch (err) {
    // Most likely the port is taken. Go back to how it was so apps are not left without their server.
    setSetting(ACCESS_PORT_SETTING, previous === null ? null : String(previous));
    await run(['rm', '-f', POSTGRES_CONTAINER]);
    await createContainer();
    throw err;
  }
  await waitReady();
}

/**
 * What pgAdmin or psql needs, at the hostname the caller reached Dockyard through, since that is
 * the name that points at this machine. The superuser sees every app's database.
 */
export function superuserCredentials(host: string): { user: string; password: string; host: string; port: number | null; url: string | null } {
  const port = accessPort();
  const password = superuserPassword();
  return { user: SUPERUSER, password, host, port, url: port ? `postgres://${SUPERUSER}:${password}@${host}:${port}/postgres?sslmode=require` : null };
}

const ident = (name: string) => `"${name.replace(/"/g, '""')}"`;
const literal = (value: string) => `'${value.replace(/'/g, "''")}'`;

/** Runs SQL as the superuser over the container's local socket, which needs no password. */
async function psql(sql: string): Promise<void> {
  const res = await run(['exec', '-i', POSTGRES_CONTAINER, 'psql', '-U', SUPERUSER, '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q'], { input: sql, timeoutMs: 60_000 });
  if (res.code !== 0) throw new Error(`Postgres refused: ${lastLine(res.stderr)}`);
}

/**
 * Makes sure the app's role and database exist, with the password the app knows. Safe to run on
 * every deploy: an existing database is left as it is, only the password is set again. Other
 * apps' roles cannot connect to it.
 */
export async function provisionDatabase(appId: string): Promise<SharedDatabase> {
  const d = sharedDatabase(appId);
  await psql(
    [
      `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${literal(d.user)}) THEN CREATE ROLE ${ident(d.user)}; END IF; END $$;`,
      `ALTER ROLE ${ident(d.user)} WITH LOGIN PASSWORD ${literal(d.password)};`,
      `SELECT 'CREATE DATABASE ${ident(d.name).replace(/'/g, "''")} OWNER ${ident(d.user).replace(/'/g, "''")}' WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = ${literal(d.name)}) \\gexec`,
      `REVOKE CONNECT ON DATABASE ${ident(d.name)} FROM PUBLIC;`,
      `GRANT CONNECT ON DATABASE ${ident(d.name)} TO ${ident(d.user)};`,
      // App roles have no business in the maintenance databases either.
      'REVOKE CONNECT ON DATABASE postgres, template1 FROM PUBLIC;',
    ].join('\n'),
  );
  return d;
}

/** Deletes the app's database and role, connections included. Nothing happens when the server is not running. */
export async function dropDatabase(appId: string): Promise<void> {
  if ((await postgresState()) !== 'running') return;
  const d = sharedDatabase(appId);
  await psql(
    [
      `DROP DATABASE IF EXISTS ${ident(d.name)} WITH (FORCE);`,
      `DROP ROLE IF EXISTS ${ident(d.user)};`,
    ].join('\n'),
  );
}

export interface SharedDatabaseInfo {
  name: string;
  size: string;
}

/** The app databases on the server with their sizes, for the health view. */
export async function listDatabases(): Promise<SharedDatabaseInfo[]> {
  const res = await run(
    ['exec', POSTGRES_CONTAINER, 'psql', '-U', SUPERUSER, '-d', 'postgres', '-At', '-F', '\t', '-c',
      "SELECT datname, pg_size_pretty(pg_database_size(datname)) FROM pg_database WHERE datname LIKE 'app\\_%' ORDER BY datname"],
    { timeoutMs: 15_000 },
  );
  if (res.code !== 0) return [];
  return res.stdout.split('\n').filter(Boolean).map((line) => {
    const [name, size] = line.split('\t');
    return { name, size };
  });
}

/** Streams a custom-format dump of the app's database into a file. */
export function dumpDatabase(appId: string, file: string): Promise<{ code: number; stderr: string }> {
  const d = sharedDatabase(appId);
  return new Promise((resolve) => {
    const child = spawn('docker', ['exec', POSTGRES_CONTAINER, 'pg_dump', '-U', SUPERUSER, '-d', d.name, '-Fc']);
    const out = fs.createWriteStream(file);
    let stderr = '';
    child.stdout.pipe(out);
    child.stderr.on('data', (c) => (stderr += c.toString()));
    child.on('error', (err) => resolve({ code: 127, stderr: err.message }));
    child.on('close', (code) => out.end(() => resolve({ code: code ?? 1, stderr })));
  });
}

/** Loads a dump into the app's database, replacing what is there. Objects end up owned by the app's role. */
export function restoreDatabase(appId: string, file: string): Promise<{ code: number; stderr: string }> {
  const d = sharedDatabase(appId);
  return new Promise((resolve) => {
    const child = spawn('docker', [
      'exec', '-i', POSTGRES_CONTAINER, 'pg_restore', '-U', SUPERUSER, '-d', d.name, '--clean', '--if-exists', '--no-owner', '--role', d.user,
    ]);
    let stderr = '';
    child.stderr.on('data', (c) => (stderr += c.toString()));
    child.on('error', (err) => resolve({ code: 127, stderr: err.message }));
    child.on('close', (code) => resolve({ code: code ?? 1, stderr }));
    fs.createReadStream(file).pipe(child.stdin);
  });
}

export interface PostgresInfo {
  state: PostgresState;
  /** Docker's own words, such as "Up 3 hours (healthy)". */
  status: string;
  health: string;
  image: string;
  version: string | null;
  /** All app databases together, as Postgres reports it. */
  dataSize: string | null;
  volume: string;
  network: string;
  /** The host port the running container actually publishes 5432 on, if any. */
  publishedPort: number | null;
  databases: SharedDatabaseInfo[];
}

/** The shared server as a whole, for the Services page. Cheap when it is not running. */
export async function postgresInfo(): Promise<PostgresInfo> {
  const base = { image: IMAGE, volume: VOLUME, network: config.dataNetwork, publishedPort: null as number | null };
  const inspect = await run([
    'inspect', '--format', '{{.State.Status}}\t{{if .State.Health}}{{.State.Health.Status}}{{end}}\t{{.Config.Image}}\t{{json .HostConfig.PortBindings}}', POSTGRES_CONTAINER,
  ]);
  if (inspect.code !== 0) return { ...base, state: 'missing', status: '', health: '', version: null, dataSize: null, databases: [] };
  const [dockerState, health = '', image = IMAGE, bindings = '{}'] = inspect.stdout.trim().split('\t');
  try {
    const hostPort = (JSON.parse(bindings) as Record<string, { HostPort?: string }[] | null>)['5432/tcp']?.[0]?.HostPort;
    base.publishedPort = hostPort ? Number(hostPort) : null;
  } catch {
    base.publishedPort = null;
  }
  const ps = await run(['ps', '-a', '--filter', `name=^${POSTGRES_CONTAINER}$`, '--format', '{{.Status}}']);
  const status = ps.stdout.trim();
  if (dockerState !== 'running') return { ...base, image, state: 'stopped', status, health, version: null, dataSize: null, databases: [] };

  const summary = await run(
    ['exec', POSTGRES_CONTAINER, 'psql', '-U', SUPERUSER, '-d', 'postgres', '-At', '-F', '\t', '-c',
      "SELECT current_setting('server_version'), pg_size_pretty(COALESCE(SUM(pg_database_size(datname)), 0)) FROM pg_database WHERE datname LIKE 'app\\_%'"],
    { timeoutMs: 15_000 },
  );
  const [version = null, dataSize = null] = summary.code === 0 ? summary.stdout.trim().split('\t') : [];
  return { ...base, image, state: 'running', status, health, version, dataSize, databases: await listDatabases() };
}

/** Start, stop or restart the server. Apps using it lose their database while it is stopped. */
export async function postgresAction(action: 'start' | 'stop' | 'restart'): Promise<void> {
  if (action === 'start') {
    await ensurePostgres();
    return;
  }
  const res = await run([action, '-t', '30', POSTGRES_CONTAINER], { timeoutMs: 60_000 });
  if (res.code !== 0) throw new Error(`Could not ${action} ${POSTGRES_CONTAINER}: ${lastLine(res.stderr)}`);
  if (action === 'restart') await waitReady();
}

export async function postgresLogs(tail: number): Promise<string> {
  const res = await run(['logs', '--timestamps', '--tail', String(tail), POSTGRES_CONTAINER], { timeoutMs: 15_000 });
  return res.stdout + res.stderr;
}
