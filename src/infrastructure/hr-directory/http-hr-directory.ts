import { Inject, Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import {
  ContractViolationError,
  RecordNotFoundError,
  TICKET_CATEGORIES,
  TICKET_STATUSES,
  type Benefits,
  type HoursBank,
  type HrDirectoryPort,
  type HrResponse,
  type Ticket,
  type VacationBalance,
  type OpenTicketInput,
} from '../../application/ports/hr-directory.port';
import { withRetry, withTimeout } from '../../shared/resilience';

const vacationBalanceSchema = z.object({
  employeeId: z.number().int(),
  availableDays: z.number().int().min(0),
  accrualPeriodStart: z.string(),
  accrualPeriodEnd: z.string(),
  expiresAt: z.string(),
  daysAlreadySold: z.number().int().min(0),
});

const benefitsSchema = z.object({
  employeeId: z.number().int(),
  healthPlan: z.object({
    active: z.boolean(),
    provider: z.string(),
    dependents: z.number().int().min(0),
  }),
  dentalPlan: z.object({ active: z.boolean() }),
  mealAllowanceDaily: z.number(),
  foodAllowanceMonthly: z.number(),
  homeOfficeAllowance: z.number(),
  gym: z.boolean(),
});

const hoursBankSchema = z.object({
  employeeId: z.number().int(),
  balanceHours: z.number(),
  updatedAt: z.string(),
  compensationDeadline: z.string(),
});

const ticketSchema = z.object({
  id: z.number().int(),
  employeeId: z.number().int(),
  category: z.enum(TICKET_CATEGORIES),
  status: z.enum(TICKET_STATUSES),
  title: z.string(),
  openedAt: z.string(),
  slaBusinessDays: z.number().int().positive(),
  resolvedAt: z.string().nullable(),
});

export const hrSchemas = {
  vacationBalance: vacationBalanceSchema,
  benefits: benefitsSchema,
  hoursBank: hoursBankSchema,
  ticket: ticketSchema,
};

@Injectable()
export class HttpHrDirectory implements HrDirectoryPort {
  private readonly log = new Logger(HttpHrDirectory.name);

  constructor(@Inject(ENV) private readonly env: Env) {}

  private async fetchResource<T>(path: string, schema: z.ZodType<T>): Promise<HrResponse<T>> {
    const url = `${this.env.HR_API_BASE_URL}${path}`;
    const endpoint = `GET ${path}`;
    const start = Date.now();

    const attempt = async (): Promise<T> => {
      const response = await withTimeout(fetch(url), this.env.TOOL_TIMEOUT_MS);

      if (response.status === 404) {
        const body = (await response.json().catch(() => ({}))) as { message?: string };

        throw new RecordNotFoundError(body.message ?? `Resource not found at ${path}`);
      }

      if (!response.ok) {
        const error = new Error(`HTTP ${response.status} on ${endpoint}`) as Error & {
          status: number;
        };
        error.status = response.status;
        throw error;
      }

      const parsed = schema.safeParse(await response.json());

      if (!parsed.success) {
        const detail = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
        throw new ContractViolationError(endpoint, detail);
      }

      return parsed.data;
    };

    const data = await withRetry(attempt, {
      attempts: this.env.TOOL_MAX_RETRIES,
      onRetry: (n, error) =>
        this.log.warn(
          `Retrying ${endpoint} (attempt ${n}): ${error instanceof Error ? error.message : error}`,
        ),
    });

    return {
      data,
      source: { kind: 'api', endpoint, fields: [], latencyMs: Date.now() - start },
    };
  }

  /**
   * A unica escrita do adaptador, e ela NAO tem retry.
   *
   * Reenviar um POST que talvez tenha funcionado abre dois chamados para o
   * mesmo pedido — e o usuario so descobre depois. Sem idempotency key do lado
   * do RH, falhar uma vez e avisar e melhor que tentar de novo as cegas.
   */
  async openTicket(input: OpenTicketInput): Promise<HrResponse<Ticket>> {
    const endpoint = 'POST /tickets';
    const start = Date.now();

    const response = await withTimeout(
      fetch(`${this.env.HR_API_BASE_URL}/tickets`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(input),
      }),
      this.env.TOOL_TIMEOUT_MS,
    );

    if (!response.ok) {
      const error = new Error(`HTTP ${response.status} on ${endpoint}`) as Error & { status: number };
      error.status = response.status;
      throw error;
    }

    const parsed = ticketSchema.safeParse(await response.json());
    if (!parsed.success) {
      throw new ContractViolationError(endpoint, 'resposta de criação fora do contrato');
    }

    return {
      data: parsed.data,
      source: { kind: 'api', endpoint, fields: ['id', 'status', 'slaBusinessDays'], latencyMs: Date.now() - start },
    };
  }

  vacationBalance(employeeId: number): Promise<HrResponse<VacationBalance>> {
    return this.fetchResource(`/employees/${employeeId}/vacation-balance`, vacationBalanceSchema);
  }

  benefits(employeeId: number): Promise<HrResponse<Benefits>> {
    return this.fetchResource(`/employees/${employeeId}/benefits`, benefitsSchema);
  }

  hoursBank(employeeId: number): Promise<HrResponse<HoursBank>> {
    return this.fetchResource(`/employees/${employeeId}/hours-bank`, hoursBankSchema);
  }

  ticket(ticketId: number): Promise<HrResponse<Ticket>> {
    return this.fetchResource(`/tickets/${ticketId}`, ticketSchema);
  }
}
