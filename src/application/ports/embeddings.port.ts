export interface EmbeddingsPort {
  embedQuery(text: string): Promise<number[]>;

  embedDocuments(texts: string[]): Promise<number[][]>;

  readonly modelName: string;

  readonly dimensions: number;
}

export const EMBEDDINGS = Symbol('EMBEDDINGS');
