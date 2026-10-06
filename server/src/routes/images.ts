import type { FastifyInstance } from 'fastify';
import { pruneImages, unusedImages } from '../images.js';

export async function imageRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/images/unused', async () => {
    const images = (await unusedImages()).map(({ id, name, size }) => ({ id, name, size }));
    return { images, totalBytes: images.reduce((sum, image) => sum + image.size, 0) };
  });

  app.post('/api/images/prune', async () => pruneImages());
}
