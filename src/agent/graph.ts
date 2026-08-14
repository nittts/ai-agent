import { END, START, StateGraph } from '@langchain/langgraph';
import { EstadoAgente, type EstadoAgenteType } from './state';
import {
  criarNoAvaliar,
  criarNoClassificar,
  criarNoConsultarApi,
  criarNoRecuperar,
  criarNoRecusar,
  criarNoResponder,
  type DependenciasNos,
} from './nodes';

export function construirGrafo(deps: DependenciasNos) {
  const grafo = new StateGraph(EstadoAgente)
    .addNode('classificar', criarNoClassificar(deps))
    .addNode('recuperar', criarNoRecuperar(deps))
    .addNode('consultarApi', criarNoConsultarApi(deps))
    .addNode('avaliar', criarNoAvaliar(deps))
    .addNode('responder', criarNoResponder(deps))
    .addNode('recusar', criarNoRecusar())

    .addEdge(START, 'classificar')

    .addConditionalEdges(
      'classificar',
      (estado: EstadoAgenteType) => {
        switch (estado.rota) {
          case 'out_of_scope':
            return ['recusar'];
          case 'kb':
            return ['recuperar'];
          case 'tool':
            return ['consultarApi'];
          case 'hybrid':
            return ['recuperar', 'consultarApi'];
        }
      },
      ['recuperar', 'consultarApi', 'recusar'],
    )

    .addEdge('recuperar', 'avaliar')
    .addEdge('consultarApi', 'avaliar')

    .addConditionalEdges(
      'avaliar',
      (estado: EstadoAgenteType) => (estado.recusado ? 'recusar' : 'responder'),
      ['responder', 'recusar'],
    )

    .addEdge('responder', END)
    .addEdge('recusar', END);

  return grafo.compile();
}

export function estadoInicial(pergunta: string): Partial<EstadoAgenteType> {
  return { pergunta };
}
