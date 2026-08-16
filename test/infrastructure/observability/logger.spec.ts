import { describe, it, expect } from 'vitest';
import { prettyTransport } from '../../../src/infrastructure/observability/logger';

describe('prettyTransport', () => {
  it('asks for pino-pretty only when it is both wanted and installed', () => {
    expect(prettyTransport(true, true)).toHaveProperty('transport');
  });

  it('returns nothing when pretty output was not requested', () => {
    expect(prettyTransport(false, true)).toEqual({});
  });

  it('returns nothing when pino-pretty is absent, instead of asking for it', () => {
    expect(prettyTransport(true, false)).toEqual({});
  });
});
