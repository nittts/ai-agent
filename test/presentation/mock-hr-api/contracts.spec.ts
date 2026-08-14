import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { hrSchemas } from '../../../src/infrastructure/hr-directory/http-hr-directory';
import {
  benefits,
  hoursBanks,
  tickets,
  vacationBalances,
} from '../../../src/presentation/mock-hr-api/seed';

describe('HR API contracts', () => {
  it('every vacation balance satisfies the schema', () => {
    for (const record of Object.values(vacationBalances)) {
      expect(() => hrSchemas.vacationBalance.parse(record)).not.toThrow();
    }
  });

  it('every benefits package satisfies the schema', () => {
    for (const record of Object.values(benefits)) {
      expect(() => hrSchemas.benefits.parse(record)).not.toThrow();
    }
  });

  it('every hours bank satisfies the schema', () => {
    for (const record of Object.values(hoursBanks)) {
      expect(() => hrSchemas.hoursBank.parse(record)).not.toThrow();
    }
  });

  it('every ticket satisfies the schema', () => {
    for (const record of Object.values(tickets)) {
      expect(() => hrSchemas.ticket.parse(record)).not.toThrow();
    }
  });

  it('rejects a payload with a missing field', () => {
    const { availableDays: _omitted, ...incomplete } = vacationBalances[1042];
    expect(() => hrSchemas.vacationBalance.parse(incomplete)).toThrow();
  });

  it('rejects a payload with the wrong type', () => {
    expect(() =>
      hrSchemas.vacationBalance.parse({ ...vacationBalances[1042], availableDays: '18' }),
    ).toThrow();
  });
});

describe('corpus and seed consistency', () => {
  const read = (file: string) => readFileSync(join(process.cwd(), 'corpus', file), 'utf-8');

  it('the demo employee balance exercises the one-third rule', () => {
    const balance = vacationBalances[1042];
    const policy = read('ferias.md');

    expect(policy).toContain('10 dias');
    expect(policy).toContain('1/3');

    expect(balance.availableDays).toBeGreaterThan(10);
    expect(balance.daysAlreadySold).toBe(0);
  });

  it('ticket 8871 is OUT of SLA, exercising corpus + API together', () => {
    const ticket = tickets[8871];
    const policy = read('acesso-ti.md');

    expect(ticket.category).toBe('access');
    expect(policy).toContain('`acesso`: 3 dias úteis');
    expect(ticket.slaBusinessDays).toBe(3);

    const daysOpen = (Date.now() - new Date(ticket.openedAt).getTime()) / 86_400_000;
    expect(daysOpen).toBeGreaterThan(ticket.slaBusinessDays);
    expect(ticket.status).not.toBe('resolved');
  });

  it('the demo hours bank is convertible into whole days off', () => {
    const bank = hoursBanks[1042];
    const policy = read('ponto-jornada.md');

    expect(policy).toContain('Cada dia de folga consome 8 horas');

    expect(bank.balanceHours).toBe(24);
    expect(bank.balanceHours % 8).toBe(0);
  });

  it('the home-office allowance matches between corpus and API', () => {
    expect(read('beneficios.md')).toContain('R$ 150,00');
    expect(benefits[1042].homeOfficeAllowance).toBe(150);
  });
});
