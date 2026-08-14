import 'reflect-metadata';

import { loadEnv } from './infrastructure/config/env';
import { startOtel, stopOtel } from './infrastructure/observability/otel';

const bootEnv = loadEnv();
if (bootEnv.OTEL_ENABLED) {
  startOtel(bootEnv.OTEL_SERVICE_NAME, process.env.npm_package_version ?? '1.0.0');
}

import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module';
import { configureApp } from './bootstrap';
import { ENV } from './infrastructure/config/config.module';
import type { Env } from './infrastructure/config/env';
import { createLogger } from './infrastructure/observability/logger';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: false }),
    { bufferLogs: true },
  );

  const env = app.get<Env>(ENV);
  const log = createLogger(env.LOG_LEVEL, env.NODE_ENV === 'development');

  await configureApp(app);

  app.enableShutdownHooks();

  await app.listen({ port: env.PORT, host: '0.0.0.0' });

  log.info(
    {
      port: env.PORT,
      llmProvider: env.LLM_PROVIDER,
      chatModel: env.LLM_PROVIDER === 'fake' ? 'fake' : env.GEMINI_CHAT_MODEL,
      cacheEnabled: env.CACHE_ENABLED && Boolean(env.REDIS_URL),
    },
    `HR/IT assistant is up — console at http://localhost:${env.PORT}`,
  );
}

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.once(signal, () => {
    void stopOtel().finally(() => process.exit(0));
  });
}

bootstrap().catch((err) => {
  console.error('\nFailed to start the service:\n');
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
