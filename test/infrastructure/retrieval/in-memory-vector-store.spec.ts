import { describe, it, expect, beforeAll } from 'vitest';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  InMemoryVectorStore,
  cosineSimilarity,
} from '../../../src/infrastructure/retrieval/in-memory-vector-store';
import { buildChunks, type RawDocument } from '../../../src/infrastructure/retrieval/chunker';
import { FakeEmbeddings } from '../../../src/infrastructure/llm/fake/fake-embeddings';
import type { IndexSnapshot } from '../../../src/domain/knowledge';

describe('cosineSimilarity', () => {
  it('is 1 for identical vectors and 0 for orthogonal ones', () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1);
    expect(cosineSimilarity([1, 0, 0], [0, 1, 0])).toBeCloseTo(0);
  });

  it('clamps negative similarity to 0', () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBe(0);
  });

  it('fails with an actionable message on dimension mismatch', () => {
    expect(() => cosineSimilarity([1, 2, 3], [1, 2])).toThrowError(/npm run ingest/);
  });
});

describe('InMemoryVectorStore over the real corpus', () => {
  let store: InMemoryVectorStore;
  let embeddings: FakeEmbeddings;

  beforeAll(async () => {
    const corpusDir = join(process.cwd(), 'corpus');
    const files = (await readdir(corpusDir)).filter((f) => f.endsWith('.md')).sort();
    const documents: RawDocument[] = await Promise.all(
      files.map(async (file) => ({
        file,
        content: await readFile(join(corpusDir, file), 'utf-8'),
      })),
    );

    const chunks = await buildChunks(documents);
    embeddings = new FakeEmbeddings();
    const vectors = await embeddings.embedDocuments(chunks.map((c) => c.text));

    const snapshot: IndexSnapshot = {
      corpusVersion: chunks[0].metadata.corpusVersion,
      embeddingModel: embeddings.modelName,
      dimensions: embeddings.dimensions,
      generatedAt: new Date().toISOString(),
      chunks: chunks.map((c, i) => ({ ...c, embedding: vectors[i] })),
    };

    store = new InMemoryVectorStore();
    store.load(snapshot);
  });

  it('loads the whole index', () => {
    expect(store.size()).toBeGreaterThan(20);
    expect(store.corpusVersion()).toHaveLength(12);
  });

  it('returns results ordered by score, limited to k', async () => {
    const vector = await embeddings.embedQuery('Quantos dias de férias eu tenho por ano?');
    const results = store.search(vector, 3);

    expect(results).toHaveLength(3);
    expect(results[0].score).toBeGreaterThanOrEqual(results[1].score);
    expect(results[1].score).toBeGreaterThanOrEqual(results[2].score);
  });

  it.each([
    ['Quantos dias de férias eu tenho direito por ano?', 'ferias.md'],
    ['Qual o valor do auxílio home-office?', 'beneficios.md'],
    ['Qual o prazo para enviar comprovantes de reembolso?', 'reembolso.md'],
    ['Quantos dias por semana preciso ir ao escritório?', 'home-office.md'],
    ['Como funciona o aviso prévio?', 'desligamento.md'],
  ])('retrieves the correct document for %s', async (question, expectedFile) => {
    const vector = await embeddings.embedQuery(question);
    const results = store.search(vector, 3);

    expect(results.map((r) => r.metadata.file)).toContain(expectedFile);
  });

  it('scores an out-of-scope question far below a legitimate one', async () => {
    const outside = await embeddings.embedQuery('Qual a previsão do tempo em São Paulo amanhã?');
    const inside = await embeddings.embedQuery('Posso vender parte das minhas férias?');

    expect(store.search(outside, 1)[0].score).toBeLessThan(store.search(inside, 1)[0].score);
    expect(store.search(outside, 1)[0].score).toBeLessThan(0.18);
  });

  it('returns an empty list when no index is loaded', () => {
    const empty = new InMemoryVectorStore();
    expect(empty.search([1, 2, 3], 5)).toEqual([]);
    expect(empty.size()).toBe(0);
  });
});
