import type { FastifyInstance } from 'fastify';
import { db } from '../db.js';
import { dockerAvailable, dockerStorage, lastLine, managedAppStorage, platformContainers, run } from '../docker.js';

export async function platformRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/platform/health', async () => {
    const docker = await dockerAvailable();
    if (!docker) {
      return {
        checkedAt: Date.now(),
        dockyard: { status: 'healthy', uptimeSeconds: Math.floor(process.uptime()), memoryBytes: process.memoryUsage().rss },
        docker: { status: 'unavailable', version: null },
        services: [],
        storage: [],
        apps: [],
      };
    }

    const appRows = db.prepare('SELECT id, name, slug, preview_of, branch FROM apps ORDER BY name').all() as {
      id: string; name: string; slug: string; preview_of: string | null; branch: string | null;
    }[];
    const [versionResult, services, storage, apps] = await Promise.all([
      run(['version', '--format', '{{.Server.Version}}'], { timeoutMs: 10_000 }),
      platformContainers(),
      dockerStorage(),
      managedAppStorage(appRows.map((row) => ({
        id: row.id,
        name: row.name,
        slug: row.slug,
        previewOf: row.preview_of,
        branch: row.branch,
      }))),
    ]);
    if (versionResult.code !== 0) throw new Error(`Could not read Docker version: ${lastLine(versionResult.stderr)}`);

    return {
      checkedAt: Date.now(),
      dockyard: { status: 'healthy', uptimeSeconds: Math.floor(process.uptime()), memoryBytes: process.memoryUsage().rss },
      docker: { status: 'healthy', version: versionResult.stdout.trim() },
      services,
      storage,
      apps,
    };
  });
}
