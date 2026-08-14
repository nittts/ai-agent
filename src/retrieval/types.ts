export interface ChunkMetadata {
  arquivo: string;

  secao: string;

  chunkId: string;

  corpusVersion: string;
}

export interface Chunk {
  texto: string;
  metadata: ChunkMetadata;
}

export interface EmbeddedChunk extends Chunk {
  embedding: number[];
}

export interface SearchResult extends Chunk {
  score: number;
}

export interface IndexSnapshot {
  corpusVersion: string;
  modeloEmbedding: string;
  dimensoes: number;
  geradoEm: string;
  chunks: EmbeddedChunk[];
}

export interface VectorStorePort {
  carregar(snapshot: IndexSnapshot): void;

  buscar(embeddingConsulta: number[], k: number): SearchResult[];

  corpusVersion(): string;
  tamanho(): number;
}
