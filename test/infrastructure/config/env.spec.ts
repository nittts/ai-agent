import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEnv, hrApiLooksMisdirected } from '../../../src/infrastructure/config/env';

describe('loadEnv', () => {
  /**
   * The DEFAULT follows PORT. Nothing else does.
   *
   * An earlier version rewrote an explicitly-set loopback URL to match PORT, and
   * it broke two legitimate configurations: the HR client suite, which points at
   * a stub on a random port, and the HTTP e2e suite, which points at its own
   * instance — whose listening port is NOT `process.env.PORT`, because the test
   * passes it to `app.listen()` directly.
   *
   * That last part is the real lesson: at config-load time the process cannot
   * know which port it will actually listen on, so it is not entitled to
   * "correct" anyone. Explicit configuration wins; a suspicious value earns a
   * warning, not a silent rewrite.
   */
  it('derives HR_API_BASE_URL from PORT when it is not set', () => {
    const env = loadEnv({ LLM_PROVIDER: 'fake', PORT: '8080' } as NodeJS.ProcessEnv);

    expect(env.HR_API_BASE_URL).toBe('http://127.0.0.1:8080/mock/v1');
  });

  it('respects an explicit HR_API_BASE_URL even when it disagrees with PORT', () => {
    const env = loadEnv({
      LLM_PROVIDER: 'fake',
      PORT: '8080',
      HR_API_BASE_URL: 'http://127.0.0.1:3000/mock/v1',
    } as NodeJS.ProcessEnv);

    expect(env.HR_API_BASE_URL).toBe('http://127.0.0.1:3000/mock/v1');
  });

  it('never touches a remote HR_API_BASE_URL', () => {
    const env = loadEnv({
      LLM_PROVIDER: 'fake',
      PORT: '8080',
      HR_API_BASE_URL: 'https://rh.empresa.com/api/v1',
    } as NodeJS.ProcessEnv);

    expect(env.HR_API_BASE_URL).toBe('https://rh.empresa.com/api/v1');
  });

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

  it('rejects a per-attempt timeout larger than the total request budget', () => {
    expect(() =>
      loadEnv({
        LLM_PROVIDER: 'fake',
        LLM_TIMEOUT_MS: '20000',
        REQUEST_DEADLINE_MS: '15000',
      } as NodeJS.ProcessEnv),
    ).toThrowError(/LLM_TIMEOUT_MS.*must not exceed.*REQUEST_DEADLINE_MS/s);
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

  it('.env.example is a VALID configuration, not just documentation', () => {
    const raw = Object.fromEntries(
      readFileSync(join(process.cwd(), '.env.example'), 'utf-8')
        .split('\n')
        .filter((line) => /^[A-Z0-9_]+=/.test(line))
        .map((line) => {
          const i = line.indexOf('=');
          return [line.slice(0, i), line.slice(i + 1)];
        }),
    ) as NodeJS.ProcessEnv;

    raw.GEMINI_API_KEY = 'placeholder-for-validation';

    expect(() => loadEnv(raw)).not.toThrow();
  });

  it('.env.example declares exactly the variables the schema knows', () => {
    const declared = new Set(
      readFileSync(join(process.cwd(), '.env.example'), 'utf-8')
        .split('\n')
        /**
         * Uma variavel COMENTADA continua declarada para efeito deste teste: ela
         * esta documentada, so nao vem ligada por padrao. E o que permite
         * mostrar `HR_API_BASE_URL` sem que um `cp .env.example .env` a defina —
         * o gesto que levou a producao a apontar para a porta errada.
         */
        .filter((line) => /^#?\s*[A-Z0-9_]+=/.test(line))
        .map((line) => {
          const clean = line.replace(/^#\s*/, '');
          return clean.slice(0, clean.indexOf('='));
        }),
    );

    const known = new Set(
      [
        ...readFileSync(
          join(process.cwd(), 'src/infrastructure/config/env.ts'),
          'utf-8',
        ).matchAll(/^\s{2}([A-Z][A-Z0-9_]+):/gm),
      ].map((m) => m[1]),
    );

    expect([...declared].filter((k) => !known.has(k))).toEqual([]);
    expect([...known].filter((k) => !declared.has(k))).toEqual([]);
  });
});

/**
 * The detector behind the warning. It answers one narrow question: does this URL
 * name THIS process's own mock mount while pointing at a different port?
 */
describe('hrApiLooksMisdirected', () => {
  it.each(['http://127.0.0.1:3000/mock/v1', 'http://localhost:3000/mock/v1', 'http://0.0.0.0:3000/mock/v1'])(
    'flags a loopback mock mount on the wrong port: %s',
    (url) => {
      expect(hrApiLooksMisdirected(url, 8080)).toBe(true);
    },
  );

  it('says nothing when the port already agrees', () => {
    expect(hrApiLooksMisdirected('http://127.0.0.1:8080/mock/v1', 8080)).toBe(false);
  });

  /** A stub or a second instance on another port is a valid setup, not a mistake. */
  it('ignores a loopback address that is not the mock mount', () => {
    expect(hrApiLooksMisdirected('http://127.0.0.1:45231', 8080)).toBe(false);
    expect(hrApiLooksMisdirected('http://127.0.0.1:45231/employees', 8080)).toBe(false);
  });

  it('ignores a remote host entirely', () => {
    expect(hrApiLooksMisdirected('https://rh.empresa.com/mock/v1', 8080)).toBe(false);
  });

  it('does not throw on a value that is not a URL', () => {
    expect(hrApiLooksMisdirected('nao-e-url', 8080)).toBe(false);
  });
});
