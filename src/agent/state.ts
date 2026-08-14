import { Annotation } from '@langchain/langgraph';
import { z } from 'zod';
import type { SearchResult } from '../retrieval/types';
import type { Fonte, Rota } from '../http/contracts';
import { somarUso, USO_ZERO, type UsoTokens } from '../llm/chat-model';
import type { ResultadoTool } from '../tools/rh.tools';
import { NOMES_TOOLS } from '../tools/rh.tools';

export const classificacaoSchema = z.object({
  rota: z
    .enum(['kb', 'tool', 'hybrid', 'out_of_scope'])
    .describe(
      'kb: responde só com políticas internas. tool: precisa de dado pessoal do colaborador. ' +
        'hybrid: precisa de política E dado pessoal. out_of_scope: fora do domínio de RH/TI.',
    ),
  colaboradorId: z
    .number()
    .int()
    .optional()
    .describe('Matrícula citada na pergunta. Omitir se não houver — NUNCA inventar.'),
  chamadoId: z
    .number()
    .int()
    .optional()
    .describe('Número do chamado citado na pergunta. Omitir se não houver — NUNCA inventar.'),
  ferramentas: z
    .array(z.enum(NOMES_TOOLS))
    .default([])
    .describe('Ferramentas necessárias para responder. Vazio nas rotas kb e out_of_scope.'),
  motivo: z.string().optional().describe('Justificativa curta quando a rota for out_of_scope.'),
});

export type Classificacao = z.infer<typeof classificacaoSchema>;

export type MotivoRecusa =
  | 'fora_de_escopo'
  | 'sem_fundamentacao'
  | 'faltou_identificacao'
  | 'fontes_indisponiveis';

export const EstadoAgente = Annotation.Root({
  pergunta: Annotation<string>,

  rota: Annotation<Rota>({
    reducer: (_atual, novo) => novo,
    default: () => 'kb' as Rota,
  }),

  classificacao: Annotation<Classificacao | null>({
    reducer: (_atual, novo) => novo,
    default: () => null,
  }),

  docs: Annotation<SearchResult[]>({
    reducer: (atual, novo) => (novo.length > 0 ? novo : atual),
    default: () => [],
  }),

  resultadosTool: Annotation<ResultadoTool[]>({
    reducer: (atual, novo) => [...atual, ...novo],
    default: () => [],
  }),

  uso: Annotation<UsoTokens>({
    reducer: somarUso,
    default: () => USO_ZERO,
  }),

  avisos: Annotation<string[]>({
    reducer: (atual, novo) => [...atual, ...novo],
    default: () => [],
  }),

  degradado: Annotation<boolean>({
    reducer: (atual, novo) => atual || novo,
    default: () => false,
  }),

  fontes: Annotation<Fonte[]>({
    reducer: (atual, novo) => [...atual, ...novo],
    default: () => [],
  }),

  resposta: Annotation<string>({
    reducer: (_atual, novo) => novo,
    default: () => '',
  }),

  recusado: Annotation<boolean>({
    reducer: (_atual, novo) => novo,
    default: () => false,
  }),

  motivoRecusa: Annotation<MotivoRecusa | null>({
    reducer: (_atual, novo) => novo,
    default: () => null,
  }),

  melhorScore: Annotation<number>({
    reducer: (atual, novo) => Math.max(atual, novo),
    default: () => 0,
  }),

  tempos: Annotation<Record<string, number>>({
    reducer: (atual, novo) => ({ ...atual, ...novo }),
    default: () => ({}),
  }),
});

export type EstadoAgenteType = typeof EstadoAgente.State;
