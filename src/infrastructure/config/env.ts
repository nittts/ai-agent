import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

loadDotenv();

const emptyAsAbsent = (v: unknown) => (v === '' ? undefined : v);

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),

  LOG_LEVEL: z.enum(['silent', 'fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  LLM_PROVIDER: z.enum(['gemini', 'fake']).default('gemini'),
  GEMINI_API_KEY: z.preprocess(emptyAsAbsent, z.string().min(1).optional()),

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

  REDIS_URL: z.preprocess(emptyAsAbsent, z.string().url().optional()),
  CACHE_TTL_SECONDS: z.coerce.number().int().positive().default(3_600),
  CACHE_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),

  HR_API_BASE_URL: z.string().url().default('http://127.0.0.1:3000/mock/v1'),

  CHAOS_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),

  OTEL_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  OTEL_SERVICE_NAME: z.string().default('hr-it-assistant'),
});

export type Env = z.infer<typeof envSchema>;

function validateCrossFieldRules(source: NodeJS.ProcessEnv): string[] {
  const errors: string[] = [];

  const provider = source.LLM_PROVIDER ?? 'gemini';

  if (provider === 'gemini' && !source.GEMINI_API_KEY) {
    errors.push(
      '  - GEMINI_API_KEY: required when LLM_PROVIDER=gemini. ' +
        'To run with no credentials (tests, CI, offline development), use LLM_PROVIDER=fake.',
    );
  }

  return errors;
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);

  const errors: string[] = [
    ...(parsed.success
      ? []
      : parsed.error.issues.map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)),
    ...validateCrossFieldRules(source),
  ];

  if (errors.length > 0) {
    throw new Error(`Invalid environment configuration:\n${errors.join('\n')}`);
  }

  return (parsed as { success: true; data: Env }).data;
}
