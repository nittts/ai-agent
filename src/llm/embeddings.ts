import { createHash } from 'node:crypto';
import { GoogleGenerativeAIEmbeddings } from '@langchain/google-genai';
import type { Env } from '../config/env';

export interface EmbeddingsPort {
  embedarConsulta(texto: string): Promise<number[]>;

  embedarDocumentos(textos: string[]): Promise<number[][]>;
  readonly nomeModelo: string;
  readonly dimensoes: number;
}

export class GeminiEmbeddings implements EmbeddingsPort {
  readonly nomeModelo: string;

  readonly dimensoes = 3072;

  private readonly cliente: GoogleGenerativeAIEmbeddings;

  constructor(env: Env) {
    this.nomeModelo = env.GEMINI_EMBED_MODEL;
    this.cliente = new GoogleGenerativeAIEmbeddings({
      apiKey: env.GEMINI_API_KEY,
      model: env.GEMINI_EMBED_MODEL,
    });
  }

  embedarConsulta(texto: string): Promise<number[]> {
    return this.cliente.embedQuery(texto);
  }

  embedarDocumentos(textos: string[]): Promise<number[][]> {
    return this.cliente.embedDocuments(textos);
  }
}

const DIMENSOES_FAKE = 256;

function tokenizar(texto: string): string[] {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2);
}

function bucket(token: string): { indice: number; sinal: number } {
  const digest = createHash('sha1').update(token).digest();
  const indice = ((digest[0] << 8) | digest[1]) % DIMENSOES_FAKE;
  const sinal = digest[2] % 2 === 0 ? 1 : -1;
  return { indice, sinal };
}

export class FakeEmbeddings implements EmbeddingsPort {
  readonly nomeModelo = 'fake-hashing-bow';
  readonly dimensoes = DIMENSOES_FAKE;

  async embedarConsulta(texto: string): Promise<number[]> {
    return this.vetorizar(texto);
  }

  async embedarDocumentos(textos: string[]): Promise<number[][]> {
    return textos.map((t) => this.vetorizar(t));
  }

  private vetorizar(texto: string): number[] {
    const vetor = new Array<number>(DIMENSOES_FAKE).fill(0);

    for (const token of tokenizar(texto)) {
      const { indice, sinal } = bucket(token);
      vetor[indice] += sinal;
    }

    const norma = Math.sqrt(vetor.reduce((acc, v) => acc + v * v, 0));
    if (norma === 0) return vetor;

    return vetor.map((v) => v / norma);
  }
}

export function criarEmbeddings(env: Env): EmbeddingsPort {
  return env.LLM_PROVIDER === 'fake' ? new FakeEmbeddings() : new GeminiEmbeddings(env);
}
