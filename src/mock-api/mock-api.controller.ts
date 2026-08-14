import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
} from '@nestjs/common';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { ChaosService, MODOS_CHAOS, type ModoChaos } from './chaos.service';
import { bancosHoras, beneficios, chamados, saldosFerias } from './seed';

@Controller('mock/v1')
export class MockApiController {
  constructor(
    @Inject(ChaosService) private readonly chaos: ChaosService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private async aplicarChaos(): Promise<void> {
    switch (this.chaos.atual()) {
      case 'ok':
        return;
      case '500':
        throw new HttpException(
          { erro: 'falha_interna', mensagem: 'Serviço de RH indisponível (chaos ativo).' },
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      case 'timeout':
        await new Promise((r) => setTimeout(r, this.env.TOOL_TIMEOUT_MS * 3));
        return;
      case 'contrato':

        throw new HttpException({ payloadInesperado: true }, HttpStatus.OK);
    }
  }

  private naoEncontrado(recurso: string, id: number): never {
    throw new NotFoundException({
      erro: 'nao_encontrado',
      mensagem: `${recurso} ${id} não existe na base de RH.`,
    });
  }

  @Get('colaboradores/:id/ferias-saldo')
  async feriasSaldo(@Param('id', ParseIntPipe) id: number) {
    await this.aplicarChaos();
    return saldosFerias[id] ?? this.naoEncontrado('Colaborador', id);
  }

  @Get('colaboradores/:id/beneficios')
  async beneficiosDoColaborador(@Param('id', ParseIntPipe) id: number) {
    await this.aplicarChaos();
    return beneficios[id] ?? this.naoEncontrado('Colaborador', id);
  }

  @Get('colaboradores/:id/banco-horas')
  async bancoHoras(@Param('id', ParseIntPipe) id: number) {
    await this.aplicarChaos();
    return bancosHoras[id] ?? this.naoEncontrado('Colaborador', id);
  }

  @Get('chamados/:id')
  async chamado(@Param('id', ParseIntPipe) id: number) {
    await this.aplicarChaos();
    return chamados[id] ?? this.naoEncontrado('Chamado', id);
  }

  @Get('_chaos')
  estadoChaos() {
    return { habilitado: this.env.CHAOS_ENABLED, modo: this.chaos.atual(), modos: MODOS_CHAOS };
  }

  @Post('_chaos')
  @HttpCode(HttpStatus.OK)
  definirChaos(@Body() body: { modo?: string }) {
    if (!this.env.CHAOS_ENABLED) {
      throw new ForbiddenException({
        erro: 'chaos_desabilitado',
        mensagem: 'CHAOS_ENABLED=false. O interruptor de falha não existe neste ambiente.',
      });
    }

    const modo = body?.modo;
    if (!modo || !MODOS_CHAOS.includes(modo as ModoChaos)) {
      throw new BadRequestException({
        erro: 'modo_invalido',
        mensagem: `modo deve ser um de: ${MODOS_CHAOS.join(', ')}`,
      });
    }

    this.chaos.definir(modo as ModoChaos);
    return { modo: this.chaos.atual() };
  }
}
