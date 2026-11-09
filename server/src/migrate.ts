import fs from 'node:fs';
import path from 'node:path';
import { addonServices, addonsOf, restoreAddonSnapshot, switchToSharedPostgres } from './addons.js';
import { execToFile } from './backup.js';
import { parseCompose } from './compose.js';
import { config } from './config.js';
import { db, type AppRow, type DeploymentRow } from './db.js';
import { enqueueDeploy } from './deployer.js';
import { lastLine, projectName, run } from './docker.js';
import { badRequest } from './errors.js';
import { POSTGRES_CONTAINER, dropDatabase, ensurePostgres, provisionDatabase, queryShared, sharedDatabase } from './postgres.js';

/**
 * Moves an app from the dedicated Postgres add-on (a server inside the app) to a database on the
 * shared server, data included:
 *
 *   1. stop the app's own containers, so nothing writes while the data is copied;
 *   2. pg_dump the dedicated server and pg_restore it into the app's new shared database;
 *   3. compare the exact row count of every table on both sides;
 *   4. switch the add-on and redeploy, which removes the old Postgres container.
 *
 * Until step 4 the app's settings are untouched: a failure drops the new database and starts the
 * app again as it was. If the redeploy fails, the old settings come back and are deployed again.
 * The dedicated server's Docker volume is never deleted, so its data stays as a fallback.
 */

export interface Migration {
  appId: string;
  appName: string;
  status: 'running' | 'succeeded' | 'failed';
  startedAt: number;
  finishedAt: number | null;
  log: string[];
  tables: number | null;
  rows: number | null;
  error: string | null;
}

// The dedicated add-on always creates this role and database (see ADDONS.postgres).
const DEDICATED_USER = 'app';
const DEDICATED_DB = 'app';

const migrations = new Map<string, Migration>();

export const migrationOf = (appId: string): Migration | null => migrations.get(appId) ?? null;

/** Exact row counts of every table, as "schema.table=count" lines, so both sides can be compared. */
const COUNT_ROWS = `SELECT n.nspname || '.' || c.relname || '=' || (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM %I.%I', n.nspname, c.relname), false, true, '')))[1]::text
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE c.relkind IN ('r', 'p') AND n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname NOT LIKE 'pg\\_toast%'
ORDER BY 1`;

function parseCounts(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const line of text.split('\n').filter(Boolean)) {
    const at = line.lastIndexOf('=');
    counts.set(line.slice(0, at), Number(line.slice(at + 1)));
  }
  return counts;
}

async function dedicatedQuery(app: AppRow, service: string, sql: string): Promise<string> {
  const res = await run(['compose', '-p', projectName(app.id), 'exec', '-T', service, 'psql', '-U', DEDICATED_USER, '-d', DEDICATED_DB, '-v', 'ON_ERROR_STOP=1', '-At', '-c', sql], { timeoutMs: 300_000 });
  if (res.code !== 0) throw new Error(`The app's Postgres refused: ${lastLine(res.stderr)}`);
  return res.stdout;
}

interface Extension {
  name: string;
  schema: string;
}

const EXTENSIONS = "SELECT e.extname || '|' || n.nspname FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace WHERE e.extname <> 'plpgsql' ORDER BY 1";

const parseExtensions = (text: string): Extension[] =>
  text.split('\n').filter(Boolean).map((line) => {
    const [name, schema] = line.split('|');
    return { name, schema };
  });

const ident = (name: string) => `"${name.replace(/"/g, '""')}"`;

/**
 * Restores the dump into the app's shared database as the app's own role, so it owns everything.
 * The dedicated server's user was a superuser and may have created extensions an ordinary owner
 * cannot, so extensions (and the schemas they live in) are created first as the superuser and
 * left out of the restore list.
 */
