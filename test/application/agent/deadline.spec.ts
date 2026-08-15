import { describe, it, expect, beforeAll } from 'vitest';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { buildAgentGraph } from '../../../src/application/agent/agent-graph';
import type { AgentStateType } from '../../../src/application/agent/agent-state';
import { FakeChatModel } from '../../../src/infrastructure/llm/fake/fake-chat-model';
import { FakeEmbeddings } from '../../../src/infrastructure/llm/fake/fake-embeddings';
import { InMemoryVectorStore } from '../../../src/infrastructure/retrieval/in-memory-vector-store';
import { buildChunks, type RawDocument } from '../../../src/infrastructure/retrieval/chunker';
import type { IndexSnapshot } from '../../../src/domain/knowledge';
import type { EmbeddingsPort } from '../../../src/application/ports/embeddings.port';
import type { HrDirectoryPort } from '../../../src/application/ports/hr-directory.port';
import { withTimeout } from '../../../src/shared/resilience';

class SlowEmbeddings implements EmbeddingsPort {
  readonly modelName = 'fake-hashing-bow';
  readonly dimensions = 256;

  constructor(
    private readonly inner: FakeEmbeddings,
    private readonly delayMs: number,
  ) {}

  async embedQuery(text: string, options?: { timeoutMs?: number }): Promise<number[]> {
    const slow = new Promise<number[]>((resolve) => {
      setTimeout(() => void this.inner.embedQuery(text).then(resolve), this.delayMs);
    });

    return options?.timeoutMs ? withTimeout(slow, options.timeoutMs) : slow;
  }

  embedDocuments(texts: string[]): Promise<number[][]> {
    return this.inner.embedDocuments(texts);
  }
}

const hrStub: HrDirectoryPort = {
  vacationBalance: () => Promise.reject(new Error('not used')),
  benefits: () => Promise.reject(new Error('not used')),
  hoursBank: () => Promise.reject(new Error('not used')),
  ticket: () => Promise.reject(new Error('not used')),
};

describe('request deadline', () => {
  let store: InMemoryVectorStore;
  let fakeEmbeddings: FakeEmbeddings;

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
    fakeEmbeddings = new FakeEmbeddings();
    const vectors = await fakeEmbeddings.embedDocuments(chunks.map((c) => c.text));

    const snapshot: IndexSnapshot = {
      corpusVersion: chunks[0].metadata.corpusVersion,
      embeddingModel: fakeEmbeddings.modelName,
      dimensions: fakeEmbeddings.dimensions,
      generatedAt: new Date().toISOString(),
      chunks: chunks.map((c, i) => ({ ...c, embedding: vectors[i] })),
    };

    store = new InMemoryVectorStore();
    store.load(snapshot);
  });

  const run = (embeddings: EmbeddingsPort, deadlineMs: number) =>
    buildAgentGraph({
      model: new FakeChatModel(),
      embeddings,
      vectorStore: store,
      hr: hrStub,
      settings: { topK: 4, minScore: 0.18, llmTimeoutMs: 20_000, llmMaxRetries: 1 },
      deadline: Date.now() + deadlineMs,
    }).invoke({ question: 'Quantos dias de férias eu tenho por ano?' }) as Promise<AgentStateType>;

  it('a slow embedding call cannot exceed the request deadline', async () => {
    const started = Date.now();
    await run(new SlowEmbeddings(fakeEmbeddings, 10_000), 1_500);
    const elapsed = Date.now() - started;

    expect(elapsed).toBeLessThan(4_000);
  }, 20_000);

  it('degrades honestly when retrieval is cut short by the deadline', async () => {
    const state = await run(new SlowEmbeddings(fakeEmbeddings, 10_000), 1_500);

    expect(state.degraded).toBe(true);
    expect(state.warnings.length).toBeGreaterThan(0);
  }, 20_000);

  it('refuses instead of starting a generation that cannot finish', async () => {
    const state = await run(new SlowEmbeddings(fakeEmbeddings, 10_000), 1_200);

    expect(state.refused).toBe(true);
    expect(state.refusalReason).toBe('timedOut');

    expect(state.answer).not.toContain('[resposta interrompida antes de terminar]');
  }, 20_000);

  it('is unaffected when everything is fast', async () => {
    const started = Date.now();
    const state = await run(fakeEmbeddings, 15_000);

    expect(Date.now() - started).toBeLessThan(2_000);
    expect(state.refused).toBe(false);
    expect(state.degraded).toBe(false);
  });
});
