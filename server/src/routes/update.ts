import type { FastifyInstance } from 'fastify';
import { applyUpdate, updateLog, updateStatus } from '../update.js';

/** Session only: checking is harmless, but applying replaces the running server. */
export async function updateRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { refresh?: string } }>('/api/update', async (req) => updateStatus(req.query.refresh === 'true'));
  app.post('/api/update', async (_req, reply) => {
    const result = await applyUpdate();
    reply.code(202);
    return result;
  });
  app.get('/api/update/log', async (_req, reply) => {
    reply.type('text/plain; charset=utf-8');
    return updateLog();
  });
}
