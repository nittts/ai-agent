import { META_ANSWER, META_ANSWER_SHORT, META_GREETING } from '../prompts';
import type { AgentStateType } from '../agent-state';
import { timed, type StatePatch } from './node-context';

export function createMetaNode() {
  return (state: AgentStateType) =>
    timed('meta', async (): Promise<StatePatch> => {
      const jaSeApresentou = state.history.some(
        (turn) => turn.role === 'assistant' && turn.content.startsWith(META_GREETING),
      );

      return {
        answer: jaSeApresentou ? META_ANSWER_SHORT : META_ANSWER,
        refused: false,
        sources: [],
      };
    });
}
