import type { FastifyInstance } from 'fastify';
import { config } from '../config.js';
import { decrypt, encrypt, newHookSecret, randomId } from '../crypto.js';
import { db, type AppRow, type DeploymentRow } from '../db.js';
import {
  compose,
  containerStats,
  listContainers,
  projectName,
  projectStates,
  removeAppDir,
} from '../docker.js';
import { getServiceImage, imageCompose, parseCompose, validateCompose } from '../compose.js';
import { appEnv, appHost, enqueueDeploy } from '../deployer.js';
import { badRequest, HttpError, notFound } from '../errors.js';
import { generateSlug } from '../slug.js';
import { globalHookEnabled } from './hooks.js';
import { DOCKER_HUB, hasCredentials } from '../registries.js';

const ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;
const IMAGE_REF = /^[a-z0-9][a-z0-9._\-/:@]*$/i;

function getApp(id: string): AppRow {
  const app = db.prepare('SELECT * FROM apps WHERE id = ?').get(id) as AppRow | undefined;
  if (!app) throw notFound('App');
  return app;
}

function deploymentSummary(d: DeploymentRow | undefined) {
  if (!d) return null;
  return {
    id: d.id,
    status: d.status,
    trigger: d.trigger,
    image: d.image,
    commitSha: d.commit_sha,
    rollbackOf: d.rollback_of,
    createdAt: d.created_at,
    finishedAt: d.finished_at,
  };
}

function latestDeployment(appId: string): DeploymentRow | undefined {
  return db
    .prepare('SELECT * FROM deployments WHERE app_id = ? ORDER BY created_at DESC LIMIT 1')
    .get(appId) as DeploymentRow | undefined;
}

function toDto(app: AppRow) {
  return {
    id: app.id,
    name: app.name,
    slug: app.slug,
    url: `https://${appHost(app)}`,
    sourceType: app.source_type,
    primaryService: app.primary_service,
    port: app.port,
    image: getServiceImage(app.compose, app.primary_service),
    currentDeploymentId: app.current_deployment_id,
    lastDeployment: deploymentSummary(latestDeployment(app.id)),
    createdAt: app.created_at,
    updatedAt: app.updated_at,
  };
}

function validName(name: unknown): string {
  if (typeof name !== 'string' || !name.trim()) throw badRequest('Give the app a name.');
  if (name.trim().length > 60) throw badRequest('Keep the app name under 60 characters.');
  return name.trim();
}

function validPort(port: unknown): number {
  const n = Number(port);
  if (!Number.isInteger(n) || n < 1 || n > 65535) throw badRequest('Port must be a whole number from 1 to 65535.');
  return n;
}

const SLUG = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

/** A subdomain the user picked instead of a random one. One level only, so the wildcard certificate covers it. */
function validSlug(slug: unknown, appId?: string): string {
  const value = String(slug ?? '').trim().toLowerCase();
  if (!SLUG.test(value)) {
    throw badRequest('Use 1 to 63 lowercase letters, digits and hyphens for the address, with no hyphen at either end.');
  }
  if (`${value}.${config.baseDomain}` === config.dashboardHost) {
    throw badRequest('That address is used by the Dockyard dashboard.');
  }
  const taken = db.prepare('SELECT id FROM apps WHERE slug = ?').get(value) as { id: string } | undefined;
  if (taken && taken.id !== appId) throw badRequest('Another app already uses that address.');
  return value;
}

function uniqueSlug(): string {
  for (let i = 0; i < 20; i++) {
    const slug = generateSlug();
    if (!db.prepare('SELECT 1 FROM apps WHERE slug = ?').get(slug)) return slug;
  }
  throw new HttpError(500, 'Could not generate a unique subdomain. Try again.');
}

