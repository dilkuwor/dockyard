import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../config.js';
import { createSessionToken, safeEqual, SESSION_MAX_AGE_SECONDS, verifySessionToken } from '../crypto.js';
import { HttpError } from '../errors.js';

const COOKIE = 'dy_session';
const PUBLIC_API = [/^\/api\/health$/, /^\/api\/auth\/login$/, /^\/api\/hooks\//];

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
    throw new HttpError(429, `Too many sign-in attempts. Try again in ${minutes} minutes.`);
  }
}

export async function requireAuth(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const url = req.url.split('?')[0];
  if (!url.startsWith('/api/')) return;
  if (PUBLIC_API.some((re) => re.test(url))) return;
  if (!verifySessionToken(req.cookies[COOKIE])) {
    reply.code(401).send({ error: 'Sign in to continue.' });
  }
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/auth/login', async (req, reply) => {
    checkRateLimit(req.ip);
    const { password } = (req.body ?? {}) as { password?: string };
    if (typeof password !== 'string' || !safeEqual(password, config.adminPassword)) {
      throw new HttpError(401, 'That password is incorrect.');
    }
    attempts.delete(req.ip);
    reply.setCookie(COOKIE, createSessionToken(), {
      path: '/',
      httpOnly: true,
      sameSite: 'strict',
      secure: req.protocol === 'https',
      maxAge: SESSION_MAX_AGE_SECONDS,
    });
    return { ok: true };
  });

  app.post('/api/auth/logout', async (_req, reply) => {
    reply.clearCookie(COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/api/auth/me', async () => ({ ok: true }));
}
