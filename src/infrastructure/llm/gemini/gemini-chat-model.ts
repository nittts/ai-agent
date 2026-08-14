import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import type { Env } from '../../config/env';
import type { TokenUsage } from '../../../domain/cost';
import { ZERO_USAGE } from '../../../domain/cost';
import type {
  ChatModelPort,
  GenerationParams,
  StructuredParams,
} from '../../../application/ports/chat-model.port';
import { SseReader } from '../../../shared/sse/sse-reader';
import { withTimeout } from '../../../shared/resilience';

interface GeminiStreamEvent {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
}

interface LangChainUsage {
  input_tokens?: number;
  output_tokens?: number;
}

function toUsage(meta: LangChainUsage | undefined): TokenUsage {
  return { input: meta?.input_tokens ?? 0, output: meta?.output_tokens ?? 0 };
}

export class GeminiChatModel implements ChatModelPort {
  readonly modelName: string;

  private readonly langchainModel: ChatGoogleGenerativeAI;
  private readonly apiKey: string;
  private readonly timeoutMs: number;

  constructor(env: Env) {
    this.modelName = env.GEMINI_CHAT_MODEL;
    this.apiKey = env.GEMINI_API_KEY ?? '';
    this.timeoutMs = env.LLM_TIMEOUT_MS;

    this.langchainModel = new ChatGoogleGenerativeAI({
      apiKey: env.GEMINI_API_KEY,
      model: env.GEMINI_CHAT_MODEL,
      temperature: 0,

      maxRetries: 0,
      streaming: true,
      streamUsage: true,
    });
  }

  async structured<T>({
    system,
    user,
    schema,
    schemaName,
    timeoutMs,
  }: StructuredParams<T>): Promise<{ data: T; usage: TokenUsage }> {
    const withSchema = this.langchainModel.withStructuredOutput(schema, {
      name: schemaName,
      includeRaw: true,
    });

    const response = (await withTimeout(
      withSchema.invoke([new SystemMessage(system), new HumanMessage(user)]),
      timeoutMs ?? this.timeoutMs,
    )) as { parsed: T; raw?: { usage_metadata?: LangChainUsage } };

    return { data: response.parsed, usage: toUsage(response.raw?.usage_metadata) };
  }

  async generate({
    system,
    user,
    onToken,
    timeoutMs,
  }: GenerationParams): Promise<{ text: string; usage: TokenUsage }> {
    const url =
      `https://generativelanguage.googleapis.com/v1beta/models/${this.modelName}` +
      `:streamGenerateContent?alt=sse&key=${this.apiKey}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        generationConfig: { temperature: 0 },
      }),
      signal: AbortSignal.timeout(timeoutMs ?? this.timeoutMs),
    });

    if (!response.ok || !response.body) {
      const detail = await response.text().catch(() => '');
      const error = new Error(
        `Gemini responded ${response.status}: ${detail.slice(0, 200)}`,
      ) as Error & { status: number };
      error.status = response.status;
      throw error;
    }

    let text = '';
    let usage: TokenUsage = ZERO_USAGE;

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const sse = new SseReader();

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      for (const payload of sse.feed(decoder.decode(value, { stream: true }))) {
        const event = JSON.parse(payload) as GeminiStreamEvent;

        for (const part of event.candidates?.[0]?.content?.parts ?? []) {
          if (part.text) {
            text += part.text;
            onToken?.(part.text);
          }
        }

        if (event.usageMetadata) {
          usage = {
            input: event.usageMetadata.promptTokenCount ?? 0,
            output: event.usageMetadata.candidatesTokenCount ?? 0,
          };
        }
      }
    }

    return { text, usage };
  }
}
