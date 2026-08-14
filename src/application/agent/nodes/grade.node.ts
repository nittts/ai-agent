import type { RefusalReason } from '../../../domain/answer';
import type { AgentStateType } from '../agent-state';
import { timed, type NodeContext, type StatePatch } from './node-context';

export function createGradeNode(ctx: NodeContext) {
  return (state: AgentStateType) =>
    timed('grade', async (): Promise<StatePatch> => {
      const hasRelevantDocs =
        state.documents.length > 0 && state.bestScore >= ctx.settings.minScore;
      const hasApiData = state.toolResults.length > 0;

      if (hasRelevantDocs || hasApiData) return {};

      return { refused: true, refusalReason: decideReason(state) };
    });
}

function decideReason(state: AgentStateType): RefusalReason {
  const neededAnId =
    (state.route === 'tool' || state.route === 'hybrid') &&
    state.classification?.employeeId === undefined &&
    state.classification?.ticketId === undefined;

  if (neededAnId) return 'missingIdentification';
  if (state.degraded) return 'sourcesUnavailable';
  return 'notGrounded';
}
