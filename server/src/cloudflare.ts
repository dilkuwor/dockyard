import { config } from './config.js';
import { randomId, sha256Hex } from './crypto.js';
import { connectorId, connectorState, connectorUpToDate, startConnector, stopConnector, waitForConnector } from './docker.js';
import { badRequest } from './errors.js';
import { completeOnboarding, configuredDomains, publicAccess, savePublicAccess, type PublicAccess } from './site.js';

export interface Step {
  name: string;
  status: 'ok' | 'warning' | 'failed';
  detail: string;
}

export interface SetupResult {
  ok: boolean;
  steps: Step[];
}

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
  // Recreated when the token changed, or when it still runs the old QUIC default.
  if (await connectorUpToDate(tokenId(access.tunnelToken))) return;
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
  const alreadyRunning = await connectorUpToDate(tokenId(access.tunnelToken));
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
 * hooks past bot protection. The token is kept, encrypted with the rest of the public-access
 * settings, so domains can be added or removed later without pasting it again.
 */
interface Tunnel {
  id: string;
  name: string;
  deleted_at?: string | null;
  connections?: { client_id: string; opened_at?: string }[];
}

/** Connectors on a tunnel other than the one running on this machine, by Cloudflare's connector id. */
function foreignConnectors(tunnel: Tunnel, ours: string | null): number {
  return new Set((tunnel.connections ?? []).map((c) => c.client_id).filter((id) => id !== ours)).size;
}

