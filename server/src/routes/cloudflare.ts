import type { FastifyInstance } from 'fastify';
import {
  disablePublicAccess,
  enablePublicAccess,
  forgetPublicAccess,
  listZones,
  setupAutomatic,
  setupManual,
} from '../cloudflare.js';
import { config } from '../config.js';
import { connectorState } from '../docker.js';
import { appUrl, completeOnboarding, dashboardUrl, onboardingPending, publicAccess } from '../site.js';

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
    dashboardUrl: dashboardUrl(),
    localDashboardUrl: `http://${config.dashboardSubdomain}.${config.localDomain}${port}`,
    exampleAppUrl: appUrl('my-app'),
  };
}

export async function cloudflareRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/cloudflare', async () => status());

  /** Checks an API token and lists the domains it can manage. Nothing is stored. */
  app.post('/api/cloudflare/zones', async (req) => {
    const { apiToken } = (req.body ?? {}) as { apiToken?: unknown };
    return listZones(String(apiToken ?? '').trim());
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
