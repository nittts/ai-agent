import type { AgentStateType } from '../agent-state';
import { ANSWER_SYSTEM_PROMPT, buildAnswerPrompt } from '../prompts';
import { withRetry, remainingBudget } from '../../../shared/resilience';
import { timed, type NodeContext, type StatePatch } from './node-context';

export function createAnswerNode(ctx: NodeContext) {
  return (state: AgentStateType) =>
    timed('generateAnswer', async (): Promise<StatePatch> => {
      try {
        const { text, usage } = await withRetry(
          () =>
            ctx.model.generate({
              system: ANSWER_SYSTEM_PROMPT,
              user: buildAnswerPrompt(
                state.question,
                state.documents,
                state.toolResults,
                state.warnings,
              ),
              onToken: ctx.onToken,
              timeoutMs: remainingBudget(ctx.deadline, ctx.settings.llmTimeoutMs),
            }),
          { attempts: ctx.settings.llmMaxRetries, deadline: ctx.deadline },
        );

        return { answer: text, usage };
      } catch {
        return {
          refused: true,
          refusalReason: 'sourcesUnavailable',
          degraded: true,
          warnings: ['language model unavailable'],
        };
      }
    });
}
