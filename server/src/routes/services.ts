import type { FastifyInstance } from 'fastify';
import { db } from '../db.js';
import { containerStats } from '../docker.js';
import { HttpError, badRequest, notFound } from '../errors.js';
import { POSTGRES_CONTAINER, accessPort, postgresAction, postgresInfo, postgresLogs, setAccessPort, sharedDatabase, superuserCredentials } from '../postgres.js';
import { disableRemote, enableRemote, remoteAccess, remoteAccessSummary } from '../tailscale.js';

/**
 * Shared services: infrastructure Dockyard runs once for every app that asks, as opposed to
 * add-on containers inside an app. Postgres is the first; the shape leaves room for more.
 */
export async function serviceRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/services', async (req) => {
    const [info, remote] = await Promise.all([postgresInfo(), remoteAccessSummary()]);
    // The name the dashboard was reached through points at this machine, so a published port is reachable there too,
    // unless the request came through Cloudflare's proxy or tunnel, which carry web traffic only.
    const host = req.hostname;
    const viaCloudflare = 'cf-ray' in req.headers;
    const stats = info.state === 'running' ? (await containerStats([POSTGRES_CONTAINER]))[0] : undefined;

    // Which app each database belongs to; a database whose app is gone is shown as orphaned.
    const apps = db.prepare('SELECT id, name, slug, preview_of, branch FROM apps').all() as {
      id: string; name: string; slug: string; preview_of: string | null; branch: string | null;
    }[];
    const byDatabase = new Map(apps.map((a) => [sharedDatabase(a.id).name, a]));
    const users = db.prepare("SELECT app_id FROM addons WHERE type = 'postgres-shared'").all() as { app_id: string }[];

    return {
      checkedAt: Date.now(),
      services: [
        {
          type: 'postgres',
          label: 'PostgreSQL',
          container: POSTGRES_CONTAINER,
          description: 'One server for every app with the shared Postgres add-on; each app gets a database and role of its own.',
          state: info.state,
          status: info.status,
          health: info.health,
          image: info.image,
          version: info.version,
          dataSize: info.dataSize,
          volume: info.volume,
          network: info.network,
          host: `${POSTGRES_CONTAINER}:5432`,
          // Direct access: the port asked for, and the one the running container really publishes (they differ until it is recreated).
          accessPort: accessPort(),
          publishedPort: info.publishedPort,
          accessHost: host,
          viaCloudflare,
          // Remote access over Tailscale; the login link is only on the session-only route below.
          remote,
          cpu: stats?.cpu ?? '',
          memory: stats?.memory ?? '',
          memoryPercent: stats?.memoryPercent ?? '',
          appCount: users.length,
          databases: info.databases.map((d) => {
            const owner = byDatabase.get(d.name);
            return {
              name: d.name,
              size: d.size,
              app: owner ? { id: owner.id, name: owner.name, slug: owner.slug, previewOf: owner.preview_of, branch: owner.branch } : null,
            };
          }),
        },
      ],
    };
  });

  app.post<{ Params: { type: string; action: string } }>('/api/services/:type/actions/:action', async (req) => {
    if (req.params.type !== 'postgres') throw notFound('Service');
    const action = req.params.action;
    if (action !== 'start' && action !== 'stop' && action !== 'restart') throw notFound('Action');
    try {
      await postgresAction(action);
    } catch (err) {
      throw new HttpError(500, (err as Error).message);
    }
    return { ok: true };
  });

  /** Publish the server on a port of the machine Dockyard runs on (`{port: 5432}`), or stop doing so (`{port: null}`). Session only. */
  app.put<{ Params: { type: string } }>('/api/services/:type/access', async (req) => {
    if (req.params.type !== 'postgres') throw notFound('Service');
    const raw = (req.body as { port?: unknown } | undefined)?.port;
    const port = raw === null || raw === undefined || raw === '' ? null : Number(raw);
    if (port !== null && !Number.isInteger(port)) throw badRequest('The port must be a whole number.');
    try {
      await setAccessPort(port);
    } catch (err) {
      throw new HttpError(500, (err as Error).message);
    }
    return { accessPort: accessPort() };
  });

  /** Remote access over Tailscale, with the login link while the node waits for someone to sign in. Session only. */
  app.get<{ Params: { type: string } }>('/api/services/:type/remote', async (req) => {
    if (req.params.type !== 'postgres') throw notFound('Service');
    return remoteAccess();
  });

  /** Turn remote access on (`{enabled: true}`, optionally with `authKey`) or off (`{enabled: false}`). Session only. */
  app.put<{ Params: { type: string } }>('/api/services/:type/remote', async (req) => {
    if (req.params.type !== 'postgres') throw notFound('Service');
    const body = (req.body ?? {}) as { enabled?: unknown; authKey?: unknown };
    if (typeof body.enabled !== 'boolean') throw badRequest('Send {"enabled": true} or {"enabled": false}.');
    const authKey = typeof body.authKey === 'string' && body.authKey.trim() ? body.authKey.trim() : null;
    try {
      if (!body.enabled) {
        await disableRemote();
        return remoteAccess();
      }
      return await enableRemote(authKey);
    } catch (err) {
      throw new HttpError(500, (err as Error).message);
    }
  });

  /** The superuser sign-in for direct access. Session only, never through an API token. */
  app.get<{ Params: { type: string } }>('/api/services/:type/credentials', async (req) => {
    if (req.params.type !== 'postgres') throw notFound('Service');
    return superuserCredentials(req.hostname);
  });

  app.get<{ Params: { type: string }; Querystring: { tail?: string } }>('/api/services/:type/logs', async (req, reply) => {
    if (req.params.type !== 'postgres') throw notFound('Service');
    const tail = Math.min(2000, Math.max(1, Number(req.query.tail ?? 200) || 200));
    reply.type('text/plain');
    return postgresLogs(tail);
  });
}
