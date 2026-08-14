import type { Env } from '../config/env';
import type { EmbeddingsPort } from '../../application/ports/embeddings.port';
import { GeminiEmbeddings } from './gemini/gemini-embeddings';
import { FakeEmbeddings } from './fake/fake-embeddings';

export function createEmbeddings(env: Env): EmbeddingsPort {
  return env.LLM_PROVIDER === 'fake' ? new FakeEmbeddings() : new GeminiEmbeddings(env);
}
