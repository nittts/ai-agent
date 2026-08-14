import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { loadEnv } from '../src/config/env';
import { criarEmbeddings } from '../src/llm/embeddings';
import { MemoryVectorStore } from '../src/retrieval/memory-vector-store';
import type { IndexSnapshot } from '../src/retrieval/types';

interface Pergunta {
  id: string;
  categoria: string;
  texto: string;
  docEsperado: string | null;
}

interface Resultado {
  id: string;
  categoria: string;
  texto: string;
  docEsperado: string;
  posicao: number | null;
  scoreTopo: number;
  docTopo: string;
  recall1: boolean;
  recall3: boolean;
  recall5: boolean;
}

const K_MAX = 5;

async function main(): Promise<void> {
  const env = loadEnv();

  const arquivo = JSON.parse(
    await readFile(resolve(process.cwd(), 'eval', 'questions.json'), 'utf-8'),
  ) as { perguntas: Pergunta[] };

  const comGabarito = arquivo.perguntas.filter((p) => p.docEsperado !== null);

  const snapshot = JSON.parse(
    await readFile(resolve(process.cwd(), env.INDEX_PATH), 'utf-8'),
  ) as IndexSnapshot;

  const embeddings = criarEmbeddings(env);

  if (snapshot.modeloEmbedding !== embeddings.nomeModelo) {
    throw new Error(
      `Índice gerado com "${snapshot.modeloEmbedding}" mas o provider atual usa ` +
        `"${embeddings.nomeModelo}". Rode \`npm run ingest\` antes de avaliar.`,
    );
  }

  const store = new MemoryVectorStore();
  store.carregar(snapshot);

  console.log(
    `\nAvaliação de retrieval\n` +
      `  modelo=${embeddings.nomeModelo}  chunks=${store.tamanho()}  ` +
      `corpusVersion=${store.corpusVersion()}\n` +
      `  perguntas com gabarito=${comGabarito.length} (de ${arquivo.perguntas.length})\n`,
  );

  const resultados: Resultado[] = [];

  for (const pergunta of comGabarito) {
    const vetor = await embeddings.embedarConsulta(pergunta.texto);
    const encontrados = store.buscar(vetor, K_MAX);

    const indice = encontrados.findIndex((r) => r.metadata.arquivo === pergunta.docEsperado);
    const posicao = indice >= 0 ? indice + 1 : null;

    resultados.push({
      id: pergunta.id,
      categoria: pergunta.categoria,
      texto: pergunta.texto,
      docEsperado: pergunta.docEsperado!,
      posicao,
      scoreTopo: Number((encontrados[0]?.score ?? 0).toFixed(4)),
      docTopo: encontrados[0]?.metadata.arquivo ?? '-',
      recall1: posicao !== null && posicao <= 1,
      recall3: posicao !== null && posicao <= 3,
      recall5: posicao !== null && posicao <= 5,
    });
  }

  const n = resultados.length;
  const taxa = (f: (r: Resultado) => boolean) => resultados.filter(f).length / n;

  const recall1 = taxa((r) => r.recall1);
  const recall3 = taxa((r) => r.recall3);
  const recall5 = taxa((r) => r.recall5);
  const mrr = resultados.reduce((s, r) => s + (r.posicao ? 1 / r.posicao : 0), 0) / n;

  const falhas = resultados.filter((r) => !r.recall3);

  const linhas: string[] = [
    'métrica'.padEnd(12) + 'valor'.padStart(8),
    '-'.repeat(20),
    'recall@1'.padEnd(12) + recall1.toFixed(3).padStart(8),
    'recall@3'.padEnd(12) + recall3.toFixed(3).padStart(8),
    'recall@5'.padEnd(12) + recall5.toFixed(3).padStart(8),
    'MRR'.padEnd(12) + mrr.toFixed(3).padStart(8),
    '',
    'por categoria:',
  ];

  for (const categoria of [...new Set(resultados.map((r) => r.categoria))]) {
    const doGrupo = resultados.filter((r) => r.categoria === categoria);
    const r3 = doGrupo.filter((r) => r.recall3).length / doGrupo.length;
    linhas.push(
      `  ${categoria.padEnd(14)} n=${String(doGrupo.length).padStart(2)}  recall@3=${r3.toFixed(3)}`,
    );
  }

  if (falhas.length > 0) {
    linhas.push('', 'perguntas SEM o documento esperado no top-3:');
    for (const f of falhas) {
      linhas.push(
        `  [${f.id}] "${f.texto.slice(0, 58)}"\n` +
          `        esperado=${f.docEsperado}  top1=${f.docTopo} (${f.scoreTopo})  posição=${f.posicao ?? 'fora do top-5'}`,
      );
    }
  }

  const relatorio = linhas.join('\n');
  console.log(relatorio);

  const destino = join(process.cwd(), 'eval', 'results');
  await mkdir(destino, { recursive: true });

  await writeFile(
    join(destino, 'retrieval-eval.json'),
    JSON.stringify(
      {
        geradoEm: new Date().toISOString(),
        modeloEmbedding: embeddings.nomeModelo,
        corpusVersion: store.corpusVersion(),
        chunks: store.tamanho(),
        limiarRecusa: env.RETRIEVAL_MIN_SCORE,
        metricas: {
          n,
          recall1: Number(recall1.toFixed(4)),
          recall3: Number(recall3.toFixed(4)),
          recall5: Number(recall5.toFixed(4)),
          mrr: Number(mrr.toFixed(4)),
        },
        resultados,
      },
      null,
      2,
    ),
    'utf-8',
  );

  await writeFile(
    join(destino, 'retrieval-eval.txt'),
    `Avaliação de retrieval — modelo=${embeddings.nomeModelo} corpusVersion=${store.corpusVersion()}\n` +
      `gerado em ${new Date().toISOString()}\n\n${relatorio}\n`,
    'utf-8',
  );

  console.log(`\nJSON: eval/results/retrieval-eval.json`);
}

main().catch((err) => {
  console.error('\nFalha na avaliação:\n', err instanceof Error ? err.message : err);
  process.exit(1);
});
