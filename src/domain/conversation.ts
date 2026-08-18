export interface ConversationTurn {
  role: 'user' | 'assistant';
  content: string;
}

export const MAX_HISTORY_TURNS = 6;

export const MAX_TURN_CHARS = 600;

export function sanitiseHistory(turns: readonly ConversationTurn[]): ConversationTurn[] {
  return turns
    .filter((turn) => typeof turn?.content === 'string' && turn.content.trim().length > 0)
    .filter((turn) => turn.role === 'user' || turn.role === 'assistant')
    .slice(-MAX_HISTORY_TURNS)
    .map((turn) => ({ role: turn.role, content: turn.content.trim().slice(0, MAX_TURN_CHARS) }));
}

export function formatHistory(turns: readonly ConversationTurn[]): string {
  if (turns.length === 0) return '';

  return turns
    .map((turn) => `${turn.role === 'user' ? 'Usuário' : 'Assistente'}: ${turn.content}`)
    .join('\n');
}

export interface SessionFacts {
  employeeId?: number;
}

export function mergeFacts(current: SessionFacts, learned: SessionFacts): SessionFacts {
  return { ...current, ...Object.fromEntries(Object.entries(learned).filter(([, v]) => v !== undefined)) };
}

export function sanitiseFacts(value: unknown): SessionFacts {
  if (typeof value !== 'object' || value === null) return {};

  const id = (value as SessionFacts).employeeId;
  return Number.isInteger(id) && (id as number) > 0 ? { employeeId: id } : {};
}

/**
 * Uma ação PROPOSTA, ainda não executada.
 *
 * O agente descreve o que faria; quem executa é o turno seguinte, com esta
 * estrutura devolvida INTACTA pelo cliente. Confirmar não reabre a
 * interpretação: o que roda é o que foi mostrado na tela, não algo re-inferido
 * a partir de um "sim".
 */
export interface PendingAction {
  kind: 'open_ticket';
  employeeId: number;
  category: 'access' | 'equipment' | 'software';
  title: string;
}

const CATEGORIAS: PendingAction['category'][] = ['access', 'equipment', 'software'];

export function sanitiseAction(value: unknown): PendingAction | undefined {
  if (typeof value !== 'object' || value === null) return undefined;

  const a = value as PendingAction;
  const valida =
    a.kind === 'open_ticket' &&
    Number.isInteger(a.employeeId) &&
    a.employeeId > 0 &&
    CATEGORIAS.includes(a.category) &&
    typeof a.title === 'string' &&
    a.title.trim().length > 0;

  return valida
    ? { kind: 'open_ticket', employeeId: a.employeeId, category: a.category, title: a.title.trim().slice(0, 120) }
    : undefined;
}
