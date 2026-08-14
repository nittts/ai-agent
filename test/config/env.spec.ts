import { describe, it, expect } from 'vitest';
import { loadEnv } from '../../src/config/env';

describe('loadEnv', () => {
  it('aceita LLM_PROVIDER=fake sem nenhuma credencial', () => {
    const env = loadEnv({ LLM_PROVIDER: 'fake' } as NodeJS.ProcessEnv);

    expect(env.LLM_PROVIDER).toBe('fake');
    expect(env.GEMINI_API_KEY).toBeUndefined();
  });

  it('exige GEMINI_API_KEY quando o provider é gemini, com mensagem acionável', () => {
    expect(() => loadEnv({ LLM_PROVIDER: 'gemini' } as NodeJS.ProcessEnv)).toThrowError(
      /GEMINI_API_KEY é obrigatória.*LLM_PROVIDER=fake/s,
    );
  });

  it('trata string vazia como credencial ausente', () => {
    expect(() =>
      loadEnv({ LLM_PROVIDER: 'gemini', GEMINI_API_KEY: '' } as NodeJS.ProcessEnv),
    ).toThrowError(/GEMINI_API_KEY/);

    const env = loadEnv({ LLM_PROVIDER: 'fake', REDIS_URL: '' } as NodeJS.ProcessEnv);
    expect(env.REDIS_URL).toBeUndefined();
  });

  it('fixa o modelo de chat em vez de usar um ponteiro móvel', () => {
    const env = loadEnv({ LLM_PROVIDER: 'fake' } as NodeJS.ProcessEnv);

    expect(env.GEMINI_CHAT_MODEL).not.toMatch(/latest/);

    expect(env.GEMINI_EMBED_MODEL).toBe('gemini-embedding-001');
  });

  it('acumula todos os erros de configuração numa única mensagem', () => {
    try {
      loadEnv({ LLM_PROVIDER: 'gemini', PORT: 'não-é-número' } as NodeJS.ProcessEnv);
      expect.unreachable('deveria ter lançado');
    } catch (err) {
      const msg = (err as Error).message;
      expect(msg).toContain('PORT');
      expect(msg).toContain('GEMINI_API_KEY');
    }
  });

  it('aplica defaults sensatos de resiliência e retrieval', () => {
    const env = loadEnv({ LLM_PROVIDER: 'fake' } as NodeJS.ProcessEnv);

    expect(env.PORT).toBe(3000);
    expect(env.LLM_TIMEOUT_MS).toBeGreaterThan(0);
    expect(env.TOOL_TIMEOUT_MS).toBeGreaterThan(0);
    expect(env.RETRIEVAL_TOP_K).toBeGreaterThan(0);
    expect(env.RETRIEVAL_MIN_SCORE).toBeGreaterThan(0);
    expect(env.RETRIEVAL_MIN_SCORE).toBeLessThanOrEqual(1);
  });
});
