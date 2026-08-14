import { Inject, Injectable } from '@nestjs/common';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { EMBEDDINGS, VECTOR_STORE } from '../retrieval/retrieval.module';
import type { EmbeddingsPort } from '../llm/embeddings';
import type { VectorStorePort } from '../retrieval/types';
import { CHAT_MODEL } from '../llm/llm.module';
import type { ChatModelPort } from '../llm/chat-model';
import { CACHE } from '../cache/cache.module';
import { chaveResposta, type CachePort } from '../cache/cache.port';
import { RhApiClient } from '../tools/rh-api.client';
import { currentCorrelationId, newCorrelationId } from '../observability/logger';
import type { AskResponse } from '../http/contracts';
import { construirGrafo } from './graph';
import type { EstadoAgenteType } from './state';

export interface OpcoesPergunta {
  aoReceberToken?: (token: string) => void;

  ignorarCache?: boolean;
}

type RespostaCacheavel = Omit<AskResponse, 'tempos' | 'correlationId' | 'cache' | 'custo'>;

@Injectable()
export class AgentService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(CHAT_MODEL) private readonly modelo: ChatModelPort,
    @Inject(EMBEDDINGS) private readonly embeddings: EmbeddingsPort,
    @Inject(VECTOR_STORE) private readonly store: VectorStorePort,
    @Inject(CACHE) private readonly cache: CachePort,
    @Inject(RhApiClient) private readonly cliente: RhApiClient,
  ) {}

  async perguntar(pergunta: string, opcoes: OpcoesPergunta = {}): Promise<AskResponse> {
    const inicio = Date.now();
    const correlationId = currentCorrelationId() ?? newCorrelationId();

    const chave = chaveResposta(pergunta, this.modelo.nomeModelo, this.store.corpusVersion());

    if (!opcoes.ignorarCache) {
      const emCache = await this.cache.obter<RespostaCacheavel>(chave);

      if (emCache) {
        opcoes.aoReceberToken?.(emCache.resposta);

        return {
          ...emCache,
          cache: 'HIT',
          tempos: {
            totalMs: Date.now() - inicio,
            ttftMs: null,
            retrievalMs: null,
            llmMs: null,
          },

          custo: { tokensEntrada: 0, tokensSaida: 0, custoUsd: 0 },
          correlationId,
        };
      }
    }

    const grafo = construirGrafo({
      env: this.env,
      modelo: this.modelo,
      embeddings: this.embeddings,
      store: this.store,
      cliente: this.cliente,
      aoReceberToken: opcoes.aoReceberToken,
    });

    const final = (await grafo.invoke({ pergunta })) as EstadoAgenteType;
    const resposta = this.montarResposta(final, inicio, correlationId);

    await this.talvezGravar(chave, final, resposta);

    return resposta;
  }

  private async talvezGravar(
    chave: string,
    estado: EstadoAgenteType,
    resposta: AskResponse,
  ): Promise<void> {
    if (!this.cache.habilitado) return;
    if (estado.degradado) return;
    if (estado.motivoRecusa === 'faltou_identificacao') return;
    if (estado.motivoRecusa === 'fontes_indisponiveis') return;
    if (!resposta.resposta) return;

    if (estado.resultadosTool.length > 0) return;

    await this.cache.gravar<RespostaCacheavel>(
      chave,
      {
        resposta: resposta.resposta,
        rota: resposta.rota,
        fontes: resposta.fontes,
        degradado: false,
        avisos: [],
        recusado: resposta.recusado,
      },
      this.env.CACHE_TTL_SECONDS,
    );
  }

  private montarResposta(
    estado: EstadoAgenteType,
    inicio: number,
    correlationId: string,
  ): AskResponse {
    const tempos = estado.tempos ?? {};

    const custoUsd =
      (estado.uso.entrada / 1_000_000) * this.env.COST_PER_1M_INPUT_USD +
      (estado.uso.saida / 1_000_000) * this.env.COST_PER_1M_OUTPUT_USD;

    return {
      resposta: estado.resposta,
      rota: estado.rota,
      fontes: estado.fontes,
      degradado: estado.degradado,
      avisos: estado.avisos,
      recusado: estado.recusado,
      cache: this.cache.habilitado ? 'MISS' : 'OFF',
      tempos: {
        totalMs: Date.now() - inicio,
        ttftMs: null,
        retrievalMs: tempos.recuperar ?? null,

        llmMs: (tempos.classificar ?? 0) + (tempos.responder ?? 0) || null,
      },
      custo: {
        tokensEntrada: estado.uso.entrada,
        tokensSaida: estado.uso.saida,
        custoUsd: Number(custoUsd.toFixed(6)),
      },
      correlationId,
    };
  }
}
