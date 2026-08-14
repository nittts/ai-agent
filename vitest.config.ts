import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/**/*.spec.ts'],

    /**
     * Builds the test index before anything runs. The e2e tests boot the real
     * AppModule, which loads the snapshot at boot — without it every kb-route
     * question would be refused and the suite would fail on infrastructure
     * rather than on a defect.
     */
    globalSetup: ['./test/global-setup.ts'],

    /**
     * The entire suite runs with the fake provider and no Redis. That is not a
     * convenience: it is what guarantees `npm test` passes with NO credentials,
     * and therefore that CI needs no secrets.
     *
     * Any test that needs the network is a test bug, not an exception.
     */
    env: {
      NODE_ENV: 'test',
      LLM_PROVIDER: 'fake',
      LOG_LEVEL: 'silent',
      CACHE_ENABLED: 'false',
      CHAOS_ENABLED: 'true',
      REDIS_URL: '',

      /**
       * Threshold calibrated for the FAKE embeddings, not for Gemini.
       *
       * The threshold is a property of the embedding model, not of the code:
       * under the fake (bag-of-words hashing) relevant documents score
       * 0.22–0.55, while under gemini-embedding-001 they score 0.69–0.78. Using
       * 0.55 here would make the agent refuse almost every valid question and
       * the tests would "prove" a broken refusal path.
       *
       * What holds under both models is the SEPARATION: out-of-scope scores
       * ~0.16, far below any legitimate question.
       */
      RETRIEVAL_MIN_SCORE: '0.18',

      /** Index produced by globalSetup, separate from the production one. */
      INDEX_PATH: './eval/index-test.json',
    },

    testTimeout: 15_000,
    hookTimeout: 30_000,
  },
});
