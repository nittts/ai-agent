import { z } from 'zod';

export const saldoFeriasSchema = z.object({
  colaboradorId: z.number().int(),
  diasDisponiveis: z.number().int().min(0),
  periodoAquisitivoInicio: z.string(),
  periodoAquisitivoFim: z.string(),
  vencimentoEm: z.string(),
  diasJaVendidos: z.number().int().min(0),
});
export type SaldoFerias = z.infer<typeof saldoFeriasSchema>;

export const beneficiosSchema = z.object({
  colaboradorId: z.number().int(),
  planoSaude: z.object({
    ativo: z.boolean(),
    operadora: z.string(),
    dependentes: z.number().int().min(0),
  }),
  planoOdontologico: z.object({ ativo: z.boolean() }),
  valeRefeicaoDiario: z.number(),
  valeAlimentacaoMensal: z.number(),
  auxilioHomeOffice: z.number(),
  gympass: z.boolean(),
});
export type Beneficios = z.infer<typeof beneficiosSchema>;

export const bancoHorasSchema = z.object({
  colaboradorId: z.number().int(),
  saldoHoras: z.number(),
  atualizadoEm: z.string(),
  vencimentoCompensacaoEm: z.string(),
});
export type BancoHoras = z.infer<typeof bancoHorasSchema>;

export const CATEGORIAS_CHAMADO = ['acesso', 'equipamento', 'software'] as const;
export const STATUS_CHAMADO = ['aberto', 'em_andamento', 'resolvido'] as const;

export const chamadoSchema = z.object({
  id: z.number().int(),
  colaboradorId: z.number().int(),
  categoria: z.enum(CATEGORIAS_CHAMADO),
  status: z.enum(STATUS_CHAMADO),
  titulo: z.string(),
  abertoEm: z.string(),

  slaDiasUteis: z.number().int().positive(),
  resolvidoEm: z.string().nullable(),
});
export type Chamado = z.infer<typeof chamadoSchema>;

export const erroSchema = z.object({
  erro: z.string(),
  mensagem: z.string(),
});
