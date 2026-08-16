import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from '../../../src/app.module';
import { configureApp } from '../../../src/bootstrap';
import { freePort } from '../../helpers/free-port';
import type { AskResponse, SseEvent } from '../../../src/presentation/http/api-contract';

describe('AskController (e2e)', () => {
  let app: NestFastifyApplication;
  let base: string;

  beforeAll(async () => {
    const port = await freePort();
    base = `http://127.0.0.1:${port}`;
    process.env.HR_API_BASE_URL = `${base}/mock/v1`;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter({ logger: false }));

    await configureApp(app);

    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    await app.listen({ port, host: '127.0.0.1' });
  }, 30_000);

  afterAll(async () => {
    await app?.close();
  });

  const ask = async (question: unknown) => {
    const response = await fetch(`${base}/ask`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question }),
    });
    return { status: response.status, body: (await response.json()) as AskResponse };
  };

  it('responds 200 with the complete contract', async () => {
    const { status, body } = await ask('Quantos dias de férias eu tenho direito por ano?');

    expect(status).toBe(200);
    expect(body).toMatchObject({ route: 'kb', refused: false, cache: expect.any(String) });
    expect(body.answer.length).toBeGreaterThan(0);
    expect(body.correlationId).toMatch(/[0-9a-f-]{36}/);
    expect(body.timings.totalMs).toBeGreaterThanOrEqual(0);
    expect(body.cost.inputTokens).toBeGreaterThan(0);
  });

  it('cites a document source with file and section', async () => {
    const { body } = await ask('Qual o prazo para enviar comprovantes de reembolso?');
    const document = body.sources.find((s) => s.kind === 'document');

    expect(document).toBeDefined();
    if (document?.kind === 'document') {
      expect(document.file).toMatch(/\.md$/);
      expect(document.section.length).toBeGreaterThan(0);
      expect(document.excerpt.length).toBeGreaterThan(0);
    }
  });

  it('refuses out of scope with no sources and no generation cost', async () => {
    const { status, body } = await ask('Qual a previsão do tempo em São Paulo amanhã?');

    expect(status).toBe(200);
    expect(body.refused).toBe(true);
    expect(body.route).toBe('outOfScope');
    expect(body.refusalReason).toBe('outOfScope');
    expect(body.sources).toHaveLength(0);

    expect(body.cost.outputTokens).toBeLessThan(30);
  });

  it('asks for the employee number instead of inventing one', async () => {
    const { body } = await ask('Qual o saldo de férias?');

    expect(body.refused).toBe(true);
    expect(body.refusalReason).toBe('missingIdentification');
    expect(body.answer).toMatch(/matrícula/i);
  });

  it.each([
    ['empty', ''],
    ['non-string', 42],
    ['whitespace only', '   '],
  ])('rejects an invalid question (%s) with 400', async (_case, value) => {
    expect((await ask(value)).status).toBe(400);
  });

  it('returns x-correlation-id and preserves an incoming one', async () => {
    const sent = '11111111-2222-3333-4444-555555555555';
    const response = await fetch(`${base}/ask`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-correlation-id': sent },
      body: JSON.stringify({ question: 'Quantos dias de férias por ano?' }),
    });

    expect(response.headers.get('x-correlation-id')).toBe(sent);
  });

  it('exposes per-node timings so p95 can be attributed to a step', async () => {
    const { body } = await ask('Quantos dias de férias por ano?');

    expect(body.timings.perNode).not.toBeNull();
    expect(Object.keys(body.timings.perNode!)).toEqual(
      expect.arrayContaining(['classify', 'retrieve', 'grade', 'generateAnswer']),
    );
  });

  const VACATION_TURNS = [
    { role: 'user', content: 'Quantos dias de férias eu tenho direito por ano?' },
    { role: 'assistant', content: 'Todo colaborador CLT tem direito a 30 dias corridos de férias.' },
  ];

  it('accepts a history and reports how it understood the follow-up', async () => {
    const response = await fetch(`${base}/ask`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question: 'E posso vender quantos desses?', history: VACATION_TURNS }),
    });

    const body = (await response.json()) as AskResponse;

    expect(response.status).toBe(200);
    expect(body.refused).toBe(false);

    expect(body.interpretedAs).toBeTruthy();
    expect(body.interpretedAs).not.toBe('E posso vender quantos desses?');
  });

  it('reports interpretedAs as null on a single-turn question', async () => {
    const response = await fetch(`${base}/ask`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question: 'Quantos dias de férias eu tenho direito por ano?' }),
    });

    expect(((await response.json()) as AskResponse).interpretedAs).toBeNull();
  });

  it('ignores a malformed history instead of returning 400', async () => {
    const response = await fetch(`${base}/ask`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        question: 'Quantos dias de férias eu tenho direito por ano?',
        history: 'isto não é uma lista',
      }),
    });

    expect(response.status).toBe(200);
    expect(((await response.json()) as AskResponse).refused).toBe(false);
  });

  async function readSse(question: string): Promise<{ events: SseEvent[]; contentType: string }> {
    const response = await fetch(`${base}/ask/stream?q=${encodeURIComponent(question)}`);
    const contentType = response.headers.get('content-type') ?? '';
    const text = await response.text();

    const events = text
      .split('\n\n')
      .filter((block) => block.startsWith('data: '))
      .map((block) => JSON.parse(block.slice(6)) as SseEvent);

    return { events, contentType };
  }

  it('streams tokens then sources then the summary, in that order', async () => {
    const { events, contentType } = await readSse('Quantos dias de férias eu tenho por ano?');

    expect(contentType).toContain('text/event-stream');
    expect(events.filter((e) => e.type === 'token').length).toBeGreaterThan(1);

    const types = events.map((e) => e.type);
    expect(types.indexOf('sources')).toBeGreaterThan(types.lastIndexOf('token'));
    expect(types[types.length - 1]).toBe('done');
  });

  it('streams over POST as well, carrying the conversation in the body', async () => {
    const response = await fetch(`${base}/ask/stream`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question: 'E posso vender quantos desses?', history: VACATION_TURNS }),
    });

    expect(response.headers.get('content-type')).toContain('text/event-stream');

    const events = (await response.text())
      .split('\n\n')
      .filter((block) => block.startsWith('data: '))
      .map((block) => JSON.parse(block.slice(6)) as SseEvent);

    const done = events.find((e) => e.type === 'done');
    expect(done?.type).toBe('done');
    expect(done?.type === 'done' && done.summary.interpretedAs).toBeTruthy();
  });

  it('fills ttftMs on the SSE summary — and only there', async () => {
    const { events } = await readSse('Quantos dias de férias eu tenho por ano?');
    const done = events.find((e) => e.type === 'done');

    expect(done?.type).toBe('done');
    if (done?.type === 'done') {
      expect(done.summary.timings.ttftMs).toBeGreaterThanOrEqual(0);
    }

    const { body } = await ask('Quantos dias de férias eu tenho por ano?');
    expect(body.timings.ttftMs).toBeNull();
  });

  it('responds 400 on the stream when ?q= is missing', async () => {
    expect((await fetch(`${base}/ask/stream`)).status).toBe(400);
  });

  it('degrades clearly when the HR API fails, without becoming a 500', async () => {
    const chaos = (mode: string) =>
      fetch(`${base}/mock/v1/_chaos`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ mode }),
      });

    await chaos('500');
    try {
      const { status, body } = await ask('Tenho 18 dias de férias (id 1042). Posso vender 10 dias?');

      expect(status).toBe(200);
      expect(body.degraded).toBe(true);
      expect(body.warnings.length).toBeGreaterThan(0);
      expect(body.correlationId).toBeTruthy();

      expect(body.sources.some((s) => s.kind === 'document')).toBe(true);
      expect(body.refused).toBe(false);
    } finally {
      await chaos('ok');
    }
  });

  it('serves the question profile the benchmark also reads', async () => {
    const response = await fetch(`${base}/demo/questions`);
    const { questions } = (await response.json()) as { questions: { id: string }[] };

    expect(response.status).toBe(200);
    expect(questions.length).toBeGreaterThan(20);
  });

  it('serves the console on the same origin as the API', async () => {
    const html = await fetch(`${base}/`);
    expect(html.status).toBe(200);
    expect(html.headers.get('content-type')).toContain('text/html');

    expect((await fetch(`${base}/app.js`)).status).toBe(200);
  });
});
