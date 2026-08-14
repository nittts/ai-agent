import { Inject, Injectable, Logger } from '@nestjs/common';
import type { z } from 'zod';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import {
  bancoHorasSchema,
  beneficiosSchema,
  chamadoSchema,
  saldoFeriasSchema,
  type BancoHoras,
  type Beneficios,
  type Chamado,
  type SaldoFerias,
} from '../mock-api/schemas';
import { comRetry, comTimeout } from './resiliencia';

export class ErroRecursoNaoEncontrado extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = 'ErroRecursoNaoEncontrado';
  }
}

export class ErroContrato extends Error {
  constructor(
    public readonly endpoint: string,
    detalhe: string,
  ) {
    super(`Resposta de ${endpoint} não satisfaz o contrato esperado: ${detalhe}`);
    this.name = 'ErroContrato';
  }
}

export interface RespostaApi<T> {
  dados: T;
  endpoint: string;
  latenciaMs: number;
}

@Injectable()
export class RhApiClient {
  private readonly log = new Logger(RhApiClient.name);

  constructor(@Inject(ENV) private readonly env: Env) {}

  private async buscar<T>(caminho: string, schema: z.ZodType<T>): Promise<RespostaApi<T>> {
    const url = `${this.env.MOCK_API_BASE_URL}${caminho}`;
    const endpoint = `GET ${caminho}`;
    const inicio = Date.now();

    const executar = async (): Promise<T> => {
      const resposta = await comTimeout(fetch(url), this.env.TOOL_TIMEOUT_MS);

      if (resposta.status === 404) {
        const corpo = (await resposta.json().catch(() => ({}))) as { mensagem?: string };

        throw new ErroRecursoNaoEncontrado(corpo.mensagem ?? `Recurso não encontrado em ${caminho}`);
      }

      if (!resposta.ok) {
        const erro = new Error(`HTTP ${resposta.status} em ${endpoint}`) as Error & {
          status: number;
        };
        erro.status = resposta.status;
        throw erro;
      }

      const bruto = await resposta.json();
      const validado = schema.safeParse(bruto);

      if (!validado.success) {
        const detalhe = validado.error.issues
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; ');
        throw new ErroContrato(endpoint, detalhe);
      }

      return validado.data;
    };

    const dados = await comRetry(executar, {
      tentativas: this.env.TOOL_MAX_RETRIES,
      aoRepetir: (tentativa, erro) =>
        this.log.warn(
          `Repetindo ${endpoint} (tentativa ${tentativa}): ${erro instanceof Error ? erro.message : erro}`,
        ),
    });

    return { dados, endpoint, latenciaMs: Date.now() - inicio };
  }

  saldoFerias(colaboradorId: number): Promise<RespostaApi<SaldoFerias>> {
    return this.buscar(`/colaboradores/${colaboradorId}/ferias-saldo`, saldoFeriasSchema);
  }

  beneficios(colaboradorId: number): Promise<RespostaApi<Beneficios>> {
    return this.buscar(`/colaboradores/${colaboradorId}/beneficios`, beneficiosSchema);
  }

  bancoHoras(colaboradorId: number): Promise<RespostaApi<BancoHoras>> {
    return this.buscar(`/colaboradores/${colaboradorId}/banco-horas`, bancoHorasSchema);
  }

  chamado(chamadoId: number): Promise<RespostaApi<Chamado>> {
    return this.buscar(`/chamados/${chamadoId}`, chamadoSchema);
  }
}
