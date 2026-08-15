import { GoogleGenerativeAIEmbeddings } from '@langchain/google-genai';
import type { Env } from '../../config/env';
import type {
  EmbeddingsOptions,
  EmbeddingsPort,
} from '../../../application/ports/embeddings.port';
import { withTimeout } from '../../../shared/resilience';

export class GeminiEmbeddings implements EmbeddingsPort {
  readonly modelName: string;

  readonly dimensions = 3072;

  private readonly client: GoogleGenerativeAIEmbeddings;
  private readonly timeoutMs: number;

  constructor(env: Env) {
    this.modelName = env.GEMINI_EMBED_MODEL;

    this.timeoutMs = env.LLM_TIMEOUT_MS;

    this.client = new GoogleGenerativeAIEmbeddings({
      apiKey: env.GEMINI_API_KEY,
      model: env.GEMINI_EMBED_MODEL,
    });
  }

  embedQuery(text: string, options?: EmbeddingsOptions): Promise<number[]> {
    return withTimeout(this.client.embedQuery(text), options?.timeoutMs ?? this.timeoutMs);
  }

  embedDocuments(texts: string[]): Promise<number[][]> {
    return this.client.embedDocuments(texts);
  }
}
