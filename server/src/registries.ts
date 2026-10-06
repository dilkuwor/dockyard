import { config } from './config.js';
import { decrypt, encrypt } from './crypto.js';
import { db } from './db.js';
import { registryLogin, registryLogout } from './docker.js';
import { badRequest } from './errors.js';

export const DOCKER_HUB = 'docker.io';
const NAMES: Record<string, string> = { [DOCKER_HUB]: 'Docker Hub', 'ghcr.io': 'GitHub Container Registry' };
const HOST = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:\d{1,5})?$/;
const DOCKER_HUB_ALIASES = new Set(['docker.io', 'index.docker.io', 'registry-1.docker.io', 'hub.docker.com']);

interface RegistryRow {
  registry: string;
  username: string;
  token_enc: string;
  updated_at: number;
}

export interface Credential {
  registry: string;
  name: string;
  username: string;
  token: string;
  source: 'dashboard' | 'env';
  updatedAt: number | null;
}

export const registryName = (registry: string) => NAMES[registry] ?? registry;

/** Accepts "ghcr.io", "https://ghcr.io/", "GHCR.IO" and so on, and returns the bare host. */
export function normalizeRegistry(input: unknown): string {
  const host = String(input ?? '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (DOCKER_HUB_ALIASES.has(host)) return DOCKER_HUB;
  if (!HOST.test(host)) throw badRequest('Enter the registry as a host name, such as ghcr.io or registry.example.com:5000.');
  return host;
}

/** Credentials saved from the dashboard, plus any from .env for registries the dashboard has none for. */
export function credentials(): Credential[] {
  const rows = db.prepare('SELECT * FROM registries ORDER BY registry').all() as RegistryRow[];
  const list: Credential[] = rows.map((row) => ({
    registry: row.registry,
    name: registryName(row.registry),
    username: row.username,
    token: decrypt(row.token_enc),
    source: 'dashboard',
    updatedAt: row.updated_at,
  }));
  const fromEnv = [
    { registry: DOCKER_HUB, username: config.dockerHubUsername, token: config.dockerHubToken },
    { registry: 'ghcr.io', username: config.ghcrUsername, token: config.ghcrToken },
  ];
  for (const env of fromEnv) {
    if (!env.username || !env.token || list.some((c) => c.registry === env.registry)) continue;
    list.push({ registry: env.registry, name: registryName(env.registry), username: env.username, token: env.token, source: 'env', updatedAt: null });
  }
  return list;
}

export const hasCredentials = (registry: string) => credentials().some((c) => c.registry === registry);

/** Signs in to every registry with credentials, so private images can be pulled. Run at startup. */
export async function loginRegistries(): Promise<void> {
  const failures: string[] = [];
  for (const credential of credentials()) {
    const error = await registryLogin(credential.registry, credential.username, credential.token);
    if (error) failures.push(`${credential.name} login failed: ${error}`);
  }
  if (failures.length) throw new Error(failures.join(' '));
}

/** Checks the credentials by signing in, and only stores them if the registry accepts them. */
export async function saveCredentials(registry: string, username: string, token: string): Promise<void> {
  const error = await registryLogin(registry, username, token);
  if (error) throw badRequest(`${registryName(registry)} did not accept those credentials.`, [error]);
  db.prepare(
    `INSERT INTO registries (registry, username, token_enc, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(registry) DO UPDATE SET username = excluded.username, token_enc = excluded.token_enc, updated_at = excluded.updated_at`,
  ).run(registry, username, encrypt(token), Date.now());
}

/** Forgets saved credentials. If .env still has some for this registry, Dockyard goes back to those. */
export async function removeCredentials(registry: string): Promise<boolean> {
  if (db.prepare('DELETE FROM registries WHERE registry = ?').run(registry).changes === 0) return false;
  await registryLogout(registry);
  const fallback = credentials().find((c) => c.registry === registry);
  if (fallback) await registryLogin(fallback.registry, fallback.username, fallback.token);
  return true;
}
