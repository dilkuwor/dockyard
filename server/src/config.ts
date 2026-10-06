import path from 'node:path';

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required environment variable ${name}. See .env.example.`);
    process.exit(1);
  }
  return value;
}

const baseDomain = required('BASE_DOMAIN');
const dataDir = process.env.DATA_DIR ?? '/data';

export const config = {
  port: Number(process.env.PORT ?? 3000),
  host: process.env.HOST ?? '0.0.0.0',
  dataDir,
  appsDir: path.join(dataDir, 'apps'),
  publicDir: process.env.PUBLIC_DIR ?? path.resolve('public'),
  baseDomain,
  dashboardHost: process.env.DASHBOARD_HOST ?? `dockyard.${baseDomain}`,
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
