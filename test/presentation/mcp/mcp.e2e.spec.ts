import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from '../../../src/app.module';
import { configureApp } from '../../../src/bootstrap';
import { freePort } from '../../helpers/free-port';

describe('MCP transport (e2e)', () => {
  let app: NestFastifyApplication;
  let base: string;

  const HEADERS = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
  };

  let nextId = 1;

  async function rpc(method: string, params?: unknown) {
    const response = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method, params }),
    });

    const raw = await response.text();

    const payload = raw.startsWith('event:') || raw.startsWith('data:')
      ? raw
          .split('\n')
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trim())
          .join('')
      : raw;

    return { status: response.status, body: JSON.parse(payload) };
  }

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

    await rpc('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'vitest', version: '1.0.0' },
    });
  }, 30_000);

  afterAll(async () => {
    await app?.close();
  });

  it('completes the initialize handshake', async () => {
    const { status, body } = await rpc('initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'vitest', version: '1.0.0' },
    });

    expect(status).toBe(200);
    expect(body.result.serverInfo.name).toBeTruthy();

    expect(body.result.capabilities.tools).toBeDefined();
    expect(body.result.capabilities.resources).toBeDefined();
  });

  it('advertises the agent as a single tool', async () => {
    const { body } = await rpc('tools/list');
    const names = body.result.tools.map((t: { name: string }) => t.name);

    expect(names).toContain('perguntar_rh');

    expect(names).not.toContain('get_vacation_balance');
    expect(names).not.toContain('get_hours_bank');
  });

  it('answers a policy question with grounded text and structured evidence', async () => {
    const { body } = await rpc('tools/call', {
      name: 'perguntar_rh',
      arguments: { pergunta: 'Quantos dias de férias eu tenho direito por ano?' },
    });

    const result = body.result;

    expect(result.isError).toBeFalsy();
    expect(result.content[0].type).toBe('text');
    expect(result.content[0].text.length).toBeGreaterThan(0);

    expect(result.structuredContent.route).toBe('kb');
    expect(result.structuredContent.sources.length).toBeGreaterThan(0);
    expect(result.structuredContent.cost.inputTokens).toBeGreaterThan(0);
  });

  it('answers a personal-data question when the employee number is given', async () => {
    const { body } = await rpc('tools/call', {
      name: 'perguntar_rh',
      arguments: { pergunta: 'Qual o meu saldo de férias? Meu id é 1042.' },
    });

    expect(body.result.structuredContent.route).toBe('tool');
    expect(
      body.result.structuredContent.sources.some((s: { kind: string }) => s.kind === 'api'),
    ).toBe(true);
  });

  it('reports a refusal as a normal result, never as isError', async () => {
    const { body } = await rpc('tools/call', {
      name: 'perguntar_rh',
      arguments: { pergunta: 'Qual a previsão do tempo em São Paulo amanhã?' },
    });

    expect(body.result.isError).toBeFalsy();
    expect(body.result.structuredContent.refused).toBe(true);
    expect(body.result.structuredContent.refusalReason).toBe('outOfScope');
    expect(body.result.content[0].text.length).toBeGreaterThan(0);
  });

  it('rejects an empty question', async () => {
    const { body } = await rpc('tools/call', {
      name: 'perguntar_rh',
      arguments: { pergunta: '   ' },
    });

    expect(body.result.isError).toBe(true);
  });

  it('lists the policy corpus as resources', async () => {
    const { body } = await rpc('resources/list');
    const uris = body.result.resources.map((r: { uri: string }) => r.uri);

    expect(uris.length).toBeGreaterThanOrEqual(7);
    expect(uris.every((u: string) => u.startsWith('hr://policy/'))).toBe(true);
    expect(uris).toContain('hr://policy/ferias.md');
  });

  it('reads a policy document', async () => {
    const { body } = await rpc('resources/read', { uri: 'hr://policy/ferias.md' });
    const contents = body.result.contents[0];

    expect(contents.mimeType).toContain('markdown');
    expect(contents.text).toContain('Abono pecuniário');
  });

  it.each([
    'hr://policy/../../.env',
    'hr://policy/../package.json',
    'hr://policy/nao-existe.md',
  ])('refuses to read outside the corpus: %s', async (uri) => {
    const { body } = await rpc('resources/read', { uri });

    const failed = Boolean(body.error) || body.result?.contents?.length === 0;
    expect(failed).toBe(true);

    const serialised = JSON.stringify(body);
    expect(serialised).not.toMatch(/GEMINI_API_KEY/);
    expect(serialised).not.toMatch(/"dependencies"/);
  });
});
