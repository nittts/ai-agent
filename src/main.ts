import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { join } from 'node:path';
import { AppModule } from './app.module';
import { ENV } from './config/config.module';
import type { Env } from './config/env';
import { createLogger, newCorrelationId, runWithContext } from './observability/logger';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: false }),
    { bufferLogs: true },
  );

  const env = app.get<Env>(ENV);
  const log = createLogger(env.LOG_LEVEL, env.NODE_ENV === 'development');

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

  await app.listen({ port: env.PORT, host: '0.0.0.0' });

  log.info(
    {
      port: env.PORT,
      llmProvider: env.LLM_PROVIDER,
      chatModel: env.LLM_PROVIDER === 'fake' ? 'fake' : env.GEMINI_CHAT_MODEL,
      cacheEnabled: env.CACHE_ENABLED && Boolean(env.REDIS_URL),
    },
    'Assistente RH/TI no ar',
  );
}

bootstrap().catch((err) => {
  console.error('\nFalha ao iniciar o serviço:\n');
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
