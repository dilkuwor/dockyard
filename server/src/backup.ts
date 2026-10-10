import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { addonsOf } from './addons.js';
import { config } from './config.js';
import { randomId } from './crypto.js';
import { db, getSetting, setSetting, type AppRow } from './db.js';
import { compose, projectName, run } from './docker.js';
import { badRequest, HttpError, notFound } from './errors.js';

/**
 * Local backups. A run makes one archive of Dockyard's own state (database and rendered
 * compose files) and one archive per app with data: its named volumes as files, and a
 * pg_dump instead of raw files for the Postgres add-on. Volumes are copied by a short-lived
 * helper container that has them mounted read-only, while the app is paused for the
 * seconds the copy takes. Runs live in dated folders under the backup directory, which
 * docker-compose.yml bind-mounts from the host, and older runs are pruned to the retention.
 */
const HELPER_IMAGE = 'alpine:3.20';
const STATE_FILE = 'dockyard.tar.gz';

export interface BackupSettings {
  enabled: boolean;
  /** "HH:MM" in the server's local time. */
  time: string;
  /** How many runs to keep. */
  retention: number;
}

const SETTING = 'backup';
const defaults: BackupSettings = { enabled: false, time: '03:00', retention: 7 };

export function backupSettings(): BackupSettings {
  const raw = getSetting(SETTING);
  return raw ? { ...defaults, ...(JSON.parse(raw) as Partial<BackupSettings>) } : defaults;
}

export function saveBackupSettings(input: Partial<BackupSettings>): BackupSettings {
  const current = backupSettings();
  const next: BackupSettings = {
    enabled: input.enabled !== undefined ? input.enabled === true : current.enabled,
    time: input.time !== undefined ? String(input.time) : current.time,
    retention: input.retention !== undefined ? Number(input.retention) : current.retention,
  };
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(next.time)) throw badRequest('Give the time as HH:MM, for example 03:00.');
  if (!Number.isInteger(next.retention) || next.retention < 1 || next.retention > 365) throw badRequest('Keep between 1 and 365 backups.');
  setSetting(SETTING, JSON.stringify(next));
  return next;
}

export interface BackupRow {
  id: string;
  kind: 'scheduled' | 'manual';
  status: 'running' | 'succeeded' | 'failed';
  started_at: number;
  finished_at: number | null;
  size: number;
  log: string;
}

export interface BackupItemRow {
  backup_id: string;
  app_id: string;
  app_name: string;
  file: string | null;
  size: number;
  status: 'succeeded' | 'failed' | 'empty';
  detail: string | null;
}

const runDir = (id: string) => path.join(config.backupDir, id);

export const backupDirReady = (): boolean => fs.existsSync(config.backupDir);

/** The host path behind /backups, so a helper container can be given the same directory. */
async function hostBackupDir(): Promise<string> {
  const res = await run(['inspect', '--format', '{{range .Mounts}}{{if eq .Destination "/backups"}}{{.Source}}{{end}}{{end}}', os.hostname()]);
  const source = res.stdout.trim();
  if (res.code !== 0 || !source) {
    throw new HttpError(500, 'The backup directory is not mounted at /backups. Pull the latest docker-compose.yml and run docker compose up -d once by hand.');
  }
  return source;
}

async function projectVolumes(appId: string): Promise<string[]> {
  const res = await run(['volume', 'ls', '--filter', `label=com.docker.compose.project=${projectName(appId)}`, '--format', '{{.Name}}']);
  return res.stdout.split('\n').map((l) => l.trim()).filter(Boolean);
}

/** Streams `docker compose exec` output into a file, byte for byte (pg_dump output is binary). */
function execToFile(appId: string, service: string, cmd: string[], file: string): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn('docker', ['compose', '-p', projectName(appId), 'exec', '-T', service, ...cmd]);
    const out = fs.createWriteStream(file);
    let stderr = '';
    child.stdout.pipe(out);
    child.stderr.on('data', (c) => (stderr += c.toString()));
    child.on('error', (err) => resolve({ code: 127, stderr: err.message }));
    child.on('close', (code) => out.end(() => resolve({ code: code ?? 1, stderr })));
  });
}

/** Pipes a file into `docker compose exec` (for pg_restore). */
function fileToExec(appId: string, service: string, cmd: string[], file: string): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn('docker', ['compose', '-p', projectName(appId), 'exec', '-T', service, ...cmd]);
    let stderr = '';
    child.stderr.on('data', (c) => (stderr += c.toString()));
    child.on('error', (err) => resolve({ code: 127, stderr: err.message }));
    child.on('close', (code) => resolve({ code: code ?? 1, stderr }));
    fs.createReadStream(file).pipe(child.stdin);
  });
}

