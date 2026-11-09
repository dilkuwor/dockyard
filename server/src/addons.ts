import YAML from 'yaml';
import { parseCompose } from './compose.js';
import { decrypt, encrypt, randomId } from './crypto.js';
import { db, type AppRow } from './db.js';
import { badRequest } from './errors.js';
import { dropDatabase, ensurePostgres, provisionDatabase, sharedDatabase, sharedDatabaseEnv } from './postgres.js';

/**
 * Managed add-ons. Most are a database, cache or object store added to an app's compose file as
 * another service with a named volume, with the connection details put into the app's
 * environment; the compose file stays plain compose, so it can still be edited by hand. The
 * shared Postgres add-on is different: it gives the app its own database on the Postgres server
 * Dockyard runs for every app, and joins the app to that server's network at deploy time.
 */
export type AddonType = 'postgres-shared' | 'postgres' | 'redis' | 'minio';
export type AddonKind = 'service' | 'shared';

interface AddonSpec {
  type: AddonType;
  kind: AddonKind;
  label: string;
  /** For a service add-on, the compose service and volume it adds. */
  service?: string;
  volume?: string;
  /** Builds the service definition and the variables the app gets, with fresh secrets. */
  make?: () => { service: Record<string, unknown>; env: Record<string, string> };
  /** The variable names this add-on owns, so removal can take them away again. */
  envKeys: string[];
  note: string;
}

const secret = () => randomId(24);
const PG_KEYS = ['DATABASE_URL', 'PGHOST', 'PGPORT', 'PGUSER', 'PGPASSWORD', 'PGDATABASE'];

export const ADDONS: Record<AddonType, AddonSpec> = {
  'postgres-shared': {
    type: 'postgres-shared',
    kind: 'shared',
    label: 'PostgreSQL 18 (shared server)',
    envKeys: PG_KEYS,
    note: 'A database of its own on the Postgres server Dockyard runs for all apps, reachable as host "dockyard-postgres". Lighter than a server per app; a preview gets its own empty database.',
  },
  postgres: {
    type: 'postgres',
    kind: 'service',
    label: 'PostgreSQL 18 (dedicated)',
    service: 'postgres',
    volume: 'postgres-data',
    envKeys: PG_KEYS,
    note: 'A Postgres server of its own in the app, reachable as host "postgres" on port 5432. Data lives in the named volume "postgres-data". For apps that need their own version or extensions.',
    make: () => {
      const password = secret();
      return {
        service: {
          image: 'postgres:18-alpine',
          environment: { POSTGRES_USER: 'app', POSTGRES_PASSWORD: password, POSTGRES_DB: 'app' },
          // The 18 image keeps the cluster under /var/lib/postgresql/18/; mounting one level up keeps it in the volume.
          volumes: ['postgres-data:/var/lib/postgresql'],
          healthcheck: { test: ['CMD-SHELL', 'pg_isready -U app -d app'], interval: '5s', timeout: '3s', retries: 20 },
        },
        env: {
          DATABASE_URL: `postgres://app:${password}@postgres:5432/app`,
          PGHOST: 'postgres',
          PGPORT: '5432',
          PGUSER: 'app',
          PGPASSWORD: password,
          PGDATABASE: 'app',
        },
      };
    },
  },
  redis: {
    type: 'redis',
    kind: 'service',
    label: 'Redis 7',
    service: 'redis',
    volume: 'redis-data',
    envKeys: ['REDIS_URL'],
    note: 'Reachable from the app as host "redis" on port 6379, persisted to the named volume "redis-data".',
    make: () => ({
      service: {
        image: 'redis:7-alpine',
        command: ['redis-server', '--appendonly', 'yes'],
        volumes: ['redis-data:/data'],
        healthcheck: { test: ['CMD', 'redis-cli', 'ping'], interval: '5s', timeout: '3s', retries: 20 },
      },
      env: { REDIS_URL: 'redis://redis:6379' },
    }),
  },
  minio: {
    type: 'minio',
    kind: 'service',
    label: 'MinIO (S3 storage)',
    service: 'minio',
    volume: 'minio-data',
    envKeys: ['S3_ENDPOINT', 'S3_ACCESS_KEY', 'S3_SECRET_KEY', 'S3_REGION', 'S3_FORCE_PATH_STYLE'],
    note: 'S3-compatible storage at http://minio:9000 from the app. Create buckets from the app with the S3 API; the MinIO console is not exposed.',
    make: () => {
      const accessKey = `app${randomId(8)}`;
      const secretKey = secret();
      return {
        service: {
          // MinIO no longer publishes images; Chainguard builds them from MinIO's source.
          image: 'cgr.dev/chainguard/minio:latest',
          command: ['server', '/data'],
          environment: { MINIO_ROOT_USER: accessKey, MINIO_ROOT_PASSWORD: secretKey },
          volumes: ['minio-data:/data'],
          healthcheck: { test: ['CMD', 'mc', 'ready', 'local'], interval: '5s', timeout: '3s', retries: 20 },
        },
        env: {
          S3_ENDPOINT: 'http://minio:9000',
          S3_ACCESS_KEY: accessKey,
          S3_SECRET_KEY: secretKey,
          S3_REGION: 'us-east-1',
          S3_FORCE_PATH_STYLE: 'true',
        },
      };
    },
  },
};

