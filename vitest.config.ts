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

      /**
       * Limiar calibrado para os embeddings FAKE, não para o Gemini.
       *
       * O limiar é propriedade do modelo de embedding, não do código: sob o
       * fake (hashing de saco de palavras) documentos relevantes pontuam
       * 0.22–0.55, enquanto sob o gemini-embedding-001 pontuam 0.6–0.8.
       * Usar 0.55 aqui faria o agente recusar quase toda pergunta válida e os
       * testes "provariam" um caminho de recusa quebrado.
       *
       * O que se mantém sob os dois modelos é a SEPARAÇÃO: fora de escopo
       * pontua ~0.16, bem abaixo de qualquer pergunta legítima.
       */
      RETRIEVAL_MIN_SCORE: '0.18',
    },
    testTimeout: 15_000,
    hookTimeout: 15_000,
  },
});
