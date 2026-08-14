import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer } from 'node:net';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from '../../src/app.module';
import { configurarApp } from '../../src/bootstrap';
import type { AskResponse, SseEvent } from '../../src/http/contracts';

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

describe('AskController (e2e)', () => {
  let app: NestFastifyApplication;
  let base: string;

  beforeAll(async () => {
    const porta = await portaLivre();
    base = `http://127.0.0.1:${porta}`;
    process.env.MOCK_API_BASE_URL = `${base}/mock/v1`;

    const modulo = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = modulo.createNestApplication<NestFastifyApplication>(new FastifyAdapter({ logger: false }));

    await configurarApp(app);

    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    await app.listen({ port: porta, host: '127.0.0.1' });
  }, 30_000);

  afterAll(async () => {
    await app?.close();
  });

  const perguntar = async (pergunta: unknown) => {
    const resposta = await fetch(`${base}/ask`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pergunta }),
    });
    return { status: resposta.status, corpo: (await resposta.json()) as AskResponse };
  };

  it('responde 200 com o contrato completo', async () => {
    const { status, corpo } = await perguntar('Quantos dias de férias eu tenho direito por ano?');

    expect(status).toBe(200);
    expect(corpo).toMatchObject({
      rota: 'kb',
      recusado: false,
      cache: expect.any(String),
    });
    expect(corpo.resposta.length).toBeGreaterThan(0);
    expect(corpo.correlationId).toMatch(/[0-9a-f-]{36}/);
    expect(corpo.tempos.totalMs).toBeGreaterThanOrEqual(0);
    expect(corpo.custo.tokensEntrada).toBeGreaterThan(0);
  });

  it('cita a fonte documental com arquivo e seção', async () => {
    const { corpo } = await perguntar('Qual o prazo para enviar comprovantes de reembolso?');
    const doc = corpo.fontes.find((f) => f.tipo === 'documento');

    expect(doc).toBeDefined();
    if (doc?.tipo === 'documento') {
      expect(doc.arquivo).toMatch(/\.md$/);
      expect(doc.secao.length).toBeGreaterThan(0);
      expect(doc.trecho.length).toBeGreaterThan(0);
    }
  });

  it('recusa fora de escopo sem citar fonte e sem custo de geração', async () => {
    const { status, corpo } = await perguntar('Qual a previsão do tempo em São Paulo amanhã?');

    expect(status).toBe(200);
    expect(corpo.recusado).toBe(true);
    expect(corpo.rota).toBe('out_of_scope');
    expect(corpo.fontes).toHaveLength(0);

    expect(corpo.custo.tokensSaida).toBeLessThan(30);
  });

  it('pede a matrícula em vez de inventar', async () => {
    const { corpo } = await perguntar('Qual o saldo de férias?');

    expect(corpo.recusado).toBe(true);
    expect(corpo.resposta).toMatch(/matrícula/i);
  });

  it.each([
    ['corpo vazio', ''],
    ['não-string', 42],
    ['só espaços', '   '],
  ])('rejeita pergunta inválida (%s) com 400', async (_caso, valor) => {
    const { status } = await perguntar(valor);
    expect(status).toBe(400);
  });

  it('devolve o header x-correlation-id e respeita o recebido', async () => {
    const enviado = '11111111-2222-3333-4444-555555555555';
    const resposta = await fetch(`${base}/ask`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-correlation-id': enviado },
      body: JSON.stringify({ pergunta: 'Quantos dias de férias por ano?' }),
    });

    expect(resposta.headers.get('x-correlation-id')).toBe(enviado);
  });

  async function lerSse(pergunta: string): Promise<{ eventos: SseEvent[]; contentType: string }> {
    const resposta = await fetch(
      `${base}/ask/stream?q=${encodeURIComponent(pergunta)}`,
    );

    const contentType = resposta.headers.get('content-type') ?? '';
    const texto = await resposta.text();

    const eventos = texto
      .split('\n\n')
      .filter((bloco) => bloco.startsWith('data: '))
      .map((bloco) => JSON.parse(bloco.slice(6)) as SseEvent);

    return { eventos, contentType };
  }

  it('transmite tokens e encerra com fontes e resumo, nessa ordem', async () => {
    const { eventos, contentType } = await lerSse('Quantos dias de férias eu tenho por ano?');

    expect(contentType).toContain('text/event-stream');

    const tokens = eventos.filter((e) => e.tipo === 'token');
    expect(tokens.length).toBeGreaterThan(1);

    const tipos = eventos.map((e) => e.tipo);
    expect(tipos.indexOf('fontes')).toBeGreaterThan(tipos.lastIndexOf('token'));
    expect(tipos[tipos.length - 1]).toBe('fim');
  });

  it('preenche ttftMs no resumo do SSE — e só nele', async () => {
    const { eventos } = await lerSse('Quantos dias de férias eu tenho por ano?');
    const fim = eventos.find((e) => e.tipo === 'fim');

    expect(fim?.tipo).toBe('fim');
    if (fim?.tipo === 'fim') {
      expect(fim.resumo.tempos.ttftMs).toBeGreaterThanOrEqual(0);
    }

    const { corpo } = await perguntar('Quantos dias de férias eu tenho por ano?');
    expect(corpo.tempos.ttftMs).toBeNull();
  });

  it('responde 400 no stream quando falta ?q=', async () => {
    const resposta = await fetch(`${base}/ask/stream`);
    expect(resposta.status).toBe(400);
  });

  it('degrada com clareza quando a API mock cai, sem virar 500', async () => {
    const raiz = base;
    const chaos = (modo: string) =>
      fetch(`${raiz}/mock/v1/_chaos`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ modo }),
      });

    await chaos('500');
    try {
      const { status, corpo } = await perguntar(
        'Tenho 18 dias de férias (id 1042). Posso vender 10 dias?',
      );

      expect(status).toBe(200);
      expect(corpo.degradado).toBe(true);
      expect(corpo.avisos.length).toBeGreaterThan(0);
      expect(corpo.correlationId).toBeTruthy();

      expect(corpo.fontes.some((f) => f.tipo === 'documento')).toBe(true);
      expect(corpo.recusado).toBe(false);
    } finally {
      await chaos('ok');
    }
  });

  it('serve o console na mesma origem da API', async () => {
    const raiz = base;

    const html = await fetch(`${raiz}/`);
    expect(html.status).toBe(200);
    expect(html.headers.get('content-type')).toContain('text/html');

    const bundle = await fetch(`${raiz}/app.js`);
    expect(bundle.status).toBe(200);
  });
});