export async function setupAutomatic(input: {
  apiToken: string;
  zoneId: string;
  replaceDns: boolean;
  disableBotFightMode: boolean;
  /** Create a fresh tunnel even if one for this domain, or this install's previous one, exists. */
  newTunnel: boolean;
}): Promise<SetupResult> {
  const { zoneId } = input;
  // A blank token means "the saved one", for "Set up again" after the first setup.
  const apiToken = input.apiToken || publicAccess()?.apiToken || '';
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

    // One tunnel per Dockyard. Two installs on one tunnel would have Cloudflare split a domain's
    // requests between both machines, so a tunnel that other connectors are using is never joined.
    const previous = publicAccess();
    const tunnel = await must('Create the tunnel', async () => {
      const ours = await connectorId();
      const shared = (t: Tunnel) => {
        const n = foreignConnectors(t, ours);
        return n === 0
          ? null
          : new Error(
              `The tunnel "${t.name}" already has ${n} other connector${n === 1 ? '' : 's'} attached, so another Dockyard or cloudflared is using it. ` +
                'Sharing it would send some of this domain\'s requests to that machine. Tick "Use a separate tunnel" and run the setup again.',
            );
      };
      const byName = `dockyard-${domain}`;

      if (!input.newTunnel) {
        // The tunnel this install already uses, as long as it still exists and is not shared.
        if (previous?.tunnelId) {
          const own = await cf<Tunnel>(apiToken, 'GET', `/accounts/${account}/cfd_tunnel/${previous.tunnelId}`).catch(() => null);
          if (own && !own.deleted_at) {
            const problem = shared(own);
            if (problem) throw problem;
            return { ...own, reused: true };
          }
        }
        // Otherwise one named for this domain, if nobody else is on it.
        const existing = await cf<Tunnel[]>(apiToken, 'GET', `/accounts/${account}/cfd_tunnel?name=${encodeURIComponent(byName)}&is_deleted=false`);
        if (existing[0]) {
          const problem = shared(existing[0]);
          if (problem) throw problem;
          return { ...existing[0], reused: true };
        }
      }

      const taken = await cf<Tunnel[]>(apiToken, 'GET', `/accounts/${account}/cfd_tunnel?name=${encodeURIComponent(byName)}&is_deleted=false`);
      const name = taken[0] ? `${byName}-${randomId(4)}` : byName;
      const created = await cf<Tunnel>(apiToken, 'POST', `/accounts/${account}/cfd_tunnel`, { name, config_src: 'cloudflare' });
      return { ...created, name, reused: false };
    });
    steps.push({
      name: 'Create the tunnel',
      status: 'ok',
      detail: tunnel.reused ? `Reusing your tunnel "${tunnel.name}".` : `Created the tunnel "${tunnel.name}".`,
    });
    const movedTunnels = previous?.tunnelId !== undefined && previous.tunnelId !== tunnel.id;

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
      // Moving to a new tunnel: records that point at the old tunnel are expected and get replaced.
      const pointsAtATunnel = (record: DnsRecord) => record.type === 'CNAME' && record.content.endsWith('.cfargotunnel.com');
      const blocking = inTheWay.filter((record) => !(input.replaceDns || (movedTunnels && pointsAtATunnel(record))));
      if (blocking.length) {
        const list = blocking.map((record) => `${record.name} (${record.type} to ${record.content})`).join(', ');
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

    if (movedTunnels && previous?.tunnelId) {
      const old = previous.tunnelId;
      await tryTo('Remove this domain from the old tunnel', async () => {
        type Ingress = { hostname?: string; service: string };
        const path = `/accounts/${account}/cfd_tunnel/${old}/configurations`;
        const current = await cf<{ config?: { ingress?: Ingress[] } | null }>(apiToken, 'GET', path);
        const rules = current?.config?.ingress ?? [];
        if (!rules.some((rule) => rule.hostname === wildcard)) return 'It had no route for this domain.';
        const ingress = rules.filter((rule) => rule.hostname && rule.hostname !== wildcard);
        await cf(apiToken, 'PUT', path, { config: { ...(current?.config ?? {}), ingress: [...ingress, { service: 'http_status:404' }] } });
        return `${wildcard} no longer routes through the tunnel this Dockyard used before.`;
      });
    }

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
      { enabled: true, mode: 'automatic', domain, tunnelToken, accountId: account, zoneId, tunnelId: tunnel.id, apiToken, updatedAt: Date.now() },
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

  // With a saved token, make sure the tunnel is still ours alone before attaching to it again.
  if (access.mode === 'automatic' && access.apiToken && access.accountId && access.tunnelId) {
    try {
      const tunnel = await cf<Tunnel>(access.apiToken, 'GET', `/accounts/${access.accountId}/cfd_tunnel/${access.tunnelId}`);
      const others = foreignConnectors(tunnel, await connectorId());
      if (others > 0) {
        steps.push({
          name: 'Check the tunnel',
          status: 'failed',
          detail:
            `The tunnel "${tunnel.name}" has ${others} other connector${others === 1 ? '' : 's'} attached, so another Dockyard or cloudflared is using it. ` +
            'Joining it would send some of this domain\'s requests to that machine. Use "Set up again" with "Use a separate tunnel" instead.',
        });
        return { ok: false, steps };
      }
      steps.push({ name: 'Check the tunnel', status: 'ok', detail: `No other connectors on "${tunnel.name}".` });
    } catch (err) {
      steps.push({ name: 'Check the tunnel', status: 'warning', detail: `Could not check for other connectors: ${(err as Error).message}` });
    }
  }

  const ok = await activate({ ...access, enabled: true, updatedAt: Date.now() }, steps);
  return { ok, steps };
}

export async function forgetPublicAccess(): Promise<void> {
  savePublicAccess(null);
  await stopConnector();
}

type Ingress = { hostname?: string; service: string; originRequest?: unknown };
const ingressPath = (account: string, tunnelId: string) => `/accounts/${account}/cfd_tunnel/${tunnelId}/configurations`;

/** Adds or removes the tunnel route `*.domain` → Traefik, keeping every other route. */
async function setWildcardRoute(apiToken: string, account: string, tunnelId: string, domain: string, present: boolean): Promise<void> {
  const wildcard = `*.${domain}`;
  const path = ingressPath(account, tunnelId);
  const current = await cf<{ config?: { ingress?: Ingress[] } | null }>(apiToken, 'GET', path).catch(() => null);
  const others = (current?.config?.ingress ?? []).filter((rule) => rule.hostname && rule.hostname !== wildcard);
  const ours = present ? [{ hostname: wildcard, service: 'http://traefik:80', originRequest: {} }] : [];
  await cf(apiToken, 'PUT', path, { config: { ...(current?.config ?? {}), ingress: [...others, ...ours, { service: 'http_status:404' }] } });
}

/** Makes `*.domain` a proxied CNAME to the tunnel, replacing a record that points elsewhere only when allowed. */
async function pointWildcardDns(apiToken: string, zoneId: string, tunnelId: string, domain: string, replaceDns: boolean): Promise<void> {
  const wildcard = `*.${domain}`;
  const target = `${tunnelId}.cfargotunnel.com`;
  const records = await cf<DnsRecord[]>(apiToken, 'GET', `/zones/${zoneId}/dns_records?name=${encodeURIComponent(wildcard)}`);
  const isOurs = (record: DnsRecord) => record.type === 'CNAME' && record.content === target;
  const inTheWay = records.filter((record) => !isOurs(record));
  if (inTheWay.length && !replaceDns) {
    const list = inTheWay.map((record) => `${record.name} (${record.type} to ${record.content})`).join(', ');
    throw new Error(`These DNS records point somewhere else: ${list}. Tick "Replace existing DNS records" to point them at Dockyard instead.`);
  }
  for (const record of inTheWay) await cf(apiToken, 'DELETE', `/zones/${zoneId}/dns_records/${record.id}`);
  const ours = records.find(isOurs);
  if (!ours) {
    await cf(apiToken, 'POST', `/zones/${zoneId}/dns_records`, { type: 'CNAME', name: wildcard, content: target, proxied: true, comment: 'Dockyard public access' });
  } else if (!ours.proxied) {
    await cf(apiToken, 'PATCH', `/zones/${zoneId}/dns_records/${ours.id}`, { proxied: true });
  }
}

export const normalizeDomain = (value: unknown): string => String(value ?? '').trim().toLowerCase().replace(/^\*\./, '');

/**
 * Adds another domain apps can live under. It rides this install's existing tunnel: one more
 * route on it and a wildcard record in the new domain's zone, using the token saved at setup unless
 * another is given. In manual mode the domain is only recorded, and the report says what to set up.
 */
export async function addDomain(input: { apiToken?: string; zoneId?: string; domain?: string; replaceDns: boolean }): Promise<SetupResult> {
  const access = publicAccess();
  if (!access) throw badRequest('Set up public access first, then add more domains.');
  const steps: Step[] = [];
  const fail = (name: string, err: unknown): SetupResult => {
    steps.push({ name, status: 'failed', detail: (err as Error).message });
    return { ok: false, steps };
  };

  if (access.mode === 'manual') {
    const domain = normalizeDomain(input.domain);
    if (!DOMAIN.test(domain)) throw badRequest('Enter the domain, such as example.com.');
    if (configuredDomains().includes(domain)) throw badRequest(`${domain} is already one of this Dockyard's domains.`);
    savePublicAccess({ ...access, extraDomains: [...(access.extraDomains ?? []), { domain }], updatedAt: Date.now() });
    steps.push({ name: 'Save', status: 'ok', detail: `Apps can now be given addresses under ${domain}.` });
    steps.push({
      name: 'Set up Cloudflare yourself',
      status: 'warning',
      detail: `In Cloudflare, add a published application route for *.${domain} → HTTP → traefik:80 to your tunnel, and a proxied CNAME record *.${domain} pointing at the tunnel. Dockyard cannot do this without an API token.`,
    });
    return { ok: true, steps };
  }

  const apiToken = (input.apiToken ?? '').trim() || access.apiToken || '';
  const zoneId = (input.zoneId ?? '').trim();
  if (!apiToken) throw badRequest('Enter a Cloudflare API token. Run "Set up again" once to have Dockyard keep it.');
  if (!ZONE_ID.test(zoneId)) throw badRequest('Choose one of your domains.');
  if (!access.accountId || !access.tunnelId) {
    throw badRequest('This public access setup predates multiple domains. Run "Set up again" once, then add domains.');
  }

  let zone: { name: string; account: { id: string } };
  try {
    zone = await cf<{ name: string; account: { id: string } }>(apiToken, 'GET', `/zones/${zoneId}`);
  } catch (err) {
    return fail('Find the domain', err);
  }
  const domain = zone.name;
  if (configuredDomains().includes(domain)) throw badRequest(`${domain} is already one of this Dockyard's domains.`);
  if (zone.account.id !== access.accountId) {
    return fail('Find the domain', new Error(`${domain} is in a different Cloudflare account than this Dockyard's tunnel. A tunnel can only carry domains from its own account.`));
  }
  steps.push({ name: 'Find the domain', status: 'ok', detail: domain });

  try {
    await setWildcardRoute(apiToken, access.accountId, access.tunnelId, domain, true);
    steps.push({ name: 'Route the domain to Dockyard', status: 'ok', detail: `*.${domain} goes to Dockyard's proxy through the existing tunnel.` });
  } catch (err) {
    return fail('Route the domain to Dockyard', err);
  }
  try {
    await pointWildcardDns(apiToken, zoneId, access.tunnelId, domain, input.replaceDns);
    steps.push({ name: 'Point DNS at the tunnel', status: 'ok', detail: `*.${domain} is proxied through Cloudflare to the tunnel.` });
  } catch (err) {
    return fail('Point DNS at the tunnel', err);
  }

  savePublicAccess({ ...access, extraDomains: [...(access.extraDomains ?? []), { domain, zoneId }], updatedAt: Date.now() });
  steps.push({ name: 'Save', status: 'ok', detail: `Apps can now be given addresses under ${domain}.` });
  return { ok: true, steps };
}

/** Removes an extra domain. With an API token in automatic mode, its route and DNS record go too. */
export async function removeDomain(domain: string, apiToken: string | undefined, appsUsingIt: number): Promise<SetupResult> {
  const access = publicAccess();
  if (!access) throw badRequest('Public access has not been set up.');
  if (domain === access.domain) throw badRequest('The dashboard\'s own domain cannot be removed. Use "Set up again" to change it.');
  const extra = access.extraDomains?.find((d) => d.domain === domain);
  if (!extra) throw badRequest('That domain is not configured.');
  if (appsUsingIt > 0) throw badRequest(`${appsUsingIt} app${appsUsingIt === 1 ? ' uses' : 's use'} ${domain}. Move them to another domain first.`);
  const steps: Step[] = [];
  const token = apiToken?.trim() || access.apiToken;

  if (access.mode === 'automatic' && token && access.accountId && access.tunnelId) {
    try {
      await setWildcardRoute(token, access.accountId, access.tunnelId, domain, false);
      steps.push({ name: 'Remove the tunnel route', status: 'ok', detail: `*.${domain} no longer goes to Dockyard.` });
    } catch (err) {
      steps.push({ name: 'Remove the tunnel route', status: 'warning', detail: `Left in place: ${(err as Error).message}` });
    }
    if (extra.zoneId) {
      try {
        const target = `${access.tunnelId}.cfargotunnel.com`;
        const records = await cf<DnsRecord[]>(token, 'GET', `/zones/${extra.zoneId}/dns_records?name=${encodeURIComponent(`*.${domain}`)}`);
        const ours = records.find((record) => record.type === 'CNAME' && record.content === target);
        if (ours) await cf(token, 'DELETE', `/zones/${extra.zoneId}/dns_records/${ours.id}`);
        steps.push({ name: 'Remove the DNS record', status: 'ok', detail: ours ? `Deleted the *.${domain} record.` : 'There was no record of ours to delete.' });
      } catch (err) {
        steps.push({ name: 'Remove the DNS record', status: 'warning', detail: `Left in place: ${(err as Error).message}` });
      }
    }
  } else {
    steps.push({
      name: 'Cloudflare',
      status: 'warning',
      detail: `The tunnel route and DNS record for *.${domain} stay in your Cloudflare account. Remove them there if you no longer want them.`,
    });
  }

  savePublicAccess({
    ...access,
    extraDomains: (access.extraDomains ?? []).filter((d) => d.domain !== domain),
    defaultDomain: access.defaultDomain === domain ? undefined : access.defaultDomain,
    updatedAt: Date.now(),
  });
  steps.push({ name: 'Save', status: 'ok', detail: `${domain} removed.` });
  return { ok: true, steps };
}

/** Drops the saved Cloudflare API token. Domain changes then ask for one again. */
export function forgetApiToken(): void {
  const access = publicAccess();
  if (!access) throw badRequest('Public access has not been set up.');
  savePublicAccess({ ...access, apiToken: undefined, updatedAt: Date.now() });
}

/** The saved Cloudflare API token, for listing zones without asking again. */
export const savedApiToken = (): string | null => publicAccess()?.apiToken ?? null;

/** Where new apps go when no domain is chosen. Only affects apps created from now on. */
export function setDefaultDomain(domain: string): void {
  const access = publicAccess();
  if (!access) throw badRequest('Public access has not been set up.');
  if (!configuredDomains().includes(domain)) throw badRequest('That domain is not configured.');
  savePublicAccess({ ...access, defaultDomain: domain === access.domain ? undefined : domain, updatedAt: Date.now() });
}

/** The zone a hostname belongs to, found by trying ever shorter suffixes with the token's zone list. */
async function zoneFor(apiToken: string, hostname: string): Promise<{ id: string; name: string; account: { id: string } } | null> {
  const parts = hostname.split('.');
  for (let i = 0; i < parts.length - 1; i++) {
    const candidate = parts.slice(i).join('.');
    const zones = await cf<{ id: string; name: string; account: { id: string } }[]>(apiToken, 'GET', `/zones?name=${encodeURIComponent(candidate)}&status=active`);
    if (zones[0]) return zones[0];
  }
  return null;
}

/** Adds or removes the tunnel route for one exact hostname. */
async function setHostRoute(apiToken: string, account: string, tunnelId: string, hostname: string, present: boolean): Promise<void> {
  const path = ingressPath(account, tunnelId);
  const current = await cf<{ config?: { ingress?: Ingress[] } | null }>(apiToken, 'GET', path).catch(() => null);
  const others = (current?.config?.ingress ?? []).filter((rule) => rule.hostname && rule.hostname !== hostname);
  const ours = present ? [{ hostname, service: 'http://traefik:80', originRequest: {} }] : [];
  // Exact hostnames go before wildcards so they win, which is also how Cloudflare evaluates them.
  await cf(apiToken, 'PUT', path, { config: { ...(current?.config ?? {}), ingress: [...ours, ...others, { service: 'http_status:404' }] } });
}

/**
 * Points a custom hostname at this install's tunnel: a tunnel route plus a proxied CNAME in its zone.
 * Cloudflare flattens CNAMEs at the apex, so example.com itself works too.
 */
export async function attachHostname(hostname: string): Promise<SetupResult & { zoneId: string | null }> {
  const access = publicAccess();
  const steps: Step[] = [];
  if (!access) return { ok: false, zoneId: null, steps: [{ name: 'Cloudflare', status: 'failed', detail: 'Public access is not set up.' }] };
  if (access.mode !== 'automatic' || !access.apiToken || !access.accountId || !access.tunnelId) {
    steps.push({
      name: 'Cloudflare',
      status: 'warning',
      detail: `Dockyard has no saved API token for this. In Cloudflare, add a published application route for ${hostname} → HTTP → traefik:80 to your tunnel, and a proxied CNAME record for ${hostname} pointing at the tunnel.`,
    });
    return { ok: true, zoneId: null, steps };
  }
  const token = access.apiToken;

  let zone: Awaited<ReturnType<typeof zoneFor>>;
  try {
    zone = await zoneFor(token, hostname);
  } catch (err) {
    return { ok: false, zoneId: null, steps: [{ name: 'Find the zone', status: 'failed', detail: (err as Error).message }] };
  }
  if (!zone) {
    return { ok: false, zoneId: null, steps: [{ name: 'Find the zone', status: 'failed', detail: `No Cloudflare zone of yours contains ${hostname}. Add its domain to Cloudflare first.` }] };
  }
  if (zone.account.id !== access.accountId) {
    return { ok: false, zoneId: null, steps: [{ name: 'Find the zone', status: 'failed', detail: `${zone.name} is in a different Cloudflare account than this Dockyard's tunnel.` }] };
  }
  steps.push({ name: 'Find the zone', status: 'ok', detail: zone.name });

  try {
    await setHostRoute(token, access.accountId, access.tunnelId, hostname, true);
    steps.push({ name: 'Route the hostname to Dockyard', status: 'ok', detail: `${hostname} goes to Dockyard's proxy through the tunnel.` });
  } catch (err) {
    return { ok: false, zoneId: zone.id, steps: [...steps, { name: 'Route the hostname to Dockyard', status: 'failed', detail: (err as Error).message }] };
  }

  try {
    const target = `${access.tunnelId}.cfargotunnel.com`;
    const records = await cf<DnsRecord[]>(token, 'GET', `/zones/${zone.id}/dns_records?name=${encodeURIComponent(hostname)}`);
    const ours = records.find((r) => r.type === 'CNAME' && r.content === target);
    const others = records.filter((r) => !(r.type === 'CNAME' && r.content === target));
    if (others.length) {
      const list = others.map((r) => `${r.type} to ${r.content}`).join(', ');
      throw new Error(`${hostname} already has a DNS record pointing elsewhere (${list}). Remove it in Cloudflare, then add the hostname again.`);
    }
    if (!ours) {
      await cf(token, 'POST', `/zones/${zone.id}/dns_records`, { type: 'CNAME', name: hostname, content: target, proxied: true, comment: 'Dockyard custom hostname' });
    } else if (!ours.proxied) {
      await cf(token, 'PATCH', `/zones/${zone.id}/dns_records/${ours.id}`, { proxied: true });
    }
    steps.push({ name: 'Point DNS at the tunnel', status: 'ok', detail: `${hostname} is proxied through Cloudflare to the tunnel.` });
  } catch (err) {
    await setHostRoute(token, access.accountId, access.tunnelId, hostname, false).catch(() => undefined);
    return { ok: false, zoneId: zone.id, steps: [...steps, { name: 'Point DNS at the tunnel', status: 'failed', detail: (err as Error).message }] };
  }
  return { ok: true, zoneId: zone.id, steps };
}

/** Removes the tunnel route and the DNS record Dockyard made for a custom hostname. */
export async function detachHostname(hostname: string, zoneId: string): Promise<SetupResult> {
  const access = publicAccess();
  const steps: Step[] = [];
  if (!access?.apiToken || !access.accountId || !access.tunnelId) {
    steps.push({ name: 'Cloudflare', status: 'warning', detail: `No saved API token: the tunnel route and DNS record for ${hostname} stay in Cloudflare.` });
    return { ok: true, steps };
  }
  try {
    await setHostRoute(access.apiToken, access.accountId, access.tunnelId, hostname, false);
    steps.push({ name: 'Remove the tunnel route', status: 'ok', detail: `${hostname} no longer routes through the tunnel.` });
  } catch (err) {
    steps.push({ name: 'Remove the tunnel route', status: 'warning', detail: `Left in place: ${(err as Error).message}` });
  }
  try {
    const target = `${access.tunnelId}.cfargotunnel.com`;
    const records = await cf<DnsRecord[]>(access.apiToken, 'GET', `/zones/${zoneId}/dns_records?name=${encodeURIComponent(hostname)}`);
    const ours = records.find((r) => r.type === 'CNAME' && r.content === target);
    if (ours) await cf(access.apiToken, 'DELETE', `/zones/${zoneId}/dns_records/${ours.id}`);
    steps.push({ name: 'Remove the DNS record', status: 'ok', detail: ours ? `Deleted the ${hostname} record.` : 'There was no record of ours to delete.' });
  } catch (err) {
    steps.push({ name: 'Remove the DNS record', status: 'warning', detail: `Left in place: ${(err as Error).message}` });
  }
  return { ok: true, steps };
}
