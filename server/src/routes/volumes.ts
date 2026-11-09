import type { FastifyInstance } from 'fastify';
import { deleteVolume, unusedVolumes, volumeArchive } from '../volumes.js';

/** Unused app volumes. Listing works with an API token; downloading and deleting need a session (see SESSION_ONLY). */
export async function volumeRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/volumes/unused', async () => {
    const volumes = await unusedVolumes();
    return { volumes, totalBytes: volumes.reduce((sum, v) => sum + v.size, 0) };
  });

  /** Deletes one unused volume. The body must repeat its name: `{confirm: "<name>"}`. */
  app.delete<{ Params: { name: string } }>('/api/volumes/:name', async (req) => {
    return deleteVolume(req.params.name, (req.body as { confirm?: unknown } | undefined)?.confirm);
  });

  /** The volume's files as a .tar.gz, to keep before deleting it. */
  app.get<{ Params: { name: string } }>('/api/volumes/:name/archive', async (req, reply) => {
    const archive = await volumeArchive(req.params.name);
    reply.header('Content-Type', 'application/gzip');
    reply.header('Content-Disposition', `attachment; filename="${archive.filename}"`);
    return reply.send(archive.stream);
  });
}
