export const ROUTES = [
  'kb',
  'tool',
  'hybrid',
  'outOfScope',
  'meta',

  'unresolvedFollowUp',
  /**
   * O usuário quer que algo SEJA FEITO, não perguntado.
   *
   * Esta rota nunca escreve: ela propõe. A escrita acontece no turno seguinte,
   * a partir da proposta devolvida pelo cliente — abrir chamado por engano é
   * pior do que não abrir.
   */
  'action',
] as const;
export type Route = (typeof ROUTES)[number];

export type RefusalReason =

  | 'outOfScope'

  | 'unresolvedFollowUp'

  | 'recordNotFound'

  | 'notGrounded'

  | 'missingIdentification'

  | 'sourcesUnavailable'

  | 'timedOut';

export interface DocumentSource {
  kind: 'document';

  file: string;

  section: string;
  chunkId: string;

  score: number;

  excerpt: string;
}

export interface ApiSource {
  kind: 'api';

  endpoint: string;

  fields: string[];
  latencyMs: number;
}

export type Source = DocumentSource | ApiSource;

export function isDocumentSource(source: Source): source is DocumentSource {
  return source.kind === 'document';
}

export function isApiSource(source: Source): source is ApiSource {
  return source.kind === 'api';
}
