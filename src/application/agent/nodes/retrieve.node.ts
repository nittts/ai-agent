import type { Source } from '../../../domain/answer';
import type { AgentStateType } from '../agent-state';
import { timed, type NodeContext, type StatePatch } from './node-context';

export function createRetrieveNode(ctx: NodeContext) {
  return (state: AgentStateType) =>
    timed('retrieve', async (): Promise<StatePatch> => {
      try {
        const vector = await ctx.embeddings.embedQuery(state.question);
        const documents = ctx.vectorStore.search(vector, ctx.settings.topK);

        const sources: Source[] = documents.map((doc) => ({
          kind: 'document',
          file: doc.metadata.file,
          section: doc.metadata.section,
          chunkId: doc.metadata.chunkId,
          score: Number(doc.score.toFixed(4)),

          excerpt: doc.text.slice(0, 240),
        }));

        return { documents, sources, bestScore: documents[0]?.score ?? 0 };
      } catch {
        return { degraded: true, warnings: ['knowledge base unavailable'] };
      }
    });
}
