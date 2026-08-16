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
