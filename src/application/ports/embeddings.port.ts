export interface EmbeddingsOptions {
  timeoutMs?: number;
}

export interface EmbeddingsPort {
  embedQuery(text: string, options?: EmbeddingsOptions): Promise<number[]>;

  embedDocuments(texts: string[]): Promise<number[][]>;

  readonly modelName: string;

  readonly dimensions: number;
}

export const EMBEDDINGS = Symbol('EMBEDDINGS');
