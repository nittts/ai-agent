import { META_ANSWER, META_ANSWER_SHORT, META_CLOSING } from '../prompts';
import type { AgentStateType } from '../agent-state';
import { timed, type StatePatch } from './node-context';

export function createMetaNode() {
  return (state: AgentStateType) =>
    timed('meta', async (): Promise<StatePatch> => {
      return {
        answer: escolherTexto(state),
        refused: false,
        sources: [],
      };
    });
}

function escolherTexto(state: AgentStateType): string {
  if (state.classification?.metaKind === 'closing') return META_CLOSING;

  return state.history.length > 0 ? META_ANSWER_SHORT : META_ANSWER;
}
