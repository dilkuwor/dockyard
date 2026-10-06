import type { FastifyInstance } from 'fastify';
import { decrypt, hmacHex, safeEqual } from '../crypto.js';
import { db, type AppRow } from '../db.js';
import { enqueueDeploy } from '../deployer.js';
import { badRequest, HttpError, notFound } from '../errors.js';

const MAX_SKEW_SECONDS = 300;
const IMAGE = /^[a-z0-9][a-z0-9._\-/:]*$/i;
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{7,40}$/i;

/** Drops a ":tag" suffix, leaving registry ports (host:5000/app) intact. */
function stripTag(image: string): string {
  const lastSlash = image.lastIndexOf('/');
  const lastColon = image.lastIndexOf(':');
  return lastColon > lastSlash ? image.slice(0, lastColon) : image;
}

export async function hookRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Called by CI after pushing an image.
   * Headers: X-Dockyard-Timestamp (unix seconds),
   *          X-Dockyard-Signature: sha256=HMAC_SHA256(secret, `${timestamp}.${rawBody}`)
   * Body:    { "image": "user/app", "digest": "sha256:…", "commit": "abc123" }
   */
  app.post<{ Params: { id: string } }>('/api/hooks/:id', async (req, reply) => {
    const row = db.prepare('SELECT * FROM apps WHERE id = ?').get(req.params.id) as AppRow | undefined;
    if (!row) throw notFound('App');

    const timestamp = String(req.headers['x-dockyard-timestamp'] ?? '');
    const signature = String(req.headers['x-dockyard-signature'] ?? '').replace(/^sha256=/, '');
    const rawBody = (req as unknown as { rawBody?: string }).rawBody ?? '';
    const age = Math.abs(Date.now() / 1000 - Number(timestamp));
    if (!timestamp || !Number.isFinite(age) || age > MAX_SKEW_SECONDS) {
      throw new HttpError(401, 'Missing or stale X-Dockyard-Timestamp header.');
    }
    const expected = hmacHex(decrypt(row.hook_secret_enc), `${timestamp}.${rawBody}`);
    if (!signature || !safeEqual(signature, expected)) throw new HttpError(401, 'Invalid signature.');

    const body = (req.body ?? {}) as { image?: string; digest?: string; commit?: string };
    let image: string | undefined;
    if (body.image !== undefined) {
      if (typeof body.image !== 'string' || !IMAGE.test(body.image)) throw badRequest('"image" is not a valid image name.');
      if (body.digest !== undefined) {
        if (typeof body.digest !== 'string' || !DIGEST.test(body.digest)) throw badRequest('"digest" must be sha256:<64 hex>.');
        image = `${stripTag(body.image)}@${body.digest}`;
      } else {
        image = body.image;
      }
    }
    const commitSha = typeof body.commit === 'string' && COMMIT.test(body.commit) ? body.commit : undefined;

    const deployment = enqueueDeploy(row.id, { trigger: 'webhook', image, commitSha });
    reply.code(202);
    return { deploymentId: deployment.id, status: deployment.status, image: deployment.image };
  });
}
