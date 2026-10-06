import type { FastifyInstance } from 'fastify';
import { newApiToken, randomId, sha256Hex } from '../crypto.js';
import { db } from '../db.js';
import { badRequest, notFound } from '../errors.js';

interface TokenRow {
  id: string;
  name: string;
  created_at: number;
  last_used_at: number | null;
}

const toDto = (row: TokenRow) => ({ id: row.id, name: row.name, createdAt: row.created_at, lastUsedAt: row.last_used_at });

/** True if the token exists. Also records that it was just used. */
export function useApiToken(token: string): boolean {
  return db.prepare('UPDATE tokens SET last_used_at = ? WHERE hash = ?').run(Date.now(), sha256Hex(token)).changes > 0;
}

export async function tokenRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/tokens', async () => {
    const rows = db.prepare('SELECT * FROM tokens ORDER BY created_at DESC').all() as TokenRow[];
    return rows.map(toDto);
  });

  app.post('/api/tokens', async (req, reply) => {
    const name = String(((req.body ?? {}) as { name?: unknown }).name ?? '').trim();
    if (!name) throw badRequest('Give the token a name, such as the agent or machine that will use it.');
    if (name.length > 60) throw badRequest('Keep the token name under 60 characters.');
    const token = newApiToken();
    const row: TokenRow = { id: randomId(10), name, created_at: Date.now(), last_used_at: null };
    db.prepare('INSERT INTO tokens (id, name, hash, created_at) VALUES (?, ?, ?, ?)').run(row.id, row.name, sha256Hex(token), row.created_at);
    reply.code(201);
    // The token itself is only ever returned here; Dockyard keeps just its hash.
    return { ...toDto(row), token };
  });

  app.delete<{ Params: { id: string } }>('/api/tokens/:id', async (req) => {
    if (db.prepare('DELETE FROM tokens WHERE id = ?').run(req.params.id).changes === 0) throw notFound('Token');
    return { ok: true };
  });
}
