import { Controller, Get, Inject, Logger } from '@nestjs/common';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';

export interface PerguntaDemo {
  id: string;
  categoria: string;
  texto: string;
  esperado: string;
  docEsperado: string | null;
}

@Controller('demo')
export class DemoController {
  private readonly log = new Logger(DemoController.name);
  private cache: PerguntaDemo[] | null = null;

  constructor(@Inject(ENV) private readonly env: Env) {}

  @Get('perguntas')
  async perguntas(): Promise<{ perguntas: PerguntaDemo[]; chaosDisponivel: boolean }> {
    if (!this.cache) {
      try {
        const caminho = resolve(process.cwd(), 'eval', 'questions.json');
        const conteudo = JSON.parse(await readFile(caminho, 'utf-8')) as {
          perguntas: PerguntaDemo[];
        };
        this.cache = conteudo.perguntas;
      } catch (erro) {
        this.log.warn(
          `Não foi possível ler eval/questions.json: ${erro instanceof Error ? erro.message : erro}`,
        );
        this.cache = [];
      }
    }

    return { perguntas: this.cache, chaosDisponivel: this.env.CHAOS_ENABLED };
  }
}
