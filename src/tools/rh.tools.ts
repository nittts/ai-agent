import { tool } from '@langchain/core/tools';
import { z } from 'zod';
import type { RhApiClient } from './rh-api.client';
import type { FonteApi } from '../http/contracts';

export const argsColaborador = z.object({
  colaboradorId: z.number().int().describe('Matrícula do colaborador, ex.: 1042'),
});

export const argsChamado = z.object({
  chamadoId: z.number().int().describe('Número do chamado de TI, ex.: 8871'),
});

export interface ResultadoTool {
  nome: string;

  conteudo: string;
  fonte: FonteApi;
}

export const NOMES_TOOLS = [
  'consultar_saldo_ferias',
  'consultar_beneficios',
  'consultar_banco_horas',
  'consultar_chamado',
] as const;
export type NomeTool = (typeof NOMES_TOOLS)[number];

export const TOOLS_DE_COLABORADOR: readonly NomeTool[] = [
  'consultar_saldo_ferias',
  'consultar_beneficios',
  'consultar_banco_horas',
];

export function criarTools(cliente: RhApiClient) {
  const consultarSaldoFerias = tool(
    async ({ colaboradorId }) => {
      const { dados, endpoint, latenciaMs } = await cliente.saldoFerias(colaboradorId);
      return montar('consultar_saldo_ferias', dados, endpoint, latenciaMs, [
        'diasDisponiveis',
        'diasJaVendidos',
        'vencimentoEm',
      ]);
    },
    {
      name: 'consultar_saldo_ferias',
      description:
        'Consulta o saldo de férias de um colaborador: dias disponíveis, dias já vendidos e data de vencimento.',
      schema: argsColaborador,
    },
  );

  const consultarBeneficios = tool(
    async ({ colaboradorId }) => {
      const { dados, endpoint, latenciaMs } = await cliente.beneficios(colaboradorId);
      return montar('consultar_beneficios', dados, endpoint, latenciaMs, [
        'planoSaude',
        'valeRefeicaoDiario',
        'auxilioHomeOffice',
      ]);
    },
    {
      name: 'consultar_beneficios',
      description:
        'Consulta os benefícios ativos de um colaborador: plano de saúde, dependentes, VR, VA, auxílio home-office e Gympass.',
      schema: argsColaborador,
    },
  );

  const consultarBancoHoras = tool(
    async ({ colaboradorId }) => {
      const { dados, endpoint, latenciaMs } = await cliente.bancoHoras(colaboradorId);
      return montar('consultar_banco_horas', dados, endpoint, latenciaMs, [
        'saldoHoras',
        'vencimentoCompensacaoEm',
      ]);
    },
    {
      name: 'consultar_banco_horas',
      description: 'Consulta o saldo do banco de horas de um colaborador e o prazo de compensação.',
      schema: argsColaborador,
    },
  );

  const consultarChamado = tool(
    async ({ chamadoId }) => {
      const { dados, endpoint, latenciaMs } = await cliente.chamado(chamadoId);
      return montar('consultar_chamado', dados, endpoint, latenciaMs, [
        'status',
        'categoria',
        'abertoEm',
        'slaDiasUteis',
      ]);
    },
    {
      name: 'consultar_chamado',
      description:
        'Consulta um chamado de TI: status, categoria, data de abertura e SLA em dias úteis.',
      schema: argsChamado,
    },
  );

  return {
    consultar_saldo_ferias: consultarSaldoFerias,
    consultar_beneficios: consultarBeneficios,
    consultar_banco_horas: consultarBancoHoras,
    consultar_chamado: consultarChamado,
  } as const;
}

export function criarExecutorTools(cliente: RhApiClient) {
  const tools = criarTools(cliente);

  return async function executar(nome: NomeTool, id: number): Promise<ResultadoTool> {
    const bruto = await (() => {
      switch (nome) {
        case 'consultar_saldo_ferias':
          return tools.consultar_saldo_ferias.invoke({ colaboradorId: id });
        case 'consultar_beneficios':
          return tools.consultar_beneficios.invoke({ colaboradorId: id });
        case 'consultar_banco_horas':
          return tools.consultar_banco_horas.invoke({ colaboradorId: id });
        case 'consultar_chamado':
          return tools.consultar_chamado.invoke({ chamadoId: id });
      }
    })();

    return JSON.parse(bruto as string) as ResultadoTool;
  };
}

function montar(
  nome: string,
  dados: unknown,
  endpoint: string,
  latenciaMs: number,
  campos: string[],
): string {
  const resultado: ResultadoTool = {
    nome,
    conteudo: JSON.stringify(dados),
    fonte: { tipo: 'api', endpoint, campos, latenciaMs },
  };
  return JSON.stringify(resultado);
}
