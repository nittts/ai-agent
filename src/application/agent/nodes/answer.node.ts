import type { AgentStateType } from '../agent-state';
import { ANSWER_SYSTEM_PROMPT, buildAnswerPrompt, REFUSAL_MESSAGES } from '../prompts';
import { withRetry, remainingBudget } from '../../../shared/resilience';
import {
  budgetLeft,
  MIN_VIABLE_GENERATION_MS,
  timed,
  type NodeContext,
  type StatePatch,
} from './node-context';

export function createAnswerNode(ctx: NodeContext) {
  return (state: AgentStateType) =>
    timed('generateAnswer', async (): Promise<StatePatch> => {
      if (budgetLeft(ctx.deadline) < MIN_VIABLE_GENERATION_MS) {
        return {
          refused: true,
          refusalReason: 'timedOut',

          answer: REFUSAL_MESSAGES.timedOut,
          degraded: true,
          warnings: ['tempo insuficiente para gerar a resposta dentro do prazo do request'],
        };
      }

      let streamedText = '';

      const onToken = ctx.onToken
        ? (token: string) => {
            streamedText += token;
            ctx.onToken!(token);
          }
        : (token: string) => {
            streamedText += token;
          };

      try {
        const { text, usage } = await withRetry(
          () =>
            ctx.model.generate({
              system: ANSWER_SYSTEM_PROMPT,
              user: buildAnswerPrompt(
                state.standaloneQuestion,
                state.documents,
                state.toolResults,
                state.warnings,
                state.notes,
              ),
              onToken,
              timeoutMs: remainingBudget(ctx.deadline, ctx.settings.llmTimeoutMs),
            }),
          { attempts: ctx.settings.llmMaxRetries, deadline: ctx.deadline },
        );

        return { answer: text, usage };
      } catch {
        if (streamedText.trim().length > 0) {
          return {
            answer: `${streamedText.trimEnd()}\n\n[resposta interrompida antes de terminar]`,
            degraded: true,
            warnings: ['a geração da resposta foi interrompida antes de concluir'],
          };
        }

        return {
          refused: true,
          refusalReason: 'sourcesUnavailable',

          answer: REFUSAL_MESSAGES.sourcesUnavailable,
          degraded: true,
          warnings: ['language model unavailable'],
        };
      }
    });
}
