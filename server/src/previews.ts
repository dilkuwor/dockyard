import { setServiceImage } from './compose.js';
import { encrypt, newHookSecret, randomId } from './crypto.js';
import { db, type AppRow } from './db.js';
import { compose, removeAppDir } from './docker.js';

/**
 * Preview deployments: when an app has them turned on, a push to any branch other than its
 * deploy branch gets its own app at <slug>-<branch>.<domain>, with the parent's compose file,
 * port and environment, and goes away when the branch is deleted.
 */

/** "feature/Login-Form" → "feature-login-form", short enough to fit the address with the slug. */
export function branchSlug(branch: string, room: number): string {
  const cleaned = branch
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return (cleaned || 'branch').slice(0, Math.max(3, room)).replace(/-+$/g, '');
}

export function previewsOf(parentId: string): AppRow[] {
  return db.prepare('SELECT * FROM apps WHERE preview_of = ? ORDER BY created_at DESC').all(parentId) as AppRow[];
}

function uniqueSlug(base: string): string {
  let slug = base;
  for (let i = 2; db.prepare('SELECT 1 FROM apps WHERE slug = ?').get(slug); i++) slug = `${base.slice(0, 60)}-${i}`;
  return slug;
}

/** The preview app for a branch, created on first push. Its image is updated on every push. */
export function findOrCreatePreview(parent: AppRow, branch: string, image: string): AppRow {
  const existing = db.prepare('SELECT * FROM apps WHERE preview_of = ? AND branch = ?').get(parent.id, branch) as AppRow | undefined;
  if (existing) {
    // Keep the preview in step with its parent: same compose shape and variables, new image.
    const composeText = setServiceImage(parent.compose, parent.primary_service, image);
    db.prepare('UPDATE apps SET compose = ?, env_enc = ?, port = ?, primary_service = ?, domain = ?, updated_at = ? WHERE id = ?').run(
      composeText,
      parent.env_enc,
      parent.port,
      parent.primary_service,
      parent.domain,
      Date.now(),
      existing.id,
    );
    return { ...existing, compose: composeText, env_enc: parent.env_enc, port: parent.port, primary_service: parent.primary_service, domain: parent.domain };
  }

  const now = Date.now();
  const slug = uniqueSlug(`${parent.slug}-${branchSlug(branch, 62 - parent.slug.length)}`);
  const row: AppRow = {
    id: randomId(10),
    name: `${parent.name} (${branch})`.slice(0, 60),
    slug,
    source_type: parent.source_type,
    compose: setServiceImage(parent.compose, parent.primary_service, image),
    primary_service: parent.primary_service,
    port: parent.port,
    env_enc: parent.env_enc,
    hook_secret_enc: encrypt(newHookSecret()),
    current_deployment_id: null,
    domain: parent.domain,
    deploy_branch: branch,
    previews_enabled: 0,
    preview_of: parent.id,
    branch,
    backup_enabled: 0,
    created_at: now,
    updated_at: now,
  };
  db.prepare(
    `INSERT INTO apps (id, name, slug, source_type, compose, primary_service, port, env_enc, hook_secret_enc,
      current_deployment_id, domain, deploy_branch, previews_enabled, preview_of, branch, backup_enabled, created_at, updated_at)
     VALUES (@id, @name, @slug, @source_type, @compose, @primary_service, @port, @env_enc, @hook_secret_enc,
      @current_deployment_id, @domain, @deploy_branch, @previews_enabled, @preview_of, @branch, @backup_enabled, @created_at, @updated_at)`,
  ).run(row);
  return row;
}

/** Stops and deletes a preview, including its volumes: previews hold nothing worth keeping. */
export async function removePreviewApp(preview: AppRow): Promise<void> {
  await compose.down(preview.id, true);
  removeAppDir(preview.id);
  db.prepare('DELETE FROM apps WHERE id = ?').run(preview.id);
}

/** Removes the preview for a branch, if there is one. Returns what was removed. */
export async function removePreview(parentId: string, branch: string): Promise<{ id: string; slug: string } | null> {
  const preview = db.prepare('SELECT * FROM apps WHERE preview_of = ? AND branch = ?').get(parentId, branch) as AppRow | undefined;
  if (!preview) return null;
  await removePreviewApp(preview);
  return { id: preview.id, slug: preview.slug };
}
