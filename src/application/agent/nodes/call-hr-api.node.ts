import type { Source } from '../../../domain/answer';
import {
  ContractViolationError,
  RecordNotFoundError,
} from '../../ports/hr-directory.port';
import { createToolExecutor, EMPLOYEE_TOOLS, type ToolName, type ToolResult } from '../tools';
import type { AgentStateType } from '../agent-state';
import { timed, type NodeContext, type StatePatch } from './node-context';

class MissingIdentifierError extends Error {
  constructor(
    public readonly toolName: string,
    public readonly dataLabel: string,
  ) {
    super(`Tool ${toolName} requires an identifier that was not provided`);
    this.name = 'MissingIdentifierError';
  }
}

const DATA_LABEL: Record<string, string> = {
  get_vacation_balance: 'seu saldo de férias',
  get_benefits: 'seus benefícios',
  get_hours_bank: 'seu saldo de banco de horas',
  get_ticket: 'os dados do chamado',
};

export function createCallHrApiNode(ctx: NodeContext) {
  const executeTool = createToolExecutor(ctx.hr);

  return (state: AgentStateType) =>
    timed('callHrApi', async (): Promise<StatePatch> => {
      const classification = state.classification;
      const requested = (classification?.tools ?? []) as ToolName[];

      if (requested.length === 0) return {};

      const employeeId = classification?.employeeId;
      const ticketId = classification?.ticketId;

      const executions = requested.map(async (name) => {
        const needsEmployee = EMPLOYEE_TOOLS.includes(name);
        const id = needsEmployee ? employeeId : ticketId;

        if (id === undefined) {
          throw new MissingIdentifierError(name, DATA_LABEL[name] ?? 'esse dado');
        }

        return executeTool(name, id);
      });

      const outcomes = await Promise.allSettled(executions);

      const results: ToolResult[] = [];
      const sources: Source[] = [];
      const warnings: string[] = [];
      const notes: string[] = [];

      outcomes.forEach((outcome, index) => {
        if (outcome.status === 'fulfilled') {
          results.push(outcome.value);
          sources.push(outcome.value.source);
          return;
        }

        if (outcome.reason instanceof MissingIdentifierError) {
          notes.push(
            `Não consultei ${outcome.reason.dataLabel} porque a matrícula não foi informada.`,
          );
          return;
        }

        warnings.push(describeFailure(requested[index], outcome.reason));
      });

      return {
        toolResults: results,
        sources,
        warnings,
        notes,

        degraded: warnings.length > 0,
      };
    });
}

function describeFailure(toolName: string, error: unknown): string {
  const label = DATA_LABEL[toolName] ?? 'esse dado';

  if (error instanceof RecordNotFoundError) return `${label}: ${error.message}`;
  if (error instanceof ContractViolationError) {
    return `não consegui ler ${label}: o sistema de RH respondeu em formato inesperado`;
  }
  return `não consegui consultar ${label}: o sistema de RH não respondeu`;
}
