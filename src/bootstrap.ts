import { join } from 'node:path';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { newCorrelationId, runWithContext } from './infrastructure/observability/logger';

export async function configureApp(app: NestFastifyApplication): Promise<void> {
  const fastify = app.getHttpAdapter().getInstance();

  fastify.addHook('onRequest', (req, reply, done) => {
    const incoming = req.headers['x-correlation-id'];
    const correlationId = typeof incoming === 'string' && incoming ? incoming : newCorrelationId();

    reply.header('x-correlation-id', correlationId);
    runWithContext({ correlationId }, done);
  });

  await app.register(import('@fastify/static'), {
    root: join(__dirname, '..', 'public'),
    prefix: '/',
  });
}
