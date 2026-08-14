import type { BancoHoras, Beneficios, Chamado, SaldoFerias } from './schemas';

function diasAtras(dias: number): string {
  const d = new Date(Date.now() - dias * 24 * 60 * 60 * 1000);
  return d.toISOString();
}

function diasAFrente(dias: number): string {
  const d = new Date(Date.now() + dias * 24 * 60 * 60 * 1000);
  return d.toISOString();
}

export const COLABORADOR_DEMO = 1042;

export const saldosFerias: Record<number, SaldoFerias> = {
  1042: {
    colaboradorId: 1042,
    diasDisponiveis: 18,
    periodoAquisitivoInicio: diasAtras(400),
    periodoAquisitivoFim: diasAtras(35),
    vencimentoEm: diasAFrente(330),
    diasJaVendidos: 0,
  },
  2077: {
    colaboradorId: 2077,
    diasDisponiveis: 30,
    periodoAquisitivoInicio: diasAtras(380),
    periodoAquisitivoFim: diasAtras(15),
    vencimentoEm: diasAFrente(350),
    diasJaVendidos: 0,
  },
};

export const beneficios: Record<number, Beneficios> = {
  1042: {
    colaboradorId: 1042,
    planoSaude: { ativo: true, operadora: 'Saúde Brasil', dependentes: 1 },
    planoOdontologico: { ativo: false },
    valeRefeicaoDiario: 40,
    valeAlimentacaoMensal: 600,
    auxilioHomeOffice: 150,
    gympass: true,
  },
  2077: {
    colaboradorId: 2077,
    planoSaude: { ativo: true, operadora: 'Saúde Brasil', dependentes: 0 },
    planoOdontologico: { ativo: true },
    valeRefeicaoDiario: 40,
    valeAlimentacaoMensal: 600,
    auxilioHomeOffice: 150,
    gympass: false,
  },
};

export const bancosHoras: Record<number, BancoHoras> = {
  1042: {
    colaboradorId: 1042,
    saldoHoras: 24,
    atualizadoEm: diasAtras(1),
    vencimentoCompensacaoEm: diasAFrente(120),
  },
  2077: {
    colaboradorId: 2077,
    saldoHoras: -2,
    atualizadoEm: diasAtras(2),
    vencimentoCompensacaoEm: diasAFrente(150),
  },
};

export const chamados: Record<number, Chamado> = {
  8871: {
    id: 8871,
    colaboradorId: 1042,
    categoria: 'acesso',
    status: 'em_andamento',
    titulo: 'Liberação de VPN para viagem internacional',
    abertoEm: diasAtras(5),
    slaDiasUteis: 3,
    resolvidoEm: null,
  },
  9002: {
    id: 9002,
    colaboradorId: 1042,
    categoria: 'software',
    status: 'resolvido',
    titulo: 'Instalação de licença de IDE',
    abertoEm: diasAtras(10),
    slaDiasUteis: 5,
    resolvidoEm: diasAtras(7),
  },
  9105: {
    id: 9105,
    colaboradorId: 2077,
    categoria: 'equipamento',
    status: 'aberto',
    titulo: 'Solicitação de monitor externo',
    abertoEm: diasAtras(2),
    slaDiasUteis: 10,
    resolvidoEm: null,
  },
};