async function restoreInto(target: string, role: string, dumpFile: string, extensions: Extension[]): Promise<void> {
  const remoteDump = `/tmp/${target}.dump`;
  const remoteList = `/tmp/${target}.list`;
  try {
    const copy = await run(['cp', dumpFile, `${POSTGRES_CONTAINER}:${remoteDump}`], { timeoutMs: 600_000 });
    if (copy.code !== 0) throw new Error(`Could not copy the dump to the shared server: ${lastLine(copy.stderr)}`);

    const extSchemas = [...new Set(extensions.map((e) => e.schema).filter((s) => s !== 'public'))];
    for (const schema of extSchemas) await queryShared(target, `CREATE SCHEMA IF NOT EXISTS ${ident(schema)} AUTHORIZATION ${ident(role)}`);
    for (const e of extensions) await queryShared(target, `CREATE EXTENSION IF NOT EXISTS ${ident(e.name)} SCHEMA ${ident(e.schema)}`);

    const list = await run(['exec', POSTGRES_CONTAINER, 'pg_restore', '-l', remoteDump], { timeoutMs: 120_000 });
    if (list.code !== 0) throw new Error(`Could not read the dump: ${lastLine(list.stderr)}`);
    const skip = (line: string) =>
      / EXTENSION - /.test(line) || / COMMENT - EXTENSION /.test(line) || extSchemas.some((s) => line.includes(` SCHEMA - ${s} `));
    const kept = list.stdout.split('\n').filter((line) => !skip(line)).join('\n');
    const write = await run(['exec', '-i', POSTGRES_CONTAINER, 'sh', '-c', `cat > ${remoteList}`], { input: kept, timeoutMs: 30_000 });
    if (write.code !== 0) throw new Error(`Could not write the restore list: ${lastLine(write.stderr)}`);

    const restore = await run(
      ['exec', POSTGRES_CONTAINER, 'pg_restore', '-U', 'postgres', '-d', target, '--no-owner', '--no-acl', '--role', role, '-L', remoteList, remoteDump],
      { timeoutMs: 3_600_000 },
    );
    if (restore.code !== 0) {
      const lines = restore.stderr.trim().split('\n');
      const errors = lines.filter((l) => /error:|ERROR:/.test(l)).map((l) => l.replace(/^pg_restore: /, '').trim());
      throw new Error(`pg_restore failed: ${(errors.length ? errors : lines.slice(-3)).slice(0, 4).join(' ')}`);
    }
  } finally {
    await run(['exec', POSTGRES_CONTAINER, 'rm', '-f', remoteDump, remoteList]);
  }
}

async function waitForDeployment(id: string, timeoutMs: number): Promise<DeploymentRow> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const row = db.prepare('SELECT * FROM deployments WHERE id = ?').get(id) as DeploymentRow;
    if (row.status === 'succeeded' || row.status === 'failed') return row;
    if (Date.now() > deadline) throw new Error('The redeploy did not finish in time. Check the app\'s Deployments tab.');
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}

/** Checks what can be checked up front, then runs the migration in the background. */
export function startMigration(app: AppRow): Migration {
  if (app.preview_of) throw badRequest('Previews follow their app. Migrate the app itself.');
  const current = migrations.get(app.id);
  if (current?.status === 'running') throw badRequest('This app is already being migrated.');
  const added = addonsOf(app.id);
  if (!added.some((a) => a.type === 'postgres')) throw badRequest('This app has no dedicated Postgres add-on to migrate.');
  if (added.some((a) => a.type === 'postgres-shared')) throw badRequest('This app already has a database on the shared server.');
  const busy = db.prepare("SELECT 1 FROM deployments WHERE app_id = ? AND status IN ('queued', 'running')").get(app.id);
  if (busy) throw badRequest('A deployment of this app is in progress. Try again when it has finished.');

  const migration: Migration = {
    appId: app.id, appName: app.name, status: 'running', startedAt: Date.now(), finishedAt: null, log: [], tables: null, rows: null, error: null,
  };
  migrations.set(app.id, migration);
  void migrate(app, migration);
  return migration;
}

