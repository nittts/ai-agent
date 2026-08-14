import { describe, it, expect, vi } from 'vitest';
import { comRetry, comTimeout, ehTransitorio, ErroTimeout } from '../../src/tools/resiliencia';

describe('comTimeout', () => {
  it('devolve o valor quando a promessa resolve a tempo', async () => {
    await expect(comTimeout(Promise.resolve('ok'), 1_000)).resolves.toBe('ok');
  });

  it('lança ErroTimeout quando estoura o prazo', async () => {
    const lenta = new Promise((r) => setTimeout(() => r('tarde'), 200));
    await expect(comTimeout(lenta, 30)).rejects.toBeInstanceOf(ErroTimeout);
  });

  it('propaga o erro original em vez de mascarar como timeout', async () => {
    const falha = Promise.reject(new Error('conexão recusada'));
    await expect(comTimeout(falha, 1_000)).rejects.toThrowError('conexão recusada');
  });
});

describe('ehTransitorio', () => {
  it('considera transitórios timeout, 429 e 5xx', () => {
    expect(ehTransitorio(new ErroTimeout(100))).toBe(true);
    expect(ehTransitorio({ status: 429 })).toBe(true);
    expect(ehTransitorio({ status: 500 })).toBe(true);
    expect(ehTransitorio({ status: 503 })).toBe(true);
  });

  it('NÃO considera transitório 4xx que não seja 429', () => {
    expect(ehTransitorio({ status: 404 })).toBe(false);
    expect(ehTransitorio({ status: 400 })).toBe(false);
    expect(ehTransitorio({ status: 403 })).toBe(false);
  });

  it('considera transitórias falhas de socket, que não têm status', () => {
    expect(ehTransitorio({ code: 'ECONNRESET' })).toBe(true);
    expect(ehTransitorio({ code: 'UND_ERR_SOCKET' })).toBe(true);
    expect(ehTransitorio({ code: 'ENOTFOUND' })).toBe(false);
  });
});

describe('comRetry', () => {
  it('não repete quando a primeira tentativa dá certo', async () => {
    const operacao = vi.fn().mockResolvedValue('pronto');

    await expect(comRetry(operacao, { tentativas: 3, baseMs: 1 })).resolves.toBe('pronto');
    expect(operacao).toHaveBeenCalledTimes(1);
  });

  it('repete erro transitório até obter sucesso', async () => {
    const operacao = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error('429'), { status: 429 }))
      .mockResolvedValue('pronto');

    await expect(comRetry(operacao, { tentativas: 2, baseMs: 1 })).resolves.toBe('pronto');
    expect(operacao).toHaveBeenCalledTimes(2);
  });

  it('NÃO repete erro permanente — falha na primeira', async () => {
    const operacao = vi.fn().mockRejectedValue(Object.assign(new Error('404'), { status: 404 }));

    await expect(comRetry(operacao, { tentativas: 3, baseMs: 1 })).rejects.toThrow('404');

    expect(operacao).toHaveBeenCalledTimes(1);
  });

  it('respeita o limite de tentativas e propaga o último erro', async () => {
    const operacao = vi.fn().mockRejectedValue(Object.assign(new Error('500'), { status: 500 }));

    await expect(comRetry(operacao, { tentativas: 2, baseMs: 1 })).rejects.toThrow('500');
    expect(operacao).toHaveBeenCalledTimes(3);
  });

  it('avisa a cada repetição, para que o log mostre a tentativa', async () => {
    const aoRepetir = vi.fn();
    const operacao = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error('503'), { status: 503 }))
      .mockResolvedValue('pronto');

    await comRetry(operacao, { tentativas: 2, baseMs: 1, aoRepetir });

    expect(aoRepetir).toHaveBeenCalledTimes(1);
    expect(aoRepetir).toHaveBeenCalledWith(1, expect.any(Error));
  });

  it('espalha os atrasos com jitter em vez de repetir em uníssono', async () => {
    const atrasos: number[] = [];
    const dormirOriginal = globalThis.setTimeout;

    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void, ms?: number) => {
      if (typeof ms === 'number' && ms > 0) atrasos.push(ms);
      return dormirOriginal(fn, 0);
    }) as typeof setTimeout);

    try {
      for (let i = 0; i < 8; i++) {
        const operacao = vi
          .fn()
          .mockRejectedValueOnce(Object.assign(new Error('429'), { status: 429 }))
          .mockResolvedValue('ok');
        await comRetry(operacao, { tentativas: 1, baseMs: 100 });
      }
    } finally {
      vi.restoreAllMocks();
    }

    expect(atrasos.length).toBeGreaterThan(4);

    expect(new Set(atrasos).size).toBeGreaterThan(1);
  });
});