const fileSize = (file: string): number => {
  try {
    return fs.statSync(file).size;
  } catch {
    return 0;
  }
};

let running = false;
export const backupRunning = (): boolean => running;

/** One full run. Returns the backup id at once; progress and errors go into its log and items. */
export async function runBackup(kind: BackupRow['kind']): Promise<string> {
  if (running) throw badRequest('A backup is already running.');
  if (!backupDirReady()) throw badRequest('The backup directory is not mounted. Pull the latest docker-compose.yml and run docker compose up -d once by hand.');
  running = true;
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const id = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}-${randomId(4)}`;
  const dir = runDir(id);
  const lines: string[] = [];
  const log = (line: string) => {
    lines.push(line);
    db.prepare('UPDATE backups SET log = ? WHERE id = ?').run(lines.join('\n'), id);
  };
  db.prepare('INSERT INTO backups (id, kind, status, started_at, size, log) VALUES (?, ?, ?, ?, 0, ?)').run(id, kind, 'running', Date.now(), '');

  void (async () => {
    let total = 0;
    let failed = false;
    try {
      fs.mkdirSync(dir, { recursive: true });
      const hostDir = await hostBackupDir();
      log(`Backup ${id} started (${kind}).`);

      // 1. Dockyard's own state: a consistent copy of the database plus the rendered compose files.
      const stateDir = path.join(dir, 'dockyard');
      fs.mkdirSync(stateDir, { recursive: true });
      await db.backup(path.join(stateDir, 'dockyard.db'));
      fs.cpSync(config.appsDir, path.join(stateDir, 'apps'), { recursive: true });
      const stateTar = await run(['run', '--rm', '-v', `${hostDir}/${id}:/work`, HELPER_IMAGE, 'sh', '-c', `cd /work && tar czf ${STATE_FILE} dockyard && rm -rf dockyard`]);
      if (stateTar.code !== 0) throw new Error(`Could not archive Dockyard's state: ${stateTar.stderr.trim()}`);
      total += fileSize(path.join(dir, STATE_FILE));
      log(`Dockyard state archived (${Math.round(fileSize(path.join(dir, STATE_FILE)) / 1024)} KB).`);

      // 2. One archive per app with data. Previews are disposable copies and never backed up;
      //    other apps can opt out on their Settings tab.
      const apps = db.prepare('SELECT * FROM apps WHERE preview_of IS NULL ORDER BY name').all() as AppRow[];
      for (const app of apps) {
        if (app.backup_enabled === 0) {
          log(`${app.name}: excluded by its settings, skipped.`);
          continue;
        }
        const item = (status: BackupItemRow['status'], file: string | null, size: number, detail: string | null) =>
          db.prepare('INSERT INTO backup_items (backup_id, app_id, app_name, file, size, status, detail) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, app.id, app.name, file, size, status, detail);
        try {
          const volumes = await projectVolumes(app.id);
          const postgres = addonsOf(app.id).find((a) => a.type === 'postgres');
          const pgVolume = volumes.find((v) => v.endsWith('_postgres-data'));
          const fileVolumes = volumes.filter((v) => v !== pgVolume);
          if (volumes.length === 0) {
            item('empty', null, 0, 'No volumes: nothing to back up.');
            log(`${app.name}: no data volumes, skipped.`);
            continue;
          }

          const appDir = path.join(dir, app.id);
          fs.mkdirSync(appDir, { recursive: true });
          const manifest = {
            app: { id: app.id, name: app.name, slug: app.slug, domain: app.domain, deploymentId: app.current_deployment_id },
            volumes: fileVolumes,
            postgres: postgres ? 'postgres.dump' : null,
            createdAt: Date.now(),
          };
          fs.writeFileSync(path.join(appDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

          if (postgres) {
            const dump = await execToFile(app.id, postgres.service, ['pg_dump', '-U', 'app', '-d', 'app', '-Fc'], path.join(appDir, 'postgres.dump'));
            if (dump.code !== 0) throw new Error(`pg_dump failed: ${dump.stderr.trim() || 'is the app running?'}`);
          }

          if (fileVolumes.length) {
            const mounts = fileVolumes.flatMap((v) => ['-v', `${v}:/volumes/${v}:ro`]);
            await compose.pause(app.id);
            try {
              const tar = await run(['run', '--rm', ...mounts, '-v', `${hostDir}/${id}/${app.id}:/out`, HELPER_IMAGE, 'sh', '-c', 'tar czf /out/volumes.tar.gz -C /volumes .']);
              if (tar.code !== 0) throw new Error(`Copying volumes failed: ${tar.stderr.trim()}`);
            } finally {
              await compose.unpause(app.id);
            }
          }

          const pack = await run(['run', '--rm', '-v', `${hostDir}/${id}:/work`, HELPER_IMAGE, 'sh', '-c', `cd /work && tar czf ${app.id}.tar.gz ${app.id} && rm -rf ${app.id}`]);
          if (pack.code !== 0) throw new Error(`Packing the archive failed: ${pack.stderr.trim()}`);
          const size = fileSize(path.join(dir, `${app.id}.tar.gz`));
          total += size;
          item('succeeded', `${app.id}.tar.gz`, size, `${fileVolumes.length} volume${fileVolumes.length === 1 ? '' : 's'}${postgres ? ' + Postgres dump' : ''}`);
          log(`${app.name}: ${Math.round(size / 1024)} KB.`);
        } catch (err) {
          failed = true;
          item('failed', null, 0, (err as Error).message);
          log(`${app.name}: FAILED. ${(err as Error).message}`);
        }
      }

      db.prepare('UPDATE backups SET status = ?, finished_at = ?, size = ? WHERE id = ?').run(failed ? 'failed' : 'succeeded', Date.now(), total, id);
      log(failed ? 'Finished with errors.' : `Finished. ${Math.round(total / 1024)} KB in total.`);
      pruneBackups(backupSettings().retention, log);
    } catch (err) {
      db.prepare('UPDATE backups SET status = ?, finished_at = ?, size = ? WHERE id = ?').run('failed', Date.now(), total, id);
      log(`FAILED: ${(err as Error).message}`);
    } finally {
      running = false;
    }
  })();

  return id;
}

