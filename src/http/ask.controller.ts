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
import { AgentService } from '../agent/agent.service';
import { currentCorrelationId, newCorrelationId } from '../observability/logger';
import type { AskResponse, SseEvent } from './contracts';

const LIMITE_PERGUNTA = 2_000;

function validarPergunta(valor: unknown): string {
  if (typeof valor !== 'string' || valor.trim().length === 0) {
    throw new BadRequestException({
      erro: 'pergunta_invalida',
      mensagem: 'Informe uma pergunta não vazia.',
    });
  }

  if (valor.length > LIMITE_PERGUNTA) {
    throw new BadRequestException({
      erro: 'pergunta_muito_longa',
      mensagem: `A pergunta excede ${LIMITE_PERGUNTA} caracteres.`,
    });
  }

  return valor.trim();
}

@Controller('ask')
export class AskController {
  constructor(@Inject(AgentService) private readonly agente: AgentService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  async perguntar(
    @Body() body: { pergunta?: unknown; ignorarCache?: unknown },
  ): Promise<AskResponse> {
    return this.agente.perguntar(validarPergunta(body?.pergunta), {
      ignorarCache: body?.ignorarCache === true,
    });
  }

  @Get('stream')
  async transmitir(@Query('q') q: string, @Res() reply: FastifyReply): Promise<void> {
    const correlationId = currentCorrelationId() ?? newCorrelationId();

    let pergunta: string;
    try {
      pergunta = validarPergunta(q);
    } catch {
      reply.status(400).send({ erro: 'pergunta_invalida', mensagem: 'Informe ?q= com a pergunta.' });
      return;
    }

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      'x-correlation-id': correlationId,
    });

    const enviar = (evento: SseEvent): void => {
      if (reply.raw.writableEnded) return;
      reply.raw.write(`data: ${JSON.stringify(evento)}\n\n`);
    };

    const inicio = Date.now();
    let ttftMs: number | null = null;

    try {
      const resposta = await this.agente.perguntar(pergunta, {
        aoReceberToken: (token) => {
          ttftMs ??= Date.now() - inicio;
          enviar({ tipo: 'token', texto: token });
        },
      });

      enviar({ tipo: 'fontes', fontes: resposta.fontes, rota: resposta.rota });

      enviar({
        tipo: 'fim',
        resumo: { ...resposta, tempos: { ...resposta.tempos, ttftMs } },
      });
    } catch (erro) {
      enviar({
        tipo: 'erro',
        mensagem: erro instanceof Error ? erro.message : 'Falha inesperada',
        correlationId,
      });
    } finally {
      reply.raw.end();
    }
  }
}
