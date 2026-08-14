import { createHash } from 'node:crypto';
import type { EmbeddingsPort } from '../../../application/ports/embeddings.port';

const FAKE_DIMENSIONS = 256;

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2);
}

function bucketOf(token: string): { index: number; sign: number } {
  const digest = createHash('sha1').update(token).digest();
  return {
    index: ((digest[0] << 8) | digest[1]) % FAKE_DIMENSIONS,
    sign: digest[2] % 2 === 0 ? 1 : -1,
  };
}

export class FakeEmbeddings implements EmbeddingsPort {
  readonly modelName = 'fake-hashing-bow';
  readonly dimensions = FAKE_DIMENSIONS;

  async embedQuery(text: string): Promise<number[]> {
    return this.vectorize(text);
  }

  async embedDocuments(texts: string[]): Promise<number[][]> {
    return texts.map((t) => this.vectorize(t));
  }

  private vectorize(text: string): number[] {
    const vector = new Array<number>(FAKE_DIMENSIONS).fill(0);

    for (const token of tokenize(text)) {
      const { index, sign } = bucketOf(token);
      vector[index] += sign;
    }

    const norm = Math.sqrt(vector.reduce((acc, v) => acc + v * v, 0));
    if (norm === 0) return vector;

    return vector.map((v) => v / norm);
  }
}
