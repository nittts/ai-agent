import { describe, it, expect, beforeAll } from 'vitest';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { MemoryVectorStore, similaridadeCosseno } from '../../src/retrieval/memory-vector-store';
import { gerarChunks, type DocumentoBruto } from '../../src/retrieval/chunker';
import { FakeEmbeddings } from '../../src/llm/embeddings';
import type { IndexSnapshot } from '../../src/retrieval/types';

describe('similaridadeCosseno', () => {
  it('vale 1 para vetores idênticos e 0 para ortogonais', () => {
    expect(similaridadeCosseno([1, 0, 0], [1, 0, 0])).toBeCloseTo(1);
    expect(similaridadeCosseno([1, 0, 0], [0, 1, 0])).toBeCloseTo(0);
  });

  it('faz clamp de similaridade negativa em 0', () => {
    expect(similaridadeCosseno([1, 0], [-1, 0])).toBe(0);
  });

  it('falha com mensagem acionável quando as dimensões não batem', () => {
    expect(() => similaridadeCosseno([1, 2, 3], [1, 2])).toThrowError(/npm run ingest/);
  });
});

describe('MemoryVectorStore sobre o corpus real', () => {
  let store: MemoryVectorStore;
  let embeddings: FakeEmbeddings;

  beforeAll(async () => {
    const corpusDir = join(process.cwd(), 'corpus');
    const arquivos = (await readdir(corpusDir)).filter((f) => f.endsWith('.md')).sort();
    const documentos: DocumentoBruto[] = await Promise.all(
      arquivos.map(async (arquivo) => ({
        arquivo,
        conteudo: await readFile(join(corpusDir, arquivo), 'utf-8'),
      })),
    );

    const chunks = await gerarChunks(documentos);
    embeddings = new FakeEmbeddings();
    const vetores = await embeddings.embedarDocumentos(chunks.map((c) => c.texto));

    const snapshot: IndexSnapshot = {
      corpusVersion: chunks[0].metadata.corpusVersion,
      modeloEmbedding: embeddings.nomeModelo,
      dimensoes: embeddings.dimensoes,
      geradoEm: new Date().toISOString(),
      chunks: chunks.map((c, i) => ({ ...c, embedding: vetores[i] })),
    };

    store = new MemoryVectorStore();
    store.carregar(snapshot);
  });

  it('carrega o índice inteiro', () => {
    expect(store.tamanho()).toBeGreaterThan(20);
    expect(store.corpusVersion()).toHaveLength(12);
  });

  it('devolve resultados ordenados por score, limitados a k', async () => {
    const v = await embeddings.embedarConsulta('Quantos dias de férias eu tenho por ano?');
    const r = store.buscar(v, 3);

    expect(r).toHaveLength(3);
    expect(r[0].score).toBeGreaterThanOrEqual(r[1].score);
    expect(r[1].score).toBeGreaterThanOrEqual(r[2].score);
  });

  it.each([
    ['Quantos dias de férias eu tenho direito por ano?', 'ferias.md'],
    ['Qual o valor do auxílio home-office?', 'beneficios.md'],
    ['Qual o prazo para enviar comprovantes de reembolso?', 'reembolso.md'],
    ['Quantos dias por semana preciso ir ao escritório?', 'home-office.md'],
    ['Como funciona o aviso prévio?', 'desligamento.md'],
  ])('recupera o documento correto para %s', async (pergunta, esperado) => {
    const v = await embeddings.embedarConsulta(pergunta);
    const r = store.buscar(v, 3);

    expect(r.map((x) => x.metadata.arquivo)).toContain(esperado);
  });

  it('pontua pergunta fora de escopo bem abaixo de pergunta legítima', async () => {
    const fora = await embeddings.embedarConsulta('Qual a previsão do tempo em São Paulo amanhã?');
    const dentro = await embeddings.embedarConsulta('Posso vender parte das minhas férias?');

    const scoreFora = store.buscar(fora, 1)[0].score;
    const scoreDentro = store.buscar(dentro, 1)[0].score;

    expect(scoreFora).toBeLessThan(scoreDentro);
    expect(scoreFora).toBeLessThan(0.18);
  });

  it('devolve lista vazia quando não há índice carregado', () => {
    const vazio = new MemoryVectorStore();
    expect(vazio.buscar([1, 2, 3], 5)).toEqual([]);
    expect(vazio.tamanho()).toBe(0);
  });
});
