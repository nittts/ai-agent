import { describe, it, expect, vi } from 'vitest';
import {
  withRetry,
  withTimeout,
  isTransient,
  remainingBudget,
  TimeoutError,
  DeadlineExceededError,
} from '../../src/shared/resilience';

describe('withTimeout', () => {
  it('returns the value when the promise resolves in time', async () => {
    await expect(withTimeout(Promise.resolve('ok'), 1_000)).resolves.toBe('ok');
  });

  it('throws TimeoutError when the budget is exceeded', async () => {
    const slow = new Promise((r) => setTimeout(() => r('late'), 200));
    await expect(withTimeout(slow, 30)).rejects.toBeInstanceOf(TimeoutError);
  });

  it('propagates the original error rather than masking it as a timeout', async () => {
    await expect(withTimeout(Promise.reject(new Error('connection refused')), 1_000)).rejects.toThrowError(
      'connection refused',
    );
  });
});

describe('isTransient', () => {
  it('treats timeout, 429 and 5xx as transient', () => {
    expect(isTransient(new TimeoutError(100))).toBe(true);
    expect(isTransient({ status: 429 })).toBe(true);
    expect(isTransient({ status: 500 })).toBe(true);
    expect(isTransient({ status: 503 })).toBe(true);
  });

  it('does NOT treat 4xx other than 429 as transient', () => {
    expect(isTransient({ status: 404 })).toBe(false);
    expect(isTransient({ status: 400 })).toBe(false);
    expect(isTransient({ status: 403 })).toBe(false);
  });

  it('treats socket failures as transient — they carry no HTTP status', () => {
    expect(isTransient({ code: 'ECONNRESET' })).toBe(true);
    expect(isTransient({ code: 'UND_ERR_SOCKET' })).toBe(true);
    expect(isTransient({ code: 'ENOTFOUND' })).toBe(false);
  });
});

describe('withRetry', () => {
  it('does not retry when the first attempt succeeds', async () => {
    const operation = vi.fn().mockResolvedValue('done');

    await expect(withRetry(operation, { attempts: 3, baseMs: 1 })).resolves.toBe('done');
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('retries a transient error and then succeeds', async () => {
    const operation = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error('429'), { status: 429 }))
      .mockResolvedValue('done');

    await expect(withRetry(operation, { attempts: 2, baseMs: 1 })).resolves.toBe('done');
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it('does NOT retry a permanent error', async () => {
    const operation = vi.fn().mockRejectedValue(Object.assign(new Error('404'), { status: 404 }));

    await expect(withRetry(operation, { attempts: 3, baseMs: 1 })).rejects.toThrow('404');
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('honours the attempt limit and propagates the last error', async () => {
    const operation = vi.fn().mockRejectedValue(Object.assign(new Error('500'), { status: 500 }));

    await expect(withRetry(operation, { attempts: 2, baseMs: 1 })).rejects.toThrow('500');
    expect(operation).toHaveBeenCalledTimes(3);
  });

  it('refuses to start an attempt once the deadline has passed', async () => {
    const operation = vi.fn().mockResolvedValue('never reached');

    await expect(
      withRetry(operation, { attempts: 3, baseMs: 1, deadline: Date.now() - 1 }),
    ).rejects.toBeInstanceOf(DeadlineExceededError);

    expect(operation).not.toHaveBeenCalled();
  });

  it('stops retrying when the backoff would exceed the deadline', async () => {
    const operation = vi.fn().mockRejectedValue(Object.assign(new Error('503'), { status: 503 }));

    await expect(
      withRetry(operation, { attempts: 5, baseMs: 5_000, deadline: Date.now() + 50 }),
    ).rejects.toThrow('503');

    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('reports each retry so logs show the attempt number', async () => {
    const onRetry = vi.fn();
    const operation = vi
      .fn()
      .mockRejectedValueOnce(Object.assign(new Error('503'), { status: 503 }))
      .mockResolvedValue('done');

    await withRetry(operation, { attempts: 2, baseMs: 1, onRetry });

    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledWith(1, expect.any(Error));
  });

  it('spreads delays with jitter instead of retrying in unison', async () => {
    const delays: number[] = [];
    const realSetTimeout = globalThis.setTimeout;

    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void, ms?: number) => {
      if (typeof ms === 'number' && ms > 0) delays.push(ms);
      return realSetTimeout(fn, 0);
    }) as typeof setTimeout);

    try {
      for (let i = 0; i < 8; i++) {
        const operation = vi
          .fn()
          .mockRejectedValueOnce(Object.assign(new Error('429'), { status: 429 }))
          .mockResolvedValue('ok');
        await withRetry(operation, { attempts: 1, baseMs: 100 });
      }
    } finally {
      vi.restoreAllMocks();
    }

    expect(delays.length).toBeGreaterThan(4);
    expect(new Set(delays).size).toBeGreaterThan(1);
  });
});

describe('remainingBudget', () => {
  it('returns the per-attempt timeout when there is no deadline', () => {
    expect(remainingBudget(undefined, 8_000)).toBe(8_000);
  });

  it('caps the attempt at what remains of the request budget', () => {
    const remaining = remainingBudget(Date.now() + 3_000, 8_000);
    expect(remaining).toBeGreaterThan(2_000);
    expect(remaining).toBeLessThanOrEqual(3_000);
  });

  it('never returns less than a 250ms floor', () => {
    expect(remainingBudget(Date.now() - 10_000, 8_000)).toBe(250);
  });
});
