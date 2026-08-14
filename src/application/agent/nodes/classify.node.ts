import { classificationSchema, type Classification, type AgentStateType } from '../agent-state';
import { CLASSIFICATION_SYSTEM_PROMPT } from '../prompts';
import { withRetry, remainingBudget } from '../../../shared/resilience';
import { timed, type NodeContext, type StatePatch } from './node-context';

export function createClassifyNode(ctx: NodeContext) {
  return (state: AgentStateType) =>
    timed('classify', async (): Promise<StatePatch> => {
      try {
        const { data, usage } = await withRetry(
          () =>
            ctx.model.structured<Classification>({
              system: CLASSIFICATION_SYSTEM_PROMPT,
              user: state.question,
              schema: classificationSchema,
              schemaName: 'classification',

              timeoutMs: remainingBudget(ctx.deadline, ctx.settings.llmTimeoutMs),
            }),
          { attempts: ctx.settings.llmMaxRetries, deadline: ctx.deadline },
        );

        return {
          classification: data,
          route: data.route,
          usage,

          ...(data.route === 'outOfScope'
            ? { refused: true, refusalReason: 'outOfScope' as const }
            : {}),
        };
      } catch {
        return {
          classification: { route: 'kb', tools: [] },
          route: 'kb',
          degraded: true,
          warnings: ['could not classify the question; answered from policy only'],
        };
      }
    });
}
