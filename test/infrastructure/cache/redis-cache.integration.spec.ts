import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from '../../../src/app.module';
import { configureApp } from '../../../src/bootstrap';
import { AnswerQuestionUseCase } from '../../../src/application/use-cases/answer-question.use-case';
import { CACHE, type CachePort } from '../../../src/application/ports/cache.port';
import { freePort } from '../../helpers/free-port';

const REDIS_URL = process.env.TEST_REDIS_URL ?? 'redis://127.0.0.1:6379';

async function redisAvailable(url: string): Promise<boolean> {
  const { default: Redis } = await import('ioredis');
  const redis = new Redis(url, {
    lazyConnect: true,
    enableOfflineQueue: false,
    connectTimeout: 500,
    maxRetriesPerRequest: 0,
    retryStrategy: () => null,
  });

  try {
    await redis.connect();
    await redis.ping();
    return true;
  } catch {
    return false;
  } finally {
    redis.disconnect();
  }
}

describe('cache with real Redis', () => {
  let app: NestFastifyApplication;
  let useCase: AnswerQuestionUseCase;
  let cache: CachePort;
  let hasRedis = false;

  const ifRedis = (name: string, fn: () => Promise<void>) =>
    it(name, async (ctx) => {
      if (!hasRedis) return ctx.skip();
      await fn();
    });

  beforeAll(async () => {
    hasRedis = await redisAvailable(REDIS_URL);
    if (!hasRedis) return;

    const port = await freePort();
    process.env.HR_API_BASE_URL = `http://127.0.0.1:${port}/mock/v1`;
    process.env.CACHE_ENABLED = 'true';
    process.env.REDIS_URL = REDIS_URL;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter({ logger: false }));
    await configureApp(app);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    await app.listen({ port, host: '127.0.0.1' });

    useCase = app.get(AnswerQuestionUseCase);
    cache = app.get<CachePort>(CACHE);
    await cache.clear();
  }, 30_000);

  afterAll(async () => {
    await cache?.clear();
    await app?.close();

    process.env.CACHE_ENABLED = 'false';
    process.env.REDIS_URL = '';
  });

  ifRedis('MISS on the first call, HIT on the second', async () => {
    const question = 'Qual o prazo para enviar comprovantes de reembolso?';

    const first = await useCase.execute(question);
    expect(first.cache).toBe('MISS');

    const second = await useCase.execute(question);
    expect(second.cache).toBe('HIT');
    expect(second.answer).toBe(first.answer);
    expect(second.sources).toEqual(first.sources);
  });

  ifRedis('a cache hit costs ZERO tokens', async () => {
    const question = 'Quantos dias por semana preciso ir ao escritório?';

    const first = await useCase.execute(question);
    const second = await useCase.execute(question);

    expect(first.cost.inputTokens).toBeGreaterThan(0);

    expect(second.cache).toBe('HIT');
    expect(second.cost.inputTokens).toBe(0);
    expect(second.cost.usd).toBe(0);
  });

  ifRedis('a typographic variant of the same question hits the cache', async () => {
    await useCase.execute('Como funciona o aviso prévio?');
    expect((await useCase.execute('  como funciona o aviso previo  ')).cache).toBe('HIT');
  });

  ifRedis('bypassCache forces the full path', async () => {
    const question = 'Qual o valor do auxílio home-office?';

    await useCase.execute(question);
    const forced = await useCase.execute(question, { bypassCache: true });

    expect(forced.cache).toBe('MISS');
    expect(forced.cost.inputTokens).toBeGreaterThan(0);
  });

  ifRedis('NEVER caches an answer containing personal data', async () => {
    const question = 'Qual o meu saldo de férias? Meu id é 1042.';

    const first = await useCase.execute(question);
    expect(first.sources.some((s) => s.kind === 'api')).toBe(true);

    expect((await useCase.execute(question)).cache).toBe('MISS');
  });

  ifRedis('never caches a degraded answer', async () => {
    const root = `http://127.0.0.1:${new URL(process.env.HR_API_BASE_URL!).port}`;
    const chaos = (mode: string) =>
      fetch(`${root}/mock/v1/_chaos`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode }),
      });

    const question = 'Meu banco de horas está em 24h (id 1042); posso converter em folga?';

    await chaos('500');
    try {
      expect((await useCase.execute(question)).degraded).toBe(true);
    } finally {
      await chaos('ok');
    }

    expect((await useCase.execute(question)).cache).toBe('MISS');
  });
});
