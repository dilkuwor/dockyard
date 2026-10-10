import type { FastifyInstance } from 'fastify';
import { ADDONS, addAddon, addonsOf, parseAddonType, removeAddon } from '../addons.js';
import { db, type AppRow } from '../db.js';
import { notFound } from '../errors.js';
import { addHostname, hostnameDetails, removeHostname } from '../hostnames.js';

function getApp(id: string): AppRow {
  const app = db.prepare('SELECT * FROM apps WHERE id = ?').get(id) as AppRow | undefined;
  if (!app) throw notFound('App');
  return app;
}

/** Per-app extras: managed add-ons and custom hostnames. */
export async function extrasRoutes(app: FastifyInstance): Promise<void> {
  /** What can be added and what already is, with the variables each one provides. */
  app.get<{ Params: { id: string } }>('/api/apps/:id/addons', async (req) => {
    const row = getApp(req.params.id);
    const added = new Map(addonsOf(row.id).map((a) => [a.type, a]));
    return Object.values(ADDONS).map((spec) => ({
      type: spec.type,
      label: spec.label,
      service: spec.service,
      envKeys: spec.envKeys,
      note: spec.note,
      added: added.has(spec.type),
      addedAt: added.get(spec.type)?.created_at ?? null,
    }));
  });

  app.post<{ Params: { id: string } }>('/api/apps/:id/addons', async (req, reply) => {
    const row = getApp(req.params.id);
    const type = parseAddonType((req.body as { type?: unknown } | undefined)?.type);
    const result = addAddon(row, type);
    reply.code(201);
    return { ok: true, type, envKeys: result.envKeys, note: 'Added to the compose file and environment. Deploy to start it.' };
  });

  app.delete<{ Params: { id: string; type: string } }>('/api/apps/:id/addons/:type', async (req) => {
    const row = getApp(req.params.id);
    removeAddon(row, parseAddonType(req.params.type));
    return { ok: true, note: 'Removed from the compose file and environment. Deploy to stop it. Its Docker volume is kept.' };
  });

  app.get<{ Params: { id: string } }>('/api/apps/:id/hostnames', async (req) => hostnameDetails(getApp(req.params.id).id));

  app.post<{ Params: { id: string } }>('/api/apps/:id/hostnames', async (req, reply) => {
    const row = getApp(req.params.id);
    const result = await addHostname(row, (req.body as { hostname?: unknown } | undefined)?.hostname);
    reply.code(result.ok ? 201 : 200);
    return { ...result, hostnames: hostnameDetails(row.id) };
  });

  app.delete<{ Params: { id: string; hostname: string } }>('/api/apps/:id/hostnames/:hostname', async (req) => {
    const row = getApp(req.params.id);
    const result = await removeHostname(row, req.params.hostname);
    return { ...result, hostnames: hostnameDetails(row.id) };
  });
}
