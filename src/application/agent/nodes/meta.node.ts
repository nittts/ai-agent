import { META_ANSWER } from '../prompts';
import { timed, type StatePatch } from './node-context';

export function createMetaNode() {
  return () =>
    timed('meta', async (): Promise<StatePatch> => {
      return {
        answer: META_ANSWER,
        refused: false,
        sources: [],
      };
    });
}
