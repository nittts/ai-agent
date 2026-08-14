import { Logger } from '@nestjs/common';
import type { Env } from '../config/env';
import type { ChatModelPort } from '../llm/chat-model';
import type { EmbeddingsPort } from '../llm/embeddings';
import type { VectorStorePort } from '../retrieval/types';
import type { Fonte } from '../http/contracts';
import {
  ErroContrato,
  ErroRecursoNaoEncontrado,
  type RhApiClient,
} from '../tools/rh-api.client';
import {
  criarExecutorTools,
  TOOLS_DE_COLABORADOR,
  type NomeTool,
  type ResultadoTool,
} from '../tools/rh.tools';
import { comRetry } from '../tools/resiliencia';
import {
  classificacaoSchema,
  type Classificacao,
  type EstadoAgenteType,
  type MotivoRecusa,
} from './state';
import { montarPromptResposta, RESPOSTAS_RECUSA, SISTEMA_CLASSIFICACAO, SISTEMA_RESPOSTA } from './prompts';

const log = new Logger('AgenteNos');

export interface DependenciasNos {
  env: Env;
  modelo: ChatModelPort;
  embeddings: EmbeddingsPort;
  store: VectorStorePort;
  cliente: RhApiClient;

  aoReceberToken?: (token: string) => void;
}

type Atualizacao = Partial<EstadoAgenteType>;

async function cronometrar<T extends Atualizacao>(
  nome: string,
  fn: () => Promise<T>,
): Promise<T & { tempos: Record<string, number> }> {
  const inicio = Date.now();
  const resultado = await fn();
  return { ...resultado, tempos: { [nome]: Date.now() - inicio } };
}

export function criarNoClassificar(deps: DependenciasNos) {
  return (estado: EstadoAgenteType) =>
    cronometrar('classificar', async (): Promise<Atualizacao> => {
      try {
        const { dados, uso } = await comRetry(
          () =>
            deps.modelo.estruturado<Classificacao>({
              sistema: SISTEMA_CLASSIFICACAO,
              usuario: estado.pergunta,
              schema: classificacaoSchema,
              nomeSchema: 'classificacao',
            }),
          { tentativas: deps.env.LLM_MAX_RETRIES },
        );

        return {
          classificacao: dados,
          rota: dados.rota,
          uso,

          ...(dados.rota === 'out_of_scope'
            ? { recusado: true, motivoRecusa: 'fora_de_escopo' as const }
            : {}),
        };
      } catch (erro) {
        log.warn(
          `Classificação falhou, caindo para a rota kb: ${erro instanceof Error ? erro.message : erro}`,
        );
        return {
          classificacao: { rota: 'kb', ferramentas: [] },
          rota: 'kb',
          degradado: true,
          avisos: ['não foi possível classificar a pergunta; respondida apenas pelas políticas'],
        };
      }
    });
}

export function criarNoRecuperar(deps: DependenciasNos) {
  return (estado: EstadoAgenteType) =>
    cronometrar('recuperar', async (): Promise<Atualizacao> => {
      try {
        const vetor = await deps.embeddings.embedarConsulta(estado.pergunta);
        const docs = deps.store.buscar(vetor, deps.env.RETRIEVAL_TOP_K);

        const fontes: Fonte[] = docs.map((doc) => ({
          tipo: 'documento',
          arquivo: doc.metadata.arquivo,
          secao: doc.metadata.secao,
          chunkId: doc.metadata.chunkId,
          score: Number(doc.score.toFixed(4)),

          trecho: doc.texto.slice(0, 240),
        }));

        return { docs, fontes, melhorScore: docs[0]?.score ?? 0 };
      } catch (erro) {
        log.warn(`Retrieval falhou: ${erro instanceof Error ? erro.message : erro}`);
        return {
          degradado: true,
          avisos: ['base de conhecimento indisponível'],
        };
      }
    });
}

