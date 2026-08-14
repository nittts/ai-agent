import { describe, it, expect } from 'vitest';
import { addUsage, computeCost, ZERO_USAGE } from '../../src/domain/cost';

describe('addUsage', () => {
  it('accumulates input and output — this is the graph state reducer', () => {
    expect(addUsage({ input: 10, output: 5 }, { input: 3, output: 2 })).toEqual({
      input: 13,
      output: 7,
    });
    expect(addUsage(ZERO_USAGE, { input: 1, output: 1 })).toEqual({ input: 1, output: 1 });
  });

  it('is commutative and does not mutate its arguments', () => {
    const a = { input: 4, output: 6 };
    const b = { input: 1, output: 2 };

    expect(addUsage(a, b)).toEqual(addUsage(b, a));
    expect(a).toEqual({ input: 4, output: 6 });
  });
});

describe('computeCost', () => {
  it('prices input and output independently', () => {
    const cost = computeCost({ input: 1_000_000, output: 0 }, { input: 0.3, output: 2.5 });
    expect(cost.usd).toBeCloseTo(0.3, 6);

    const outputOnly = computeCost({ input: 0, output: 1_000_000 }, { input: 0.3, output: 2.5 });
    expect(outputOnly.usd).toBeCloseTo(2.5, 6);
  });

  it('keeps 6 decimals — 2 would render every request as $0.00', () => {
    const cost = computeCost({ input: 300, output: 40 }, { input: 0.3, output: 2.5 });

    expect(cost.usd).toBeGreaterThan(0);
    expect(cost.usd.toFixed(2)).toBe('0.00');
  });

  it('reports zero for zero usage — the cache-hit case', () => {
    expect(computeCost(ZERO_USAGE, { input: 0.3, output: 2.5 })).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      usd: 0,
    });
  });
});
