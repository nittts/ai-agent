import { Injectable } from '@nestjs/common';
import type { EmbeddedChunk, IndexSnapshot, SearchResult, VectorStorePort } from './types';

export function similaridadeCosseno(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(
      `Dimensões incompatíveis: consulta tem ${a.length}, índice tem ${b.length}. ` +
        'Isso normalmente significa que o índice foi gerado com outro modelo de embedding — rode `npm run ingest` de novo.',
    );
  }

  let produto = 0;
  let normaA = 0;
  let normaB = 0;

  for (let i = 0; i < a.length; i++) {
    produto += a[i] * b[i];
    normaA += a[i] * a[i];
    normaB += b[i] * b[i];
  }

  if (normaA === 0 || normaB === 0) return 0;

  const cos = produto / (Math.sqrt(normaA) * Math.sqrt(normaB));

  return Math.max(0, Math.min(1, cos));
}

@Injectable()
export class MemoryVectorStore implements VectorStorePort {
  private chunks: EmbeddedChunk[] = [];
  private versao = 'vazio';

  carregar(snapshot: IndexSnapshot): void {
    this.chunks = snapshot.chunks;
    this.versao = snapshot.corpusVersion;
  }

  buscar(embeddingConsulta: number[], k: number): SearchResult[] {
    if (this.chunks.length === 0) return [];

    return this.chunks
      .map((chunk) => ({
        texto: chunk.texto,
        metadata: chunk.metadata,
        score: similaridadeCosseno(embeddingConsulta, chunk.embedding),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, k);
  }

  corpusVersion(): string {
    return this.versao;
  }

  tamanho(): number {
    return this.chunks.length;
  }
}
