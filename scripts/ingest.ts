import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { loadEnv } from '../src/config/env';
import { gerarChunks, calcularCorpusVersion, type DocumentoBruto } from '../src/retrieval/chunker';
import { criarEmbeddings } from '../src/llm/embeddings';
import type { EmbeddedChunk, IndexSnapshot } from '../src/retrieval/types';

const TAMANHO_LOTE = 32;

async function lerCorpus(caminho: string): Promise<DocumentoBruto[]> {
  const arquivos = (await readdir(caminho)).filter((f) => f.endsWith('.md')).sort();

  if (arquivos.length === 0) {
    throw new Error(`Nenhum arquivo .md encontrado em ${caminho}`);
  }

  return Promise.all(
    arquivos.map(async (arquivo) => ({
      arquivo,
      conteudo: await readFile(join(caminho, arquivo), 'utf-8'),
    })),
  );
}

async function main(): Promise<void> {
  const env = loadEnv();
  const inicio = Date.now();

  const caminhoCorpus = resolve(process.cwd(), env.CORPUS_PATH);
  const caminhoIndice = resolve(process.cwd(), env.INDEX_PATH);

  console.log(`Lendo corpus de ${caminhoCorpus}`);
  const documentos = await lerCorpus(caminhoCorpus);
  const corpusVersion = calcularCorpusVersion(documentos);
  console.log(`  ${documentos.length} documentos, corpusVersion=${corpusVersion}`);

  const chunks = await gerarChunks(documentos);
  console.log(`  ${chunks.length} chunks gerados`);

  const embeddings = criarEmbeddings(env);
  console.log(`Embeddando com ${embeddings.nomeModelo} (provider=${env.LLM_PROVIDER})`);

  const embedados: EmbeddedChunk[] = [];

  for (let i = 0; i < chunks.length; i += TAMANHO_LOTE) {
    const lote = chunks.slice(i, i + TAMANHO_LOTE);
    const vetores = await embeddings.embedarDocumentos(lote.map((c) => c.texto));

    if (vetores.length !== lote.length) {
      throw new Error(
        `Provider devolveu ${vetores.length} vetores para ${lote.length} textos. Ingestão abortada para não gravar índice desalinhado.`,
      );
    }

    lote.forEach((chunk, indice) => embedados.push({ ...chunk, embedding: vetores[indice] }));
    console.log(`  ${Math.min(i + TAMANHO_LOTE, chunks.length)}/${chunks.length}`);
  }

  const dimensoes = embedados[0]?.embedding.length ?? 0;
  if (dimensoes === 0) throw new Error('Embeddings vazios — nada a gravar.');

  const snapshot: IndexSnapshot = {
    corpusVersion,
    modeloEmbedding: embeddings.nomeModelo,
    dimensoes,
    geradoEm: new Date().toISOString(),
    chunks: embedados,
  };

  await mkdir(dirname(caminhoIndice), { recursive: true });
  await writeFile(caminhoIndice, JSON.stringify(snapshot), 'utf-8');

  const segundos = ((Date.now() - inicio) / 1000).toFixed(1);
  console.log(
    `\nÍndice gravado em ${caminhoIndice}\n` +
      `  chunks=${embedados.length} dimensoes=${dimensoes} modelo=${embeddings.nomeModelo}\n` +
      `  corpusVersion=${corpusVersion} tempo=${segundos}s`,
  );
}

main().catch((err) => {
  console.error('\nFalha na ingestão:\n');
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
