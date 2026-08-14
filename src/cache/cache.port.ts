import { createHash } from 'node:crypto';

export interface CachePort {
  obter<T>(chave: string): Promise<T | null>;
  gravar<T>(chave: string, valor: T, ttlSegundos: number): Promise<void>;

  limpar(): Promise<void>;
  readonly habilitado: boolean;
}

export function normalizarPergunta(pergunta: string): string {
  return pergunta
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/[?!.\s]+$/, '');
}

export function chaveResposta(pergunta: string, modelo: string, corpusVersion: string): string {
  const digest = createHash('sha256')
    .update(normalizarPergunta(pergunta))
    .update('\0')
    .update(modelo)
    .update('\0')
    .update(corpusVersion)
    .digest('hex');

  return `resp:${digest.slice(0, 32)}`;
}

export function chaveEmbedding(texto: string, modeloEmbedding: string): string {
  const digest = createHash('sha256')
    .update(normalizarPergunta(texto))
    .update('\0')
    .update(modeloEmbedding)
    .digest('hex');

  return `emb:${digest.slice(0, 32)}`;
}
