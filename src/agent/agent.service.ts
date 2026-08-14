import { Inject, Injectable } from '@nestjs/common';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { EMBEDDINGS, VECTOR_STORE } from '../retrieval/retrieval.module';
import type { EmbeddingsPort } from '../llm/embeddings';
import type { VectorStorePort } from '../retrieval/types';
import { CHAT_MODEL } from '../llm/llm.module';
import type { ChatModelPort } from '../llm/chat-model';
import { RhApiClient } from '../tools/rh-api.client';
import { currentCorrelationId, newCorrelationId } from '../observability/logger';
import type { AskResponse } from '../http/contracts';
import { construirGrafo } from './graph';
import type { EstadoAgenteType } from './state';

export interface OpcoesPergunta {
  aoReceberToken?: (token: string) => void;
}

@Injectable()
export class AgentService {
  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(CHAT_MODEL) private readonly modelo: ChatModelPort,
    @Inject(EMBEDDINGS) private readonly embeddings: EmbeddingsPort,
    @Inject(VECTOR_STORE) private readonly store: VectorStorePort,
    private readonly cliente: RhApiClient,
  ) {}

  async perguntar(pergunta: string, opcoes: OpcoesPergunta = {}): Promise<AskResponse> {
    const inicio = Date.now();
    const correlationId = currentCorrelationId() ?? newCorrelationId();

    const grafo = construirGrafo({
      env: this.env,
      modelo: this.modelo,
      embeddings: this.embeddings,
      store: this.store,
      cliente: this.cliente,
      aoReceberToken: opcoes.aoReceberToken,
    });

    const final = (await grafo.invoke({ pergunta })) as EstadoAgenteType;

    return this.montarResposta(final, inicio, correlationId);
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
      cache: 'OFF',
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
