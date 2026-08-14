export const ROUTES = ['kb', 'tool', 'hybrid', 'outOfScope'] as const;
export type Route = (typeof ROUTES)[number];

export type RefusalReason =

  | 'outOfScope'

  | 'notGrounded'

  | 'missingIdentification'

  | 'sourcesUnavailable';

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
