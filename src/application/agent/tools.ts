import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { ApiSource } from '../../domain/answer';
import type { HrDirectoryPort } from '../ports/hr-directory.port';

export const employeeArgs = z.object({
  employeeId: z.number().int().describe('Employee number, e.g. 1042'),
});

export const ticketArgs = z.object({
  ticketId: z.number().int().describe('IT ticket number, e.g. 8871'),
});

export interface ToolResult {
  name: string;

  content: string;
  source: ApiSource;
}

export const TOOL_NAMES = [
  'get_vacation_balance',
  'get_benefits',
  'get_hours_bank',
  'get_ticket',
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

export const EMPLOYEE_TOOLS: readonly ToolName[] = [
  'get_vacation_balance',
  'get_benefits',
  'get_hours_bank',
];

function pack(name: string, data: unknown, source: ApiSource, fields: string[]): string {
  const result: ToolResult = {
    name,
    content: JSON.stringify(data),
    source: { ...source, fields },
  };
  return JSON.stringify(result);
}

export function createTools(hr: HrDirectoryPort) {
  return {
    get_vacation_balance: tool(
      async ({ employeeId }) => {
        const { data, source } = await hr.vacationBalance(employeeId);
        return pack('get_vacation_balance', data, source, [
          'availableDays',
          'daysAlreadySold',
          'expiresAt',
        ]);
      },
      {
        name: 'get_vacation_balance',
        description:
          'Looks up an employee’s vacation balance: available days, days already sold, expiry date.',
        schema: employeeArgs,
      },
    ),

    get_benefits: tool(
      async ({ employeeId }) => {
        const { data, source } = await hr.benefits(employeeId);
        return pack('get_benefits', data, source, [
          'healthPlan',
          'mealAllowanceDaily',
          'homeOfficeAllowance',
        ]);
      },
      {
        name: 'get_benefits',
        description:
          'Looks up an employee’s active benefits: health plan, dependents, meal and food allowances, home-office allowance, gym.',
        schema: employeeArgs,
      },
    ),

    get_hours_bank: tool(
      async ({ employeeId }) => {
        const { data, source } = await hr.hoursBank(employeeId);
        return pack('get_hours_bank', data, source, ['balanceHours', 'compensationDeadline']);
      },
      {
        name: 'get_hours_bank',
        description: 'Looks up an employee’s hours-bank balance and its compensation deadline.',
        schema: employeeArgs,
      },
    ),

    get_ticket: tool(
      async ({ ticketId }) => {
        const { data, source } = await hr.ticket(ticketId);
        return pack('get_ticket', data, source, [
          'status',
          'category',
          'openedAt',
          'slaBusinessDays',
        ]);
      },
      {
        name: 'get_ticket',
        description: 'Looks up an IT ticket: status, category, opening date and SLA in business days.',
        schema: ticketArgs,
      },
    ),
  } as const;
}

export function createToolExecutor(hr: HrDirectoryPort) {
  const tools = createTools(hr);

  return async function execute(name: ToolName, id: number): Promise<ToolResult> {
    const raw = await (() => {
      switch (name) {
        case 'get_vacation_balance':
          return tools.get_vacation_balance.invoke({ employeeId: id });
        case 'get_benefits':
          return tools.get_benefits.invoke({ employeeId: id });
        case 'get_hours_bank':
          return tools.get_hours_bank.invoke({ employeeId: id });
        case 'get_ticket':
          return tools.get_ticket.invoke({ ticketId: id });
      }
    })();

    return JSON.parse(raw as string) as ToolResult;
  };
}