export interface AddonRow {
  app_id: string;
  type: AddonType;
  /** The compose service the add-on put into the app, or for the shared Postgres add-on, the app's database name. */
  service: string;
  created_at: number;
}

export const addonsOf = (appId: string): AddonRow[] =>
  db.prepare('SELECT * FROM addons WHERE app_id = ? ORDER BY created_at').all(appId) as AddonRow[];

/** The compose services add-ons put into the app; they keep their own environment at deploy time. */
export const addonServices = (appId: string): string[] =>
  addonsOf(appId).filter((a) => ADDONS[a.type]?.kind === 'service').map((a) => a.service);

/** Whether the app, or the app a preview belongs to, uses the shared Postgres server. */
export const usesSharedPostgres = (app: Pick<AppRow, 'id' | 'preview_of'>): boolean =>
  addonsOf(app.preview_of ?? app.id).some((a) => a.type === 'postgres-shared');

export function parseAddonType(value: unknown): AddonType {
  const type = String(value ?? '');
  if (!(type in ADDONS)) throw badRequest(`Unknown add-on. Choose one of: ${Object.keys(ADDONS).join(', ')}.`);
  return type as AddonType;
}

type Env = { key: string; value: string }[];
const readEnv = (app: AppRow): Env => (app.env_enc ? (JSON.parse(decrypt(app.env_enc)) as Env) : []);
const writeEnv = (vars: Env): string | null => (vars.length ? encrypt(JSON.stringify(vars)) : null);

/** The app's variables with the add-on's own set over them. */
function withAddonEnv(vars: Env, spec: AddonSpec, env: Record<string, string>): Env {
  const kept = vars.filter((v) => !spec.envKeys.includes(v.key));
  for (const [key, value] of Object.entries(env)) kept.push({ key, value });
  return kept;
}

/**
 * Puts the add-on into the app: a service and volume in the compose file, or a database on the
 * shared server, with its variables in the environment either way.
 */
export async function addAddon(app: AppRow, type: AddonType): Promise<{ envKeys: string[] }> {
  const spec = ADDONS[type];
  const added = addonsOf(app.id);
  if (added.some((a) => a.type === type)) throw badRequest(`${spec.label} is already added to this app.`);
  const clash = added.find((a) => ADDONS[a.type]?.envKeys.some((k) => spec.envKeys.includes(k)));
  if (clash) throw badRequest(`${ADDONS[clash.type].label} provides the same variables. Remove it first.`);

  if (spec.kind === 'shared') {
    await ensurePostgres();
    const database = await provisionDatabase(app.id);
    const vars = withAddonEnv(readEnv(app), spec, sharedDatabaseEnv(app.id));
    db.transaction(() => {
      db.prepare('UPDATE apps SET env_enc = ?, updated_at = ? WHERE id = ?').run(writeEnv(vars), Date.now(), app.id);
      db.prepare('INSERT INTO addons (app_id, type, service, created_at) VALUES (?, ?, ?, ?)').run(app.id, type, database.name, Date.now());
    })();
    return { envKeys: spec.envKeys };
  }

  const doc = parseCompose(app.compose) as Record<string, unknown> & { services: Record<string, unknown>; volumes?: Record<string, unknown> };
  if (doc.services[spec.service!]) {
    throw badRequest(`The compose file already has a service named "${spec.service}". Rename it first, or manage it yourself.`);
  }
  const { service, env } = spec.make!();
  doc.services[spec.service!] = service;
  doc.volumes = { ...(doc.volumes ?? {}), [spec.volume!]: {} };
  const composeText = YAML.stringify(doc);
  const vars = withAddonEnv(readEnv(app), spec, env);

  db.transaction(() => {
    db.prepare('UPDATE apps SET compose = ?, env_enc = ?, updated_at = ? WHERE id = ?').run(composeText, writeEnv(vars), Date.now(), app.id);
    db.prepare('INSERT INTO addons (app_id, type, service, created_at) VALUES (?, ?, ?, ?)').run(app.id, type, spec.service, Date.now());
  })();
  return { envKeys: Object.keys(env) };
}

/**
 * Takes the add-on out again. A service add-on's Docker volume is kept; the shared Postgres
 * add-on's database is deleted, since nothing else could ever reach it.
 */
