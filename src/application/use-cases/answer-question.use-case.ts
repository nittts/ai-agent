import { createHash } from 'node:crypto';
import type { Route, RefusalReason, Source } from '../../domain/answer';
import { computeCost, type Cost, type PricePerMillionTokens } from '../../domain/cost';
import type { ChatModelPort } from '../ports/chat-model.port';
import type { EmbeddingsPort } from '../ports/embeddings.port';
import type { VectorStorePort } from '../ports/vector-store.port';
import type { CachePort } from '../ports/cache.port';
import type { HrDirectoryPort } from '../ports/hr-directory.port';
import { buildAgentGraph } from '../agent/agent-graph';
import type { AgentStateType } from '../agent/agent-state';

export interface AnswerQuestionSettings {
  topK: number;
  minScore: number;
  llmTimeoutMs: number;
  llmMaxRetries: number;
  requestDeadlineMs: number;
  cacheTtlSeconds: number;
  price: PricePerMillionTokens;
}

export interface AskOptions {
  onToken?: (token: string) => void;

  bypassCache?: boolean;
}

export interface Timings {
  totalMs: number;

  ttftMs: number | null;
  retrievalMs: number | null;
  llmMs: number | null;

  perNode: Record<string, number> | null;
}

export interface AnswerResult {
  answer: string;
  route: Route;
  sources: Source[];
  degraded: boolean;

  warnings: string[];

  notes: string[];
  refused: boolean;
  refusalReason: RefusalReason | null;
  cache: 'HIT' | 'MISS' | 'OFF';
  timings: Timings;
  cost: Cost;
}

type CacheableAnswer = Pick<
  AnswerResult,
  'answer' | 'route' | 'sources' | 'refused' | 'refusalReason'
>;

export function normaliseQuestion(question: string): string {
  return question
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/[?!.\s]+$/, '');
}

export function answerCacheKey(question: string, model: string, corpusVersion: string): string {
  const digest = createHash('sha256')
    .update(normaliseQuestion(question))
    .update('\0')
    .update(model)
    .update('\0')
    .update(corpusVersion)
    .digest('hex');

  return `answer:${digest.slice(0, 32)}`;
}

export class AnswerQuestionUseCase {
  constructor(
    private readonly model: ChatModelPort,
    private readonly embeddings: EmbeddingsPort,
    private readonly vectorStore: VectorStorePort,
    private readonly hr: HrDirectoryPort,
    private readonly cache: CachePort,
    private readonly settings: AnswerQuestionSettings,
  ) {}

  async execute(question: string, options: AskOptions = {}): Promise<AnswerResult> {
    const start = Date.now();
    const key = answerCacheKey(question, this.model.modelName, this.vectorStore.corpusVersion());

    if (!options.bypassCache) {
      const cached = await this.cache.get<CacheableAnswer>(key);

      if (cached) {
        options.onToken?.(cached.answer);

        return {
          ...cached,
          degraded: false,
          warnings: [],
          notes: [],
          cache: 'HIT',
          timings: { totalMs: Date.now() - start, ttftMs: null, retrievalMs: null, llmMs: null, perNode: null },

          cost: { inputTokens: 0, outputTokens: 0, usd: 0 },
        };
      }
    }

    const graph = buildAgentGraph({
      model: this.model,
      embeddings: this.embeddings,
      vectorStore: this.vectorStore,
      hr: this.hr,
      settings: this.settings,

      deadline: start + this.settings.requestDeadlineMs,
      onToken: options.onToken,
    });

    const finalState = (await graph.invoke({ question })) as AgentStateType;
    const result = this.toResult(finalState, start);

    await this.maybeCache(key, finalState, result);

    return result;
  }

  private async maybeCache(
    key: string,
    state: AgentStateType,
    result: AnswerResult,
  ): Promise<void> {
    if (!this.cache.enabled) return;
    if (state.degraded) return;
    if (state.refusalReason === 'missingIdentification') return;
    if (state.refusalReason === 'sourcesUnavailable') return;
    if (!result.answer) return;

    if (state.toolResults.length > 0) return;

    await this.cache.set<CacheableAnswer>(
      key,
      {
        answer: result.answer,
        route: result.route,
        sources: result.sources,
        refused: result.refused,
        refusalReason: result.refusalReason,
      },
      this.settings.cacheTtlSeconds,
    );
  }

  private toResult(state: AgentStateType, start: number): AnswerResult {
    const timings = state.timings ?? {};

    return {
      answer: state.answer,
      route: state.route,
      sources: state.sources,
      degraded: state.degraded,
      warnings: state.warnings,
      notes: state.notes,
      refused: state.refused,
      refusalReason: state.refusalReason,
      cache: this.cache.enabled ? 'MISS' : 'OFF',
      timings: {
        totalMs: Date.now() - start,

        ttftMs: null,
        retrievalMs: timings.retrieve ?? null,

        llmMs: (timings.classify ?? 0) + (timings.generateAnswer ?? 0) || null,
        perNode: Object.keys(timings).length > 0 ? timings : null,
      },
      cost: computeCost(state.usage, this.settings.price),
    };
  }
}
