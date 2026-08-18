import type { Source } from '../../../domain/answer';
import type { AgentStateType } from '../agent-state';
import { remainingBudget } from '../../../shared/resilience';
import { timed, type NodeContext, type StatePatch } from './node-context';

/**
 * `reach` amplia o alcance da busca sem tocar no limiar.
 *
 * A segunda tentativa procura MAIS FUNDO, não com critério mais frouxo: se o
 * trecho certo existia na posição 7, ele passa a ser encontrado; se não existia
 * acima do limiar, a recusa continua sendo a resposta certa. Baixar o limiar
 * seria comprar resposta trocando fundamentação, que é o oposto do projeto.
 */
export function createRetrieveNode(ctx: NodeContext, reach = 1, label = 'retrieve') {
  return (state: AgentStateType) =>
    timed(label, async (): Promise<StatePatch> => {
      try {
        const vector = await ctx.embeddings.embedQuery(state.standaloneQuestion, {
          timeoutMs: remainingBudget(ctx.deadline, ctx.settings.llmTimeoutMs),
        });
        const documents = ctx.vectorStore.search(vector, ctx.settings.topK * reach);

        const sources: Source[] = documents.map((doc) => ({
          kind: 'document',
          file: doc.metadata.file,
          section: doc.metadata.section,
          chunkId: doc.metadata.chunkId,
          score: Number(doc.score.toFixed(4)),

          excerpt: doc.text.slice(0, 240),
        }));

        return { documents, sources, bestScore: documents[0]?.score ?? 0, retried: reach > 1 };
      } catch {
        return { degraded: true, warnings: ['knowledge base unavailable'] };
      }
    });
}
