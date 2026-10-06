import { parseCompose } from './compose.js';
import { db } from './db.js';
import { imagesInUse, inspectImages, removeImage, type ImageInfo } from './docker.js';
import { HttpError } from './errors.js';

export interface UnusedImage extends ImageInfo {
  name: string;
}

/**
 * Remembers which local images Dockyard pulled for these compose files, so
 * pruning never touches images that belong to anything else on the machine.
 */
export async function trackImages(composeTexts: string[]): Promise<void> {
  const refs = new Set<string>();
  for (const text of composeTexts) {
    try {
      for (const svc of Object.values(parseCompose(text).services)) {
        if (typeof svc.image === 'string') refs.add(svc.image);
      }
    } catch {
      // Unparseable history has no images to track.
    }
  }
  const upsert = db.prepare('INSERT INTO images (id, ref) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET ref = excluded.ref');
  for (const ref of refs) {
    const [image] = await inspectImages([ref]);
    if (image) upsert.run(image.id, ref);
  }
}

/** Picks up images from deployments made before image tracking existed. */
export async function trackDeployedImages(): Promise<void> {
  const rows = db.prepare('SELECT DISTINCT compose FROM deployments').all() as { compose: string }[];
  await trackImages(rows.map((r) => r.compose));
}

/** Images Dockyard pulled that no container on this machine, running or stopped, uses any more. */
export async function unusedImages(): Promise<UnusedImage[]> {
  const rows = db.prepare('SELECT id, ref FROM images').all() as { id: string; ref: string }[];
  const inUse = await imagesInUse();
  if (!inUse) throw new HttpError(503, 'Could not ask Docker which images are in use. Try again.');
  const refs = new Map(rows.map((r) => [r.id, r.ref]));
  const present = await inspectImages(rows.map((r) => r.id));
  return present
    .filter((image) => !inUse.has(image.id))
    .map((image) => ({ ...image, name: image.tags[0] ?? refs.get(image.id) ?? image.id }));
}

export async function pruneImages(): Promise<{ removed: number; failed: number; bytes: number }> {
  if (db.prepare("SELECT 1 FROM deployments WHERE status IN ('queued', 'running')").get()) {
    throw new HttpError(409, 'A deployment is in progress. Try again when it finishes.');
  }
  const forget = db.prepare('DELETE FROM images WHERE id = ?');
  const result = { removed: 0, failed: 0, bytes: 0 };
  for (const image of await unusedImages()) {
    if (await removeImage(image)) {
      forget.run(image.id);
      result.removed += 1;
      result.bytes += image.size;
    } else {
      result.failed += 1;
    }
  }
  return result;
}
