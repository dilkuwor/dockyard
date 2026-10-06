import { config } from './config.js';
import { sha256Hex } from './crypto.js';
import { connectorState, startConnector, stopConnector, waitForConnector } from './docker.js';
import { badRequest } from './errors.js';
import { completeOnboarding, publicAccess, savePublicAccess, type PublicAccess } from './site.js';

export interface Step {
  name: string;
  status: 'ok' | 'warning' | 'failed';
  detail: string;
}

export interface SetupResult {
  ok: boolean;
  steps: Step[];
}

const TUNNEL_NAME = 'dockyard';
const HOOK_RULE = 'Dockyard: let deploy hooks through Super Bot Fight Mode';
const DOMAIN = /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;
const ZONE_ID = /^[a-f0-9]{32}$/;

class CloudflareError extends Error {}

/** One call to the Cloudflare API. Throws with Cloudflare's own explanation when it refuses. */
async function cf<T>(apiToken: string, method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${config.cloudflareApi}${path}`, {
      method,
      headers: { Authorization: `Bearer ${apiToken}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(20_000),
    });
  } catch (err) {
    throw new CloudflareError(`Could not reach Cloudflare: ${(err as Error).message}`);
  }
  const data = (await res.json().catch(() => null)) as { success?: boolean; errors?: { message?: string }[]; result?: T } | null;
  if (!res.ok || !data?.success) {
    const said = data?.errors?.map((e) => e.message).filter(Boolean).join('; ');
    throw new CloudflareError(said || `Cloudflare answered with status ${res.status}.`);
  }
  return data.result as T;
}

/** A tunnel token is base64 JSON holding the account, tunnel and secret. */
function tunnelTokenLooksValid(token: string): boolean {
  try {
    const decoded = JSON.parse(Buffer.from(token, 'base64').toString('utf8')) as Record<string, unknown>;
    return typeof decoded.a === 'string' && typeof decoded.t === 'string' && typeof decoded.s === 'string';
  } catch {
    return false;
  }
}

const tokenId = (token: string) => sha256Hex(token).slice(0, 12);

/** Makes the running connector match the saved settings. Run at startup and after every change. */
export async function ensureConnector(): Promise<void> {
  const access = publicAccess();
  const state = await connectorState();
  if (!access?.enabled) {
    if (state.status !== 'missing') await stopConnector();
    return;
  }
  if (state.status === 'running' && state.tokenId === tokenId(access.tunnelToken)) return;
  const error = await startConnector(access.tunnelToken, tokenId(access.tunnelToken));
  if (error) throw new Error(`Could not start the Cloudflare connector: ${error}`);
}

/** Installs set up before this was configurable from the dashboard kept the tunnel in .env. */
export function importLegacySettings(hasApps: boolean): void {
  if (publicAccess()) return;
  const token = config.legacyTunnelToken ?? '';
  const domain = (config.legacyDomain ?? '').toLowerCase();
  if (tunnelTokenLooksValid(token) && DOMAIN.test(domain)) {
    savePublicAccess({ enabled: true, mode: 'manual', domain, tunnelToken: token, updatedAt: Date.now() });
    completeOnboarding();
  } else if (hasApps) {
    completeOnboarding();
  }
}

async function publiclyReachable(domain: string): Promise<boolean> {
  const url = `https://${config.dashboardSubdomain}.${domain}/api/health`;
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (res.ok && ((await res.json()) as { ok?: boolean }).ok) return true;
    } catch {
      // Not there yet: DNS or the tunnel may still be settling.
    }
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
  return false;
}

/** Starts the connector with new settings and keeps them only if it really connects. */
async function activate(access: PublicAccess, steps: Step[]): Promise<boolean> {
  // Leave a connector that already uses this token alone: restarting it would drop live traffic,
  // including the request that asked for this when it came in through the public address.
  const state = await connectorState();
  const alreadyRunning = state.status === 'running' && state.tokenId === tokenId(access.tunnelToken);
  const startError = alreadyRunning ? null : await startConnector(access.tunnelToken, tokenId(access.tunnelToken));
  const connectError = startError ?? (await waitForConnector());
  if (connectError) {
    steps.push({ name: 'Start the connector', status: 'failed', detail: `The connector could not connect to Cloudflare: ${connectError}` });
    // Put back whatever was working before.
    await ensureConnector().catch(() => undefined);
    return false;
  }
  steps.push({ name: 'Start the connector', status: 'ok', detail: 'Connected to Cloudflare.' });
  savePublicAccess(access);
  completeOnboarding();

  const url = `https://${config.dashboardSubdomain}.${access.domain}`;
  if (await publiclyReachable(access.domain)) {
    steps.push({ name: 'Check the public address', status: 'ok', detail: `${url} answers.` });
  } else {
    steps.push({
      name: 'Check the public address',
      status: 'warning',
      detail: `${url} did not answer yet. New DNS records can take a few minutes; try opening it shortly.`,
    });
  }
  return true;
}

