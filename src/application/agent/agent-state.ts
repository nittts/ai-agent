import { Annotation } from '@langchain/langgraph';
import { z } from 'zod';
import type { Route, RefusalReason, Source } from '../../domain/answer';
import {
  mergeFacts,
  type ConversationTurn,
  type PendingAction,
  type SessionFacts,
} from '../../domain/conversation';
import type { SearchResult } from '../../domain/knowledge';
import { addUsage, ZERO_USAGE, type TokenUsage } from '../../domain/cost';
import { TOOL_NAMES, type ToolResult } from './tools';

export const classificationSchema = z.object({
  route: z
    .enum(['kb', 'tool', 'hybrid', 'outOfScope', 'meta', 'unresolvedFollowUp', 'action'])
    .describe(
      'kb: answerable from internal policy alone. tool: needs the employee’s own data. ' +
        'hybrid: needs BOTH a policy rule and personal data. ' +
        'meta: about the assistant itself — a greeting, or what it can do. ' +
        'outOfScope: not an HR/IT topic. ' +
        'unresolvedFollowUp: refers to an earlier turn that is missing or unusable. ' +
        'action: the person wants something DONE — open a ticket, request something — not answered.',
    ),

  metaKind: z
    .enum(['greeting', 'about', 'closing'])
    .optional()
    .describe(
      'Only for the meta route. "greeting" for hello ("olá", "salve", "eae"); ' +
        '"closing" for thanks or sign-off AFTER something was answered; ' +
        '"about" when asking who the assistant is or what it does.',
    ),

  actionCategory: z
    .enum(['access', 'equipment', 'software'])
    .optional()
    .describe('Only for the action route: which ticket category the request belongs to.'),

  actionTitle: z
    .string()
    .optional()
    .describe('Only for the action route: a short title for the ticket, in Portuguese.'),

  standaloneQuestion: z
    .string()
    .describe(
      'The question rewritten to stand on its own, with pronouns and ellipsis resolved ' +
        'from the conversation. With no history, copy the question verbatim.',
    ),
  employeeId: z
    .number()
    .int()
    .optional()
    .describe('Employee number stated in the question. Omit if absent — NEVER invent one.'),
  ticketId: z
    .number()
    .int()
    .optional()
    .describe('Ticket number stated in the question. Omit if absent — NEVER invent one.'),
  tools: z
    .array(z.enum(TOOL_NAMES))
    .default([])
    .describe('Tools required to answer. Empty for the kb, outOfScope and meta routes.'),
  reason: z.string().optional().describe('Short justification when the route is outOfScope.'),
});

export type Classification = z.infer<typeof classificationSchema>;

export const AgentState = Annotation.Root({
  question: Annotation<string>,

  /*
    Fatos da SESSAO, nao da conversa.

    A matricula informada uma vez nao e um turno: e um fato que vale enquanto a
    sessao durar. Guarda-la no historico a fazia expirar junto com a janela de 6
    turnos — "use esse id daqui em diante" parava de valer depois de duas
    perguntas sobre outro assunto, que foi o defeito relatado.
  */
  facts: Annotation<SessionFacts>({
    reducer: (current, next) => mergeFacts(current, next),
    default: () => ({}),
  }),

  history: Annotation<ConversationTurn[]>({
    reducer: (_current, next) => next,
    default: () => [],
  }),

  /**
   * Figures the answer stated that the evidence does not contain, and citations
   * pointing at sources that do not exist. Both are checked deterministically
   * after generation, with no extra model call.
   */
  unverified: Annotation<string[]>({
    reducer: (current, next) => [...current, ...next],
    default: () => [],
  }),

  /** Trava: a busca ampliada roda no máximo uma vez, e o ciclo termina. */
  retried: Annotation<boolean>({
    reducer: (current, next) => current || next,
    default: () => false,
  }),

  /** Ação proposta e ainda não executada; o cliente devolve para confirmar. */
  pendingAction: Annotation<PendingAction | null>({
    reducer: (_current, next) => next,
    default: () => null,
  }),

  recordNotFound: Annotation<boolean>({
    reducer: (current, next) => current || next,
    default: () => false,
  }),

  standaloneQuestion: Annotation<string>({
    reducer: (_current, next) => next,
    default: () => '',
  }),

  route: Annotation<Route>({
    reducer: (_current, next) => next,
    default: () => 'kb' as Route,
  }),

  classification: Annotation<Classification | null>({
    reducer: (_current, next) => next,
    default: () => null,
  }),

  documents: Annotation<SearchResult[]>({
    reducer: (current, next) => (next.length > 0 ? next : current),
    default: () => [],
  }),

  toolResults: Annotation<ToolResult[]>({
    reducer: (current, next) => [...current, ...next],
    default: () => [],
  }),

  usage: Annotation<TokenUsage>({
    reducer: addUsage,
    default: () => ZERO_USAGE,
  }),

  warnings: Annotation<string[]>({
    reducer: (current, next) => [...current, ...next],
    default: () => [],
  }),

  notes: Annotation<string[]>({
    reducer: (current, next) => [...current, ...next],
    default: () => [],
  }),

  degraded: Annotation<boolean>({
    reducer: (current, next) => current || next,
    default: () => false,
  }),

  sources: Annotation<Source[]>({
    reducer: (current, next) => [...current, ...next],
    default: () => [],
  }),

  answer: Annotation<string>({
    reducer: (_current, next) => next,
    default: () => '',
  }),

  refused: Annotation<boolean>({
    reducer: (_current, next) => next,
    default: () => false,
  }),

  refusalReason: Annotation<RefusalReason | null>({
    reducer: (_current, next) => next,
    default: () => null,
  }),

  bestScore: Annotation<number>({
    reducer: (current, next) => Math.max(current, next),
    default: () => 0,
  }),

  timings: Annotation<Record<string, number>>({
    reducer: (current, next) => ({ ...current, ...next }),
    default: () => ({}),
  }),
});

export type AgentStateType = typeof AgentState.State;
