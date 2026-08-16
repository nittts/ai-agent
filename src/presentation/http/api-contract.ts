import type { Route, RefusalReason, Source, DocumentSource, ApiSource } from '../../domain/answer';

export type { Route, RefusalReason, Source, DocumentSource, ApiSource };

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
}

export interface AskResponse {
  answer: string;
  route: Route;
  sources: Source[];

  degraded: boolean;

  warnings: string[];

  notes: string[];

  refused: boolean;
  refusalReason: RefusalReason | null;

  cache: 'HIT' | 'MISS' | 'OFF';
  timings: Timings;
  cost: Cost;

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
