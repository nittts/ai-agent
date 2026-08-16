import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { FastifyInstance } from 'fastify';
import type { AnswerQuestionUseCase } from '../../application/use-cases/answer-question.use-case';
import { buildMcpServer, loadPolicyIndex } from './mcp-server';

export async function registerMcp(
  fastify: FastifyInstance,
  options: { answerQuestion: AnswerQuestionUseCase; corpusPath: string },
): Promise<void> {
  const policies = await loadPolicyIndex(options.corpusPath);

  const handle = async (request: { raw: unknown; body?: unknown }, reply: { raw: unknown; hijack: () => void }) => {
    const server = buildMcpServer({ answerQuestion: options.answerQuestion, policies });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

    reply.hijack();
    (reply.raw as { on: (e: string, f: () => void) => void }).on('close', () => {
      void transport.close();
      void server.close();
    });

    await server.connect(transport);
    await transport.handleRequest(
      request.raw as never,
      reply.raw as never,
      (request as { body?: unknown }).body,
    );
  };

  fastify.post('/mcp', handle as never);
  fastify.get('/mcp', handle as never);
  fastify.delete('/mcp', handle as never);
}
