export interface ChunkMetadata {
  file: string;

  section: string;

  chunkId: string;

  corpusVersion: string;
}

export interface Chunk {
  text: string;
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
  embeddingModel: string;
  dimensions: number;
  generatedAt: string;
  chunks: EmbeddedChunk[];
}
