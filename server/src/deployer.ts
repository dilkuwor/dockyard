import { config } from './config.js';
import { decrypt, randomId } from './crypto.js';
import { db, type AppRow, type DeploymentRow } from './db.js';
import { compose, writeComposeFile } from './docker.js';
import { getServiceImage, renderCompose, setServiceImage } from './compose.js';
import { notFound } from './errors.js';
import { trackImages } from './images.js';

const MAX_LOG = 200_000;
const queues = new Map<string, Promise<void>>();

export function appHost(app: Pick<AppRow, 'slug'>): string {
  return `${app.slug}.${config.baseDomain}`;
}

export function appEnv(app: Pick<AppRow, 'env_enc'>): { key: string; value: string }[] {
  if (!app.env_enc) return [];
  return JSON.parse(decrypt(app.env_enc));
}

export interface DeployRequest {
  trigger: DeploymentRow['trigger'];
  image?: string;
  commitSha?: string;
  rollbackOf?: string;
}

/**
 * Records a deployment and queues it. Deploys for the same app run one at a
 * time, in order; different apps deploy in parallel.
 */
export function enqueueDeploy(appId: string, req: DeployRequest): DeploymentRow {
  const app = db.prepare('SELECT * FROM apps WHERE id = ?').get(appId) as AppRow | undefined;
  if (!app) throw notFound('App');

  let composeText = app.compose;
  if (req.rollbackOf) {
    const target = db
      .prepare('SELECT * FROM deployments WHERE id = ? AND app_id = ?')
      .get(req.rollbackOf, appId) as DeploymentRow | undefined;
    if (!target) throw notFound('Deployment');
    composeText = target.compose;
  } else if (req.image) {
    composeText = setServiceImage(app.compose, app.primary_service, req.image);
  }

  // The app's stored compose always reflects what was most recently deployed,
  // so a manual redeploy after a webhook keeps the webhook's image.
  if (composeText !== app.compose) {
    db.prepare('UPDATE apps SET compose = ?, updated_at = ? WHERE id = ?').run(composeText, Date.now(), appId);
  }

  const deployment: DeploymentRow = {
    id: randomId(12),
    app_id: appId,
    status: 'queued',
    trigger: req.trigger,
    image: getServiceImage(composeText, app.primary_service),
    commit_sha: req.commitSha ?? null,
    compose: composeText,
    rollback_of: req.rollbackOf ?? null,
    log: '',
    created_at: Date.now(),
    finished_at: null,
  };
  db.prepare(
    `INSERT INTO deployments (id, app_id, status, trigger, image, commit_sha, compose, rollback_of, log, created_at)
     VALUES (@id, @app_id, @status, @trigger, @image, @commit_sha, @compose, @rollback_of, @log, @created_at)`,
  ).run(deployment);

  const previous = queues.get(appId) ?? Promise.resolve();
  const next = previous.then(() => runDeployment(deployment.id)).catch(() => undefined);
  queues.set(appId, next);
  next.finally(() => {
    if (queues.get(appId) === next) queues.delete(appId);
  });
  return deployment;
}

async function runDeployment(deploymentId: string): Promise<void> {
  const deployment = db.prepare('SELECT * FROM deployments WHERE id = ?').get(deploymentId) as DeploymentRow | undefined;
  if (!deployment) return;
  const app = db.prepare('SELECT * FROM apps WHERE id = ?').get(deployment.app_id) as AppRow | undefined;
  if (!app) return;

  let logSize = 0;
  const appendLog = db.prepare('UPDATE deployments SET log = log || ? WHERE id = ?');
  const log = (line: string) => {
    if (logSize > MAX_LOG) return;
    const entry = `${line}\n`;
    logSize += entry.length;
    appendLog.run(logSize > MAX_LOG ? '… log truncated\n' : entry, deploymentId);
  };
  const finish = (status: 'succeeded' | 'failed') =>
    db.prepare('UPDATE deployments SET status = ?, finished_at = ? WHERE id = ?').run(status, Date.now(), deploymentId);

  db.prepare("UPDATE deployments SET status = 'running' WHERE id = ?").run(deploymentId);

  try {
    const host = appHost(app);
    log(`Deploying ${app.name} to https://${host}`);
    if (deployment.image) log(`Image: ${deployment.image}`);

    const rendered = renderCompose(deployment.compose, {
      appId: app.id,
      host,
      primaryService: app.primary_service,
      port: app.port,
      env: appEnv(app),
      edgeNetwork: config.edgeNetwork,
      entrypoint: config.traefikEntrypoint,
    });
    writeComposeFile(app.id, rendered);

    log('\n$ docker compose pull');
    const pull = await compose.pull(app.id, log);
    if (pull.code !== 0) throw new Error('Pulling images failed. Check the image name and registry access.');
    await trackImages([deployment.compose]);

    log('\n$ docker compose up -d --wait');
    const up = await compose.up(app.id, log);
    if (up.code !== 0) throw new Error('Containers did not reach a running or healthy state. Check the app logs.');

    db.prepare('UPDATE apps SET current_deployment_id = ?, updated_at = ? WHERE id = ?').run(
      deploymentId,
      Date.now(),
      app.id,
    );
    log(`\nLive at https://${host}`);
    finish('succeeded');
  } catch (err) {
    log(`\nDeployment failed: ${(err as Error).message}`);
    finish('failed');
  }
}