export async function listZones(apiToken: string): Promise<{ id: string; name: string }[]> {
  try {
    const zones = await cf<{ id: string; name: string }[]>(apiToken, 'GET', '/zones?per_page=50&status=active');
    return zones.map((zone) => ({ id: zone.id, name: zone.name }));
  } catch (err) {
    throw badRequest('Cloudflare did not accept that API token, or it cannot list your domains.', [(err as Error).message]);
  }
}

interface DnsRecord {
  id: string;
  type: string;
  name: string;
  content: string;
  proxied?: boolean;
}

/**
 * Does everything in Cloudflare with an API token: tunnel, routing, DNS, and letting deploy
 * hooks past bot protection. The API token is used for this call only and never stored.
 */
export async function setupAutomatic(input: {
  apiToken: string;
  zoneId: string;
  replaceDns: boolean;
  disableBotFightMode: boolean;
}): Promise<SetupResult> {
  const { apiToken, zoneId } = input;
  if (!apiToken) throw badRequest('Enter a Cloudflare API token.');
  if (!ZONE_ID.test(zoneId)) throw badRequest('Choose one of your domains.');

  const steps: Step[] = [];
  const stop = Symbol('stop');
  /** A step the setup cannot continue without. */
  const must = async <T>(name: string, run: () => Promise<T>): Promise<T> => {
    try {
      return await run();
    } catch (err) {
      steps.push({ name, status: 'failed', detail: (err as Error).message });
      throw stop;
    }
  };
  /** A step that is worth doing but not worth failing the setup over. */
  const tryTo = async (name: string, run: () => Promise<Step['detail'] | { warning: string }>): Promise<void> => {
    try {
      const outcome = await run();
      if (typeof outcome === 'string') steps.push({ name, status: 'ok', detail: outcome });
      else steps.push({ name, status: 'warning', detail: outcome.warning });
    } catch (err) {
      steps.push({ name, status: 'warning', detail: `Skipped: ${(err as Error).message}` });
    }
  };

  try {
    const zone = await must('Find the domain', () => cf<{ name: string; account: { id: string } }>(apiToken, 'GET', `/zones/${zoneId}`));
    const domain = zone.name;
    const account = zone.account.id;
    steps.push({ name: 'Find the domain', status: 'ok', detail: domain });

    const tunnel = await must('Create the tunnel', async () => {
      const existing = await cf<{ id: string }[]>(apiToken, 'GET', `/accounts/${account}/cfd_tunnel?name=${TUNNEL_NAME}&is_deleted=false`);
      if (existing[0]) return { id: existing[0].id, reused: true };
      const created = await cf<{ id: string }>(apiToken, 'POST', `/accounts/${account}/cfd_tunnel`, { name: TUNNEL_NAME, config_src: 'cloudflare' });
      return { id: created.id, reused: false };
    });
    steps.push({
      name: 'Create the tunnel',
      status: 'ok',
      detail: tunnel.reused ? `Reusing your existing tunnel "${TUNNEL_NAME}".` : `Created the tunnel "${TUNNEL_NAME}".`,
    });

    const wildcard = `*.${domain}`;
    await must('Route the domain to Dockyard', async () => {
      type Ingress = { hostname?: string; service: string };
      const path = `/accounts/${account}/cfd_tunnel/${tunnel.id}/configurations`;
      const current = await cf<{ config?: { ingress?: Ingress[] } | null }>(apiToken, 'GET', path).catch(() => null);
      // Keep routes for other hostnames that someone added to this tunnel by hand.
      const others = (current?.config?.ingress ?? []).filter((rule) => rule.hostname && rule.hostname !== wildcard);
      const ingress = [...others, { hostname: wildcard, service: 'http://traefik:80', originRequest: {} }, { service: 'http_status:404' }];
      await cf(apiToken, 'PUT', path, { config: { ...(current?.config ?? {}), ingress } });
    });
    steps.push({ name: 'Route the domain to Dockyard', status: 'ok', detail: `${wildcard} goes to Dockyard's proxy.` });

    const tunnelToken = await must('Get the connector token', () => cf<string>(apiToken, 'GET', `/accounts/${account}/cfd_tunnel/${tunnel.id}/token`));

    const target = `${tunnel.id}.cfargotunnel.com`;
    const dashboard = `${config.dashboardSubdomain}.${domain}`;
    await must('Point DNS at the tunnel', async () => {
      const lookup = (name: string) => cf<DnsRecord[]>(apiToken, 'GET', `/zones/${zoneId}/dns_records?name=${encodeURIComponent(name)}`);
      const isOurs = (record: DnsRecord) => record.type === 'CNAME' && record.content === target;
      const wildcardRecords = await lookup(wildcard);
      // A record for the dashboard's own name would win over the wildcard, so it has to point here too.
      const dashboardRecords = await lookup(dashboard);
      const inTheWay = [...wildcardRecords, ...dashboardRecords].filter((record) => !isOurs(record));
      if (inTheWay.length && !input.replaceDns) {
        const list = inTheWay.map((record) => `${record.name} (${record.type} to ${record.content})`).join(', ');
        throw new Error(`These DNS records point somewhere else: ${list}. Tick "Replace existing DNS records" to point them at Dockyard instead.`);
      }
      for (const record of inTheWay) await cf(apiToken, 'DELETE', `/zones/${zoneId}/dns_records/${record.id}`);
      const ours = wildcardRecords.find(isOurs);
      if (!ours) {
        await cf(apiToken, 'POST', `/zones/${zoneId}/dns_records`, { type: 'CNAME', name: wildcard, content: target, proxied: true, comment: 'Dockyard public access' });
      } else if (!ours.proxied) {
        await cf(apiToken, 'PATCH', `/zones/${zoneId}/dns_records/${ours.id}`, { proxied: true });
      }
    });
    steps.push({ name: 'Point DNS at the tunnel', status: 'ok', detail: `${wildcard} is proxied through Cloudflare to the tunnel.` });

    // GitHub Actions calls the deploy hooks from data-centre addresses, which bot protection tends to challenge.
    await tryTo('Let deploy hooks past Super Bot Fight Mode', async () => {
      const rule = {
        action: 'skip',
        action_parameters: { phases: ['http_request_sbfm'] },
        expression: `(http.host eq "${dashboard}" and starts_with(http.request.uri.path, "/api/hooks"))`,
        description: HOOK_RULE,
        enabled: true,
      };
      type Ruleset = { id: string; rules?: { description?: string }[] };
      const entry = await cf<Ruleset>(apiToken, 'GET', `/zones/${zoneId}/rulesets/phases/http_request_firewall_custom/entrypoint`).catch(() => null);
      if (!entry) {
        await cf(apiToken, 'POST', `/zones/${zoneId}/rulesets`, { name: 'default', kind: 'zone', phase: 'http_request_firewall_custom', rules: [rule] });
      } else if (!entry.rules?.some((existing) => existing.description === HOOK_RULE)) {
        await cf(apiToken, 'POST', `/zones/${zoneId}/rulesets/${entry.id}/rules`, { ...rule, position: { index: 1 } });
      } else {
        return 'The skip rule was already in place.';
      }
      return `Added a WAF skip rule for ${dashboard}/api/hooks.`;
    });

    await tryTo('Check Bot Fight Mode', async () => {
      const bots = await cf<{ fight_mode?: boolean }>(apiToken, 'GET', `/zones/${zoneId}/bot_management`);
      if (!bots.fight_mode) return 'Bot Fight Mode is off for this domain.';
      if (!input.disableBotFightMode) {
        return {
          warning:
            'Bot Fight Mode is on for this domain. It can block GitHub from calling deploy hooks, and unlike Super Bot Fight Mode it cannot be skipped for one address. If hook calls get blocked, turn it off in Cloudflare under Security, Bots, or run this setup again with "Turn off Bot Fight Mode" ticked.',
        };
      }
      await cf(apiToken, 'PUT', `/zones/${zoneId}/bot_management`, { fight_mode: false });
      return 'Turned off Bot Fight Mode for this domain, as you asked.';
    });

    const ok = await activate(
      { enabled: true, mode: 'automatic', domain, tunnelToken, accountId: account, zoneId, tunnelId: tunnel.id, updatedAt: Date.now() },
      steps,
    );
    return { ok, steps };
  } catch (err) {
    if (err !== stop) throw err;
    return { ok: false, steps };
  }
}

