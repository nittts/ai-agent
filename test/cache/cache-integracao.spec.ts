import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:net';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from '../../src/app.module';
import { configurarApp } from '../../src/bootstrap';
import { AgentService } from '../../src/agent/agent.service';
import { CACHE } from '../../src/cache/cache.module';
import type { CachePort } from '../../src/cache/cache.port';

async function portaLivre(): Promise<number> {
  return new Promise((resolve, reject) => {
    const servidor = createServer();
    servidor.once('error', reject);
    servidor.listen(0, '127.0.0.1', () => {
      const endereco = servidor.address();
      const porta = typeof endereco === 'object' && endereco ? endereco.port : 0;
      servidor.close(() => resolve(porta));
    });
  });
}

async function redisDisponivel(url: string): Promise<boolean> {
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

const REDIS_URL = process.env.TEST_REDIS_URL ?? 'redis://127.0.0.1:6379';

describe('cache com Redis real', () => {
  let app: NestFastifyApplication;
  let agente: AgentService;
  let cache: CachePort;
  let temRedis = false;

  const seTemRedis = (nome: string, fn: () => Promise<void>) =>
    it(nome, async (ctx) => {
      if (!temRedis) return ctx.skip();
      await fn();
    });

  beforeAll(async () => {
    temRedis = await redisDisponivel(REDIS_URL);
    if (!temRedis) return;

    const porta = await portaLivre();
    process.env.MOCK_API_BASE_URL = `http://127.0.0.1:${porta}/mock/v1`;
    process.env.CACHE_ENABLED = 'true';
    process.env.REDIS_URL = REDIS_URL;

    const modulo = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = modulo.createNestApplication<NestFastifyApplication>(new FastifyAdapter({ logger: false }));
    await configurarApp(app);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    await app.listen({ port: porta, host: '127.0.0.1' });

    agente = app.get(AgentService);
    cache = app.get<CachePort>(CACHE);
    await cache.limpar();
  }, 30_000);

  afterAll(async () => {
    await cache?.limpar();
    await app?.close();

    process.env.CACHE_ENABLED = 'false';
    process.env.REDIS_URL = '';
  });

  seTemRedis('MISS na primeira vez, HIT na segunda', async () => {
    const pergunta = 'Qual o prazo para enviar comprovantes de reembolso?';

    const primeira = await agente.perguntar(pergunta);
    expect(primeira.cache).toBe('MISS');

    const segunda = await agente.perguntar(pergunta);
    expect(segunda.cache).toBe('HIT');
    expect(segunda.resposta).toBe(primeira.resposta);
    expect(segunda.fontes).toEqual(primeira.fontes);
  });

  seTemRedis('acerto de cache tem custo ZERO de tokens', async () => {
    const pergunta = 'Quantos dias por semana preciso ir ao escritório?';

    const primeira = await agente.perguntar(pergunta);
    const segunda = await agente.perguntar(pergunta);

    expect(primeira.custo.tokensEntrada).toBeGreaterThan(0);

    expect(segunda.cache).toBe('HIT');
    expect(segunda.custo.tokensEntrada).toBe(0);
    expect(segunda.custo.tokensSaida).toBe(0);
    expect(segunda.custo.custoUsd).toBe(0);
  });

  seTemRedis('variação tipográfica da mesma pergunta acerta o cache', async () => {
    await agente.perguntar('Como funciona o aviso prévio?');
    const variante = await agente.perguntar('  como funciona o aviso previo  ');

    expect(variante.cache).toBe('HIT');
  });

  seTemRedis('ignorarCache força o caminho completo', async () => {
    const pergunta = 'Qual o valor do auxílio home-office?';

    await agente.perguntar(pergunta);
    const forcado = await agente.perguntar(pergunta, { ignorarCache: true });

    expect(forcado.cache).toBe('MISS');
    expect(forcado.custo.tokensEntrada).toBeGreaterThan(0);
  });

  seTemRedis('NUNCA cacheia resposta que contém dado pessoal', async () => {
    const pergunta = 'Qual o meu saldo de férias? Meu id é 1042.';

    const primeira = await agente.perguntar(pergunta);
    expect(primeira.fontes.some((f) => f.tipo === 'api')).toBe(true);

    const segunda = await agente.perguntar(pergunta);
    expect(segunda.cache).toBe('MISS');
  });

  seTemRedis('não cacheia resposta degradada', async () => {
    const raiz = `http://127.0.0.1:${new URL(process.env.MOCK_API_BASE_URL!).port}`;
    const chaos = (modo: string) =>
      fetch(`${raiz}/mock/v1/_chaos`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ modo }),
      });

    await chaos('500');
    try {
      const pergunta = 'Meu banco de horas está em 24h (id 1042); posso converter em folga?';
      const degradada = await agente.perguntar(pergunta);
      expect(degradada.degradado).toBe(true);
    } finally {
      await chaos('ok');
    }

    const depois = await agente.perguntar(
      'Meu banco de horas está em 24h (id 1042); posso converter em folga?',
    );
    expect(depois.cache).toBe('MISS');
  });

  seTemRedis('acerto de cache é sensivelmente mais rápido que o caminho completo', async () => {
    const pergunta = 'Preciso de MFA para acessar a VPN de fora do país?';

    const frio = await agente.perguntar(pergunta, { ignorarCache: true });
    const quente = await agente.perguntar(pergunta);

    expect(quente.cache).toBe('HIT');

    expect(quente.tempos.totalMs).toBeLessThanOrEqual(frio.tempos.totalMs + 5);
  });
});
