import type { FastifyInstance } from 'fastify';
import { badRequest, notFound } from '../errors.js';
import { credentials, normalizeRegistry, removeCredentials, saveCredentials } from '../registries.js';

/** The token is never sent back; the dashboard only needs to know who Dockyard is signed in as. */
const list = () =>
  credentials().map(({ registry, name, username, source, updatedAt }) => ({ registry, name, username, source, updatedAt }));

export async function registryRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/registries', async () => list());

  app.put('/api/registries', async (req) => {
    const body = (req.body ?? {}) as { registry?: unknown; username?: unknown; token?: unknown };
    const registry = normalizeRegistry(body.registry);
    const username = String(body.username ?? '').trim();
    const token = String(body.token ?? '').trim();
    if (!username) throw badRequest('Enter the username for this registry.');
    if (!token) throw badRequest('Enter the access token or password for this registry.');
    await saveCredentials(registry, username, token);
    return list();
  });

  app.delete<{ Params: { registry: string } }>('/api/registries/:registry', async (req) => {
    if (!(await removeCredentials(normalizeRegistry(req.params.registry)))) throw notFound('Saved credentials for that registry');
    return list();
  });
}
