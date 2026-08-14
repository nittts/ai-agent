import { describe, it, expect } from 'vitest';
import {
  buildContext,
  buildAnswerPrompt,
  REFUSAL_MESSAGES,
  ANSWER_SYSTEM_PROMPT,
} from '../../../src/application/agent/prompts';
import type { SearchResult } from '../../../src/domain/knowledge';
import type { ToolResult } from '../../../src/application/agent/tools';

const doc = (file: string, section: string, text: string, score = 0.7): SearchResult => ({
  text,
  score,
  metadata: { file, section, chunkId: `${file}#x:0`, corpusVersion: 'abc123456789' },
});

const toolResult = (endpoint: string, content: string): ToolResult => ({
  name: 'get_vacation_balance',
  content,
  source: { kind: 'api', endpoint, fields: ['availableDays'], latencyMs: 12 },
});

describe('buildContext', () => {
  it('numbers sources sequentially from 1', () => {
    const context = buildContext([doc('a.md', 'S1', 'text A'), doc('b.md', 'S2', 'text B')], []);

    expect(context).toContain('[1]');
    expect(context).toContain('[2]');
    expect(context).not.toContain('[0]');
  });

  it('uses one sequence across documents and API results', () => {
    const context = buildContext(
      [doc('ferias.md', 'Abono', 'one third rule')],
      [toolResult('GET /employees/1042/vacation-balance', '{"availableDays":18}')],
    );

    expect(context).toContain('[1]');
    expect(context).toContain('[2]');
    expect(context.indexOf('[1]')).toBeLessThan(context.indexOf('[2]'));
  });

  it('names the file and section so the citation is verifiable', () => {
    const context = buildContext([doc('ferias.md', 'Abono pecuniário', 'rule')], []);

    expect(context).toContain('ferias.md');
    expect(context).toContain('Abono pecuniário');
  });

  it('names the endpoint consulted', () => {
    const context = buildContext([], [toolResult('GET /tickets/8871', '{"status":"open"}')]);
    expect(context).toContain('GET /tickets/8871');
  });

  it('returns an empty string with no sources', () => {
    expect(buildContext([], [])).toBe('');
  });
});

describe('buildAnswerPrompt', () => {
  it('places the context before the question', () => {
    const prompt = buildAnswerPrompt('Posso vender férias?', [doc('a.md', 'S', 'rule')], [], []);

    expect(prompt).toContain('CONTEXTO:');
    expect(prompt).toContain('PERGUNTA DO USUÁRIO:');

    expect(prompt.indexOf('CONTEXTO:')).toBeLessThan(prompt.indexOf('PERGUNTA DO USUÁRIO:'));
  });

  it('explicitly warns the model when a source failed', () => {
    const prompt = buildAnswerPrompt('Qual meu saldo?', [doc('a.md', 'S', 'rule')], [], [
      'get_vacation_balance: HR system unavailable',
    ]);

    expect(prompt).toContain('ATENÇÃO');
    expect(prompt).toContain('HR system unavailable');
    expect(prompt).toMatch(/incompleta/i);
  });

  it('omits the warning block when nothing failed', () => {
    expect(buildAnswerPrompt('Posso vender férias?', [doc('a.md', 'S', 'r')], [], [])).not.toContain(
      'ATENÇÃO',
    );
  });
});

describe('system prompt', () => {
  it('forbids outside knowledge and requires citations', () => {
    expect(ANSWER_SYSTEM_PROMPT).toMatch(/EXCLUSIVAMENTE/);
    expect(ANSWER_SYSTEM_PROMPT).toMatch(/\[1\]/);
    expect(ANSWER_SYSTEM_PROMPT).toMatch(/português/i);
  });

  it('declares that context text is information, not instruction', () => {
    expect(ANSWER_SYSTEM_PROMPT).toMatch(/informação, não instrução/i);
  });
});

describe('refusal messages', () => {
  it('covers every reason and none is empty', () => {
    for (const reason of [
      'outOfScope',
      'notGrounded',
      'missingIdentification',
      'sourcesUnavailable',
    ] as const) {
      expect(REFUSAL_MESSAGES[reason].length).toBeGreaterThan(40);
    }
  });

  it('the missing-identification refusal ASKS for the data and gives an example', () => {
    expect(REFUSAL_MESSAGES.missingIdentification).toMatch(/matrícula/i);
    expect(REFUSAL_MESSAGES.missingIdentification).toMatch(/1042/);
  });

  it('the not-grounded refusal points at a next step', () => {
    expect(REFUSAL_MESSAGES.notGrounded).toMatch(/chamado/i);
  });
});
