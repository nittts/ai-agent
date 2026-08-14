import { describe, it, expect } from 'vitest';
import { loadEnv } from '../../../src/infrastructure/config/env';

describe('loadEnv', () => {
  it('accepts LLM_PROVIDER=fake with no credentials', () => {
    const env = loadEnv({ LLM_PROVIDER: 'fake' } as NodeJS.ProcessEnv);

    expect(env.LLM_PROVIDER).toBe('fake');
    expect(env.GEMINI_API_KEY).toBeUndefined();
  });

  it('requires GEMINI_API_KEY for the gemini provider, with an actionable message', () => {
    expect(() => loadEnv({ LLM_PROVIDER: 'gemini' } as NodeJS.ProcessEnv)).toThrowError(
      /GEMINI_API_KEY.*LLM_PROVIDER=fake/s,
    );
  });

  it('treats an empty string as an absent credential', () => {
    expect(() =>
      loadEnv({ LLM_PROVIDER: 'gemini', GEMINI_API_KEY: '' } as NodeJS.ProcessEnv),
    ).toThrowError(/GEMINI_API_KEY/);

    const env = loadEnv({ LLM_PROVIDER: 'fake', REDIS_URL: '' } as NodeJS.ProcessEnv);
    expect(env.REDIS_URL).toBeUndefined();
  });

  it('pins the chat model instead of using a moving pointer', () => {
    const env = loadEnv({ LLM_PROVIDER: 'fake' } as NodeJS.ProcessEnv);

    expect(env.GEMINI_CHAT_MODEL).not.toMatch(/latest/);

    expect(env.GEMINI_EMBED_MODEL).toBe('gemini-embedding-001');
  });

  it('reports every configuration error at once', () => {
    try {
      loadEnv({ LLM_PROVIDER: 'gemini', PORT: 'not-a-number' } as NodeJS.ProcessEnv);
      expect.unreachable('should have thrown');
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain('PORT');
      expect(message).toContain('GEMINI_API_KEY');
    }
  });

  it('defaults the HR API to 127.0.0.1, never localhost', () => {
    const env = loadEnv({ LLM_PROVIDER: 'fake' } as NodeJS.ProcessEnv);
    expect(env.HR_API_BASE_URL).toContain('127.0.0.1');
    expect(env.HR_API_BASE_URL).not.toContain('localhost');
  });

  it('applies sane resilience and retrieval defaults', () => {
    const env = loadEnv({ LLM_PROVIDER: 'fake' } as NodeJS.ProcessEnv);

    expect(env.PORT).toBe(3000);
    expect(env.LLM_TIMEOUT_MS).toBeGreaterThan(0);

    expect(env.REQUEST_DEADLINE_MS).toBeGreaterThan(env.LLM_TIMEOUT_MS);
    expect(env.RETRIEVAL_TOP_K).toBeGreaterThan(0);
    expect(env.RETRIEVAL_MIN_SCORE).toBeGreaterThan(0);
    expect(env.RETRIEVAL_MIN_SCORE).toBeLessThanOrEqual(1);
  });
});
