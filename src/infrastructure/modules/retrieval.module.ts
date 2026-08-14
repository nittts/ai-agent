import { Module, type OnModuleInit, Inject, Logger } from '@nestjs/common';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { CACHE, type CachePort } from '../../application/ports/cache.port';
import { EMBEDDINGS, type EmbeddingsPort } from '../../application/ports/embeddings.port';
import { VECTOR_STORE } from '../../application/ports/vector-store.port';
import type { IndexSnapshot } from '../../domain/knowledge';
import { GeminiEmbeddings } from '../llm/gemini/gemini-embeddings';
import { FakeEmbeddings } from '../llm/fake/fake-embeddings';
import { CachedEmbeddings } from '../cache/cached-embeddings';
import { InMemoryVectorStore } from '../retrieval/in-memory-vector-store';

@Module({
  providers: [
    {
      provide: EMBEDDINGS,

      useFactory: (env: Env, cache: CachePort): EmbeddingsPort => {
        const base = env.LLM_PROVIDER === 'fake' ? new FakeEmbeddings() : new GeminiEmbeddings(env);
        return cache.enabled ? new CachedEmbeddings(base, cache, env.CACHE_TTL_SECONDS) : base;
      },
      inject: [ENV, CACHE],
    },
    { provide: VECTOR_STORE, useFactory: () => new InMemoryVectorStore() },
  ],
  exports: [VECTOR_STORE, EMBEDDINGS],
})
export class RetrievalModule implements OnModuleInit {
  private readonly log = new Logger(RetrievalModule.name);

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(VECTOR_STORE) private readonly store: InMemoryVectorStore,
    @Inject(EMBEDDINGS) private readonly embeddings: EmbeddingsPort,
  ) {}

  async onModuleInit(): Promise<void> {
    const path = resolve(process.cwd(), this.env.INDEX_PATH);

    let snapshot: IndexSnapshot;
    try {
      snapshot = JSON.parse(await readFile(path, 'utf-8')) as IndexSnapshot;
    } catch {
      this.log.warn(
        `Index not found at ${path}. Run \`npm run ingest\`. ` +
          'The agent will operate without a knowledge base until then.',
      );
      return;
    }

    if (snapshot.embeddingModel !== this.embeddings.modelName) {
      this.log.warn(
        `Index was built with "${snapshot.embeddingModel}" but the current provider uses ` +
          `"${this.embeddings.modelName}". Ignoring it — run \`npm run ingest\` again.`,
      );
      return;
    }

    this.store.load(snapshot);
    this.log.log(
      `Index loaded: ${this.store.size()} chunks, corpusVersion=${snapshot.corpusVersion}, ` +
        `model=${snapshot.embeddingModel}`,
    );
  }
}
