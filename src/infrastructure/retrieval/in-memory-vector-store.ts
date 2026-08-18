import { Injectable } from '@nestjs/common';
import type { EmbeddedChunk, IndexSnapshot, SearchResult } from '../../domain/knowledge';
import type { VectorStorePort } from '../../application/ports/vector-store.port';

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(
      `Dimension mismatch: query has ${a.length}, index has ${b.length}. ` +
        'This usually means the index was built with a different embedding model — run `npm run ingest` again.',
    );
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  if (normA === 0 || normB === 0) return 0;

  const cos = dot / (Math.sqrt(normA) * Math.sqrt(normB));

  return Math.max(0, Math.min(1, cos));
}

@Injectable()
export class InMemoryVectorStore implements VectorStorePort {
  private chunks: EmbeddedChunk[] = [];
  private version = 'empty';

  load(snapshot: IndexSnapshot): void {
    this.chunks = snapshot.chunks;
    this.version = snapshot.corpusVersion;
  }

  /**
   * Busca por similaridade, com UMA vaga por seção.
   *
   * Medido antes desta regra: em 10 das 14 perguntas de política o topo-4
   * trazia a mesma seção duas ou três vezes, e a resposta via 2,8 seções
   * distintas em vez de 4. Um terço do contexto era redundante — e o que ficava
   * de fora era justamente a seção que faltava para a pergunta multi-documento.
   *
   * A causa é o chunking por seção: uma seção longa vira vários trechos, todos
   * parecidos com a mesma pergunta, e eles se empilham no topo. Guardar o melhor
   * trecho de cada seção troca redundância por cobertura, sem tocar no limiar e
   * sem chamada de modelo — o ranking continua sendo a similaridade.
   */
  search(queryEmbedding: number[], k: number): SearchResult[] {
    if (this.chunks.length === 0) return [];

    const ordenados = this.chunks
      .map((chunk) => ({
        text: chunk.text,
        metadata: chunk.metadata,
        score: cosineSimilarity(queryEmbedding, chunk.embedding),
      }))
      .sort((a, b) => b.score - a.score);

    const melhorPorSecao: SearchResult[] = [];
    const vistas = new Set<string>();

    for (const resultado of ordenados) {
      const secao = `${resultado.metadata.file}§${resultado.metadata.section}`;
      if (vistas.has(secao)) continue;

      vistas.add(secao);
      melhorPorSecao.push(resultado);
      if (melhorPorSecao.length === k) break;
    }

    return melhorPorSecao;
  }

  corpusVersion(): string {
    return this.version;
  }

  size(): number {
    return this.chunks.length;
  }
}
