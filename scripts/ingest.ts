import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { loadEnv } from '../src/infrastructure/config/env';
import {
  buildChunks,
  computeCorpusVersion,
  type RawDocument,
} from '../src/infrastructure/retrieval/chunker';
import { createEmbeddings } from '../src/infrastructure/llm/embeddings.factory';
import type { EmbeddedChunk, IndexSnapshot } from '../src/domain/knowledge';

const BATCH_SIZE = 32;

async function readCorpus(path: string): Promise<RawDocument[]> {
  const files = (await readdir(path)).filter((f) => f.endsWith('.md')).sort();

  if (files.length === 0) throw new Error(`No .md files found in ${path}`);

  return Promise.all(
    files.map(async (file) => ({
      file,
      content: await readFile(join(path, file), 'utf-8'),
    })),
  );
}

async function main(): Promise<void> {
  const env = loadEnv();
  const startedAt = Date.now();

  const corpusPath = resolve(process.cwd(), env.CORPUS_PATH);
  const indexPath = resolve(process.cwd(), env.INDEX_PATH);

  console.log(`Reading corpus from ${corpusPath}`);
  const documents = await readCorpus(corpusPath);
  const corpusVersion = computeCorpusVersion(documents);
  console.log(`  ${documents.length} documents, corpusVersion=${corpusVersion}`);

  const chunks = await buildChunks(documents);
  console.log(`  ${chunks.length} chunks produced`);

  const embeddings = createEmbeddings(env);
  console.log(`Embedding with ${embeddings.modelName} (provider=${env.LLM_PROVIDER})`);

  const embedded: EmbeddedChunk[] = [];

  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = chunks.slice(i, i + BATCH_SIZE);
    const vectors = await embeddings.embedDocuments(batch.map((c) => c.text));

    if (vectors.length !== batch.length) {
      throw new Error(
        `Provider returned ${vectors.length} vectors for ${batch.length} texts. ` +
          'Aborting so a misaligned index is never written.',
      );
    }

    batch.forEach((chunk, index) => embedded.push({ ...chunk, embedding: vectors[index] }));
    console.log(`  ${Math.min(i + BATCH_SIZE, chunks.length)}/${chunks.length}`);
  }

  const dimensions = embedded[0]?.embedding.length ?? 0;
  if (dimensions === 0) throw new Error('Empty embeddings — nothing to write.');

  const snapshot: IndexSnapshot = {
    corpusVersion,
    embeddingModel: embeddings.modelName,
    dimensions,
    generatedAt: new Date().toISOString(),
    chunks: embedded,
  };

  await mkdir(dirname(indexPath), { recursive: true });
  await writeFile(indexPath, JSON.stringify(snapshot), 'utf-8');

  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(
    `\nIndex written to ${indexPath}\n` +
      `  chunks=${embedded.length} dimensions=${dimensions} model=${embeddings.modelName}\n` +
      `  corpusVersion=${corpusVersion} took=${seconds}s`,
  );
}

main().catch((err) => {
  console.error('\nIngestion failed:\n');
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
