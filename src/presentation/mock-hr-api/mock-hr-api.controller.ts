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
import { ENV } from '../../infrastructure/config/config.module';
import type { Env } from '../../infrastructure/config/env';
import { ChaosService, CHAOS_MODES, type ChaosMode } from './chaos.service';
import { benefits, hoursBanks, tickets, vacationBalances } from './seed';

@Controller('mock/v1')
export class MockHrApiController {
  constructor(
    @Inject(ChaosService) private readonly chaos: ChaosService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private async applyChaos(): Promise<void> {
    switch (this.chaos.current()) {
      case 'ok':
        return;
      case '500':
        throw new HttpException(
          { error: 'internal_failure', message: 'HR system unavailable (chaos active).' },
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      case 'timeout':
        await new Promise((r) => setTimeout(r, this.env.TOOL_TIMEOUT_MS * 3));
        return;
      case 'contract':

        throw new HttpException({ unexpectedPayload: true }, HttpStatus.OK);
    }
  }

  private notFound(resource: string, id: number): never {
    throw new NotFoundException({
      error: 'not_found',
      message: `${resource} ${id} does not exist in the HR system.`,
    });
  }

  @Get('employees/:id/vacation-balance')
  async vacationBalance(@Param('id', ParseIntPipe) id: number) {
    await this.applyChaos();
    return vacationBalances[id] ?? this.notFound('Employee', id);
  }

  @Get('employees/:id/benefits')
  async benefits(@Param('id', ParseIntPipe) id: number) {
    await this.applyChaos();
    return benefits[id] ?? this.notFound('Employee', id);
  }

  @Get('employees/:id/hours-bank')
  async hoursBank(@Param('id', ParseIntPipe) id: number) {
    await this.applyChaos();
    return hoursBanks[id] ?? this.notFound('Employee', id);
  }

  @Get('tickets/:id')
  async ticket(@Param('id', ParseIntPipe) id: number) {
    await this.applyChaos();
    return tickets[id] ?? this.notFound('Ticket', id);
  }

  @Get('_chaos')
  chaosState() {
    return { enabled: this.env.CHAOS_ENABLED, mode: this.chaos.current(), modes: CHAOS_MODES };
  }

  @Post('_chaos')
  @HttpCode(HttpStatus.OK)
  setChaos(@Body() body: { mode?: string }) {
    if (!this.env.CHAOS_ENABLED) {
      throw new ForbiddenException({
        error: 'chaos_disabled',
        message: 'CHAOS_ENABLED=false. The failure switch does not exist in this environment.',
      });
    }

    const mode = body?.mode;
    if (!mode || !CHAOS_MODES.includes(mode as ChaosMode)) {
      throw new BadRequestException({
        error: 'invalid_mode',
        message: `mode must be one of: ${CHAOS_MODES.join(', ')}`,
      });
    }

    this.chaos.set(mode as ChaosMode);
    return { mode: this.chaos.current() };
  }
}
