import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

fs.mkdirSync(config.dataDir, { recursive: true });
fs.mkdirSync(config.appsDir, { recursive: true });

export const db = new Database(path.join(config.dataDir, 'dockyard.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS apps (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  source_type TEXT NOT NULL CHECK (source_type IN ('image', 'compose')),
  compose TEXT NOT NULL,
  primary_service TEXT NOT NULL,
  port INTEGER NOT NULL,
  env_enc TEXT,
  hook_secret_enc TEXT NOT NULL,
  current_deployment_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS deployments (
  id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed')),
  trigger TEXT NOT NULL,
  image TEXT,
  commit_sha TEXT,
  compose TEXT NOT NULL,
  rollback_of TEXT,
  log TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  finished_at INTEGER
);

CREATE INDEX IF NOT EXISTS deployments_app_idx ON deployments(app_id, created_at DESC);

-- Registry sign-ins saved from the dashboard, for pulling private images.
CREATE TABLE IF NOT EXISTS registries (
  registry TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  token_enc TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Server-wide settings changed from the dashboard.
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- API tokens for agents and scripts. Only the SHA-256 of each token is stored.
CREATE TABLE IF NOT EXISTS tokens (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER
);

-- Local images Dockyard pulled; pruning only ever considers these.
CREATE TABLE IF NOT EXISTS images (
  id TEXT PRIMARY KEY,
  ref TEXT NOT NULL
);

-- Extra hostnames an app answers on, such as www.example.com, besides its <slug>.<domain> address.
CREATE TABLE IF NOT EXISTS hostnames (
  hostname TEXT PRIMARY KEY,
  app_id TEXT NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  zone_id TEXT,
  created_at INTEGER NOT NULL
);

-- Backup runs and what each one holds per app. Files live under the backup directory.
CREATE TABLE IF NOT EXISTS backups (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('scheduled', 'manual')),
  status TEXT NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')),
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  size INTEGER NOT NULL DEFAULT 0,
  log TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS backup_items (
  backup_id TEXT NOT NULL REFERENCES backups(id) ON DELETE CASCADE,
  app_id TEXT NOT NULL,
  app_name TEXT NOT NULL,
  file TEXT,
  size INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('succeeded', 'failed', 'empty')),
  detail TEXT,
  PRIMARY KEY (backup_id, app_id)
);

-- Managed add-on services (Postgres, Redis, MinIO) Dockyard put into an app's compose file.
CREATE TABLE IF NOT EXISTS addons (
  app_id TEXT NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  service TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (app_id, type)
);
`);

/** Columns added after the first release. Each is added once; SQLite has no IF NOT EXISTS for columns. */
function addColumn(table: string, column: string, definition: string): void {
  const columns = (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
  if (!columns.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}
// The public domain an app lives under. NULL means the domain chosen at onboarding.
addColumn('apps', 'domain', 'TEXT');
// Preview deployments: the branch that deploys the app itself, whether other branches get previews,
// and for a preview app, which app and branch it belongs to.
addColumn('apps', 'deploy_branch', 'TEXT');
addColumn('apps', 'previews_enabled', 'INTEGER NOT NULL DEFAULT 0');
addColumn('apps', 'preview_of', 'TEXT');
addColumn('apps', 'branch', 'TEXT');
// Whether the app's data is included in backups. Previews never are.
addColumn('apps', 'backup_enabled', 'INTEGER NOT NULL DEFAULT 1');
// Deploy notes: what the hook told us, and the environment as it was for this deployment.
addColumn('deployments', 'commit_message', 'TEXT');
addColumn('deployments', 'branch', 'TEXT');
addColumn('deployments', 'env_enc', 'TEXT');

export interface AppRow {
  id: string;
  name: string;
  slug: string;
  source_type: 'image' | 'compose';
  compose: string;
  primary_service: string;
  port: number;
  env_enc: string | null;
  hook_secret_enc: string;
  current_deployment_id: string | null;
  domain: string | null;
  deploy_branch: string | null;
  previews_enabled: number;
  preview_of: string | null;
  branch: string | null;
  backup_enabled: number;
  created_at: number;
  updated_at: number;
}

export interface DeploymentRow {
  id: string;
  app_id: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  trigger: 'create' | 'manual' | 'webhook' | 'rollback';
  image: string | null;
  commit_sha: string | null;
  compose: string;
  rollback_of: string | null;
  commit_message: string | null;
  branch: string | null;
  env_enc: string | null;
  log: string;
  created_at: number;
  finished_at: number | null;
}

export function getSetting(key: string): string | null {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setSetting(key: string, value: string | null): void {
  if (value === null) db.prepare('DELETE FROM settings WHERE key = ?').run(key);
  else db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}

/** Deployments left mid-flight by a restart can never finish; mark them failed. */
export function recoverInterruptedDeployments(): void {
  db.prepare(
    `UPDATE deployments SET status = 'failed', finished_at = ?, log = log || ?
     WHERE status IN ('queued', 'running')`,
  ).run(Date.now(), '\nDeployment interrupted: Dockyard restarted before it finished.\n');
}
