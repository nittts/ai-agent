import { ChatGoogleGenerativeAI } from '@langchain/google-genai';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import type { z } from 'zod';
import type { Env } from '../config/env';

export interface UsoTokens {
  entrada: number;
  saida: number;
}

export const USO_ZERO: UsoTokens = { entrada: 0, saida: 0 };

export function somarUso(a: UsoTokens, b: UsoTokens): UsoTokens {
  return { entrada: a.entrada + b.entrada, saida: a.saida + b.saida };
}

export interface ParamsEstruturado<T> {
  sistema: string;
  usuario: string;

  schema: z.ZodType<T, z.ZodTypeDef, unknown>;
  nomeSchema: string;
}

export interface ParamsGeracao {
  sistema: string;
  usuario: string;

  aoReceberToken?: (token: string) => void;
}

export interface ChatModelPort {
  readonly nomeModelo: string;

  estruturado<T>(params: ParamsEstruturado<T>): Promise<{ dados: T; uso: UsoTokens }>;

  gerar(params: ParamsGeracao): Promise<{ texto: string; uso: UsoTokens }>;
}

interface MetadadosUso {
  input_tokens?: number;
  output_tokens?: number;
}

function extrairUso(meta: MetadadosUso | undefined): UsoTokens {
  return { entrada: meta?.input_tokens ?? 0, saida: meta?.output_tokens ?? 0 };
}

interface RespostaGemini {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
}

export class GeminiChatModel implements ChatModelPort {
  readonly nomeModelo: string;
  private readonly modelo: ChatGoogleGenerativeAI;
  private readonly apiKey: string;
  private readonly timeoutMs: number;

  constructor(env: Env) {
    this.nomeModelo = env.GEMINI_CHAT_MODEL;
    this.apiKey = env.GEMINI_API_KEY ?? '';
    this.timeoutMs = env.LLM_TIMEOUT_MS;
    this.modelo = new ChatGoogleGenerativeAI({
      apiKey: env.GEMINI_API_KEY,
      model: env.GEMINI_CHAT_MODEL,
      temperature: 0,
      maxRetries: 0,
      streaming: true,
      streamUsage: true,
    });
  }

  async estruturado<T>({
    sistema,
    usuario,
    schema,
    nomeSchema,
  }: ParamsEstruturado<T>): Promise<{ dados: T; uso: UsoTokens }> {
    const comSchema = this.modelo.withStructuredOutput(schema, {
      name: nomeSchema,
      includeRaw: true,
    });

    const resposta = (await comSchema.invoke([
      new SystemMessage(sistema),
      new HumanMessage(usuario),
    ])) as { parsed: T; raw?: { usage_metadata?: MetadadosUso } };

    return { dados: resposta.parsed, uso: extrairUso(resposta.raw?.usage_metadata) };
  }

  async gerar({
    sistema,
    usuario,
    aoReceberToken,
  }: ParamsGeracao): Promise<{ texto: string; uso: UsoTokens }> {
    const url =
      `https://generativelanguage.googleapis.com/v1beta/models/${this.nomeModelo}` +
      `:streamGenerateContent?alt=sse&key=${this.apiKey}`;

    const resposta = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: sistema }] },
        contents: [{ role: 'user', parts: [{ text: usuario }] }],
        generationConfig: { temperature: 0 },
      }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!resposta.ok || !resposta.body) {
      const detalhe = await resposta.text().catch(() => '');
      const erro = new Error(
        `Gemini respondeu ${resposta.status}: ${detalhe.slice(0, 200)}`,
      ) as Error & { status: number };
      erro.status = resposta.status;
      throw erro;
    }

    let texto = '';
    let uso: UsoTokens = USO_ZERO;

    const leitor = resposta.body.getReader();
    const decodificador = new TextDecoder();
    let buffer = '';

    for (;;) {
      const { done, value } = await leitor.read();
      if (done) break;

      buffer += decodificador.decode(value, { stream: true }).replace(/\r\n/g, '\n');

      let corte: number;
      while ((corte = buffer.indexOf('\n\n')) >= 0) {
        const bloco = buffer.slice(0, corte);
        buffer = buffer.slice(corte + 2);

        const linha = bloco.split('\n').find((l) => l.startsWith('data: '));
        if (!linha) continue;

        const evento = JSON.parse(linha.slice(6)) as RespostaGemini;

        for (const parte of evento.candidates?.[0]?.content?.parts ?? []) {
          if (parte.text) {
            texto += parte.text;
            aoReceberToken?.(parte.text);
          }
        }

        if (evento.usageMetadata) {
          uso = {
            entrada: evento.usageMetadata.promptTokenCount ?? 0,
            saida: evento.usageMetadata.candidatesTokenCount ?? 0,
          };
        }
      }
    }

    return { texto, uso };
  }
}

export function criarChatModel(env: Env, fake?: ChatModelPort): ChatModelPort {
  if (env.LLM_PROVIDER === 'fake') {
    if (!fake) throw new Error('LLM_PROVIDER=fake exige uma implementação fake injetada.');
    return fake;
  }
  return new GeminiChatModel(env);
}
