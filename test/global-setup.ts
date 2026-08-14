import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { gerarChunks, type DocumentoBruto } from '../src/retrieval/chunker';
import { FakeEmbeddings } from '../src/llm/embeddings';
import type { IndexSnapshot } from '../src/retrieval/types';

export default async function setup(): Promise<void> {
  const corpusDir = join(process.cwd(), 'corpus');
  const destino = join(process.cwd(), 'eval', 'index-test.json');

  const arquivos = (await readdir(corpusDir)).filter((f) => f.endsWith('.md')).sort();
  const documentos: DocumentoBruto[] = await Promise.all(
    arquivos.map(async (arquivo) => ({
      arquivo,
      conteudo: await readFile(join(corpusDir, arquivo), 'utf-8'),
    })),
  );

  const chunks = await gerarChunks(documentos);
  const embeddings = new FakeEmbeddings();
  const vetores = await embeddings.embedarDocumentos(chunks.map((c) => c.texto));

  const snapshot: IndexSnapshot = {
    corpusVersion: chunks[0].metadata.corpusVersion,
    modeloEmbedding: embeddings.nomeModelo,
    dimensoes: embeddings.dimensoes,
    geradoEm: new Date().toISOString(),
    chunks: chunks.map((chunk, i) => ({ ...chunk, embedding: vetores[i] })),
  };

  await mkdir(dirname(destino), { recursive: true });
  await writeFile(destino, JSON.stringify(snapshot), 'utf-8');
}
