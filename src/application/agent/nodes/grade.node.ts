import type { RefusalReason } from '../../../domain/answer';
import type { AgentStateType } from '../agent-state';
import {
  budgetLeft,
  MIN_VIABLE_GENERATION_MS,
  timed,
  type NodeContext,
  type StatePatch,
} from './node-context';

export function createGradeNode(ctx: NodeContext) {
  return (state: AgentStateType) =>
    timed('grade', async (): Promise<StatePatch> => {
      const hasRelevantDocs =
        state.documents.length > 0 && state.bestScore >= ctx.settings.minScore;
      const hasApiData = state.toolResults.length > 0;

      if (hasRelevantDocs || hasApiData) return {};

      return { refused: true, refusalReason: decideReason(state, ctx) };
    });
}

function decideReason(state: AgentStateType, ctx: NodeContext): RefusalReason {
  if (budgetLeft(ctx.deadline) < MIN_VIABLE_GENERATION_MS && state.degraded) {
    return 'timedOut';
  }

  const neededAnId =
    (state.route === 'tool' || state.route === 'hybrid') &&
    state.classification?.employeeId === undefined &&
    state.classification?.ticketId === undefined;

  if (neededAnId) return 'missingIdentification';
  if (state.recordNotFound) return 'recordNotFound';
  if (state.degraded) return 'sourcesUnavailable';
  return 'notGrounded';
}
