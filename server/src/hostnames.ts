import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { attachHostname, detachHostname } from './cloudflare.js';
import { config } from './config.js';
import { db, type AppRow } from './db.js';
import { badRequest } from './errors.js';
import { projectName } from './docker.js';
import { configuredDomains, publicAccess } from './site.js';
import type { SetupResult } from './cloudflare.js';

/**
 * Custom hostnames: an app answers on www.example.com or example.com besides its
 * <slug>.<domain> address. Routing is a Traefik file-provider router per app, pointing at the
 * app's docker-provider service, so hostnames change without touching the containers.
 * Cloudflare gets a tunnel route and a proxied DNS record, unless the wildcard of a configured
 * domain already covers the name.
 */
const HOSTNAME = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;

export interface HostnameRow {
  hostname: string;
  app_id: string;
  zone_id: string | null;
  created_at: number;
}

export const hostnamesOf = (appId: string): string[] =>
  (db.prepare('SELECT hostname FROM hostnames WHERE app_id = ? ORDER BY created_at').all(appId) as { hostname: string }[]).map((r) => r.hostname);

export function normalizeHostname(value: unknown): string {
  const hostname = String(value ?? '').trim().toLowerCase().replace(/\.$/, '');
  if (!HOSTNAME.test(hostname)) throw badRequest('Enter a full hostname, such as www.example.com or example.com.');
  return hostname;
}

/** True when `*.<domain>` of a configured domain already matches this name, so Cloudflare needs nothing. */
export function coveredByWildcard(hostname: string): boolean {
  return configuredDomains().some((domain) => hostname.endsWith(`.${domain}`) && !hostname.slice(0, -domain.length - 1).includes('.'));
}

const routeFile = (appId: string) => path.join(config.dynamicDir, `dy-${appId}.yml`);

/** Writes (or removes) the Traefik router for an app's hostnames. */
export function writeHostnameRoutes(appId: string): void {
  if (!fs.existsSync(config.dynamicDir)) return; // older compose file without the shared directory
  const hostnames = hostnamesOf(appId);
  const file = routeFile(appId);
  if (hostnames.length === 0) {
    fs.rmSync(file, { force: true });
    return;
  }
  const router = `dy-${appId}`;
  const doc = {
    http: {
      routers: {
        [`${router}-hosts`]: {
          rule: hostnames.map((h) => `Host(\`${h}\`)`).join(' || '),
          entryPoints: [config.traefikEntrypoint],
          service: `${router}@docker`,
        },
      },
    },
  };
  fs.writeFileSync(file, YAML.stringify(doc));
}

/** Rewrites every app's router at startup, in case the directory is new or was cleared. */
export function syncHostnameRoutes(): void {
  if (!fs.existsSync(config.dynamicDir)) return;
  const apps = db.prepare('SELECT id FROM apps').all() as { id: string }[];
  const keep = new Set(apps.map((a) => path.basename(routeFile(a.id))));
  for (const name of fs.readdirSync(config.dynamicDir)) {
    if (name.startsWith('dy-') && name.endsWith('.yml') && !keep.has(name)) fs.rmSync(path.join(config.dynamicDir, name), { force: true });
  }
  for (const app of apps) writeHostnameRoutes(app.id);
}

export async function addHostname(app: AppRow, value: unknown): Promise<SetupResult> {
  const hostname = normalizeHostname(value);
  const access = publicAccess();
  if (!access) throw badRequest('Set up public access before adding hostnames.');
  if (hostname === `${config.dashboardSubdomain}.${access.domain}`) throw badRequest('That hostname is the dashboard\'s own.');
  const taken = db.prepare('SELECT app_id FROM hostnames WHERE hostname = ?').get(hostname) as { app_id: string } | undefined;
  if (taken) throw badRequest(taken.app_id === app.id ? 'That hostname is already on this app.' : 'Another app already uses that hostname.');
  if (!fs.existsSync(config.dynamicDir)) {
    throw badRequest('This Dockyard was started with an older docker-compose.yml. Pull the latest, run docker compose up -d, and try again.');
  }

  const steps: SetupResult['steps'] = [];
  let zoneId: string | null = null;
  if (coveredByWildcard(hostname)) {
    steps.push({ name: 'Cloudflare', status: 'ok', detail: 'Already covered by the wildcard record and route of its domain.' });
  } else {
    const result = await attachHostname(hostname);
    steps.push(...result.steps);
    if (!result.ok) return { ok: false, steps };
    zoneId = result.zoneId;
  }

  db.prepare('INSERT INTO hostnames (hostname, app_id, zone_id, created_at) VALUES (?, ?, ?, ?)').run(hostname, app.id, zoneId, Date.now());
  writeHostnameRoutes(app.id);
  steps.push({ name: 'Route', status: 'ok', detail: `${hostname} now goes to ${app.name}. It can take a minute for DNS to settle.` });
  return { ok: true, steps };
}

export async function removeHostname(app: AppRow, value: unknown): Promise<SetupResult> {
  const hostname = normalizeHostname(value);
  const row = db.prepare('SELECT * FROM hostnames WHERE hostname = ? AND app_id = ?').get(hostname, app.id) as HostnameRow | undefined;
  if (!row) throw badRequest('That hostname is not on this app.');
  const steps: SetupResult['steps'] = [];
  if (row.zone_id) steps.push(...(await detachHostname(hostname, row.zone_id)).steps);
  db.prepare('DELETE FROM hostnames WHERE hostname = ?').run(hostname);
  writeHostnameRoutes(app.id);
  steps.push({ name: 'Route', status: 'ok', detail: `${hostname} no longer goes to ${app.name}.` });
  return { ok: true, steps };
}

/**
 * For the hostnames table on an app. `cloudflare` says who set up the DNS and tunnel side:
 * Dockyard ("managed"), nobody needed to ("wildcard"), or the user must ("manual").
 */
export function hostnameDetails(appId: string): { hostname: string; cloudflare: 'managed' | 'wildcard' | 'manual'; createdAt: number }[] {
  return (db.prepare('SELECT * FROM hostnames WHERE app_id = ? ORDER BY created_at').all(appId) as HostnameRow[]).map((r) => ({
    hostname: r.hostname,
    cloudflare: r.zone_id !== null ? 'managed' : coveredByWildcard(r.hostname) ? 'wildcard' : 'manual',
    createdAt: r.created_at,
  }));
}

export { projectName };
