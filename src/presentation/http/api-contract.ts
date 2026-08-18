import type { Route, RefusalReason, Source, DocumentSource, ApiSource } from '../../domain/answer';
import type { ConversationTurn, SessionFacts } from '../../domain/conversation';

export type { Route, RefusalReason, Source, DocumentSource, ApiSource, ConversationTurn, SessionFacts };

export interface Cost {
  inputTokens: number;
  outputTokens: number;
  usd: number;
}

export interface Timings {
  totalMs: number;

  ttftMs: number | null;
  retrievalMs: number | null;

  llmMs: number | null;

  perNode: Record<string, number> | null;
}

export interface AskRequest {
  question: string;

  bypassCache?: boolean;

  history?: ConversationTurn[];

  /**
   * Fatos da SESSÃO — hoje só a matrícula.
   *
   * Fora da janela de histórico de propósito: "use esse id daqui em diante" é
   * um fato que vale enquanto a sessão durar, não um turno que expira depois de
   * três trocas. A resposta devolve `facts` atualizado para o cliente guardar.
   */
  facts?: SessionFacts;
}

export interface AskResponse {
  answer: string;
  route: Route;
  sources: Source[];

  degraded: boolean;

  warnings: string[];

  notes: string[];

  /**
   * O que a verificação determinística pós-geração não conseguiu respaldar:
   * números que não aparecem nas fontes, e citações para fontes inexistentes.
   *
   * Vazio na esmagadora maioria das respostas. Quando não está, o console
   * mostra — porque uma afirmação sem respaldo que ninguém vê é pior que uma
   * recusa.
   */
  unverified: string[];

  /** Fatos aprendidos; o cliente guarda e reenvia no próximo request. */
  facts: SessionFacts;

  refused: boolean;
  refusalReason: RefusalReason | null;

  cache: 'HIT' | 'MISS' | 'OFF';
  timings: Timings;
  cost: Cost;

  interpretedAs: string | null;

  correlationId: string;
}

export type SseEvent =
  | { type: 'token'; text: string }
  | { type: 'sources'; sources: Source[]; route: Route }
  | { type: 'done'; summary: AskResponse }
  | { type: 'error'; message: string; correlationId: string };

export interface HealthResponse {
  status: 'ok';
  uptimeSeconds: number;
  llm: { provider: 'gemini' | 'fake'; chatModel: string | null; embeddingModel: string | null };
  cache: { enabled: boolean; ttlSeconds: number };
  chaosEnabled: boolean;
}

export interface DemoQuestion {
  id: string;
  category: string;
  text: string;
  expected: string;
  expectedDoc: string | null;
}
