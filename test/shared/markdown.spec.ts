import { describe, it, expect } from 'vitest';
import { parseInline, parseMarkdown } from '../../src/shared/markdown/parse';

describe('parseInline', () => {
  it('renders bold, italic and code', () => {
    expect(parseInline('um **negrito** aqui')).toEqual([
      { type: 'text', value: 'um ' },
      { type: 'strong', value: 'negrito' },
      { type: 'text', value: ' aqui' },
    ]);

    expect(parseInline('um *itálico*')).toEqual([
      { type: 'text', value: 'um ' },
      { type: 'em', value: 'itálico' },
    ]);

    expect(parseInline('use `npm run ingest`')).toEqual([
      { type: 'text', value: 'use ' },
      { type: 'code', value: 'npm run ingest' },
    ]);
  });

  it('keeps citation markers as their own token', () => {
    expect(parseInline('conforme a política [2].')).toEqual([
      { type: 'text', value: 'conforme a política ' },
      { type: 'citation', value: '[2]' },
      { type: 'text', value: '.' },
    ]);
  });

  it('does NOT treat asterisks inside code as emphasis', () => {
    expect(parseInline('`a ** b`')).toEqual([{ type: 'code', value: 'a ** b' }]);
  });

  it('prefers bold over italic for a double marker', () => {
    expect(parseInline('**forte**')).toEqual([{ type: 'strong', value: 'forte' }]);
  });

  it('leaves unterminated emphasis as literal text', () => {
    expect(parseInline('um **negr')).toEqual([{ type: 'text', value: 'um **negr' }]);
  });

  it('handles text with no markup at all', () => {
    expect(parseInline('texto simples')).toEqual([{ type: 'text', value: 'texto simples' }]);
  });
});

describe('parseMarkdown', () => {
  it('splits paragraphs on blank lines', () => {
    const blocks = parseMarkdown('primeiro\n\nsegundo');

    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({ type: 'paragraph' });
    expect(blocks[1]).toMatchObject({ type: 'paragraph' });
  });

  it('parses bullet lists', () => {
    const blocks = parseMarkdown('Regras:\n- primeira\n- segunda');

    expect(blocks[0]).toMatchObject({ type: 'paragraph' });
    expect(blocks[1]).toMatchObject({ type: 'list', ordered: false });
    expect((blocks[1] as { items: unknown[] }).items).toHaveLength(2);
  });

  it('parses numbered lists separately from bullets', () => {
    const blocks = parseMarkdown('1. um\n2. dois');

    expect(blocks[0]).toMatchObject({ type: 'list', ordered: true });
    expect((blocks[0] as { items: unknown[] }).items).toHaveLength(2);
  });

  it('does not merge a bullet list into a numbered one', () => {
    const blocks = parseMarkdown('- a\n1. b');

    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({ ordered: false });
    expect(blocks[1]).toMatchObject({ ordered: true });
  });

  it('continues a wrapped list item instead of starting a paragraph', () => {
    const blocks = parseMarkdown('- uma regra muito longa\n  que continua aqui');

    expect(blocks).toHaveLength(1);
    const items = (blocks[0] as { items: { value?: string }[][] }).items;
    expect(items).toHaveLength(1);
    expect(items[0].map((t) => t.value).join('')).toContain('que continua aqui');
  });

  it('parses headings with their level', () => {
    expect(parseMarkdown('## Cálculo')[0]).toMatchObject({ type: 'heading', level: 2 });
  });

  it('keeps fenced code verbatim', () => {
    const blocks = parseMarkdown('```\nconst a = **1**;\n```');

    expect(blocks[0]).toEqual({ type: 'code', text: 'const a = **1**;' });
  });

  it('renders an unterminated fence rather than swallowing the answer', () => {
    const blocks = parseMarkdown('```\nlinha parcial');

    expect(blocks[0]).toMatchObject({ type: 'code' });
  });

  it('parses a realistic model answer end to end', () => {
    const answer = [
      'Sim, você pode vender **10 dias** [1].',
      '',
      'Cálculo:',
      '- O limite é de 1/3 do período de 30 dias [1].',
      '- Não incide sobre o saldo de 18 dias [2].',
    ].join('\n');

    const blocks = parseMarkdown(answer);

    expect(blocks.map((b) => b.type)).toEqual(['paragraph', 'paragraph', 'list']);

    const first = (blocks[0] as { inline: { type: string }[] }).inline;
    expect(first.some((t) => t.type === 'strong')).toBe(true);
    expect(first.some((t) => t.type === 'citation')).toBe(true);

    expect((blocks[2] as { items: unknown[] }).items).toHaveLength(2);
  });

  it('returns nothing for empty input', () => {
    expect(parseMarkdown('')).toEqual([]);
    expect(parseMarkdown('   \n  ')).toEqual([]);
  });
});
