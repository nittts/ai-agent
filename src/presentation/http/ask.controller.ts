import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { AnswerQuestionUseCase } from '../../application/use-cases/answer-question.use-case';
import { currentCorrelationId, newCorrelationId } from '../../infrastructure/observability/logger';
import type { AskResponse, SseEvent } from './api-contract';
import {
  sanitiseHistory,
  sanitiseFacts,
  type ConversationTurn,
  type SessionFacts,
} from '../../domain/conversation';

const MAX_QUESTION_LENGTH = 2_000;

function validateHistory(value: unknown): ConversationTurn[] {
  if (!Array.isArray(value)) return [];

  return sanitiseHistory(
    value.filter(
      (turn): turn is ConversationTurn =>
        typeof turn === 'object' && turn !== null && 'role' in turn && 'content' in turn,
    ),
  );
}

function validateQuestion(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new BadRequestException({
      error: 'invalid_question',
      message: 'Provide a non-empty question.',
    });
  }

  if (value.length > MAX_QUESTION_LENGTH) {
    throw new BadRequestException({
      error: 'question_too_long',
      message: `The question exceeds ${MAX_QUESTION_LENGTH} characters.`,
    });
  }

  return value.trim();
}

@Controller('ask')
export class AskController {
  constructor(@Inject(AnswerQuestionUseCase) private readonly answerQuestion: AnswerQuestionUseCase) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  async ask(
    @Body() body: { question?: unknown; bypassCache?: unknown; history?: unknown; facts?: unknown; confirmAction?: unknown },
  ): Promise<AskResponse> {
    const correlationId = currentCorrelationId() ?? newCorrelationId();

    const result = await this.answerQuestion.execute(validateQuestion(body?.question), {
      bypassCache: body?.bypassCache === true,
      history: validateHistory(body?.history),
      facts: sanitiseFacts(body?.facts),
      confirmAction: body?.confirmAction,
    });

    return { ...result, correlationId };
  }

  @Get('stream')
  async stream(@Query('q') q: string, @Res() reply: FastifyReply): Promise<void> {
    let question: string;
    try {
      question = validateQuestion(q);
    } catch {
      reply.status(400).send({ error: 'invalid_question', message: 'Provide ?q= with the question.' });
      return;
    }

    await this.streamAnswer(question, [], reply, {});
  }

  @Post('stream')
  async streamPost(
    @Body() body: { question?: unknown; history?: unknown; facts?: unknown; confirmAction?: unknown },
    @Res() reply: FastifyReply,
  ): Promise<void> {
    let question: string;
    try {
      question = validateQuestion(body?.question);
    } catch {
      reply.status(400).send({ error: 'invalid_question', message: 'Provide a question.' });
      return;
    }

    await this.streamAnswer(question, validateHistory(body?.history), reply, sanitiseFacts(body?.facts));
  }

  private async streamAnswer(
    question: string,
    history: ConversationTurn[],
    reply: FastifyReply,
    facts: SessionFacts,
  ): Promise<void> {
    const correlationId = currentCorrelationId() ?? newCorrelationId();

    reply.raw.socket?.setNoDelay(true);

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      'x-correlation-id': correlationId,
    });

    reply.raw.flushHeaders();

    const send = (event: SseEvent): void => {
      if (reply.raw.writableEnded) return;
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    const start = Date.now();
    let ttftMs: number | null = null;

    try {
      const result = await this.answerQuestion.execute(question, {
        history,
        facts,
        onToken: (token) => {
          ttftMs ??= Date.now() - start;
          send({ type: 'token', text: token });
        },
      });

      send({ type: 'sources', sources: result.sources, route: result.route });

      send({
        type: 'done',
        summary: { ...result, timings: { ...result.timings, ttftMs }, correlationId },
      });
    } catch (error) {
      send({
        type: 'error',
        message: error instanceof Error ? error.message : 'Unexpected failure',
        correlationId,
      });
    } finally {
      reply.raw.end();
    }
  }
}
