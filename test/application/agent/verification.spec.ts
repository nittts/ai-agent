import { describe, it, expect } from 'vitest';
import { verifyAnswer, extractFigures, citedMarkers } from '../../../src/application/agent/verification';

/**
 * Two deterministic checks that run after generation, with no extra model call.
 *
 * They do not make hallucination impossible — nothing does. They make one class
 * of it impossible to ship SILENTLY: a figure that appears in the answer and
 * nowhere in the evidence, and a citation pointing at a source that does not
 * exist. Both are the shape a fabricated claim takes in this product, because
 * every real answer here is a number with a source next to it.
 */
describe('citedMarkers', () => {
  it('reads single and grouped markers', () => {
    expect(citedMarkers('Sim [1]. Também [2, 5] e [3].')).toEqual([1, 2, 5, 3]);
  });

  it('is empty when nothing was cited', () => {
    expect(citedMarkers('Não encontrei essa informação.')).toEqual([]);
  });

  /** `[1.200,00]` is money in brackets, not a citation. */
  it('does not mistake a bracketed amount for a citation', () => {
    expect(citedMarkers('O limite é [1.200,00] reais.')).toEqual([]);
  });
});

describe('extractFigures', () => {
  it('reads plain integers and Brazilian decimals', () => {
    expect(extractFigures('São 30 dias e R$ 1.200,00 por mês.')).toEqual([30, 1200]);
  });

  it('ignores citation markers, which are not claims about the world', () => {
    expect(extractFigures('O limite é de 10 dias [1], [5].')).toEqual([10]);
  });

  it('ignores fractions written as ratios', () => {
    // "1/3 do período" is a rule, not a figure to be matched against evidence.
    expect(extractFigures('no máximo 1/3 do período')).toEqual([]);
  });
});

describe('verifyAnswer', () => {
  const evidencia = [
    '[1] (política: ferias.md § Abono) O limite é de 10 dias para o período de 30 dias.',
    '[2] (dados do RH) {"availableDays":18,"daysAlreadySold":0}',
  ].join('\n');

  it('accepts an answer whose figures all appear in the evidence', () => {
    const r = verifyAnswer({
      answer: 'Você tem 18 dias e pode vender 10 [1], [2].',
      context: evidencia,
      sourceCount: 2,
    });

    expect(r.unsupportedFigures).toEqual([]);
    expect(r.invalidCitations).toEqual([]);
    expect(r.ok).toBe(true);
  });

  /**
   * The point of the whole exercise: a number that exists nowhere in the
   * evidence is a fabricated figure, and it must not pass unnoticed.
   */
  it('flags a figure that appears nowhere in the evidence', () => {
    const r = verifyAnswer({
      answer: 'O auxílio home-office é de R$ 250,00 por mês [1].',
      context: evidencia,
      sourceCount: 2,
    });

    expect(r.unsupportedFigures).toEqual([250]);
    expect(r.ok).toBe(false);
  });

  /**
   * A derived number is legitimate: 18 - 10 = 8 never appears in the evidence
   * and is exactly what the user asked for. Rejecting arithmetic would forbid
   * the agent from answering half the questions it exists to answer.
   */
  it('accepts a figure derived from two figures in the evidence', () => {
    const r = verifyAnswer({
      answer: 'Vendendo 10 dos seus 18, sobram 8 dias [1], [2].',
      context: evidencia,
      sourceCount: 2,
    });

    expect(r.unsupportedFigures).toEqual([]);
  });

  /**
   * Medido contra o agente real: "auxílio home-office multiplicado por 12
   * meses" produz 1800, correto, com o 12 vindo só da pergunta. Sem isto o
   * detector acusava a própria resposta certa.
   */
  it('counts figures the user supplied in the question as evidence', () => {
    const r = verifyAnswer({
      answer: 'São R$ 150,00 por mês [1]; em 12 meses, R$ 1.800,00.',
      context: '[1] O auxílio home-office é de R$ 150,00 por mês.',
      sourceCount: 1,
      question: 'Qual o valor do auxílio home-office multiplicado por 12 meses?',
    });

    expect(r.unsupportedFigures).toEqual([]);
  });

  it('flags a citation pointing at a source that does not exist', () => {
    const r = verifyAnswer({
      answer: 'O limite é de 10 dias [7].',
      context: evidencia,
      sourceCount: 2,
    });

    expect(r.invalidCitations).toEqual([7]);
    expect(r.ok).toBe(false);
  });

  /** With no evidence there is nothing to verify against, and no claim to make. */
  it('says nothing about a refusal, which cites nothing and claims nothing', () => {
    const r = verifyAnswer({ answer: 'Não consigo ajudar com esse assunto.', context: '', sourceCount: 0 });

    expect(r.ok).toBe(true);
  });
});
