import { spawn } from 'node:child_process';
import type { Readable } from 'node:stream';
import { addonsOf } from './addons.js';
import { parseCompose } from './compose.js';
import { db, type AppRow } from './db.js';
import { lastLine, run } from './docker.js';
import { HttpError, notFound } from './errors.js';
import { queryShared, sharedDatabase } from './postgres.js';

/**
 * Docker volumes Dockyard made for apps that nothing uses any more. Unlike an unused image, a
 * volume cannot be pulled again, so this is deliberately narrow: only volumes Compose created for
 * a Dockyard app project (dy_<app id>), referenced by no container, running or stopped, and not
 * declared by that app's current compose file. Volumes of other projects on the machine, and
 * Dockyard's own (the shared Postgres server, Tailscale), never show up.
 */
export interface UnusedVolume {
  name: string;
  size: number;
  createdAt: string | null;
  appId: string;
  /** Null when the app is gone. */
  appName: string | null;
  /** The volume's key in the compose file, such as "postgres-data". */
  key: string;
  reason: string;
  /** Set when deleting it looks risky, for instance when it may hold the only copy of a database. */
  warning: string | null;
}

const PROJECT_PREFIX = 'dy_';
const HELPER_IMAGE = 'alpine:3.20';

const UNITS: Record<string, number> = { B: 1, kB: 1e3, KB: 1e3, MB: 1e6, GB: 1e9, TB: 1e12 };
function parseSize(text: string): number {
  const m = /^([\d.]+)\s*([kKMGT]?B)$/.exec(text.trim());
  return m ? Math.round(Number(m[1]) * (UNITS[m[2]] ?? 1)) : 0;
}

function parseLabels(text: string): Record<string, string> {
  const labels: Record<string, string> = {};
  for (const pair of text.split(',')) {
    const at = pair.indexOf('=');
    if (at > 0) labels[pair.slice(0, at)] = pair.slice(at + 1);
  }
  return labels;
}

/** Every volume a container on this machine mounts, stopped containers included. */
async function mountedVolumes(): Promise<Set<string>> {
  const ids = await run(['ps', '-aq']);
  if (ids.code !== 0) throw new HttpError(503, `Could not list containers: ${lastLine(ids.stderr)}`);
  const list = ids.stdout.split('\n').filter(Boolean);
  if (!list.length) return new Set();
  const res = await run(['inspect', '--format', '{{range .Mounts}}{{if eq .Type "volume"}}{{.Name}} {{end}}{{end}}', ...list], { timeoutMs: 30_000 });
  if (res.code !== 0) throw new HttpError(503, `Could not inspect containers: ${lastLine(res.stderr)}`);
  return new Set(res.stdout.split(/\s+/).filter(Boolean));
}

function composeVolumeKeys(app: AppRow): Set<string> {
  try {
    const doc = parseCompose(app.compose) as { volumes?: Record<string, unknown> };
    return new Set(Object.keys(doc.volumes ?? {}));
  } catch {
    return new Set();
  }
}

async function sharedDatabaseTables(appId: string): Promise<number | null> {
  try {
    const out = await queryShared(sharedDatabase(appId).name, "SELECT count(*) FROM pg_tables WHERE schemaname NOT IN ('pg_catalog', 'information_schema')");
    return Number(out.trim());
  } catch {
    return null;
  }
}

export async function unusedVolumes(): Promise<UnusedVolume[]> {
  const df = await run(['system', 'df', '-v', '--format', '{{json .Volumes}}'], { timeoutMs: 60_000 });
  if (df.code !== 0) throw new HttpError(503, `Could not ask Docker about volumes: ${lastLine(df.stderr)}`);
  type Row = { Name: string; Labels: string; Links: string; Size: string };
  let rows: Row[];
  try {
    rows = (JSON.parse(df.stdout.trim() || '[]') as Row[] | null) ?? [];
  } catch {
    throw new HttpError(503, 'Docker answered with something unexpected about volumes. Try again.');
  }
  const mounted = await mountedVolumes();
  const apps = new Map((db.prepare('SELECT * FROM apps').all() as AppRow[]).map((a) => [a.id, a]));

  const unused: UnusedVolume[] = [];
  for (const row of rows) {
    const labels = parseLabels(row.Labels ?? '');
    const project = labels['com.docker.compose.project'] ?? '';
    const key = labels['com.docker.compose.volume'] ?? '';
    if (!project.startsWith(PROJECT_PREFIX) || !key) continue;
    if (mounted.has(row.Name) || Number(row.Links) > 0) continue;
    const appId = project.slice(PROJECT_PREFIX.length);
    const app = apps.get(appId);
    if (app && composeVolumeKeys(app).has(key)) continue; // Still the app's; its containers are just not there right now.

    let reason: string;
    let warning: string | null = null;
    if (!app) {
      reason = 'Belonged to an app that has been deleted.';
    } else if (key === 'postgres-data' && addonsOf(app.id).some((a) => a.type === 'postgres-shared')) {
      reason = 'The app\'s old Postgres data, left over from moving it to the shared server.';
      const tables = await sharedDatabaseTables(app.id);
      if (tables === 0) warning = 'The app\'s database on the shared server has no tables, so this volume may hold its only copy. Download it first.';
      if (tables === null) warning = 'Could not check the app\'s database on the shared server. Download this volume first.';
    } else {
      reason = 'No longer in the app\'s compose file: its add-on was removed or the file changed.';
    }
    unused.push({ name: row.Name, size: parseSize(row.Size ?? ''), createdAt: null, appId, appName: app?.name ?? null, key, reason, warning });
  }

  if (unused.length) {
    const inspect = await run(['volume', 'inspect', '--format', '{{.Name}}\t{{.CreatedAt}}', ...unused.map((v) => v.name)]);
    const created = new Map(inspect.stdout.split('\n').filter(Boolean).map((l) => l.split('\t') as [string, string]));
    for (const v of unused) v.createdAt = created.get(v.name) ?? null;
  }
  return unused.sort((a, b) => b.size - a.size);
}

/** Looks the volume up again, so only something that is unused right now can be downloaded or deleted. */
async function findUnused(name: string): Promise<UnusedVolume> {
  const volume = (await unusedVolumes()).find((v) => v.name === name);
  if (!volume) throw notFound('Unused volume');
  return volume;
}

export async function deleteVolume(name: string, confirm: unknown): Promise<{ name: string; size: number }> {
  if (confirm !== name) throw new HttpError(400, 'Type the volume\'s name to confirm.');
  const volume = await findUnused(name);
  // No -f: Docker itself refuses a volume that something started using in the meantime.
  const res = await run(['volume', 'rm', volume.name]);
  if (res.code !== 0) throw new HttpError(409, `Docker did not delete it: ${lastLine(res.stderr)}`);
  return { name: volume.name, size: volume.size };
}

/** A gzipped tar of the volume's files, streamed from a throwaway container that mounts it read-only. */
export async function volumeArchive(name: string): Promise<{ stream: Readable; filename: string; done: Promise<number> }> {
  const volume = await findUnused(name);
  const child = spawn('docker', ['run', '--rm', '-v', `${volume.name}:/volume:ro`, HELPER_IMAGE, 'tar', 'czf', '-', '-C', '/volume', '.']);
  const done = new Promise<number>((resolve) => {
    child.on('error', () => resolve(127));
    child.on('close', (code) => resolve(code ?? 1));
  });
  return { stream: child.stdout, filename: `${volume.name}.tar.gz`, done };
}
