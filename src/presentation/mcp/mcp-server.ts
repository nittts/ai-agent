import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { z } from 'zod/v4';
import type { AnswerQuestionUseCase } from '../../application/use-cases/answer-question.use-case';

const POLICY_SCHEME = 'hr://policy/';

const answerShape = {
  answer: z.string(),
  route: z.string(),
  refused: z.boolean(),
  refusalReason: z.string().nullable(),

  interpretedAs: z.string().nullable(),
  degraded: z.boolean(),
  warnings: z.array(z.string()),
  notes: z.array(z.string()),
  sources: z.array(
    z.object({
      kind: z.string(),

      label: z.string(),
      detail: z.string(),
    }),
  ),
  cost: z.object({
    inputTokens: z.number(),
    outputTokens: z.number(),
    usd: z.number(),
  }),
  totalMs: z.number(),
};

export interface McpServerOptions {
  answerQuestion: AnswerQuestionUseCase;

  policies: Map<string, string>;
}

export async function loadPolicyIndex(corpusPath: string): Promise<Map<string, string>> {
  const directory = resolve(process.cwd(), corpusPath);
  const files = (await readdir(directory)).filter((f) => f.endsWith('.md')).sort();

  return new Map(files.map((file) => [`${POLICY_SCHEME}${file}`, join(directory, file)]));
}

export function buildMcpServer({ answerQuestion, policies }: McpServerOptions): McpServer {
  const server = new McpServer(
    { name: 'assistente-rh-ti', version: '1.0.0' },
    {
      instructions:
        'Assistente interno de RH e TI. A tool `perguntar_rh` responde em português, ' +
        'fundamentada nas políticas da empresa e nos dados do sistema de RH, sempre citando as fontes. ' +
        'Ela RECUSA perguntas fora do domínio em vez de especular. Para consultar dados pessoais, ' +
        'inclua a matrícula do colaborador na própria pergunta.',
    },
  );

  server.registerTool(
    'perguntar_rh',
    {
      title: 'Perguntar ao assistente de RH/TI',
      description:
        'Responde perguntas sobre políticas internas de RH e TI (férias, benefícios, reembolso, ' +
        'acesso e TI, home-office, ponto e jornada, desligamento) e sobre os dados do colaborador ' +
        'nesses sistemas. A resposta cita as fontes usadas. Perguntas fora desse domínio são recusadas — ' +
        'mas perguntar o que o assistente faz é válido e tem resposta. ' +
        'Para dados pessoais, informe a matrícula na pergunta (ex.: "meu saldo de férias, id 1042").',
      inputSchema: {
        pergunta: z
          .string()
          .min(1)
          .max(2_000)
          .describe('A pergunta, em português, do colaborador.'),

        historico: z
          .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string() }))
          .optional()
          .describe(
            'Turnos anteriores desta conversa, do mais antigo ao mais recente. ' +
              'Envie quando a pergunta se referir a algo já dito (ex.: "e no ano que vem?"). ' +
              'Apenas os últimos turnos são considerados.',
          ),
      },
      outputSchema: answerShape,
    },
    async ({ pergunta, historico }) => {
      if (!pergunta.trim()) {
        return {
          isError: true,
          content: [{ type: 'text' as const, text: 'Informe uma pergunta não vazia.' }],
        };
      }

      const result = await answerQuestion.execute(pergunta, { history: historico ?? [] });

      const structuredContent = {
        answer: result.answer,
        route: result.route,
        refused: result.refused,
        refusalReason: result.refusalReason,
        interpretedAs: result.interpretedAs,
        degraded: result.degraded,
        warnings: result.warnings,
        notes: result.notes,
        sources: result.sources.map((source) =>
          source.kind === 'document'
            ? {
                kind: source.kind,
                label: `${source.file} § ${source.section}`,
                detail: `similaridade ${source.score.toFixed(3)}`,
              }
            : {
                kind: source.kind,
                label: source.endpoint,
                detail: `campos: ${source.fields.join(', ')}`,
              },
        ),
        cost: result.cost,
        totalMs: result.timings.totalMs,
      };

      return {
        content: [{ type: 'text' as const, text: result.answer }],
        structuredContent,
      };
    },
  );

  for (const [uri, path] of policies) {
    const file = uri.slice(POLICY_SCHEME.length);

    server.registerResource(
      file,
      uri,
      {
        title: file,
        description: `Política interna de RH/TI: ${file}`,
        mimeType: 'text/markdown',
      },
      async () => ({
        contents: [{ uri, mimeType: 'text/markdown', text: await readFile(path, 'utf-8') }],
      }),
    );
  }

  return server;
}
