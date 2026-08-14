import { config as carregarDotenv } from 'dotenv';
import { z } from 'zod';

carregarDotenv();

const vazioComoAusente = (v: unknown) => (v === '' ? undefined : v);

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3000),

    LOG_LEVEL: z.enum(['silent', 'fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

    LLM_PROVIDER: z.enum(['gemini', 'fake']).default('gemini'),
    GEMINI_API_KEY: z.preprocess(vazioComoAusente, z.string().min(1).optional()),

    GEMINI_CHAT_MODEL: z.string().min(1).default('gemini-3.5-flash-lite'),

    GEMINI_EMBED_MODEL: z.string().min(1).default('gemini-embedding-001'),

    COST_PER_1M_INPUT_USD: z.coerce.number().nonnegative().default(0.3),
    COST_PER_1M_OUTPUT_USD: z.coerce.number().nonnegative().default(2.5),

    LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(8_000),
    LLM_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(2),

    REQUEST_DEADLINE_MS: z.coerce.number().int().positive().default(15_000),
    TOOL_TIMEOUT_MS: z.coerce.number().int().positive().default(3_000),
    TOOL_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(1),

    RETRIEVAL_TOP_K: z.coerce.number().int().positive().default(4),

    RETRIEVAL_MIN_SCORE: z.coerce.number().min(0).max(1).default(0.55),
    INDEX_PATH: z.string().default('./eval/index-snapshot.json'),
    CORPUS_PATH: z.string().default('./corpus'),

    REDIS_URL: z.preprocess(vazioComoAusente, z.string().url().optional()),
    CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(3_600),
    CACHE_ENABLED: z
      .enum(['true', 'false'])
      .default('true')
      .transform((v) => v === 'true'),

    MOCK_API_BASE_URL: z.string().url().default('http://127.0.0.1:3000/mock/v1'),

    CHAOS_ENABLED: z
      .enum(['true', 'false'])
      .default('true')
      .transform((v) => v === 'true'),

    OTEL_ENABLED: z
      .enum(['true', 'false'])
      .default('false')
      .transform((v) => v === 'true'),
    OTEL_SERVICE_NAME: z.string().default('assistente-rh-ti'),
  });

export type Env = z.infer<typeof envSchema>;

function validarRegrasCruzadas(source: NodeJS.ProcessEnv): string[] {
  const erros: string[] = [];

  const provider = source.LLM_PROVIDER ?? 'gemini';
  const apiKey = source.GEMINI_API_KEY;

  if (provider === 'gemini' && !apiKey) {
    erros.push(
      '  - GEMINI_API_KEY: GEMINI_API_KEY é obrigatória quando LLM_PROVIDER=gemini. ' +
        'Para rodar sem credencial (testes, CI, desenvolvimento offline), use LLM_PROVIDER=fake.',
    );
  }

  return erros;
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);

  const erros: string[] = [
    ...(parsed.success
      ? []
      : parsed.error.issues.map(
          (issue) => `  - ${issue.path.join('.') || '(raiz)'}: ${issue.message}`,
        )),
    ...validarRegrasCruzadas(source),
  ];

  if (erros.length > 0) {
    throw new Error(`Configuração de ambiente inválida:\n${erros.join('\n')}`);
  }

  return (parsed as { success: true; data: Env }).data;
}
