import { describe, it, expect } from 'vitest';
import {
  sanitiseHistory,
  formatHistory,
  MAX_HISTORY_TURNS,
  MAX_TURN_CHARS,
  type ConversationTurn,
} from '../../src/domain/conversation';

describe('sanitiseHistory', () => {
  const turn = (i: number): ConversationTurn => ({ role: 'user', content: `turno ${i}` });

  it('keeps the MOST RECENT turns when the window overflows', () => {
    const many = Array.from({ length: MAX_HISTORY_TURNS + 4 }, (_, i) => turn(i));

    const kept = sanitiseHistory(many);

    expect(kept).toHaveLength(MAX_HISTORY_TURNS);

    expect(kept.at(-1)?.content).toBe(`turno ${MAX_HISTORY_TURNS + 3}`);
    expect(kept[0].content).toBe('turno 4');
  });

  it('truncates a long turn instead of rejecting it', () => {
    const [kept] = sanitiseHistory([{ role: 'assistant', content: 'x'.repeat(5_000) }]);

    expect(kept.content).toHaveLength(MAX_TURN_CHARS);
  });

  it('drops malformed turns rather than failing the request', () => {
    const dirty = [
      { role: 'user', content: 'válida' },
      { role: 'user', content: '   ' },
      { role: 'system', content: 'papel inexistente' },
      { role: 'assistant', content: 42 },
      null,
    ] as unknown as ConversationTurn[];

    const kept = sanitiseHistory(dirty);

    expect(kept).toEqual([{ role: 'user', content: 'válida' }]);
  });

  it('is a no-op on an empty history — the single-turn path is unchanged', () => {
    expect(sanitiseHistory([])).toEqual([]);
    expect(formatHistory([])).toBe('');
  });
});

describe('formatHistory', () => {
  it('labels the speakers in Portuguese, as the prompt expects', () => {
    const text = formatHistory([
      { role: 'user', content: 'Quantos dias de férias?' },
      { role: 'assistant', content: '30 dias corridos.' },
    ]);

    expect(text).toBe('Usuário: Quantos dias de férias?\nAssistente: 30 dias corridos.');
  });
});
