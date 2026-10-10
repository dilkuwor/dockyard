import YAML from 'yaml';
import { parseCompose } from './compose.js';
import { decrypt, encrypt, randomId } from './crypto.js';
import { db, type AppRow } from './db.js';
import { badRequest } from './errors.js';

/**
 * Managed add-ons: a database, cache or object store added to an app's compose file as
 * another service with a named volume, with the connection details put into the app's
 * environment. The compose file stays plain compose, so it can still be edited by hand.
 */
export type AddonType = 'postgres' | 'redis' | 'minio';

interface AddonSpec {
  type: AddonType;
  label: string;
  service: string;
  volume: string;
  /** Builds the service definition and the variables the app gets, with fresh secrets. */
  make: () => { service: Record<string, unknown>; env: Record<string, string> };
  /** The variable names this add-on owns, so removal can take them away again. */
  envKeys: string[];
  note: string;
}

const secret = () => randomId(24);

export const ADDONS: Record<AddonType, AddonSpec> = {
  postgres: {
    type: 'postgres',
    label: 'PostgreSQL 16',
    service: 'postgres',
    volume: 'postgres-data',
    envKeys: ['DATABASE_URL', 'PGHOST', 'PGPORT', 'PGUSER', 'PGPASSWORD', 'PGDATABASE'],
    note: 'Reachable from the app as host "postgres" on port 5432. Data lives in the named volume "postgres-data".',
    make: () => {
      const password = secret();
      return {
        service: {
          image: 'postgres:16-alpine',
          environment: { POSTGRES_USER: 'app', POSTGRES_PASSWORD: password, POSTGRES_DB: 'app' },
          volumes: ['postgres-data:/var/lib/postgresql/data'],
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
          image: 'minio/minio:latest',
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
  service: string;
  created_at: number;
}

export const addonsOf = (appId: string): AddonRow[] =>
  db.prepare('SELECT * FROM addons WHERE app_id = ? ORDER BY created_at').all(appId) as AddonRow[];

export function parseAddonType(value: unknown): AddonType {
  const type = String(value ?? '');
  if (!(type in ADDONS)) throw badRequest(`Unknown add-on. Choose one of: ${Object.keys(ADDONS).join(', ')}.`);
  return type as AddonType;
}

type Env = { key: string; value: string }[];
const readEnv = (app: AppRow): Env => (app.env_enc ? (JSON.parse(decrypt(app.env_enc)) as Env) : []);
const writeEnv = (vars: Env): string | null => (vars.length ? encrypt(JSON.stringify(vars)) : null);

/** Puts the add-on's service and volume into the compose file and its variables into the environment. */
export function addAddon(app: AppRow, type: AddonType): { envKeys: string[] } {
  const spec = ADDONS[type];
  if (addonsOf(app.id).some((a) => a.type === type)) throw badRequest(`${spec.label} is already added to this app.`);
  const doc = parseCompose(app.compose) as Record<string, unknown> & { services: Record<string, unknown>; volumes?: Record<string, unknown> };
  if (doc.services[spec.service]) {
    throw badRequest(`The compose file already has a service named "${spec.service}". Rename it first, or manage it yourself.`);
  }
  const { service, env } = spec.make();
  doc.services[spec.service] = service;
  doc.volumes = { ...(doc.volumes ?? {}), [spec.volume]: {} };
  const composeText = YAML.stringify(doc);

  const vars = readEnv(app).filter((v) => !spec.envKeys.includes(v.key));
  for (const [key, value] of Object.entries(env)) vars.push({ key, value });

  db.transaction(() => {
    db.prepare('UPDATE apps SET compose = ?, env_enc = ?, updated_at = ? WHERE id = ?').run(composeText, writeEnv(vars), Date.now(), app.id);
    db.prepare('INSERT INTO addons (app_id, type, service, created_at) VALUES (?, ?, ?, ?)').run(app.id, type, spec.service, Date.now());
  })();
  return { envKeys: Object.keys(env) };
}

/** Takes the service, its volume definition and its variables out again. The Docker volume itself is kept. */
export function removeAddon(app: AppRow, type: AddonType): void {
  const spec = ADDONS[type];
  const row = addonsOf(app.id).find((a) => a.type === type);
  if (!row) throw badRequest(`${spec.label} is not added to this app.`);
  const doc = parseCompose(app.compose) as Record<string, unknown> & { services: Record<string, unknown>; volumes?: Record<string, unknown> };
  delete doc.services[row.service];
  if (doc.volumes) {
    delete doc.volumes[spec.volume];
    if (Object.keys(doc.volumes).length === 0) delete doc.volumes;
  }
  const composeText = YAML.stringify(doc);
  const vars = readEnv(app).filter((v) => !spec.envKeys.includes(v.key));

  db.transaction(() => {
    db.prepare('UPDATE apps SET compose = ?, env_enc = ?, updated_at = ? WHERE id = ?').run(composeText, writeEnv(vars), Date.now(), app.id);
    db.prepare('DELETE FROM addons WHERE app_id = ? AND type = ?').run(app.id, type);
  })();
}
