import type { FastifyInstance } from 'fastify';
import {
  addDomain,
  disablePublicAccess,
  enablePublicAccess,
  forgetApiToken,
  forgetPublicAccess,
  listZones,
  savedApiToken,
  normalizeDomain,
  removeDomain,
  setDefaultDomain,
  setupAutomatic,
  setupManual,
} from '../cloudflare.js';
import { db } from '../db.js';
import { watchdogStatus } from '../watchdog.js';
import { config } from '../config.js';
import { connectorState } from '../docker.js';
import { appUrl, completeOnboarding, configuredDomains, dashboardUrl, defaultDomain, onboardingPending, publicAccess } from '../site.js';

/** Apps assigned to a domain. Apps with no domain count towards the dashboard's. */
/** Apps that depend on a domain: served under it as <slug>.<domain>, or through a custom hostname in it. */
function appsOn(domain: string): number {
  const primary = publicAccess()?.domain;
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n FROM apps
       WHERE ${domain === primary ? 'domain IS NULL OR ' : ''}domain = @domain
          OR id IN (SELECT app_id FROM hostnames WHERE hostname = @domain OR hostname LIKE @suffix)`,
    )
    .get({ domain, suffix: `%.${domain}` }) as { n: number };
  return row.n;
}

/** What the dashboard shows about public access. Never includes the tunnel token. */
async function status() {
  const access = publicAccess();
  const port = config.localPort === 80 ? '' : `:${config.localPort}`;
  return {
    configured: access !== null,
    enabled: access?.enabled ?? false,
    mode: access?.mode ?? null,
    domain: access?.domain ?? null,
    connector: (await connectorState()).status,
    watchdog: watchdogStatus(),
    // Whether the Cloudflare API token from setup is saved, so domain changes need no pasting.
    hasApiToken: Boolean(access?.apiToken),
    domains: configuredDomains().map((domain) => ({
      domain,
      primary: domain === access?.domain,
      default: domain === defaultDomain(),
      apps: appsOn(domain),
    })),
    dashboardUrl: dashboardUrl(),
    localDashboardUrl: `http://${config.dashboardSubdomain}.${config.localDomain}${port}`,
    exampleAppUrl: appUrl('my-app'),
  };
}

export async function cloudflareRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/cloudflare', async () => status());

  /** Checks an API token and lists the domains it can manage. A blank token means the saved one. */
  app.post('/api/cloudflare/zones', async (req) => {
    const { apiToken } = (req.body ?? {}) as { apiToken?: unknown };
    return listZones(String(apiToken ?? '').trim() || savedApiToken() || '');
  });

  app.delete('/api/cloudflare/token', async () => {
    forgetApiToken();
    return status();
  });

  app.post('/api/cloudflare/setup', async (req) => {
    const body = (req.body ?? {}) as { apiToken?: unknown; zoneId?: unknown; replaceDns?: unknown; disableBotFightMode?: unknown; newTunnel?: unknown };
    const result = await setupAutomatic({
      apiToken: String(body.apiToken ?? '').trim(),
      zoneId: String(body.zoneId ?? '').trim(),
      replaceDns: body.replaceDns === true,
      disableBotFightMode: body.disableBotFightMode === true,
      newTunnel: body.newTunnel === true,
    });
    return { ...result, status: await status() };
  });

  app.post('/api/cloudflare/manual', async (req) => {
    const body = (req.body ?? {}) as { domain?: unknown; tunnelToken?: unknown };
    const result = await setupManual({ domain: String(body.domain ?? ''), tunnelToken: String(body.tunnelToken ?? '') });
    return { ...result, status: await status() };
  });

  /** Adds a domain to this install's tunnel, with the saved API token unless one is given. */
  app.post('/api/cloudflare/domains', async (req) => {
    const body = (req.body ?? {}) as { apiToken?: unknown; zoneId?: unknown; domain?: unknown; replaceDns?: unknown };
    const result = await addDomain({
      apiToken: String(body.apiToken ?? ''),
      zoneId: String(body.zoneId ?? ''),
      domain: String(body.domain ?? ''),
      replaceDns: body.replaceDns === true,
    });
    return { ...result, status: await status() };
  });

  app.delete<{ Params: { domain: string } }>('/api/cloudflare/domains/:domain', async (req) => {
    const domain = normalizeDomain(req.params.domain);
    const { apiToken } = (req.body ?? {}) as { apiToken?: unknown };
    const result = await removeDomain(domain, apiToken ? String(apiToken) : undefined, appsOn(domain));
    return { ...result, status: await status() };
  });

  app.post<{ Params: { domain: string } }>('/api/cloudflare/domains/:domain/default', async (req) => {
    setDefaultDomain(normalizeDomain(req.params.domain));
    return status();
  });

  app.post('/api/cloudflare/disable', async () => {
    await disablePublicAccess();
    return status();
  });

  app.post('/api/cloudflare/enable', async () => {
    const result = await enablePublicAccess();
    return { ...result, status: await status() };
  });

  app.delete('/api/cloudflare', async () => {
    await forgetPublicAccess();
    return status();
  });

  app.get('/api/onboarding', async () => ({ pending: onboardingPending() }));

  app.post('/api/onboarding/complete', async () => {
    completeOnboarding();
    return { pending: false };
  });
}
