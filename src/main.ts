import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module';
import { configurarApp } from './bootstrap';
import { ENV } from './config/config.module';
import type { Env } from './config/env';
import { createLogger } from './observability/logger';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: false }),
    { bufferLogs: true },
  );

  const env = app.get<Env>(ENV);
  const log = createLogger(env.LOG_LEVEL, env.NODE_ENV === 'development');

  await configurarApp(app);

  await app.listen({ port: env.PORT, host: '0.0.0.0' });

  log.info(
    {
      port: env.PORT,
      llmProvider: env.LLM_PROVIDER,
      chatModel: env.LLM_PROVIDER === 'fake' ? 'fake' : env.GEMINI_CHAT_MODEL,
      cacheEnabled: env.CACHE_ENABLED && Boolean(env.REDIS_URL),
    },
    `Assistente RH/TI no ar — console em http://localhost:${env.PORT}`,
  );
}

bootstrap().catch((err) => {
  console.error('\nFalha ao iniciar o serviço:\n');
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
