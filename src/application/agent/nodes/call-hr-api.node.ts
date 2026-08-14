import type { Source } from '../../../domain/answer';
import {
  ContractViolationError,
  RecordNotFoundError,
} from '../../ports/hr-directory.port';
import { createToolExecutor, EMPLOYEE_TOOLS, type ToolName, type ToolResult } from '../tools';
import type { AgentStateType } from '../agent-state';
import { timed, type NodeContext, type StatePatch } from './node-context';

class MissingIdentifierError extends Error {
  constructor(public readonly toolName: string) {
    super(`Tool ${toolName} requires an identifier that was not provided`);
    this.name = 'MissingIdentifierError';
  }
}

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

        if (id === undefined) throw new MissingIdentifierError(name);

        return executeTool(name, id);
      });

      const outcomes = await Promise.allSettled(executions);

      const results: ToolResult[] = [];
      const sources: Source[] = [];
      const warnings: string[] = [];

      outcomes.forEach((outcome, index) => {
        if (outcome.status === 'fulfilled') {
          results.push(outcome.value);
          sources.push(outcome.value.source);
          return;
        }
        warnings.push(describeFailure(requested[index], outcome.reason));
      });

      return {
        toolResults: results,
        sources,
        warnings,
        degraded: warnings.length > 0,
      };
    });
}

function describeFailure(toolName: string, error: unknown): string {
  if (error instanceof MissingIdentifierError) return `${toolName}: employee or ticket number not provided`;
  if (error instanceof RecordNotFoundError) return `${toolName}: ${error.message}`;
  if (error instanceof ContractViolationError) return `${toolName}: HR system returned an unexpected format`;
  return `${toolName}: HR system unavailable`;
}
