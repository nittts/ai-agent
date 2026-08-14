import { END, START, StateGraph } from '@langchain/langgraph';
import { AgentState, type AgentStateType } from './agent-state';
import { createClassifyNode } from './nodes/classify.node';
import { createRetrieveNode } from './nodes/retrieve.node';
import { createCallHrApiNode } from './nodes/call-hr-api.node';
import { createGradeNode } from './nodes/grade.node';
import { createAnswerNode } from './nodes/answer.node';
import { createRefuseNode } from './nodes/refuse.node';
import type { NodeContext } from './nodes/node-context';

export function buildAgentGraph(ctx: NodeContext) {
  const graph = new StateGraph(AgentState)
    .addNode('classify', createClassifyNode(ctx))
    .addNode('retrieve', createRetrieveNode(ctx))
    .addNode('callHrApi', createCallHrApiNode(ctx))
    .addNode('grade', createGradeNode(ctx))
    .addNode('generateAnswer', createAnswerNode(ctx))
    .addNode('refuse', createRefuseNode())

    .addEdge(START, 'classify')

    .addConditionalEdges(
      'classify',
      (state: AgentStateType) => {
        switch (state.route) {
          case 'outOfScope':
            return ['refuse'];
          case 'kb':
            return ['retrieve'];
          case 'tool':
            return ['callHrApi'];
          case 'hybrid':
            return ['retrieve', 'callHrApi'];
        }
      },
      ['retrieve', 'callHrApi', 'refuse'],
    )

    .addEdge('retrieve', 'grade')
    .addEdge('callHrApi', 'grade')

    .addConditionalEdges(
      'grade',
      (state: AgentStateType) => (state.refused ? 'refuse' : 'generateAnswer'),
      ['generateAnswer', 'refuse'],
    )

    .addEdge('generateAnswer', END)
    .addEdge('refuse', END);

  return graph.compile();
}
