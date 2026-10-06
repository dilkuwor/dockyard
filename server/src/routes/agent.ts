import type { FastifyInstance } from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { notFound } from '../errors.js';
import { addressDomain, dashboardUrl } from '../site.js';

function asset(name: string): string {
  const file = path.join(config.assetsDir, name);
  if (!fs.existsSync(file)) throw notFound('Agent file');
  return fs.readFileSync(file, 'utf8');
}

/** What an AI agent or script needs to deploy an app here: a guide for this instance, and the CLI. */
export async function agentRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/agent/guide', async (_req, reply) => {
    reply.type('text/markdown; charset=utf-8');
    return asset('agent-guide.md')
      .replaceAll('{{URL}}', dashboardUrl())
      .replaceAll('{{BASE_DOMAIN}}', addressDomain());
  });

  app.get('/api/agent/cli', async (_req, reply) => {
    reply.type('text/x-shellscript; charset=utf-8');
    return asset('dockyard');
  });
}