export function criarNoConsultarApi(deps: DependenciasNos) {
  const executarTool = criarExecutorTools(deps.cliente);

  return (estado: EstadoAgenteType) =>
    cronometrar('consultarApi', async (): Promise<Atualizacao> => {
      const classificacao = estado.classificacao;
      const solicitadas = (classificacao?.ferramentas ?? []) as NomeTool[];

      if (solicitadas.length === 0) return {};

      const colaboradorId = classificacao?.colaboradorId;
      const chamadoId = classificacao?.chamadoId;

      const execucoes = solicitadas.map(async (nome) => {
        const precisaColaborador = TOOLS_DE_COLABORADOR.includes(nome);
        const id = precisaColaborador ? colaboradorId : chamadoId;

        if (id === undefined) {
          throw new ErroSemIdentificacao(nome);
        }

        return executarTool(nome, id);
      });

      const desfechos = await Promise.allSettled(execucoes);

      const resultados: ResultadoTool[] = [];
      const fontes: Fonte[] = [];
      const avisos: string[] = [];

      desfechos.forEach((desfecho, indice) => {
        if (desfecho.status === 'fulfilled') {
          resultados.push(desfecho.value);
          fontes.push(desfecho.value.fonte);
          return;
        }

        avisos.push(descreverFalha(solicitadas[indice], desfecho.reason));
      });

      return {
        resultadosTool: resultados,
        fontes,
        avisos,
        degradado: avisos.length > 0,
      };
    });
}

class ErroSemIdentificacao extends Error {
  constructor(public readonly tool: string) {
    super(`Ferramenta ${tool} exige identificação que não foi informada`);
    this.name = 'ErroSemIdentificacao';
  }
}

function descreverFalha(tool: string, erro: unknown): string {
  if (erro instanceof ErroSemIdentificacao) return `${tool}: matrícula ou número não informado`;
  if (erro instanceof ErroRecursoNaoEncontrado) return `${tool}: ${erro.message}`;
  if (erro instanceof ErroContrato) return `${tool}: resposta do sistema de RH em formato inesperado`;
  return `${tool}: sistema de RH indisponível`;
}

export function criarNoAvaliar(deps: DependenciasNos) {
  return (estado: EstadoAgenteType) =>
    cronometrar('avaliar', async (): Promise<Atualizacao> => {
      const temDocsRelevantes =
        estado.docs.length > 0 && estado.melhorScore >= deps.env.RETRIEVAL_MIN_SCORE;
      const temDadosApi = estado.resultadosTool.length > 0;

      if (temDocsRelevantes || temDadosApi) return {};

      const motivo: MotivoRecusa = decidirMotivo(estado);
      return { recusado: true, motivoRecusa: motivo };
    });
}

function decidirMotivo(estado: EstadoAgenteType): MotivoRecusa {
  const precisavaDeId =
    (estado.rota === 'tool' || estado.rota === 'hybrid') &&
    estado.classificacao?.colaboradorId === undefined &&
    estado.classificacao?.chamadoId === undefined;

  if (precisavaDeId) return 'faltou_identificacao';
  if (estado.degradado) return 'fontes_indisponiveis';
  return 'sem_fundamentacao';
}

export function criarNoResponder(deps: DependenciasNos) {
  return (estado: EstadoAgenteType) =>
    cronometrar('responder', async (): Promise<Atualizacao> => {
      try {
        const { texto, uso } = await comRetry(
          () =>
            deps.modelo.gerar({
              sistema: SISTEMA_RESPOSTA,
              usuario: montarPromptResposta(
                estado.pergunta,
                estado.docs,
                estado.resultadosTool,
                estado.avisos,
              ),
              aoReceberToken: deps.aoReceberToken,
            }),
          { tentativas: deps.env.LLM_MAX_RETRIES },
        );

        return { resposta: texto, uso };
      } catch (erro) {
        log.error(`Geração falhou: ${erro instanceof Error ? erro.message : erro}`);
        return {
          recusado: true,
          motivoRecusa: 'fontes_indisponiveis',
          degradado: true,
          avisos: ['modelo de linguagem indisponível'],
        };
      }
    });
}

export function criarNoRecusar() {
  return (estado: EstadoAgenteType) =>
    cronometrar('recusar', async (): Promise<Atualizacao> => {
      const motivo = estado.motivoRecusa ?? 'sem_fundamentacao';
      return {
        recusado: true,
        motivoRecusa: motivo,
        resposta: RESPOSTAS_RECUSA[motivo],

        fontes: [],
      };
    });
}
