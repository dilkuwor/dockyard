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
`);

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
  log: string;
  created_at: number;
  finished_at: number | null;
}

/** Deployments left mid-flight by a restart can never finish; mark them failed. */
export function recoverInterruptedDeployments(): void {
  db.prepare(
    `UPDATE deployments SET status = 'failed', finished_at = ?, log = log || ?
     WHERE status IN ('queued', 'running')`,
  ).run(Date.now(), '\nDeployment interrupted: Dockyard restarted before it finished.\n');
}
