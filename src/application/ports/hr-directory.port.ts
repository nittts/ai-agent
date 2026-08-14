import type { ApiSource } from '../../domain/answer';

export interface VacationBalance {
  employeeId: number;
  availableDays: number;
  accrualPeriodStart: string;
  accrualPeriodEnd: string;
  expiresAt: string;
  daysAlreadySold: number;
}

export interface Benefits {
  employeeId: number;
  healthPlan: { active: boolean; provider: string; dependents: number };
  dentalPlan: { active: boolean };
  mealAllowanceDaily: number;
  foodAllowanceMonthly: number;
  homeOfficeAllowance: number;
  gym: boolean;
}

export interface HoursBank {
  employeeId: number;
  balanceHours: number;
  updatedAt: string;
  compensationDeadline: string;
}

export const TICKET_CATEGORIES = ['access', 'equipment', 'software'] as const;
export const TICKET_STATUSES = ['open', 'inProgress', 'resolved'] as const;

export interface Ticket {
  id: number;
  employeeId: number;
  category: (typeof TICKET_CATEGORIES)[number];
  status: (typeof TICKET_STATUSES)[number];
  title: string;
  openedAt: string;

  slaBusinessDays: number;
  resolvedAt: string | null;
}

export interface HrResponse<T> {
  data: T;
  source: ApiSource;
}

export interface HrDirectoryPort {
  vacationBalance(employeeId: number): Promise<HrResponse<VacationBalance>>;
  benefits(employeeId: number): Promise<HrResponse<Benefits>>;
  hoursBank(employeeId: number): Promise<HrResponse<HoursBank>>;
  ticket(ticketId: number): Promise<HrResponse<Ticket>>;
}

export const HR_DIRECTORY = Symbol('HR_DIRECTORY');

export class RecordNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RecordNotFoundError';
  }
}

export class ContractViolationError extends Error {
  constructor(
    public readonly endpoint: string,
    detail: string,
  ) {
    super(`Response from ${endpoint} does not satisfy the expected contract: ${detail}`);
    this.name = 'ContractViolationError';
  }
}