/** Deletes the oldest runs beyond the retention count, files and records both. */
export function pruneBackups(retention: number, log?: (line: string) => void): void {
  const rows = db.prepare("SELECT id FROM backups WHERE status != 'running' ORDER BY started_at DESC").all() as { id: string }[];
  for (const row of rows.slice(retention)) {
    deleteBackup(row.id);
    log?.(`Pruned old backup ${row.id}.`);
  }
}

export function deleteBackup(id: string): void {
  const row = db.prepare('SELECT * FROM backups WHERE id = ?').get(id) as BackupRow | undefined;
  if (!row) throw notFound('Backup');
  if (row.status === 'running') throw badRequest('That backup is still running.');
  fs.rmSync(runDir(id), { recursive: true, force: true });
  db.prepare('DELETE FROM backup_items WHERE backup_id = ?').run(id);
  db.prepare('DELETE FROM backups WHERE id = ?').run(id);
}

export const listBackups = (): BackupRow[] => db.prepare('SELECT * FROM backups ORDER BY started_at DESC LIMIT 100').all() as BackupRow[];
export const backupItems = (backupId: string): BackupItemRow[] =>
  db.prepare('SELECT * FROM backup_items WHERE backup_id = ? ORDER BY app_name').all(backupId) as BackupItemRow[];
export const appBackups = (appId: string): (BackupItemRow & { started_at: number; kind: string })[] =>
  db
    .prepare(
      `SELECT i.*, b.started_at, b.kind FROM backup_items i JOIN backups b ON b.id = i.backup_id
       WHERE i.app_id = ? AND i.status = 'succeeded' ORDER BY b.started_at DESC LIMIT 50`,
    )
    .all(appId) as (BackupItemRow & { started_at: number; kind: string })[];

/**
 * Puts an app's data back from a backup: its volumes are replaced from the archive and the
 * Postgres add-on's database is restored from the dump. The app's settings and image stay as
 * they are. The volumes as they were are archived first, next to the backup, as a safety copy.
 */