async function migrate(app: AppRow, m: Migration): Promise<void> {
  const log = (line: string) => m.log.push(`${new Date().toISOString().slice(11, 19)} ${line}`);
  const pgService = addonsOf(app.id).find((a) => a.type === 'postgres')!.service;
  const others = Object.keys(parseCompose(app.compose).services ?? {}).filter((s) => !addonServices(app.id).includes(s));
  const target = sharedDatabase(app.id).name;
  const dumpDir = path.join(config.dataDir, 'migrations');
  const dumpFile = path.join(dumpDir, `${app.id}-${Date.now()}.dump`);
  let stopped = false;
  let provisioned = false;

  const startApp = async () => {
    if (!stopped) return;
    const res = await run(['compose', '-p', projectName(app.id), 'start', ...others], { timeoutMs: 180_000 });
    log(res.code === 0 ? 'Started the app again, unchanged.' : `Could not start the app again: ${lastLine(res.stderr)}. Redeploy it.`);
  };

  try {
    const ready = await run(['compose', '-p', projectName(app.id), 'exec', '-T', pgService, 'pg_isready', '-U', DEDICATED_USER], { timeoutMs: 20_000 });
    if (ready.code !== 0) throw new Error(`The app's own Postgres (service "${pgService}") is not running. Start the app first.`);

    log('Preparing the database on the shared server.');
    await ensurePostgres(log);
    // Everything that can make the copy fail is checked before the app is stopped.
    const extensions = parseExtensions(await dedicatedQuery(app, pgService, EXTENSIONS));
    const available = new Set((await queryShared('postgres', 'SELECT name FROM pg_available_extensions')).split('\n').filter(Boolean));
    const missing = extensions.filter((e) => !available.has(e.name)).map((e) => e.name);
    if (missing.length) throw new Error(`The shared server does not have the extension(s) ${missing.join(', ')} this app uses. Keep it on its own Postgres.`);
    if (extensions.length) log(`Extensions: ${extensions.map((e) => e.name).join(', ')}.`);
    await provisionDatabase(app.id);
    provisioned = true;
    const existing = parseCounts(await queryShared(target, COUNT_ROWS));
    if (existing.size > 0) {
      provisioned = false; // Not ours to drop.
      throw new Error(`${target} on the shared server already has ${existing.size} table(s). Remove them first, or migrate by hand.`);
    }

    if (others.length) {
      log(`Stopping ${others.join(', ')} so nothing writes during the copy.`);
      const stop = await run(['compose', '-p', projectName(app.id), 'stop', ...others], { timeoutMs: 180_000 });
      if (stop.code !== 0) throw new Error(`Could not stop the app: ${lastLine(stop.stderr)}`);
      stopped = true;
    }

    log('Dumping the app\'s own Postgres.');
    fs.mkdirSync(dumpDir, { recursive: true });
    const dump = await execToFile(app.id, pgService, ['pg_dump', '-U', DEDICATED_USER, '-d', DEDICATED_DB, '-Fc', '--no-owner', '--no-acl'], dumpFile);
    if (dump.code !== 0) throw new Error(`pg_dump failed: ${lastLine(dump.stderr)}`);
    log(`Dump is ${Math.max(1, Math.round(fs.statSync(dumpFile).size / 1024))} KB. Restoring into ${target}.`);
    await restoreInto(target, sharedDatabase(app.id).user, dumpFile, extensions);

    log('Comparing row counts table by table.');
    const source = parseCounts(await dedicatedQuery(app, pgService, COUNT_ROWS));
    const copied = parseCounts(await queryShared(target, COUNT_ROWS));
    const mismatches = [...source].filter(([table, count]) => copied.get(table) !== count).map(([table, count]) => `${table}: ${count} → ${copied.get(table) ?? 'missing'}`);
    if (mismatches.length) throw new Error(`The copy does not match: ${mismatches.slice(0, 5).join('; ')}`);
    m.tables = source.size;
    m.rows = [...source.values()].reduce((a, b) => a + b, 0);
    log(`All ${m.tables} table(s) match, ${m.rows} row(s) in total.`);

    log('Switching the app to the shared server and redeploying.');
    const fresh = db.prepare('SELECT * FROM apps WHERE id = ?').get(app.id) as AppRow;
    const snapshot = switchToSharedPostgres(fresh);
    const deployment = await waitForDeployment(enqueueDeploy(app.id, { trigger: 'manual' }).id, 20 * 60_000);
    if (deployment.status !== 'succeeded') {
      log('The redeploy failed. Putting the dedicated Postgres back and deploying that again.');
      restoreAddonSnapshot(app.id, snapshot);
      const back = await waitForDeployment(enqueueDeploy(app.id, { trigger: 'manual' }).id, 20 * 60_000);
      log(back.status === 'succeeded' ? 'The app runs on its own Postgres again, as before.' : 'Deploying the old settings failed too. Check the Deployments tab.');
      await dropDatabase(app.id).catch(() => undefined);
      throw new Error('The app did not start on the shared server; see its Deployments tab for why.');
    }

    log(`Done. The old Postgres container is gone; its volume ${projectName(app.id)}_postgres-data is kept as a fallback; delete it under Storage Cleanup → Volumes once you are happy.`);
    m.status = 'succeeded';
  } catch (err) {
    m.error = (err as Error).message;
    m.status = 'failed';
    log(`FAILED: ${m.error}`);
    if (provisioned && addonsOf(app.id).every((a) => a.type !== 'postgres-shared')) {
      await dropDatabase(app.id).catch(() => undefined);
      log(`Dropped the partial copy in ${target}.`);
    }
    await startApp();
  } finally {
    fs.rmSync(dumpFile, { force: true });
    m.finishedAt = Date.now();
  }
}
