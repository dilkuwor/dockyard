import path from 'node:path';

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required environment variable ${name}. See .env.example.`);
    process.exit(1);
  }
  return value;
}

const dataDir = process.env.DATA_DIR ?? '/data';

export const config = {
  port: Number(process.env.PORT ?? 3000),
  host: process.env.HOST ?? '0.0.0.0',
  dataDir,
  appsDir: path.join(dataDir, 'apps'),
  publicDir: process.env.PUBLIC_DIR ?? path.resolve('public'),
  assetsDir: process.env.ASSETS_DIR ?? path.resolve('assets'),
  // The dashboard is served at <dashboardSubdomain>.<domain>, on the local address and the public one.
  dashboardSubdomain: process.env.DASHBOARD_SUBDOMAIN ?? 'dockyard',
  // Without public access, apps are reachable at http://<name>.<localDomain>:<localPort> on this machine.
  localDomain: process.env.LOCAL_DOMAIN ?? 'localhost',
  localPort: Number(process.env.LOCAL_PORT ?? 8080),
  cloudflareApi: process.env.CLOUDFLARE_API_URL ?? 'https://api.cloudflare.com/client/v4',
  // Older installs configured the tunnel in .env; these are imported into the dashboard's settings once.
  legacyDomain: process.env.BASE_DOMAIN,
  legacyTunnelToken: process.env.CLOUDFLARE_TUNNEL_TOKEN,
  edgeNetwork: process.env.EDGE_NETWORK ?? 'dockyard_edge',
  traefikEntrypoint: process.env.TRAEFIK_ENTRYPOINT ?? 'web',
  secret: required('DOCKYARD_SECRET'),
  adminPassword: required('ADMIN_PASSWORD'),
  dockerHubUsername: process.env.DOCKERHUB_USERNAME,
  dockerHubToken: process.env.DOCKERHUB_TOKEN,
  ghcrUsername: process.env.GHCR_USERNAME,
  ghcrToken: process.env.GHCR_TOKEN,
  deployTimeoutSeconds: Number(process.env.DEPLOY_WAIT_TIMEOUT ?? 120),
};

if (config.secret.length < 32) {
  console.error('DOCKYARD_SECRET must be at least 32 characters. Generate one with: openssl rand -hex 32');
  process.exit(1);
}
