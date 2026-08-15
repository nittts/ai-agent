import type { ChatModelPort } from '../../ports/chat-model.port';
import type { EmbeddingsPort } from '../../ports/embeddings.port';
import type { VectorStorePort } from '../../ports/vector-store.port';
import type { HrDirectoryPort } from '../../ports/hr-directory.port';
import type { AgentStateType } from '../agent-state';
import { withSpan } from '../../../shared/observability';

export interface NodeContext {
  model: ChatModelPort;
  embeddings: EmbeddingsPort;
  vectorStore: VectorStorePort;
  hr: HrDirectoryPort;

  settings: {
    topK: number;
    minScore: number;
    llmTimeoutMs: number;
    llmMaxRetries: number;
  };

  deadline: number;

  onToken?: (token: string) => void;
}

export type StatePatch = Partial<AgentStateType>;

export const MIN_VIABLE_GENERATION_MS = 1_200;

export function budgetLeft(deadline: number): number {
  return deadline - Date.now();
}

export async function timed<T extends StatePatch>(
  name: string,
  fn: () => Promise<T>,
): Promise<T & { timings: Record<string, number> }> {
  return withSpan(`agent.${name}`, { 'agent.node': name }, async (span) => {
    const start = Date.now();
    const result = await fn();
    const duration = Date.now() - start;

    span.setAttributes({
      'agent.duration_ms': duration,
      ...(result.route ? { 'agent.route': result.route } : {}),
      ...(result.documents ? { 'agent.documents_retrieved': result.documents.length } : {}),
      ...(result.toolResults ? { 'agent.tools_executed': result.toolResults.length } : {}),
      ...(result.usage
        ? { 'llm.input_tokens': result.usage.input, 'llm.output_tokens': result.usage.output }
        : {}),
      ...(result.degraded !== undefined ? { 'agent.degraded': result.degraded } : {}),
      ...(result.refusalReason ? { 'agent.refusal_reason': result.refusalReason } : {}),
    });

    return { ...result, timings: { [name]: duration } };
  });
}
