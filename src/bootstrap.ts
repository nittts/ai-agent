import { join } from 'node:path';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { newCorrelationId, runWithContext } from './observability/logger';

export async function configurarApp(app: NestFastifyApplication): Promise<void> {
  const fastify = app.getHttpAdapter().getInstance();

  fastify.addHook('onRequest', (req, reply, done) => {
    const recebido = req.headers['x-correlation-id'];
    const correlationId = typeof recebido === 'string' && recebido ? recebido : newCorrelationId();

    reply.header('x-correlation-id', correlationId);
    runWithContext({ correlationId }, done);
  });

  await app.register(import('@fastify/static'), {
    root: join(__dirname, '..', 'public'),
    prefix: '/',
  });
}
