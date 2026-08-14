import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { buildChunks, type RawDocument } from '../src/infrastructure/retrieval/chunker';
import { FakeEmbeddings } from '../src/infrastructure/llm/fake/fake-embeddings';
import type { IndexSnapshot } from '../src/domain/knowledge';

export default async function setup(): Promise<void> {
  const corpusDir = join(process.cwd(), 'corpus');
  const target = join(process.cwd(), 'eval', 'index-test.json');

  const files = (await readdir(corpusDir)).filter((f) => f.endsWith('.md')).sort();
  const documents: RawDocument[] = await Promise.all(
    files.map(async (file) => ({
      file,
      content: await readFile(join(corpusDir, file), 'utf-8'),
    })),
  );

  const chunks = await buildChunks(documents);
  const embeddings = new FakeEmbeddings();
  const vectors = await embeddings.embedDocuments(chunks.map((c) => c.text));

  const snapshot: IndexSnapshot = {
    corpusVersion: chunks[0].metadata.corpusVersion,
    embeddingModel: embeddings.modelName,
    dimensions: embeddings.dimensions,
    generatedAt: new Date().toISOString(),
    chunks: chunks.map((chunk, i) => ({ ...chunk, embedding: vectors[i] })),
  };

  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, JSON.stringify(snapshot), 'utf-8');
}