export async function removeAddon(app: AppRow, type: AddonType): Promise<void> {
  const spec = ADDONS[type];
  const row = addonsOf(app.id).find((a) => a.type === type);
  if (!row) throw badRequest(`${spec.label} is not added to this app.`);
  const vars = readEnv(app).filter((v) => !spec.envKeys.includes(v.key));

  if (spec.kind === 'shared') {
    await dropDatabase(app.id);
    db.transaction(() => {
      db.prepare('UPDATE apps SET env_enc = ?, updated_at = ? WHERE id = ?').run(writeEnv(vars), Date.now(), app.id);
      db.prepare('DELETE FROM addons WHERE app_id = ? AND type = ?').run(app.id, type);
    })();
    return;
  }

  const doc = parseCompose(app.compose) as Record<string, unknown> & { services: Record<string, unknown>; volumes?: Record<string, unknown> };
  delete doc.services[row.service];
  if (doc.volumes) {
    delete doc.volumes[spec.volume!];
    if (Object.keys(doc.volumes).length === 0) delete doc.volumes;
  }
  const composeText = YAML.stringify(doc);

  db.transaction(() => {
    db.prepare('UPDATE apps SET compose = ?, env_enc = ?, updated_at = ? WHERE id = ?').run(composeText, writeEnv(vars), Date.now(), app.id);
    db.prepare('DELETE FROM addons WHERE app_id = ? AND type = ?').run(app.id, type);
  })();
}

/** What a switch to the shared server changes, so a failed switch can be put back exactly. */
export interface AddonSnapshot {
  compose: string;
  envEnc: string | null;
  rows: AddonRow[];
}

/**
 * Moves the app's settings from the dedicated Postgres add-on to the shared one: the postgres
 * service and its volume entry leave the compose file (the Docker volume itself is kept, with the
 * old data), anything that depended on that service stops doing so, and the variables point at
 * the app's database on the shared server. Returns what was there before.
 */
export function switchToSharedPostgres(app: AppRow): AddonSnapshot {
  const before: AddonSnapshot = { compose: app.compose, envEnc: app.env_enc, rows: addonsOf(app.id) };
  const row = before.rows.find((a) => a.type === 'postgres');
  if (!row) throw badRequest('This app has no dedicated Postgres add-on.');
  const doc = parseCompose(app.compose) as Record<string, unknown> & { services: Record<string, Record<string, unknown>>; volumes?: Record<string, unknown> };
  delete doc.services[row.service];
  for (const service of Object.values(doc.services)) {
    const deps = service.depends_on;
    if (Array.isArray(deps)) {
      const kept = deps.filter((d) => d !== row.service);
      if (kept.length) service.depends_on = kept;
      else delete service.depends_on;
    } else if (deps && typeof deps === 'object') {
      delete (deps as Record<string, unknown>)[row.service];
      if (Object.keys(deps).length === 0) delete service.depends_on;
    }
  }
  if (doc.volumes) {
    delete doc.volumes[ADDONS.postgres.volume!];
    if (Object.keys(doc.volumes).length === 0) delete doc.volumes;
  }
  const vars = withAddonEnv(readEnv(app), ADDONS['postgres-shared'], sharedDatabaseEnv(app.id));
  db.transaction(() => {
    db.prepare('UPDATE apps SET compose = ?, env_enc = ?, updated_at = ? WHERE id = ?').run(YAML.stringify(doc), writeEnv(vars), Date.now(), app.id);
    db.prepare("DELETE FROM addons WHERE app_id = ? AND type = 'postgres'").run(app.id);
    db.prepare('INSERT INTO addons (app_id, type, service, created_at) VALUES (?, ?, ?, ?)').run(app.id, 'postgres-shared', sharedDatabase(app.id).name, Date.now());
  })();
  return before;
}

export function restoreAddonSnapshot(appId: string, snapshot: AddonSnapshot): void {
  db.transaction(() => {
    db.prepare('UPDATE apps SET compose = ?, env_enc = ?, updated_at = ? WHERE id = ?').run(snapshot.compose, snapshot.envEnc, Date.now(), appId);
    db.prepare('DELETE FROM addons WHERE app_id = ?').run(appId);
    const insert = db.prepare('INSERT INTO addons (app_id, type, service, created_at) VALUES (?, ?, ?, ?)');
    for (const r of snapshot.rows) insert.run(r.app_id, r.type, r.service, r.created_at);
  })();
}

/**
 * The environment a preview of this app should run with: the parent's, except that a preview of
 * an app on the shared Postgres server gets the variables for a database of its own.
 */
export function previewEnv(parent: AppRow, previewId: string): string | null {
  if (!usesSharedPostgres(parent)) return parent.env_enc;
  return writeEnv(withAddonEnv(readEnv(parent), ADDONS['postgres-shared'], sharedDatabaseEnv(previewId)));
}

/** The name of the app's database on the shared server, for messages. */
export const sharedDatabaseName = (appId: string): string => sharedDatabase(appId).name;
