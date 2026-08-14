import { Module, type OnModuleInit, Inject, Logger } from '@nestjs/common';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { CACHE } from '../cache/cache.module';
import type { CachePort } from '../cache/cache.port';
import { CachedEmbeddings } from '../cache/cached-embeddings';
import { criarEmbeddings, type EmbeddingsPort } from '../llm/embeddings';
import { MemoryVectorStore } from './memory-vector-store';
import type { IndexSnapshot } from './types';

export const VECTOR_STORE = Symbol('VECTOR_STORE');
export const EMBEDDINGS = Symbol('EMBEDDINGS');

@Module({
  providers: [
    {
      provide: EMBEDDINGS,

      useFactory: (env: Env, cache: CachePort): EmbeddingsPort => {
        const base = criarEmbeddings(env);
        return cache.habilitado ? new CachedEmbeddings(base, cache, env.CACHE_TTL_SECONDS) : base;
      },
      inject: [ENV, CACHE],
    },
    {
      provide: VECTOR_STORE,
      useFactory: () => new MemoryVectorStore(),
    },
  ],
  exports: [VECTOR_STORE, EMBEDDINGS],
})
export class RetrievalModule implements OnModuleInit {
  private readonly log = new Logger(RetrievalModule.name);

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(VECTOR_STORE) private readonly store: MemoryVectorStore,
    @Inject(EMBEDDINGS) private readonly embeddings: EmbeddingsPort,
  ) {}

  async onModuleInit(): Promise<void> {
    const caminho = resolve(process.cwd(), this.env.INDEX_PATH);

    let snapshot: IndexSnapshot;
    try {
      snapshot = JSON.parse(await readFile(caminho, 'utf-8')) as IndexSnapshot;
    } catch {
      this.log.warn(
        `Índice não encontrado em ${caminho}. Rode \`npm run ingest\`. ` +
          'O agente vai operar sem base de conhecimento até lá.',
      );
      return;
    }

    if (snapshot.modeloEmbedding !== this.embeddings.nomeModelo) {
      this.log.warn(
        `Índice foi gerado com "${snapshot.modeloEmbedding}" mas o provider atual usa ` +
          `"${this.embeddings.nomeModelo}". Ignorando o índice — rode \`npm run ingest\` novamente.`,
      );
      return;
    }

    this.store.carregar(snapshot);
    this.log.log(
      `Índice carregado: ${this.store.tamanho()} chunks, ` +
        `corpusVersion=${snapshot.corpusVersion}, modelo=${snapshot.modeloEmbedding}`,
    );
  }
}
