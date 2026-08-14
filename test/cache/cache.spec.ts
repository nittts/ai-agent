import { describe, it, expect } from 'vitest';
import { chaveEmbedding, chaveResposta, normalizarPergunta } from '../../src/cache/cache.port';
import { NullCache } from '../../src/cache/redis-cache';

describe('normalizarPergunta', () => {
  it('unifica variações puramente tipográficas da mesma pergunta', () => {
    const esperado = normalizarPergunta('Quantos dias de férias eu tenho?');

    expect(normalizarPergunta('  quantos dias de ferias eu tenho  ')).toBe(esperado);
    expect(normalizarPergunta('QUANTOS DIAS DE FÉRIAS EU TENHO')).toBe(esperado);
    expect(normalizarPergunta('Quantos  dias  de  férias  eu  tenho?!')).toBe(esperado);
  });

  it('não colapsa perguntas semanticamente distintas', () => {
    expect(normalizarPergunta('Quantos dias de férias?')).not.toBe(
      normalizarPergunta('Quantos dias de licença?'),
    );
  });
});

describe('chaveResposta', () => {
  it('muda quando o CORPUS muda — é o que invalida resposta desatualizada', () => {
    const antes = chaveResposta('Posso vender férias?', 'gemini-2.5-flash', 'aaaa1111');
    const depois = chaveResposta('Posso vender férias?', 'gemini-2.5-flash', 'bbbb2222');

    expect(antes).not.toBe(depois);
  });

  it('muda quando o MODELO muda', () => {
    const a = chaveResposta('Posso vender férias?', 'gemini-2.5-flash', 'aaaa1111');
    const b = chaveResposta('Posso vender férias?', 'outro-modelo', 'aaaa1111');

    expect(a).not.toBe(b);
  });

  it('é estável para a mesma entrada', () => {
    const args = ['Posso vender férias?', 'gemini-2.5-flash', 'aaaa1111'] as const;
    expect(chaveResposta(...args)).toBe(chaveResposta(...args));
  });

  it('usa namespaces distintos para resposta e embedding', () => {
    expect(chaveResposta('x', 'm', 'c').startsWith('resp:')).toBe(true);
    expect(chaveEmbedding('x', 'm').startsWith('emb:')).toBe(true);
  });
});

describe('NullCache', () => {
  it('reporta-se como desabilitado e nunca devolve valor', async () => {
    const cache = new NullCache();

    expect(cache.habilitado).toBe(false);
    await cache.gravar('k', { a: 1 }, 60);
    expect(await cache.obter('k')).toBeNull();
  });
});
