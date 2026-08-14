export const ROTAS = ['kb', 'tool', 'hybrid', 'out_of_scope'] as const;
export type Rota = (typeof ROTAS)[number];

export interface FonteDocumento {
  tipo: 'documento';

  arquivo: string;

  secao: string;
  chunkId: string;

  score: number;

  trecho: string;
}

export interface FonteApi {
  tipo: 'api';

  endpoint: string;

  campos: string[];
  latenciaMs: number;
}

export type Fonte = FonteDocumento | FonteApi;

export interface CustoTokens {
  tokensEntrada: number;
  tokensSaida: number;
  custoUsd: number;
}

export interface Tempos {
  totalMs: number;

  ttftMs: number | null;

  retrievalMs: number | null;

  llmMs: number | null;
}

export interface AskRequest {
  pergunta: string;

  ignorarCache?: boolean;
}

export interface AskResponse {
  resposta: string;
  rota: Rota;
  fontes: Fonte[];

  degradado: boolean;

  avisos: string[];

  recusado: boolean;

  cache: 'HIT' | 'MISS' | 'OFF';
  tempos: Tempos;
  custo: CustoTokens;

  correlationId: string;
}

export type SseEvent =
  | { tipo: 'token'; texto: string }
  | { tipo: 'fontes'; fontes: Fonte[]; rota: Rota }
  | { tipo: 'fim'; resumo: AskResponse }
  | { tipo: 'erro'; mensagem: string; correlationId: string };

export interface HealthResponse {
  status: 'ok';
  uptimeSeconds: number;
  llm: { provider: 'gemini' | 'fake'; chatModel: string | null; embedModel: string | null };
  cache: { enabled: boolean; ttlSeconds: number };
  chaosEnabled: boolean;
}
