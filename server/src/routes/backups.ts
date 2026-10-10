import type { FastifyInstance } from 'fastify';
import {
  appBackups,
  backupDirReady,
  backupItems,
  backupRunning,
  backupSettings,
  deleteBackup,
  listBackups,
  restoreApp,
  runBackup,
  saveBackupSettings,
} from '../backup.js';
import { config } from '../config.js';
import { db, type AppRow } from '../db.js';
import { notFound } from '../errors.js';

/** Session only: backups hold every app's data, and a restore replaces it. */
export async function backupRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/backups', async () => ({
    settings: backupSettings(),
    ready: backupDirReady(),
    directory: config.backupDir,
    running: backupRunning(),
    // Apps switched out of backups on their Settings tab, so a forgotten switch is visible here.
    excluded: (db.prepare('SELECT id, name FROM apps WHERE backup_enabled = 0 AND preview_of IS NULL ORDER BY name').all() as { id: string; name: string }[]),
    backups: listBackups().map((b) => ({
      id: b.id,
      kind: b.kind,
      status: b.status,
      startedAt: b.started_at,
      finishedAt: b.finished_at,
      size: b.size,
    })),
  }));

  app.put('/api/backups/settings', async (req) => saveBackupSettings((req.body ?? {}) as Record<string, unknown>));

  app.post('/api/backups/run', async (_req, reply) => {
    const id = await runBackup('manual');
    reply.code(202);
    return { id };
  });

  app.get<{ Params: { id: string } }>('/api/backups/:id', async (req) => {
    const row = listBackups().find((b) => b.id === req.params.id);
    if (!row) throw notFound('Backup');
    return {
      id: row.id,
      kind: row.kind,
      status: row.status,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      size: row.size,
      log: row.log,
      items: backupItems(row.id).map((i) => ({ appId: i.app_id, appName: i.app_name, size: i.size, status: i.status, detail: i.detail })),
    };
  });

  app.delete<{ Params: { id: string } }>('/api/backups/:id', async (req) => {
    deleteBackup(req.params.id);
    return { ok: true };
  });

  /** The backups that hold data for one app, newest first. */
  app.get<{ Params: { appId: string } }>('/api/backups/app/:appId', async (req) =>
    appBackups(req.params.appId).map((i) => ({ backupId: i.backup_id, startedAt: i.started_at, kind: i.kind, size: i.size, detail: i.detail })),
  );

  /** Replaces the app's data from a backup. Returns the step log either way. */
  app.post<{ Params: { id: string; appId: string } }>('/api/backups/:id/restore/:appId', async (req, reply) => {
    const row = db.prepare('SELECT * FROM apps WHERE id = ?').get(req.params.appId) as AppRow | undefined;
    if (!row) throw notFound('App');
    const lines: string[] = [];
    try {
      await restoreApp(row, req.params.id, (line) => lines.push(line));
      return { ok: true, log: lines.join('\n') };
    } catch (err) {
      reply.code(500);
      return { ok: false, error: (err as Error).message, log: lines.join('\n') };
    }
  });
}
