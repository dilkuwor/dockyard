import Fastify, { type FastifyError } from 'fastify';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { ensureConnector, importLegacySettings } from './cloudflare.js';
import { db, recoverInterruptedDeployments } from './db.js';
import { dockerAvailable, ensureEdgeNetwork } from './docker.js';
import { HttpError } from './errors.js';
import { trackDeployedImages } from './images.js';
import { loginRegistries } from './registries.js';
import { initPassword } from './password.js';
import { startWatchdog } from './watchdog.js';
import { authRoutes, requireAuth } from './routes/auth.js';
import { appRoutes } from './routes/apps.js';
import { hookRoutes } from './routes/hooks.js';
import { imageRoutes } from './routes/images.js';
import { tokenRoutes } from './routes/tokens.js';
import { agentRoutes } from './routes/agent.js';
import { githubRoutes } from './routes/github.js';
import { extrasRoutes } from './routes/extras.js';
import { updateRoutes } from './routes/update.js';
import { syncHostnameRoutes } from './hostnames.js';
import { registryRoutes } from './routes/registries.js';
import { cloudflareRoutes } from './routes/cloudflare.js';

const server = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' }, trustProxy: true, bodyLimit: 1024 * 1024 });

// Keep the raw body so webhook signatures can be verified byte-for-byte.
server.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
  (req as unknown as { rawBody: string }).rawBody = body as string;
  if (!body) return done(null, {});
  try {
    done(null, JSON.parse(body as string));
  } catch {
    done(new HttpError(400, 'Request body is not valid JSON.') as unknown as FastifyError, undefined);
  }
});
// Proxies such as Cloudflare forward a bodyless POST as "Transfer-Encoding: chunked" with no
// content type. Fastify would answer 415 for that, so accept it and treat an empty body as {}.
server.addContentTypeParser('*', { parseAs: 'string' }, (req, body, done) => {
  (req as unknown as { rawBody: string }).rawBody = body as string;
  if (!body) return done(null, {});
  const text = body as string;
  try {
    done(null, JSON.parse(text));
  } catch {
    done(new HttpError(415, 'Send request bodies as application/json.') as unknown as FastifyError, undefined);
  }
});

server.setErrorHandler((err: FastifyError | HttpError, req, reply) => {
  if (err instanceof HttpError) {
    return reply.code(err.statusCode).send({ error: err.message, details: err.details });
  }
  if ((err as FastifyError).statusCode && (err as FastifyError).statusCode! < 500) {
    return reply.code((err as FastifyError).statusCode!).send({ error: err.message });
  }
  req.log.error(err);
  return reply.code(500).send({ error: 'Something went wrong on the server. Check the Dockyard logs.' });
});

await server.register(cookie);
server.addHook('onRequest', requireAuth);
await server.register(authRoutes);
await server.register(appRoutes);
await server.register(hookRoutes);
await server.register(imageRoutes);
await server.register(tokenRoutes);
await server.register(agentRoutes);
await server.register(registryRoutes);
await server.register(cloudflareRoutes);
await server.register(githubRoutes);
await server.register(extrasRoutes);
await server.register(updateRoutes);
server.get('/api/health', async () => ({ ok: true }));

const indexHtml = path.join(config.publicDir, 'index.html');
if (fs.existsSync(indexHtml)) {
  await server.register(fastifyStatic, { root: config.publicDir, wildcard: false });
}
server.setNotFoundHandler((req, reply) => {
  if (req.url.startsWith('/api/') || !fs.existsSync(indexHtml)) {
    return reply.code(404).send({ error: 'Not found' });
  }
  return reply.sendFile('index.html');
});

recoverInterruptedDeployments();
syncHostnameRoutes();
await initPassword();
importLegacySettings(db.prepare('SELECT 1 FROM apps LIMIT 1').get() !== undefined);

if (await dockerAvailable()) {
  await ensureEdgeNetwork();
  await loginRegistries().catch((err) => server.log.warn(err.message));
  await ensureConnector().catch((err) => server.log.warn(err.message));
  void trackDeployedImages().catch((err) => server.log.warn(err.message));
  startWatchdog((msg) => server.log.warn(msg));
} else {
  server.log.warn('Docker is not reachable. Mount /var/run/docker.sock to manage apps.');
}

await server.listen({ port: config.port, host: config.host });

// As PID 1 in the container, Node gets no default SIGTERM handler; without this, `docker stop` waits 10s and kills us.
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.on(signal, () => process.exit(0));