export async function restoreApp(app: AppRow, backupId: string, log: (line: string) => void): Promise<void> {
  const item = db.prepare("SELECT * FROM backup_items WHERE backup_id = ? AND app_id = ? AND status = 'succeeded'").get(backupId, app.id) as BackupItemRow | undefined;
  if (!item?.file) throw notFound('A backup of this app in that run');
  if (running) throw badRequest('A backup is running; try again when it has finished.');
  const hostDir = await hostBackupDir();
  const dir = runDir(backupId);
  const archive = path.join(dir, item.file);
  if (!fs.existsSync(archive)) throw new HttpError(410, 'The backup file is gone from the backup directory.');

  // Unpack next to the archive so the helper and this process both see it.
  const work = path.join(dir, `restore-${app.id}`);
  fs.rmSync(work, { recursive: true, force: true });
  fs.mkdirSync(work, { recursive: true });
  const unpack = await run(['run', '--rm', '-v', `${hostDir}/${backupId}:/work`, HELPER_IMAGE, 'sh', '-c', `cd /work/restore-${app.id} && tar xzf ../${item.file}`]);
  if (unpack.code !== 0) throw new HttpError(500, `Could not unpack the backup: ${unpack.stderr.trim()}`);
  const manifest = JSON.parse(fs.readFileSync(path.join(work, app.id, 'manifest.json'), 'utf8')) as { volumes: string[]; postgres: string | null };

  try {
    log('Stopping the app.');
    const down = await compose.down(app.id, false);
    if (down.code !== 0) throw new Error(`Could not stop the app: ${down.stderr.trim()}`);

    const volumes = await projectVolumes(app.id);
    const pgVolume = volumes.find((v) => v.endsWith('_postgres-data'));
    const fileVolumes = manifest.volumes.filter((v) => volumes.includes(v));
    const missing = manifest.volumes.filter((v) => !volumes.includes(v));
    if (missing.length) log(`Skipping volumes the app no longer has: ${missing.join(', ')}.`);

    if (fileVolumes.length) {
      const mounts = fileVolumes.flatMap((v) => ['-v', `${v}:/volumes/${v}`]);
      log(`Keeping a safety copy of the current data, then restoring ${fileVolumes.length} volume${fileVolumes.length === 1 ? '' : 's'}.`);
      const script = [
        `tar czf /work/pre-restore-${app.id}-${Date.now()}.tar.gz -C /volumes .`,
        ...fileVolumes.map((v) => `find /volumes/${v} -mindepth 1 -delete`),
        `tar xzf /work/restore-${app.id}/${app.id}/volumes.tar.gz -C /volumes`,
      ].join(' && ');
      const res = await run(['run', '--rm', ...mounts, '-v', `${hostDir}/${backupId}:/work`, HELPER_IMAGE, 'sh', '-c', script]);
      if (res.code !== 0) throw new Error(`Restoring volumes failed: ${res.stderr.trim()}`);
    }

    if (manifest.postgres && pgVolume) {
      // A fresh data directory, so Postgres initialises itself; the dump is loaded once it is up.
      log('Resetting the Postgres data directory.');
      const wipe = await run(['run', '--rm', '-v', `${pgVolume}:/pg`, HELPER_IMAGE, 'sh', '-c', 'find /pg -mindepth 1 -delete']);
      if (wipe.code !== 0) throw new Error(`Could not reset the database volume: ${wipe.stderr.trim()}`);
    }

    log('Starting the app.');
    const up = await compose.up(app.id, log);
    if (up.code !== 0) throw new Error('The app did not come back up. Check its logs.');

    if (manifest.postgres && pgVolume) {
      const service = addonsOf(app.id).find((a) => a.type === 'postgres')?.service ?? 'postgres';
      log('Loading the Postgres dump.');
      const res = await fileToExec(app.id, service, ['pg_restore', '-U', 'app', '-d', 'app', '--clean', '--if-exists', '--no-owner'], path.join(work, app.id, 'postgres.dump'));
      // With --clean, pg_restore exits 1 over harmless "does not exist" notices; real failures say "error".
      if (res.code !== 0 && /error/i.test(res.stderr)) throw new Error(`pg_restore failed: ${res.stderr.trim().split('\n').slice(-3).join(' ')}`);
    }
    log('Restore finished.');
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

/** Runs the daily backup when the configured time comes round. Checked every minute. */
export function startBackupScheduler(log: (msg: string) => void): void {
  let lastDay = '';
  setInterval(() => {
    const settings = backupSettings();
    if (!settings.enabled) return;
    const now = new Date();
    const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const day = now.toDateString();
    if (hhmm !== settings.time || lastDay === day) return;
    lastDay = day;
    runBackup('scheduled').catch((err) => log(`Scheduled backup did not start: ${(err as Error).message}`));
  }, 60_000).unref();
}
