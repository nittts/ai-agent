import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  bancoHorasSchema,
  beneficiosSchema,
  chamadoSchema,
  saldoFeriasSchema,
} from '../../src/mock-api/schemas';
import { bancosHoras, beneficios, chamados, saldosFerias } from '../../src/mock-api/seed';

describe('contratos da API mock', () => {
  it('todo saldo de férias satisfaz o schema', () => {
    for (const registro of Object.values(saldosFerias)) {
      expect(() => saldoFeriasSchema.parse(registro)).not.toThrow();
    }
  });

  it('todo pacote de benefícios satisfaz o schema', () => {
    for (const registro of Object.values(beneficios)) {
      expect(() => beneficiosSchema.parse(registro)).not.toThrow();
    }
  });

  it('todo banco de horas satisfaz o schema', () => {
    for (const registro of Object.values(bancosHoras)) {
      expect(() => bancoHorasSchema.parse(registro)).not.toThrow();
    }
  });

  it('todo chamado satisfaz o schema', () => {
    for (const registro of Object.values(chamados)) {
      expect(() => chamadoSchema.parse(registro)).not.toThrow();
    }
  });

  it('rejeita payload com campo faltando', () => {
    const { diasDisponiveis: _omitido, ...incompleto } = saldosFerias[1042];
    expect(() => saldoFeriasSchema.parse(incompleto)).toThrow();
  });

  it('rejeita payload com tipo errado', () => {
    expect(() => saldoFeriasSchema.parse({ ...saldosFerias[1042], diasDisponiveis: '18' })).toThrow();
  });
});

describe('consistência entre corpus e seed', () => {
  const ler = (arquivo: string) => readFileSync(join(process.cwd(), 'corpus', arquivo), 'utf-8');

  it('o saldo do colaborador demo permite exercitar a regra de 1/3', () => {
    const saldo = saldosFerias[1042];
    const politica = ler('ferias.md');

    expect(politica).toContain('10 dias');
    expect(politica).toContain('1/3');

    expect(saldo.diasDisponiveis).toBeGreaterThan(10);
    expect(saldo.diasJaVendidos).toBe(0);
  });

  it('o chamado 8871 está FORA do SLA, exercitando corpus + API juntos', () => {
    const chamado = chamados[8871];
    const politica = ler('acesso-ti.md');

    expect(chamado.categoria).toBe('acesso');
    expect(politica).toContain('`acesso`: 3 dias úteis');
    expect(chamado.slaDiasUteis).toBe(3);

    const diasAberto = (Date.now() - new Date(chamado.abertoEm).getTime()) / 86_400_000;
    expect(diasAberto).toBeGreaterThan(chamado.slaDiasUteis);
    expect(chamado.status).not.toBe('resolvido');
  });

  it('o banco de horas do colaborador demo é convertível em folga pela política', () => {
    const banco = bancosHoras[1042];
    const politica = ler('ponto-jornada.md');

    expect(politica).toContain('Cada dia de folga consome 8 horas');

    expect(banco.saldoHoras).toBe(24);
    expect(banco.saldoHoras % 8).toBe(0);
  });

  it('o auxílio home-office bate entre corpus e API', () => {
    expect(ler('beneficios.md')).toContain('R$ 150,00');
    expect(beneficios[1042].auxilioHomeOffice).toBe(150);
  });
});
