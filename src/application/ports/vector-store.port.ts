import type { IndexSnapshot, SearchResult } from '../../domain/knowledge';

export interface VectorStorePort {
  load(snapshot: IndexSnapshot): void;

  search(queryEmbedding: number[], k: number): SearchResult[];

  corpusVersion(): string;

  size(): number;
}

export const VECTOR_STORE = Symbol('VECTOR_STORE');
