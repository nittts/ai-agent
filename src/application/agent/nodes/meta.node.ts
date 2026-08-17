import {
  META_ANSWER,
  META_ANSWER_SHORT,
  META_CLOSING,
  META_GREETING_BACK,
} from '../prompts';
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

export type MetaKind = 'greeting' | 'about' | 'closing' | undefined;

/**
 * Tabela de decisão pura: (tipo, é primeiro contato?) -> texto.
 *
 * Exportada porque é AQUI que mora a garantia, e ela precisa ser testável sem
 * grafo e sem modelo. O classificador escolhe o tipo; o que se faz com o tipo é
 * decisão nossa, e uma saudação não pode virar despedida sob hipótese alguma.
 */
export function metaAnswerFor(kind: MetaKind, primeiroContato: boolean): string {
  if (kind === 'greeting') return primeiroContato ? META_ANSWER : META_GREETING_BACK;

  // Não se encerra uma conversa que ainda não começou.
  if (kind === 'closing' && !primeiroContato) return META_CLOSING;

  return primeiroContato ? META_ANSWER : META_ANSWER_SHORT;
}

function escolherTexto(state: AgentStateType): string {
  const kind = state.classification?.metaKind;
  const primeiroContato = state.history.length === 0;

  return metaAnswerFor(kind, primeiroContato);
}
