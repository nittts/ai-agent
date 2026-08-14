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

export class GeminiChatModel implements ChatModelPort {
  readonly nomeModelo: string;
  private readonly modelo: ChatGoogleGenerativeAI;

  constructor(env: Env) {
    this.nomeModelo = env.GEMINI_CHAT_MODEL;
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
    const mensagens = [new SystemMessage(sistema), new HumanMessage(usuario)];

    let texto = '';
    let uso: UsoTokens = USO_ZERO;

    for await (const pedaco of await this.modelo.stream(mensagens)) {
      const conteudo = typeof pedaco.content === 'string' ? pedaco.content : '';
      if (conteudo) {
        texto += conteudo;
        aoReceberToken?.(conteudo);
      }
      if (pedaco.usage_metadata) uso = extrairUso(pedaco.usage_metadata);
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
