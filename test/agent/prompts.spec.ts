import { describe, it, expect } from 'vitest';
import {
  montarContexto,
  montarPromptResposta,
  RESPOSTAS_RECUSA,
  SISTEMA_RESPOSTA,
} from '../../src/agent/prompts';
import type { SearchResult } from '../../src/retrieval/types';
import type { ResultadoTool } from '../../src/tools/rh.tools';

const doc = (arquivo: string, secao: string, texto: string, score = 0.7): SearchResult => ({
  texto,
  score,
  metadata: { arquivo, secao, chunkId: `${arquivo}#x:0`, corpusVersion: 'abc123456789' },
});

const tool = (endpoint: string, conteudo: string): ResultadoTool => ({
  nome: 'consultar_saldo_ferias',
  conteudo,
  fonte: { tipo: 'api', endpoint, campos: ['diasDisponiveis'], latenciaMs: 12 },
});

describe('montarContexto', () => {
  it('numera as fontes sequencialmente a partir de 1', () => {
    const contexto = montarContexto(
      [doc('ferias.md', 'Abono', 'texto A'), doc('reembolso.md', 'Prazo', 'texto B')],
      [],
    );

    expect(contexto).toContain('[1]');
    expect(contexto).toContain('[2]');
    expect(contexto).not.toContain('[0]');
  });

  it('usa uma única sequência para documentos e API', () => {
    const contexto = montarContexto(
      [doc('ferias.md', 'Abono', 'regra de 1/3')],
      [tool('GET /colaboradores/1042/ferias-saldo', '{"diasDisponiveis":18}')],
    );

    expect(contexto).toContain('[1]');
    expect(contexto).toContain('[2]');
    expect(contexto.indexOf('[1]')).toBeLessThan(contexto.indexOf('[2]'));
  });

  it('identifica arquivo e seção do documento, para a citação ser conferível', () => {
    const contexto = montarContexto([doc('ferias.md', 'Abono pecuniário', 'regra')], []);

    expect(contexto).toContain('ferias.md');
    expect(contexto).toContain('Abono pecuniário');
  });

  it('identifica o endpoint consultado', () => {
    const contexto = montarContexto([], [tool('GET /chamados/8871', '{"status":"aberto"}')]);

    expect(contexto).toContain('GET /chamados/8871');
  });

  it('devolve string vazia sem fontes', () => {
    expect(montarContexto([], [])).toBe('');
  });
});

describe('montarPromptResposta', () => {
  it('inclui contexto e pergunta, com a pergunta claramente separada', () => {
    const prompt = montarPromptResposta('Posso vender férias?', [doc('ferias.md', 'Abono', 'regra')], [], []);

    expect(prompt).toContain('CONTEXTO:');
    expect(prompt).toContain('PERGUNTA DO USUÁRIO:');
    expect(prompt).toContain('Posso vender férias?');

    expect(prompt.indexOf('CONTEXTO:')).toBeLessThan(prompt.indexOf('PERGUNTA DO USUÁRIO:'));
  });

  it('avisa explicitamente o modelo quando uma fonte falhou', () => {
    const prompt = montarPromptResposta('Qual meu saldo?', [doc('ferias.md', 'Abono', 'regra')], [], [
      'consultar_saldo_ferias: sistema de RH indisponível',
    ]);

    expect(prompt).toContain('ATENÇÃO');
    expect(prompt).toContain('sistema de RH indisponível');
    expect(prompt).toMatch(/incompleta/i);
  });

  it('não inclui o bloco de aviso quando nada falhou', () => {
    const prompt = montarPromptResposta('Posso vender férias?', [doc('ferias.md', 'Abono', 'r')], [], []);
    expect(prompt).not.toContain('ATENÇÃO');
  });
});

describe('prompt de sistema', () => {
  it('proíbe conhecimento próprio e exige citação', () => {
    expect(SISTEMA_RESPOSTA).toMatch(/EXCLUSIVAMENTE/);
    expect(SISTEMA_RESPOSTA).toMatch(/\[1\]/);
    expect(SISTEMA_RESPOSTA).toMatch(/português/i);
  });

  it('declara que texto do contexto é informação, não instrução', () => {
    expect(SISTEMA_RESPOSTA).toMatch(/não instrução|informação, não instrução/i);
  });
});

describe('respostas de recusa', () => {
  it('cobre todos os motivos e nenhuma é vazia', () => {
    for (const motivo of [
      'fora_de_escopo',
      'sem_fundamentacao',
      'faltou_identificacao',
      'fontes_indisponiveis',
    ]) {
      expect(RESPOSTAS_RECUSA[motivo]?.length ?? 0).toBeGreaterThan(40);
    }
  });

  it('a recusa por falta de identificação PEDE o dado e dá exemplo', () => {
    expect(RESPOSTAS_RECUSA.faltou_identificacao).toMatch(/matrícula/i);
    expect(RESPOSTAS_RECUSA.faltou_identificacao).toMatch(/1042/);
  });

  it('a recusa por falta de fundamentação orienta o próximo passo', () => {
    expect(RESPOSTAS_RECUSA.sem_fundamentacao).toMatch(/chamado/i);
  });
});
