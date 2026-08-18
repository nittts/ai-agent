import type { AgentStateType } from '../agent-state';
import { ANSWER_SYSTEM_PROMPT, buildAnswerPrompt, buildContext, REFUSAL_MESSAGES } from '../prompts';
import { checkArithmetic, verifyAnswer } from '../verification';
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

        /**
         * Deterministic post-check, no extra model call.
         *
         * It cannot make hallucination impossible — nothing can. It makes one
         * class of it impossible to ship SILENTLY: a figure the evidence never
         * contained, or a citation pointing at a source that does not exist.
         * In a product where every real answer is a number next to a source,
         * that is the shape a fabricated claim takes.
         *
         * It reports rather than refuses. A false positive that erases a
         * correct answer costs more than a flagged number the reader can check
         * against the evidence panel — which is right there, on the same screen.
         */
        const check = verifyAnswer({
          answer: text,
          context: buildContext(state.documents, state.toolResults),
          sourceCount: state.documents.length + state.toolResults.length,
          question: state.standaloneQuestion,
        });

        const unverified: string[] = [];
        if (check.unsupportedFigures.length > 0) {
          unverified.push(
            `números sem respaldo nas fontes: ${check.unsupportedFigures.join(', ')}`,
          );
        }
        const contasErradas = checkArithmetic(text);
        if (contasErradas.length > 0) {
          unverified.push(`contas que não fecham: ${contasErradas.join('; ')}`);
        }
        if (check.invalidCitations.length > 0) {
          unverified.push(
            `citações para fontes inexistentes: ${check.invalidCitations.map((n) => `[${n}]`).join(', ')}`,
          );
        }

        return { answer: text, usage, unverified };
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
