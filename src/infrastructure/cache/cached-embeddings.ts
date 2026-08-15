import { createHash } from 'node:crypto';
import type {
  EmbeddingsOptions,
  EmbeddingsPort,
} from '../../application/ports/embeddings.port';
import type { CachePort } from '../../application/ports/cache.port';

export function embeddingCacheKey(text: string, model: string): string {
  const digest = createHash('sha256')
    .update(text.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''))
    .update('\0')
    .update(model)
    .digest('hex');

  return `embedding:${digest.slice(0, 32)}`;
}

export class CachedEmbeddings implements EmbeddingsPort {
  readonly modelName: string;
  readonly dimensions: number;

  constructor(
    private readonly inner: EmbeddingsPort,
    private readonly cache: CachePort,
    private readonly ttlSeconds: number,
  ) {
    this.modelName = inner.modelName;
    this.dimensions = inner.dimensions;
  }

  async embedQuery(text: string, options?: EmbeddingsOptions): Promise<number[]> {
    const key = embeddingCacheKey(text, this.modelName);

    const cached = await this.cache.get<number[]>(key);

    if (cached && cached.length === this.dimensions) return cached;

    const vector = await this.inner.embedQuery(text, options);
    await this.cache.set(key, vector, this.ttlSeconds);

    return vector;
  }

  embedDocuments(texts: string[]): Promise<number[][]> {
    return this.inner.embedDocuments(texts);
  }
}
