import type { z } from 'zod';
import type { TokenUsage } from '../../domain/cost';

export interface StructuredParams<T> {
  system: string;
  user: string;

  schema: z.ZodType<T, z.ZodTypeDef, unknown>;
  schemaName: string;

  timeoutMs?: number;
}

export interface GenerationParams {
  system: string;
  user: string;

  onToken?: (token: string) => void;

  timeoutMs?: number;
}

export interface ChatModelPort {
  readonly modelName: string;

  structured<T>(params: StructuredParams<T>): Promise<{ data: T; usage: TokenUsage }>;

  generate(params: GenerationParams): Promise<{ text: string; usage: TokenUsage }>;
}

export const CHAT_MODEL = Symbol('CHAT_MODEL');
