import { Module } from '@nestjs/common';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { CHAT_MODEL, type ChatModelPort } from '../../application/ports/chat-model.port';
import { EMBEDDINGS, type EmbeddingsPort } from '../../application/ports/embeddings.port';
import { VECTOR_STORE, type VectorStorePort } from '../../application/ports/vector-store.port';
import { CACHE, type CachePort } from '../../application/ports/cache.port';
import { HR_DIRECTORY, type HrDirectoryPort } from '../../application/ports/hr-directory.port';
import { AnswerQuestionUseCase } from '../../application/use-cases/answer-question.use-case';
import { HttpHrDirectory } from '../hr-directory/http-hr-directory';
import { RetrievalModule } from './retrieval.module';

@Module({
  imports: [RetrievalModule],
  providers: [
    { provide: HR_DIRECTORY, useClass: HttpHrDirectory },
    {
      provide: AnswerQuestionUseCase,
      useFactory: (
        env: Env,
        model: ChatModelPort,
        embeddings: EmbeddingsPort,
        vectorStore: VectorStorePort,
        hr: HrDirectoryPort,
        cache: CachePort,
      ) =>
        new AnswerQuestionUseCase(model, embeddings, vectorStore, hr, cache, {
          topK: env.RETRIEVAL_TOP_K,
          minScore: env.RETRIEVAL_MIN_SCORE,
          llmTimeoutMs: env.LLM_TIMEOUT_MS,
          llmMaxRetries: env.LLM_MAX_RETRIES,
          requestDeadlineMs: env.REQUEST_DEADLINE_MS,
          cacheTtlSeconds: env.CACHE_TTL_SECONDS,
          price: {
            input: env.COST_PER_1M_INPUT_USD,
            output: env.COST_PER_1M_OUTPUT_USD,
          },
        }),
      inject: [ENV, CHAT_MODEL, EMBEDDINGS, VECTOR_STORE, HR_DIRECTORY, CACHE],
    },
  ],
  exports: [AnswerQuestionUseCase],
})
export class AgentModule {}
