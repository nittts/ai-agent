import type { AgentStateType } from '../agent-state';
import { REFUSAL_MESSAGES } from '../prompts';
import { timed, type StatePatch } from './node-context';

const CATEGORIA_EM_PORTUGUES: Record<string, string> = {
  access: 'acesso',
  equipment: 'equipamento',
  software: 'software',
};

const SLA: Record<string, number> = { access: 3, equipment: 10, software: 5 };

/**
 * NÓ 8 — propõe uma ação. NUNCA executa. ZERO chamadas ao modelo.
 *
 * A escrita acontece no turno seguinte, a partir desta proposta devolvida pelo
 * cliente. Duas razões para separar:
 *
 * 1. Abrir um chamado por engano é pior que não abrir. Um pedido mal
 *    interpretado vira um registro que alguém tem que fechar.
 * 2. O texto que a pessoa lê e o que será executado são o MESMO objeto. Um
 *    "sim" não reabre a interpretação — se reabrisse, o agente poderia
 *    executar algo diferente do que mostrou.
 */
export function createProposeActionNode() {
  return (state: AgentStateType) =>
    timed('proposeAction', async (): Promise<StatePatch> => {
      const employeeId = state.classification?.employeeId ?? state.facts.employeeId;
      const category = state.classification?.actionCategory;
      const title = state.classification?.actionTitle?.trim();

      if (employeeId === undefined) {
        return {
          refused: true,
          refusalReason: 'missingIdentification',
          answer: REFUSAL_MESSAGES.missingIdentification,
          sources: [],
        };
      }

      if (!category || !title) {
        return {
          refused: true,
          refusalReason: 'notGrounded',
          answer:
            'Consigo abrir o chamado, mas preciso saber sobre o quê. Descreva o problema em uma frase — por exemplo: "meu notebook não liga".',
          sources: [],
        };
      }

      return {
        refused: false,
        sources: [],
        pendingAction: { kind: 'open_ticket', employeeId, category, title },
        answer:
          `Posso abrir este chamado para você:\n\n` +
          `- Assunto: ${title}\n` +
          `- Categoria: ${CATEGORIA_EM_PORTUGUES[category]}\n` +
          `- Prazo de atendimento: ${SLA[category]} dias úteis\n` +
          `- Matrícula: ${employeeId}\n\n` +
          `Confirma? Nada foi aberto ainda.`,
      };
    });
}
