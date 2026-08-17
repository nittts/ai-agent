import { Annotation } from '@langchain/langgraph';
import { z } from 'zod';
import type { Route, RefusalReason, Source } from '../../domain/answer';
import type { ConversationTurn } from '../../domain/conversation';
import type { SearchResult } from '../../domain/knowledge';
import { addUsage, ZERO_USAGE, type TokenUsage } from '../../domain/cost';
import { TOOL_NAMES, type ToolResult } from './tools';

export const classificationSchema = z.object({
  route: z
    .enum(['kb', 'tool', 'hybrid', 'outOfScope', 'meta', 'unresolvedFollowUp'])
    .describe(
      'kb: answerable from internal policy alone. tool: needs the employee’s own data. ' +
        'hybrid: needs BOTH a policy rule and personal data. ' +
        'meta: about the assistant itself — a greeting, or what it can do. ' +
        'outOfScope: not an HR/IT topic. ' +
        'unresolvedFollowUp: refers to an earlier turn that is missing or unusable.',
    ),

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

  history: Annotation<ConversationTurn[]>({
    reducer: (_current, next) => next,
    default: () => [],
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