export async function appRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/meta', async () => ({
    baseDomain: config.baseDomain,
    dashboardHost: config.dashboardHost,
    globalHook: globalHookEnabled(),
    registries: {
      ghcr: hasCredentials('ghcr.io'),
      dockerHub: hasCredentials(DOCKER_HUB),
    },
  }));

  app.get('/api/apps', async () => {
    const rows = db.prepare('SELECT * FROM apps ORDER BY created_at DESC').all() as AppRow[];
    const states = await projectStates();
    return rows.map((row) => ({ ...toDto(row), state: states.get(projectName(row.id)) ?? 'missing' }));
  });

  app.post('/api/apps', async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const name = validName(body.name);
    const port = validPort(body.port ?? 80);
    const sourceType = body.sourceType === 'compose' ? 'compose' : 'image';
    const slug = String(body.slug ?? '').trim() ? validSlug(body.slug) : null;

    let composeText: string;
    let primaryService: string;
    if (sourceType === 'image') {
      const image = String(body.image ?? '').trim();
      if (!image || !IMAGE_REF.test(image)) throw badRequest('Enter an image like nginx:alpine or user/app:latest.');
      primaryService = 'app';
      composeText = imageCompose(image, primaryService);
    } else {
      composeText = String(body.compose ?? '');
      const doc = parseCompose(composeText);
      primaryService = String(body.primaryService ?? '').trim() || Object.keys(doc.services)[0];
      validateCompose(doc, primaryService);
    }

    const now = Date.now();
    const row: AppRow = {
      id: randomId(10),
      name,
      slug: slug ?? uniqueSlug(),
      source_type: sourceType,
      compose: composeText,
      primary_service: primaryService,
      port,
      env_enc: null,
      hook_secret_enc: encrypt(newHookSecret()),
      current_deployment_id: null,
      created_at: now,
      updated_at: now,
    };
    db.prepare(
      `INSERT INTO apps (id, name, slug, source_type, compose, primary_service, port, env_enc, hook_secret_enc,
        current_deployment_id, created_at, updated_at)
       VALUES (@id, @name, @slug, @source_type, @compose, @primary_service, @port, @env_enc, @hook_secret_enc,
        @current_deployment_id, @created_at, @updated_at)`,
    ).run(row);

    if (body.deploy !== false) enqueueDeploy(row.id, { trigger: 'create' });
    reply.code(201);
    return toDto(getApp(row.id));
  });

  app.get<{ Params: { id: string } }>('/api/apps/:id', async (req) => {
    const row = getApp(req.params.id);
    const containers = await listContainers(row.id);
    return { ...toDto(row), compose: row.compose, containers };
  });

  app.patch<{ Params: { id: string } }>('/api/apps/:id', async (req) => {
    const row = getApp(req.params.id);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const name = body.name !== undefined ? validName(body.name) : row.name;
    const port = body.port !== undefined ? validPort(body.port) : row.port;
    const slug = body.slug !== undefined ? validSlug(body.slug, row.id) : row.slug;
    const composeText = body.compose !== undefined ? String(body.compose) : row.compose;
    const primaryService =
      body.primaryService !== undefined ? String(body.primaryService).trim() : row.primary_service;

    validateCompose(parseCompose(composeText), primaryService);
    db.prepare(
      'UPDATE apps SET name = ?, slug = ?, port = ?, compose = ?, primary_service = ?, updated_at = ? WHERE id = ?',
    ).run(name, slug, port, composeText, primaryService, Date.now(), row.id);
    return toDto(getApp(row.id));
  });

  app.delete<{ Params: { id: string }; Querystring: { volumes?: string } }>('/api/apps/:id', async (req) => {
    const row = getApp(req.params.id);
    const res = await compose.down(row.id, req.query.volumes === 'true');
    if (res.code !== 0) {
      throw new HttpError(500, 'Could not stop the app containers.', [res.stderr.trim()].filter(Boolean));
    }
    removeAppDir(row.id);
    db.prepare('DELETE FROM apps WHERE id = ?').run(row.id);
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/apps/:id/deploy', async (req, reply) => {
    getApp(req.params.id);
    reply.code(202);
    return deploymentSummary(enqueueDeploy(req.params.id, { trigger: 'manual' }));
  });

  app.post<{ Params: { id: string; action: string } }>('/api/apps/:id/actions/:action', async (req) => {
    const row = getApp(req.params.id);
    const action = req.params.action;
    if (action !== 'start' && action !== 'stop' && action !== 'restart') throw notFound('Action');
    const res = await compose.action(row.id, action);
    if (res.code !== 0) throw new HttpError(500, `Could not ${action} the app.`, [res.stderr.trim()].filter(Boolean));
    return { ok: true };
  });

  app.get<{ Params: { id: string } }>('/api/apps/:id/deployments', async (req) => {
    getApp(req.params.id);
    const rows = db
      .prepare('SELECT * FROM deployments WHERE app_id = ? ORDER BY created_at DESC LIMIT 50')
      .all(req.params.id) as DeploymentRow[];
    return rows.map(deploymentSummary);
  });

  app.get<{ Params: { id: string } }>('/api/deployments/:id', async (req) => {
    const row = db.prepare('SELECT * FROM deployments WHERE id = ?').get(req.params.id) as DeploymentRow | undefined;
    if (!row) throw notFound('Deployment');
    return { ...deploymentSummary(row), log: row.log };
  });

  app.post<{ Params: { id: string } }>('/api/deployments/:id/rollback', async (req, reply) => {
    const target = db.prepare('SELECT * FROM deployments WHERE id = ?').get(req.params.id) as
      | DeploymentRow
      | undefined;
    if (!target) throw notFound('Deployment');
    reply.code(202);
    return deploymentSummary(enqueueDeploy(target.app_id, { trigger: 'rollback', rollbackOf: target.id }));
  });

  app.get<{ Params: { id: string } }>('/api/apps/:id/env', async (req) => ({ vars: appEnv(getApp(req.params.id)) }));

  app.put<{ Params: { id: string } }>('/api/apps/:id/env', async (req) => {
    const row = getApp(req.params.id);
    const { vars } = (req.body ?? {}) as { vars?: { key: string; value: string }[] };
    if (!Array.isArray(vars)) throw badRequest('Send environment variables as a list.');
    const seen = new Set<string>();
    const clean = vars
      .filter((v) => v && String(v.key ?? '').trim())
      .map((v) => {
        const key = String(v.key).trim();
        if (!ENV_KEY.test(key)) throw badRequest(`"${key}" is not a valid variable name. Use letters, digits and _.`);
        if (seen.has(key)) throw badRequest(`"${key}" is listed twice.`);
        seen.add(key);
        return { key, value: String(v.value ?? '') };
      });
    db.prepare('UPDATE apps SET env_enc = ?, updated_at = ? WHERE id = ?').run(
      clean.length ? encrypt(JSON.stringify(clean)) : null,
      Date.now(),
      row.id,
    );
    return { vars: clean };
  });

  app.get<{ Params: { id: string } }>('/api/apps/:id/hook', async (req) => {
    const row = getApp(req.params.id);
    return { url: `https://${config.dashboardHost}/api/hooks/${row.id}`, secret: decrypt(row.hook_secret_enc) };
  });

  app.post<{ Params: { id: string } }>('/api/apps/:id/hook/rotate', async (req) => {
    const row = getApp(req.params.id);
    const secret = newHookSecret();
    db.prepare('UPDATE apps SET hook_secret_enc = ?, updated_at = ? WHERE id = ?').run(encrypt(secret), Date.now(), row.id);
    return { url: `https://${config.dashboardHost}/api/hooks/${row.id}`, secret };
  });

  app.get<{ Params: { id: string } }>('/api/apps/:id/stats', async (req) => {
    const row = getApp(req.params.id);
    const containers = await listContainers(row.id);
    return containerStats(containers.filter((c) => c.state === 'running').map((c) => c.id));
  });

  app.get<{ Params: { id: string }; Querystring: { tail?: string } }>('/api/apps/:id/logs', async (req, reply) => {
    const row = getApp(req.params.id);
    const tail = Math.min(Math.max(Number(req.query.tail) || 200, 1), 5000);
    const res = await compose.logs(row.id, tail);
    reply.type('text/plain');
    return res.stdout + res.stderr;
  });

  app.get<{ Params: { id: string }; Querystring: { tail?: string } }>('/api/apps/:id/logs/stream', (req, reply) => {
    const row = getApp(req.params.id);
    const tail = Math.min(Math.max(Number(req.query.tail) || 200, 1), 5000);
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    const child = compose.followLogs(row.id, tail);
    let pending = '';
    const send = (chunk: Buffer) => {
      pending += chunk.toString();
      const lines = pending.split('\n');
      pending = lines.pop() ?? '';
      for (const line of lines) reply.raw.write(`data: ${JSON.stringify(line)}\n\n`);
    };
    child.stdout?.on('data', send);
    child.stderr?.on('data', send);
    const keepAlive = setInterval(() => reply.raw.write(': ping\n\n'), 20_000);
    const cleanup = () => {
      clearInterval(keepAlive);
      child.kill('SIGTERM');
    };
    child.on('close', () => {
      clearInterval(keepAlive);
      reply.raw.write('event: end\ndata: {}\n\n');
      reply.raw.end();
    });
    req.raw.on('close', cleanup);
  });
}