/** For a tunnel the user set up in Cloudflare themselves: Dockyard only runs the connector. */
export async function setupManual(input: { domain: string; tunnelToken: string }): Promise<SetupResult> {
  const domain = input.domain.trim().toLowerCase().replace(/^\*\./, '');
  const tunnelToken = input.tunnelToken.trim();
  if (!DOMAIN.test(domain)) throw badRequest('Enter your domain, such as example.com.');
  if (!tunnelTokenLooksValid(tunnelToken)) {
    throw badRequest('That does not look like a tunnel token. Copy the long value after "--token" from the tunnel\'s install command in Cloudflare.');
  }
  const steps: Step[] = [];
  const ok = await activate({ enabled: true, mode: 'manual', domain, tunnelToken, updatedAt: Date.now() }, steps);
  return { ok, steps };
}

/** Stops serving publicly but remembers the settings, so it can be switched back on without Cloudflare. */
export async function disablePublicAccess(): Promise<void> {
  const access = publicAccess();
  if (access) savePublicAccess({ ...access, enabled: false, updatedAt: Date.now() });
  await stopConnector();
}

export async function enablePublicAccess(): Promise<SetupResult> {
  const access = publicAccess();
  if (!access) throw badRequest('Public access has not been set up yet.');
  const steps: Step[] = [];
  const ok = await activate({ ...access, enabled: true, updatedAt: Date.now() }, steps);
  return { ok, steps };
}

export async function forgetPublicAccess(): Promise<void> {
  savePublicAccess(null);
  await stopConnector();
}
