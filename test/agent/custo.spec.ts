import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:net';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from '../../src/app.module';
import { AgentService } from '../../src/agent/agent.service';
import { somarUso, USO_ZERO } from '../../src/llm/chat-model';

async function portaLivre(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const e = s.address();
      const p = typeof e === 'object' && e ? e.port : 0;
      s.close(() => resolve(p));
    });
  });
}

describe('somarUso', () => {
  it('acumula entrada e saída — é o reducer do estado do grafo', () => {
    expect(somarUso({ entrada: 10, saida: 5 }, { entrada: 3, saida: 2 })).toEqual({
      entrada: 13,
      saida: 7,
    });
    expect(somarUso(USO_ZERO, { entrada: 1, saida: 1 })).toEqual({ entrada: 1, saida: 1 });
  });
});

describe('medição de custo por request', () => {
  let app: NestFastifyApplication;
  let agente: AgentService;

  beforeAll(async () => {
    const porta = await portaLivre();
    process.env.MOCK_API_BASE_URL = `http://127.0.0.1:${porta}/mock/v1`;

    process.env.COST_PER_1M_INPUT_USD = '1';
    process.env.COST_PER_1M_OUTPUT_USD = '1';

    const modulo = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = modulo.createNestApplication<NestFastifyApplication>(new FastifyAdapter({ logger: false }));
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    await app.listen({ port: porta, host: '127.0.0.1' });

    agente = app.get(AgentService);
  }, 30_000);

  afterAll(async () => {
    await app?.close();
    delete process.env.COST_PER_1M_INPUT_USD;
    delete process.env.COST_PER_1M_OUTPUT_USD;
  });

  it('deriva o custo dos tokens efetivamente contados', async () => {
    const r = await agente.perguntar('Quantos dias de férias eu tenho direito por ano?');

    expect(r.custo.tokensEntrada).toBeGreaterThan(0);
    expect(r.custo.tokensSaida).toBeGreaterThan(0);

    const esperado = (r.custo.tokensEntrada + r.custo.tokensSaida) / 1_000_000;
    expect(r.custo.custoUsd).toBeCloseTo(Number(esperado.toFixed(6)), 6);
  });

  it('contabiliza a classificação, não só a geração', async () => {
    const r = await agente.perguntar('Qual a previsão do tempo em São Paulo amanhã?');

    expect(r.recusado).toBe(true);
    expect(r.custo.tokensEntrada).toBeGreaterThan(0);
  });

  it('reporta tempo por nó, permitindo atribuir o p95 a uma etapa', async () => {
    const r = await agente.perguntar('Qual o prazo para enviar comprovantes de reembolso?');

    expect(r.tempos.porNo).not.toBeNull();
    expect(Object.keys(r.tempos.porNo!)).toEqual(
      expect.arrayContaining(['classificar', 'recuperar', 'avaliar', 'responder']),
    );

    const soma = Object.values(r.tempos.porNo!).reduce((a, b) => a + b, 0);
    expect(soma).toBeLessThanOrEqual(r.tempos.totalMs + 5);
  });
});
