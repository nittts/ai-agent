import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import { RhApiClient, ErroContrato, ErroRecursoNaoEncontrado } from '../../src/tools/rh-api.client';
import { loadEnv, type Env } from '../../src/config/env';
import { saldosFerias } from '../../src/mock-api/seed';

describe('RhApiClient', () => {
  let servidor: Server;
  let base: string;
  let env: Env;

  let responder: (url: string) => { status: number; corpo: unknown; atrasoMs?: number };
  let chamadas: string[] = [];

  beforeAll(async () => {
    servidor = createServer((req, res) => {
      chamadas.push(req.url ?? '');
      const { status, corpo, atrasoMs } = responder(req.url ?? '');

      const enviar = () => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(corpo));
      };

      if (atrasoMs) setTimeout(enviar, atrasoMs);
      else enviar();
    });

    await new Promise<void>((r) => servidor.listen(0, '127.0.0.1', r));
    const endereco = servidor.address();
    const porta = typeof endereco === 'object' && endereco ? endereco.port : 0;
    base = `http://127.0.0.1:${porta}`;

    env = loadEnv({
      LLM_PROVIDER: 'fake',
      MOCK_API_BASE_URL: base,
      TOOL_TIMEOUT_MS: '150',
      TOOL_MAX_RETRIES: '2',
    } as NodeJS.ProcessEnv);
  });

  afterAll(async () => {
    await new Promise<void>((r) => servidor.close(() => r()));
  });

  beforeEach(() => {
    chamadas = [];
    responder = () => ({ status: 200, corpo: saldosFerias[1042] });
  });

  const cliente = () => new RhApiClient(env);

  it('devolve dados válidos com endpoint e latência', async () => {
    const resultado = await cliente().saldoFerias(1042);

    expect(resultado.dados.diasDisponiveis).toBe(18);
    expect(resultado.endpoint).toBe('GET /colaboradores/1042/ferias-saldo');
    expect(resultado.latenciaMs).toBeGreaterThanOrEqual(0);
  });

  it('rejeita resposta 200 que não satisfaz o contrato', async () => {
    responder = () => ({ status: 200, corpo: { colaboradorId: 1042, diasDisponivel: 18 } });

    await expect(cliente().saldoFerias(1042)).rejects.toBeInstanceOf(ErroContrato);
  });

  it('nomeia o campo que quebrou o contrato', async () => {
    responder = () => ({ status: 200, corpo: { ...saldosFerias[1042], diasDisponiveis: 'dezoito' } });

    await expect(cliente().saldoFerias(1042)).rejects.toThrowError(/diasDisponiveis/);
  });

  it('trata 404 como erro de recurso e NÃO repete', async () => {
    responder = () => ({ status: 404, corpo: { erro: 'nao_encontrado', mensagem: 'Colaborador 9999 não existe.' } });

    await expect(cliente().saldoFerias(9999)).rejects.toBeInstanceOf(ErroRecursoNaoEncontrado);

    expect(chamadas).toHaveLength(1);
  });

  it('repete 5xx e tem sucesso na tentativa seguinte', async () => {
    let n = 0;
    responder = () => {
      n++;
      return n === 1
        ? { status: 500, corpo: { erro: 'falha' } }
        : { status: 200, corpo: saldosFerias[1042] };
    };

    await expect(cliente().saldoFerias(1042)).resolves.toMatchObject({
      dados: { diasDisponiveis: 18 },
    });
    expect(chamadas).toHaveLength(2);
  });

  it('respeita o timeout e desiste depois das tentativas', async () => {
    responder = () => ({ status: 200, corpo: saldosFerias[1042], atrasoMs: 400 });

    await expect(cliente().saldoFerias(1042)).rejects.toThrowError(/Tempo esgotado/);
    expect(chamadas.length).toBeGreaterThan(1);
  });

  it('valida contrato de todos os recursos, não só de férias', async () => {
    responder = () => ({ status: 200, corpo: { qualquer: 'coisa' } });

    await expect(cliente().beneficios(1042)).rejects.toBeInstanceOf(ErroContrato);
    await expect(cliente().bancoHoras(1042)).rejects.toBeInstanceOf(ErroContrato);
    await expect(cliente().chamado(8871)).rejects.toBeInstanceOf(ErroContrato);
  });
});
