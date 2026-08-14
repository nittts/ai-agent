import type { AgentStateType } from '../agent-state';
import { REFUSAL_MESSAGES } from '../prompts';
import { timed, type StatePatch } from './node-context';

export function createRefuseNode() {
  return (state: AgentStateType) =>
    timed('refuse', async (): Promise<StatePatch> => {
      const reason = state.refusalReason ?? 'notGrounded';

      return {
        refused: true,
        refusalReason: reason,
        answer: REFUSAL_MESSAGES[reason],

        sources: [],
      };
    });
}
