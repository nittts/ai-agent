import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { loadEnv } from '../src/infrastructure/config/env';
import { createEmbeddings } from '../src/infrastructure/llm/embeddings.factory';
import { InMemoryVectorStore } from '../src/infrastructure/retrieval/in-memory-vector-store';
import type { IndexSnapshot } from '../src/domain/knowledge';

interface Question {
  id: string;
  category: string;
  text: string;
  expectedDoc: string | null;
}

interface Row {
  id: string;
  category: string;
  text: string;
  expectedDoc: string;
  rank: number | null;
  topScore: number;
  topDoc: string;
  recall1: boolean;
  recall3: boolean;
  recall5: boolean;
}

const MAX_K = 5;

async function main(): Promise<void> {
  const env = loadEnv();

  const file = JSON.parse(
    await readFile(resolve(process.cwd(), 'eval', 'questions.json'), 'utf-8'),
  ) as { questions: Question[] };

  const labelled = file.questions.filter((q) => q.expectedDoc !== null);

  const snapshot = JSON.parse(
    await readFile(resolve(process.cwd(), env.INDEX_PATH), 'utf-8'),
  ) as IndexSnapshot;

  const embeddings = createEmbeddings(env);

  if (snapshot.embeddingModel !== embeddings.modelName) {
    throw new Error(
      `Index was built with "${snapshot.embeddingModel}" but the current provider uses ` +
        `"${embeddings.modelName}". Run \`npm run ingest\` before evaluating.`,
    );
  }

  const store = new InMemoryVectorStore();
  store.load(snapshot);

  console.log(
    `\nRetrieval evaluation\n` +
      `  model=${embeddings.modelName}  chunks=${store.size()}  ` +
      `corpusVersion=${store.corpusVersion()}\n` +
      `  labelled questions=${labelled.length} (of ${file.questions.length})\n`,
  );

  const rows: Row[] = [];

  for (const question of labelled) {
    const vector = await embeddings.embedQuery(question.text);
    const found = store.search(vector, MAX_K);

    const index = found.findIndex((r) => r.metadata.file === question.expectedDoc);
    const rank = index >= 0 ? index + 1 : null;

    rows.push({
      id: question.id,
      category: question.category,
      text: question.text,
      expectedDoc: question.expectedDoc!,
      rank,
      topScore: Number((found[0]?.score ?? 0).toFixed(4)),
      topDoc: found[0]?.metadata.file ?? '-',
      recall1: rank !== null && rank <= 1,
      recall3: rank !== null && rank <= 3,
      recall5: rank !== null && rank <= 5,
    });
  }

  const n = rows.length;
  const rate = (predicate: (r: Row) => boolean) => rows.filter(predicate).length / n;

  const recall1 = rate((r) => r.recall1);
  const recall3 = rate((r) => r.recall3);
  const recall5 = rate((r) => r.recall5);
  const mrr = rows.reduce((sum, r) => sum + (r.rank ? 1 / r.rank : 0), 0) / n;

  const misses = rows.filter((r) => !r.recall3);

  const lines: string[] = [
    'metric'.padEnd(12) + 'value'.padStart(8),
    '-'.repeat(20),
    'recall@1'.padEnd(12) + recall1.toFixed(3).padStart(8),
    'recall@3'.padEnd(12) + recall3.toFixed(3).padStart(8),
    'recall@5'.padEnd(12) + recall5.toFixed(3).padStart(8),
    'MRR'.padEnd(12) + mrr.toFixed(3).padStart(8),
    '',
    'by category:',
  ];

  for (const category of [...new Set(rows.map((r) => r.category))]) {
    const group = rows.filter((r) => r.category === category);
    const r3 = group.filter((r) => r.recall3).length / group.length;
    lines.push(`  ${category.padEnd(14)} n=${String(group.length).padStart(2)}  recall@3=${r3.toFixed(3)}`);
  }

  if (misses.length > 0) {
    lines.push('', 'questions WITHOUT the expected document in the top-3:');
    for (const miss of misses) {
      lines.push(
        `  [${miss.id}] "${miss.text.slice(0, 58)}"\n` +
          `        expected=${miss.expectedDoc}  top1=${miss.topDoc} (${miss.topScore})  rank=${miss.rank ?? 'outside top-5'}`,
      );
    }
  }

  lines.push(
    '',
    `n=${n} labelled questions over ${store.size()} chunks. Small, well-separated corpus:`,
    'treat a perfect score as a sanity floor, not as evidence of robustness at scale.',
  );

  const report = lines.join('\n');
  console.log(report);

  const outDir = join(process.cwd(), 'eval', 'results');
  await mkdir(outDir, { recursive: true });

  await writeFile(
    join(outDir, 'retrieval-eval.json'),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        embeddingModel: embeddings.modelName,
        corpusVersion: store.corpusVersion(),
        chunks: store.size(),
        refusalThreshold: env.RETRIEVAL_MIN_SCORE,
        caveat:
          'Small labelled set over a well-separated corpus; a perfect score is a sanity floor, not proof of robustness.',
        metrics: {
          n,
          recall1: Number(recall1.toFixed(4)),
          recall3: Number(recall3.toFixed(4)),
          recall5: Number(recall5.toFixed(4)),
          mrr: Number(mrr.toFixed(4)),
        },
        rows,
      },
      null,
      2,
    ),
    'utf-8',
  );

  await writeFile(
    join(outDir, 'retrieval-eval.txt'),
    `Retrieval evaluation — model=${embeddings.modelName} corpusVersion=${store.corpusVersion()}\n` +
      `generated at ${new Date().toISOString()}\n\n${report}\n`,
    'utf-8',
  );

  console.log(`\nJSON: eval/results/retrieval-eval.json`);
}

main().catch((err) => {
  console.error('\nEvaluation failed:\n', err instanceof Error ? err.message : err);
  process.exit(1);
});
