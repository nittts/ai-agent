import type {
  Benefits,
  HoursBank,
  Ticket,
  VacationBalance,
} from '../../application/ports/hr-directory.port';

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

function daysAhead(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString();
}

export const DEMO_EMPLOYEE_ID = 1042;

export const vacationBalances: Record<number, VacationBalance> = {
  1042: {
    employeeId: 1042,
    availableDays: 18,
    accrualPeriodStart: daysAgo(400),
    accrualPeriodEnd: daysAgo(35),
    expiresAt: daysAhead(330),
    daysAlreadySold: 0,
  },
  2077: {
    employeeId: 2077,
    availableDays: 30,
    accrualPeriodStart: daysAgo(380),
    accrualPeriodEnd: daysAgo(15),
    expiresAt: daysAhead(350),
    daysAlreadySold: 0,
  },
};

export const benefits: Record<number, Benefits> = {
  1042: {
    employeeId: 1042,
    healthPlan: { active: true, provider: 'Saúde Brasil', dependents: 1 },
    dentalPlan: { active: false },
    mealAllowanceDaily: 40,
    foodAllowanceMonthly: 600,
    homeOfficeAllowance: 150,
    gym: true,
  },
  2077: {
    employeeId: 2077,
    healthPlan: { active: true, provider: 'Saúde Brasil', dependents: 0 },
    dentalPlan: { active: true },
    mealAllowanceDaily: 40,
    foodAllowanceMonthly: 600,
    homeOfficeAllowance: 150,
    gym: false,
  },
};

export const hoursBanks: Record<number, HoursBank> = {
  1042: {
    employeeId: 1042,
    balanceHours: 24,
    updatedAt: daysAgo(1),
    compensationDeadline: daysAhead(120),
  },
  2077: {
    employeeId: 2077,
    balanceHours: -2,
    updatedAt: daysAgo(2),
    compensationDeadline: daysAhead(150),
  },
};

export const tickets: Record<number, Ticket> = {
  8871: {
    id: 8871,
    employeeId: 1042,
    category: 'access',
    status: 'inProgress',
    title: 'VPN access for international travel',
    openedAt: daysAgo(5),
    slaBusinessDays: 3,
    resolvedAt: null,
  },
  9002: {
    id: 9002,
    employeeId: 1042,
    category: 'software',
    status: 'resolved',
    title: 'IDE licence installation',
    openedAt: daysAgo(10),
    slaBusinessDays: 5,
    resolvedAt: daysAgo(7),
  },
  9105: {
    id: 9105,
    employeeId: 2077,
    category: 'equipment',
    status: 'open',
    title: 'External monitor request',
    openedAt: daysAgo(2),
    slaBusinessDays: 10,
    resolvedAt: null,
  },
};
