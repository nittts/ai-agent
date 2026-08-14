import { describe, it, expect } from 'vitest';
import {
  answerCacheKey,
  normaliseQuestion,
} from '../../../src/application/use-cases/answer-question.use-case';

describe('normaliseQuestion', () => {
  it('unifies purely typographic variants of the same question', () => {
    const expected = normaliseQuestion('Quantos dias de férias eu tenho?');

    expect(normaliseQuestion('  quantos dias de ferias eu tenho  ')).toBe(expected);
    expect(normaliseQuestion('QUANTOS DIAS DE FÉRIAS EU TENHO')).toBe(expected);
    expect(normaliseQuestion('Quantos  dias  de  férias  eu  tenho?!')).toBe(expected);
  });

  it('does not collapse semantically different questions', () => {
    expect(normaliseQuestion('Quantos dias de férias?')).not.toBe(
      normaliseQuestion('Quantos dias de licença?'),
    );
  });
});

describe('answerCacheKey', () => {
  it('changes when the CORPUS changes — this is what invalidates stale answers', () => {
    const before = answerCacheKey('Posso vender férias?', 'gemini-3.5-flash-lite', 'aaaa1111');
    const after = answerCacheKey('Posso vender férias?', 'gemini-3.5-flash-lite', 'bbbb2222');

    expect(before).not.toBe(after);
  });

  it('changes when the MODEL changes', () => {
    const a = answerCacheKey('Posso vender férias?', 'gemini-3.5-flash-lite', 'aaaa1111');
    const b = answerCacheKey('Posso vender férias?', 'another-model', 'aaaa1111');

    expect(a).not.toBe(b);
  });

  it('is stable for identical input', () => {
    const args = ['Posso vender férias?', 'gemini-3.5-flash-lite', 'aaaa1111'] as const;
    expect(answerCacheKey(...args)).toBe(answerCacheKey(...args));
  });

  it('namespaces answer keys', () => {
    expect(answerCacheKey('x', 'm', 'c').startsWith('answer:')).toBe(true);
  });
});
