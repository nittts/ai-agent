import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.spec.ts', 'src/**/*.spec.ts'],
    /**
     * A suíte inteira roda com o provider fake e sem Redis. Isso não é uma
     * conveniência: é o que garante que `npm test` passe verde sem nenhuma
     * credencial, e portanto que o CI seja possível sem secrets.
     *
     * Qualquer teste que precise de rede é um bug de teste, não uma exceção.
     */
    env: {
      NODE_ENV: 'test',
      LLM_PROVIDER: 'fake',
      LOG_LEVEL: 'silent',
      CACHE_ENABLED: 'false',
      CHAOS_ENABLED: 'true',
      REDIS_URL: '',
    },
    testTimeout: 15_000,
    hookTimeout: 15_000,
  },
});
