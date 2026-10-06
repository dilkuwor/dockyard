import type { FastifyInstance, FastifyRequest } from 'fastify';
import { getServiceImage } from '../compose.js';
import { dashboardUrl } from '../site.js';
import { decrypt, encrypt, hmacHex, newHookSecret, safeEqual } from '../crypto.js';
import { db, getSetting, setSetting, type AppRow } from '../db.js';
import { enqueueDeploy } from '../deployer.js';
import { badRequest, HttpError, notFound } from '../errors.js';

const MAX_SKEW_SECONDS = 300;
const IMAGE = /^[a-z0-9][a-z0-9._\-/:]*$/i;
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{7,40}$/i;
const GLOBAL_HOOK = 'global_hook_secret_enc';

/** Drops a ":tag" suffix, leaving registry ports (host:5000/app) intact. */
function stripTag(image: string): string {
  const lastSlash = image.lastIndexOf('/');
  const lastColon = image.lastIndexOf(':');
  return lastColon > lastSlash ? image.slice(0, lastColon) : image;
}

/** "ghcr.io/Me/App:tag" and "ghcr.io/me/app@sha256:…" are the same repository. */
function imageRepository(image: string): string {
  return stripTag(image.split('@')[0]).toLowerCase();
}

/**
 * Headers: X-Dockyard-Timestamp (unix seconds),
 *          X-Dockyard-Signature: sha256=HMAC_SHA256(secret, `${timestamp}.${rawBody}`)
 */
function verifySignature(req: FastifyRequest, secret: string): void {
  const timestamp = String(req.headers['x-dockyard-timestamp'] ?? '');
  const signature = String(req.headers['x-dockyard-signature'] ?? '').replace(/^sha256=/, '');
  const rawBody = (req as unknown as { rawBody?: string }).rawBody ?? '';
  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!timestamp || !Number.isFinite(age) || age > MAX_SKEW_SECONDS) {
    throw new HttpError(401, 'Missing or stale X-Dockyard-Timestamp header.');
  }
  const expected = hmacHex(secret, `${timestamp}.${rawBody}`);
  if (!signature || !safeEqual(signature, expected)) throw new HttpError(401, 'Invalid signature.');
}

/** Body: { "image": "user/app", "digest": "sha256:…", "commit": "abc123" } */
function parseDeploy(payload: unknown): { image?: string; commitSha?: string } {
  const body = (payload ?? {}) as { image?: string; digest?: string; commit?: string };
  let image: string | undefined;
  if (body.image !== undefined) {
    if (typeof body.image !== 'string' || !IMAGE.test(body.image)) throw badRequest('"image" is not a valid image name.');
    // Docker only accepts lowercase repository names; tags keep their case.
    const repository = stripTag(body.image);
    const tag = body.image.slice(repository.length);
    if (body.digest !== undefined) {
      if (typeof body.digest !== 'string' || !DIGEST.test(body.digest)) throw badRequest('"digest" must be sha256:<64 hex>.');
      image = `${repository.toLowerCase()}@${body.digest}`;
    } else {
      image = `${repository.toLowerCase()}${tag}`;
    }
  }
  const commitSha = typeof body.commit === 'string' && COMMIT.test(body.commit) ? body.commit : undefined;
  return { image, commitSha };
}

const globalHookUrl = () => `${dashboardUrl()}/api/hooks`;

export function globalHookEnabled(): boolean {
  return getSetting(GLOBAL_HOOK) !== null;
}

export async function hookRoutes(app: FastifyInstance): Promise<void> {
  /** Called by CI after pushing an image, signed with this app's own secret. */
  app.post<{ Params: { id: string } }>('/api/hooks/:id', async (req, reply) => {
    const row = db.prepare('SELECT * FROM apps WHERE id = ?').get(req.params.id) as AppRow | undefined;
    if (!row) throw notFound('App');
    verifySignature(req, decrypt(row.hook_secret_enc));

    const { image, commitSha } = parseDeploy(req.body);
    const deployment = enqueueDeploy(row.id, { trigger: 'webhook', image, commitSha });
    reply.code(202);
    return { deploymentId: deployment.id, status: deployment.status, image: deployment.image };
  });

  /**
   * The same call signed with the server-wide secret, for setups that share one secret
   * across repositories. The app is the one whose image comes from the same repository,
   * so the secret can roll an app to another build of its own image but not to a foreign one.
   */
  app.post('/api/hooks', async (req, reply) => {
    const secret = getSetting(GLOBAL_HOOK);
    if (!secret) throw new HttpError(404, 'The global deploy hook is not enabled on this server.');
    verifySignature(req, decrypt(secret));

    const { image, commitSha } = parseDeploy(req.body);
    if (!image) throw badRequest('"image" is required so Dockyard knows which app to deploy.');
    const repository = imageRepository(image);
    const rows = (db.prepare('SELECT * FROM apps').all() as AppRow[]).filter(
      (row) => imageRepository(getServiceImage(row.compose, row.primary_service) ?? '') === repository,
    );
    if (!rows.length) throw new HttpError(404, `No app on this server uses the image ${repository}. Create the app first.`);
    if (rows.length > 1) {
      throw new HttpError(409, `${rows.length} apps use the image ${repository}. Use each app's own deploy hook instead.`);
    }

    const deployment = enqueueDeploy(rows[0].id, { trigger: 'webhook', image, commitSha });
    reply.code(202);
    return { deploymentId: deployment.id, status: deployment.status, image: deployment.image };
  });

  app.get('/api/global-hook', async () => {
    const secret = getSetting(GLOBAL_HOOK);
    return secret ? { enabled: true, url: globalHookUrl(), secret: decrypt(secret) } : { enabled: false, url: globalHookUrl() };
  });

  /** Turns the global hook on, or replaces its secret if it is already on. */
  app.post('/api/global-hook', async () => {
    const secret = newHookSecret();
    setSetting(GLOBAL_HOOK, encrypt(secret));
    return { enabled: true, url: globalHookUrl(), secret };
  });

  app.delete('/api/global-hook', async () => {
    setSetting(GLOBAL_HOOK, null);
    return { enabled: false, url: globalHookUrl() };
  });
}
