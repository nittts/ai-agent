import type { EmbeddingsPort } from '../llm/embeddings';
import { chaveEmbedding, type CachePort } from './cache.port';

export class CachedEmbeddings implements EmbeddingsPort {
  readonly nomeModelo: string;
  readonly dimensoes: number;

  constructor(
    private readonly interno: EmbeddingsPort,
    private readonly cache: CachePort,
    private readonly ttlSegundos: number,
  ) {
    this.nomeModelo = interno.nomeModelo;
    this.dimensoes = interno.dimensoes;
  }

  async embedarConsulta(texto: string): Promise<number[]> {
    const chave = chaveEmbedding(texto, this.nomeModelo);

    const emCache = await this.cache.obter<number[]>(chave);

    if (emCache && emCache.length === this.dimensoes) return emCache;

    const vetor = await this.interno.embedarConsulta(texto);
    await this.cache.gravar(chave, vetor, this.ttlSegundos);

    return vetor;
  }

  embedarDocumentos(textos: string[]): Promise<number[][]> {
    return this.interno.embedarDocumentos(textos);
  }
}
