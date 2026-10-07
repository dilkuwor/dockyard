import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createSessionToken, SESSION_MAX_AGE_SECONDS, verifySessionToken } from '../crypto.js';
import { HttpError, badRequest } from '../errors.js';
import {
  MIN_PASSWORD_LENGTH,
  passwordUpdatedAt,
  passwordVersion,
  setPassword,
  setupRequired,
  validatePassword,
  verifyPassword,
  verifySetupCode,
} from '../password.js';
import { useApiToken } from './tokens.js';

const COOKIE = 'dy_session';
const PUBLIC_API = [/^\/api\/health$/, /^\/api\/auth\/(login|status|setup)$/, /^\/api\/hooks(\/|$)/];
// API tokens can do everything except manage tokens, the password, the server-wide hook secret,
// registry credentials, the GitHub token or public access, so a leaked one can't mint more access.
const SESSION_ONLY = /^\/api\/(tokens|global-hook|registries|cloudflare|onboarding|github|auth\/password)(\/|$)/;
const BEARER = /^Bearer (dyt_[a-f0-9]{64})$/;

const attempts = new Map<string, { count: number; resetAt: number }>();
const MAX_ATTEMPTS = 10;
const WINDOW_MS = 15 * 60 * 1000;

function checkRateLimit(ip: string): void {
  const now = Date.now();
  const entry = attempts.get(ip);
  if (!entry || entry.resetAt < now) {
    attempts.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return;
  }
  entry.count += 1;
  if (entry.count > MAX_ATTEMPTS) {
    const minutes = Math.ceil((entry.resetAt - now) / 60_000);
    throw new HttpError(429, `Too many attempts. Try again in ${minutes} minutes.`);
  }
}

function startSession(req: FastifyRequest, reply: FastifyReply): void {
  reply.setCookie(COOKIE, createSessionToken(passwordVersion()), {
    path: '/',
    httpOnly: true,
    sameSite: 'strict',
    secure: req.protocol === 'https',
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

export async function requireAuth(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const url = req.url.split('?')[0];
  if (!url.startsWith('/api/')) return;
  if (PUBLIC_API.some((re) => re.test(url))) return;
  if (verifySessionToken(req.cookies[COOKIE], passwordVersion())) return;
  const token = BEARER.exec(req.headers.authorization ?? '')?.[1];
  if (token && !SESSION_ONLY.test(url) && useApiToken(token)) return;
  reply.code(401).send({ error: 'Sign in to continue.' });
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  /** Tells the sign-in page whether to show the first-visit "create a password" form instead. */
  app.get('/api/auth/status', async () => ({ setupRequired: setupRequired(), minPasswordLength: MIN_PASSWORD_LENGTH }));

  /** First visit only: creates the password. Needs the one-time code from the container logs. */
  app.post('/api/auth/setup', async (req, reply) => {
    if (!setupRequired()) throw new HttpError(409, 'The dashboard already has a password. Sign in instead.');
    checkRateLimit(req.ip);
    const { password, code } = (req.body ?? {}) as { password?: unknown; code?: unknown };
    if (!verifySetupCode(code)) {
      throw badRequest('That setup code is not right. Find it in the server logs: docker compose logs dockyard');
    }
    await setPassword(validatePassword(password));
    attempts.delete(req.ip);
    startSession(req, reply);
    return { ok: true };
  });

  app.post('/api/auth/login', async (req, reply) => {
    if (setupRequired()) throw new HttpError(409, 'No password has been set yet. Reload the page to create one.');
    checkRateLimit(req.ip);
    const { password } = (req.body ?? {}) as { password?: string };
    if (typeof password !== 'string' || !(await verifyPassword(password))) {
      throw new HttpError(401, 'That password is incorrect.');
    }
    attempts.delete(req.ip);
    startSession(req, reply);
    return { ok: true };
  });

  /** Session only. Signs every other session out by moving to a new password version. */
  app.post('/api/auth/password', async (req, reply) => {
    checkRateLimit(req.ip);
    const { current, next } = (req.body ?? {}) as { current?: unknown; next?: unknown };
    if (typeof current !== 'string' || !(await verifyPassword(current))) {
      throw badRequest('The current password is not right.');
    }
    const password = validatePassword(next);
    if (password === current) throw badRequest('The new password is the same as the current one.');
    await setPassword(password);
    attempts.delete(req.ip);
    startSession(req, reply);
    return { ok: true, updatedAt: passwordUpdatedAt() };
  });

  app.get('/api/auth/password', async () => ({ updatedAt: passwordUpdatedAt() }));

  app.post('/api/auth/logout', async (_req, reply) => {
    reply.clearCookie(COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/api/auth/me', async () => ({ ok: true }));
}
