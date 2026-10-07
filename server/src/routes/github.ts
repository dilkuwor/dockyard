import type { FastifyInstance } from 'fastify';
import { decrypt } from '../crypto.js';
import { db, getSetting, type AppRow } from '../db.js';
import { HttpError, badRequest, notFound } from '../errors.js';
import { ensureRepoSecrets, githubStatus, hasGithubToken, normalizeRepo, removeGithubToken, saveGithubToken } from '../github.js';
import { getServiceImage } from '../compose.js';
import { dashboardUrl } from '../site.js';

const GLOBAL_HOOK = 'global_hook_secret_enc';

/** The ghcr.io path of an app's image, e.g. "owner/repo" for ghcr.io/owner/repo:tag, or null for other registries. */
function ghcrRepoOf(image: string | null): string | null {
  const m = /^ghcr\.io\/([^/:@]+\/[^/:@]+)/i.exec(image ?? '');
  return m ? m[1].toLowerCase() : null;
}

export async function githubRoutes(app: FastifyInstance): Promise<void> {
  // Managing the token is session-only (see SESSION_ONLY in auth.ts): an agent token must not be able to swap it.
  app.get('/api/github', async () => githubStatus());

  app.put('/api/github', async (req) => {
    const body = (req.body ?? {}) as { token?: unknown };
    const token = String(body.token ?? '').trim();
    if (!token) throw badRequest('Paste a GitHub token.');
    return saveGithubToken(token);
  });

  app.delete('/api/github', async () => {
    if (!removeGithubToken()) throw notFound('A GitHub token');
    return githubStatus();
  });

  /**
   * Stores the app's deploy hook secret in its GitHub repository as Actions secrets, so the
   * workflow `dockyard deploy` commits can sign its calls. Agents may call this. Answers
   * `{configured: false}` when Dockyard has no GitHub token, so callers can fall back.
   */
  app.post<{ Params: { id: string } }>('/api/apps/:id/github-secrets', async (req) => {
    const row = db.prepare('SELECT * FROM apps WHERE id = ?').get(req.params.id) as AppRow | undefined;
    if (!row) throw notFound('App');
    if (!hasGithubToken()) return { configured: false as const };

    const body = (req.body ?? {}) as { repo?: unknown; reset?: unknown };
    const repo = normalizeRepo(body.repo);
    const overwrite = body.reset === true;

    // Only the repository the app's image is built from may receive its secret.
    const imageRepo = ghcrRepoOf(getServiceImage(row.compose, row.primary_service));
    if (imageRepo && imageRepo !== repo.toLowerCase()) {
      throw badRequest(`This app's image comes from ghcr.io/${imageRepo}, so its deploy secret can only be stored in that repository, not ${repo}.`);
    }

    const globalSecret = getSetting(GLOBAL_HOOK);
    const secrets: Record<string, string> = globalSecret
      ? { DOCKYARD_HOOK_SECRET: decrypt(globalSecret) }
      : { DOCKYARD_HOOK_URL: `${dashboardUrl()}/api/hooks/${row.id}`, DOCKYARD_HOOK_SECRET: decrypt(row.hook_secret_enc) };

    try {
      const secretsOutcome = await ensureRepoSecrets(repo, secrets, overwrite);
      return { configured: true as const, repo, globalHook: globalSecret !== null, secrets: secretsOutcome };
    } catch (err) {
      if (err instanceof HttpError) throw err;
      throw new HttpError(502, `Could not store the deploy secret in GitHub: ${(err as Error).message}`);
    }
  });
}
