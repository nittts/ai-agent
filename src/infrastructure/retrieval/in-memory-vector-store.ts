import { Injectable } from '@nestjs/common';
import type { EmbeddedChunk, IndexSnapshot, SearchResult } from '../../domain/knowledge';
import type { VectorStorePort } from '../../application/ports/vector-store.port';

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(
      `Dimension mismatch: query has ${a.length}, index has ${b.length}. ` +
        'This usually means the index was built with a different embedding model — run `npm run ingest` again.',
    );
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  if (normA === 0 || normB === 0) return 0;

  const cos = dot / (Math.sqrt(normA) * Math.sqrt(normB));

  return Math.max(0, Math.min(1, cos));
}

@Injectable()
export class InMemoryVectorStore implements VectorStorePort {
  private chunks: EmbeddedChunk[] = [];
  private version = 'empty';

  load(snapshot: IndexSnapshot): void {
    this.chunks = snapshot.chunks;
    this.version = snapshot.corpusVersion;
  }

  search(queryEmbedding: number[], k: number): SearchResult[] {
    if (this.chunks.length === 0) return [];

    return this.chunks
      .map((chunk) => ({
        text: chunk.text,
        metadata: chunk.metadata,
        score: cosineSimilarity(queryEmbedding, chunk.embedding),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
  }

  corpusVersion(): string {
    return this.version;
  }

  size(): number {
    return this.chunks.length;
  }
}
