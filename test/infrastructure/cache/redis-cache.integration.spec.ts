import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { RedisCache } from '../../../src/infrastructure/cache/redis-cache';
import { AnswerQuestionUseCase } from '../../../src/application/use-cases/answer-question.use-case';
import { FakeChatModel } from '../../../src/infrastructure/llm/fake/fake-chat-model';
import { FakeEmbeddings } from '../../../src/infrastructure/llm/fake/fake-embeddings';
import { InMemoryVectorStore } from '../../../src/infrastructure/retrieval/in-memory-vector-store';
import { buildChunks, type RawDocument } from '../../../src/infrastructure/retrieval/chunker';
import type { IndexSnapshot } from '../../../src/domain/knowledge';
import {
  RecordNotFoundError,
  type HrDirectoryPort,
} from '../../../src/application/ports/hr-directory.port';
import {
  benefits,
  hoursBanks,
  tickets,
  vacationBalances,
} from '../../../src/presentation/mock-hr-api/seed';

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

class FakeHrDirectory implements HrDirectoryPort {
  public failure: 'none' | 'all' = 'none';

  private respond<T>(endpoint: string, data: T | undefined, resource: string, id: number) {
    if (this.failure === 'all') throw new Error('HR system unavailable');
    if (!data) throw new RecordNotFoundError(`${resource} ${id} does not exist.`);
    return Promise.resolve({
      data,
      source: { kind: 'api' as const, endpoint, fields: [], latencyMs: 3 },
    });
  }

  vacationBalance(id: number) {
    return this.respond(`GET /employees/${id}/vacation-balance`, vacationBalances[id], 'Employee', id);
  }
  benefits(id: number) {
    return this.respond(`GET /employees/${id}/benefits`, benefits[id], 'Employee', id);
  }
  hoursBank(id: number) {
    return this.respond(`GET /employees/${id}/hours-bank`, hoursBanks[id], 'Employee', id);
  }
  ticket(id: number) {
    return this.respond(`GET /tickets/${id}`, tickets[id], 'Ticket', id);
  }
}

describe('cache with real Redis', () => {
  let cache: RedisCache;
  let useCase: AnswerQuestionUseCase;
  let hr: FakeHrDirectory;
  let store: InMemoryVectorStore;
  let embeddings: FakeEmbeddings;
  let hasRedis = false;

  const ifRedis = (name: string, fn: () => Promise<void>) =>
    it(name, async (ctx) => {
      if (!hasRedis) return ctx.skip();
      await fn();
    });

  beforeAll(async () => {
    hasRedis = await redisAvailable(REDIS_URL);
    if (!hasRedis) return;

    const corpusDir = join(process.cwd(), 'corpus');
    const files = (await readdir(corpusDir)).filter((f) => f.endsWith('.md')).sort();
    const documents: RawDocument[] = await Promise.all(
      files.map(async (file) => ({
        file,
        content: await readFile(join(corpusDir, file), 'utf-8'),
      })),
    );

    const chunks = await buildChunks(documents);
    embeddings = new FakeEmbeddings();
    const vectors = await embeddings.embedDocuments(chunks.map((c) => c.text));

    const snapshot: IndexSnapshot = {
      corpusVersion: chunks[0].metadata.corpusVersion,
      embeddingModel: embeddings.modelName,
      dimensions: embeddings.dimensions,
      generatedAt: new Date().toISOString(),
      chunks: chunks.map((c, i) => ({ ...c, embedding: vectors[i] })),
    };

    store = new InMemoryVectorStore();
    store.load(snapshot);

    cache = new RedisCache(REDIS_URL);
    hr = new FakeHrDirectory();

    useCase = new AnswerQuestionUseCase(new FakeChatModel(), embeddings, store, hr, cache, {
      topK: 4,
      minScore: 0.18,
      llmTimeoutMs: 8_000,
      llmMaxRetries: 1,
      requestDeadlineMs: 15_000,
      cacheTtlSeconds: 60,
      price: { input: 0.3, output: 2.5 },
    });
  }, 30_000);

  beforeEach(async () => {
    if (hasRedis) await cache.clear();
    if (hr) hr.failure = 'none';
  });

  afterAll(async () => {
    if (!hasRedis) return;
    await cache.clear();
    await cache.close();
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
    const question = 'Meu banco de horas está em 24h (id 1042); posso converter em folga?';

    hr.failure = 'all';
    expect((await useCase.execute(question)).degraded).toBe(true);

    hr.failure = 'none';

    expect((await useCase.execute(question)).cache).toBe('MISS');
  });

  ifRedis('an entry written by one instance is readable by another', async () => {
    const question = 'Posso vender parte das minhas férias?';
    await useCase.execute(question);

    const otherInstance = new RedisCache(REDIS_URL);
    try {
      const otherUseCase = new AnswerQuestionUseCase(
        new FakeChatModel(),
        embeddings,
        store,
        hr,
        otherInstance,
        {
          topK: 4,
          minScore: 0.18,
          llmTimeoutMs: 8_000,
          llmMaxRetries: 1,
          requestDeadlineMs: 15_000,
          cacheTtlSeconds: 60,
          price: { input: 0.3, output: 2.5 },
        },
      );

      expect((await otherUseCase.execute(question)).cache).toBe('HIT');
    } finally {
      await otherInstance.close();
    }
  });
});
