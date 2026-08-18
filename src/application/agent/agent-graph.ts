import { END, START, StateGraph } from '@langchain/langgraph';
import { AgentState, type AgentStateType } from './agent-state';
import { createClassifyNode } from './nodes/classify.node';
import { createRetrieveNode } from './nodes/retrieve.node';
import { createCallHrApiNode } from './nodes/call-hr-api.node';
import { createGradeNode } from './nodes/grade.node';
import { createAnswerNode } from './nodes/answer.node';
import { createRefuseNode } from './nodes/refuse.node';
import { createMetaNode } from './nodes/meta.node';
import { createProposeActionNode } from './nodes/propose-action.node';
import type { NodeContext } from './nodes/node-context';

export function buildAgentGraph(ctx: NodeContext) {
  const graph = new StateGraph(AgentState)
    .addNode('classify', createClassifyNode(ctx))
    .addNode('retrieve', createRetrieveNode(ctx))
    .addNode('callHrApi', createCallHrApiNode(ctx))
    .addNode('grade', createGradeNode(ctx))
    .addNode('generateAnswer', createAnswerNode(ctx))
    .addNode('refuse', createRefuseNode())
    .addNode('meta', createMetaNode())
    .addNode('retrieveAgain', createRetrieveNode(ctx, 3, 'retrieveAgain'))
    .addNode('proposeAction', createProposeActionNode())

    .addEdge(START, 'classify')

    .addConditionalEdges(
      'classify',
      (state: AgentStateType) => {
        switch (state.route) {
          case 'outOfScope':
            return ['refuse'];

          case 'meta':
            return ['meta'];

          case 'unresolvedFollowUp':
            return ['refuse'];
          case 'action':
            return ['proposeAction'];
          case 'kb':
            return ['retrieve'];
          case 'tool':
            return ['callHrApi'];
          case 'hybrid':
            return ['retrieve', 'callHrApi'];
        }
      },
      ['retrieve', 'callHrApi', 'refuse', 'meta', 'proposeAction'],
    )

    .addEdge('retrieve', 'grade')
    .addEdge('callHrApi', 'grade')

    /**
     * Uma segunda tentativa, e só uma.
     *
     * "Não encontrei" costuma significar "o trecho certo ficou na posição 6",
     * não "a informação não existe". Antes de recusar por falta de
     * fundamentação, a busca roda de novo com alcance maior — mesmo limiar.
     *
     * O ciclo é fechado pela trava `retried`, e o custo cai INTEIRO no caminho
     * da falha: quem já ia sair sem resposta paga um embedding a mais, e o p95
     * de quem seria atendido não muda. Recusa por qualquer outro motivo não
     * tenta de novo — não adianta buscar mais fundo quando falta a matrícula.
     */
    .addConditionalEdges(
      'grade',
      (state: AgentStateType) => {
        if (!state.refused) return 'generateAnswer';
        if (state.refusalReason === 'notGrounded' && !state.retried) return 'retrieveAgain';
        return 'refuse';
      },
      ['generateAnswer', 'refuse', 'retrieveAgain'],
    )
    .addEdge('retrieveAgain', 'grade')

    .addEdge('generateAnswer', END)
    .addEdge('refuse', END)
    .addEdge('meta', END)
    .addEdge('proposeAction', END);

  return graph.compile();
}
