import type { TokenUsage } from '../../../domain/cost';
import type {
  ChatModelPort,
  GenerationParams,
  StructuredParams,
} from '../../../application/ports/chat-model.port';

export class FakeChatModel implements ChatModelPort {
  readonly modelName = 'fake-deterministic';

  public structuredCalls = 0;
  public generationCalls = 0;

  public failNextGeneration: Error | null = null;

  async structured<T>({ user, schema }: StructuredParams<T>): Promise<{
    data: T;
    usage: TokenUsage;
  }> {
    this.structuredCalls++;
    return {
      data: schema.parse(this.classify(user)),
      usage: { input: countWords(user), output: 12 },
    };
  }

  async generate({ system, user, onToken }: GenerationParams): Promise<{
    text: string;
    usage: TokenUsage;
  }> {
    this.generationCalls++;

    if (this.failNextGeneration) {
      const error = this.failNextGeneration;
      this.failNextGeneration = null;
      throw error;
    }

    const text = this.compose(user);

    if (onToken) {
      for (const piece of text.match(/\S+\s*/g) ?? [text]) onToken(piece);
    }

    return {
      text,
      usage: { input: countWords(system) + countWords(user), output: countWords(text) },
    };
  }

  private classify(text: string): Record<string, unknown> {
    const t = normalize(text);

    const employeeId = /\b(?:id|matricula|colaborador)\D{0,12}(\d{3,6})\b/.exec(t)?.[1];
    const ticketId = /\bchamado\D{0,12}(\d{3,6})\b/.exec(t)?.[1];

    const outOfScope =
      /(previsao do tempo|\btempo em\b|\binvestiment\w*|\bfaturou\b|\bfaturamento\b|\bbolsa de valores\b|\bacoes da\b)/.test(
        t,
      );

    const injection =
      /(ignore as instrucoes|revele o seu prompt|prompt de sistema|system prompt)/.test(t);

    if (outOfScope || injection) {
      return { route: 'outOfScope', reason: injection ? 'injection attempt' : 'outside domain' };
    }

    const personalMarker =
      /(meu saldo|meus beneficios|beneficios ativos|meu banco de horas|saldo de ferias|saldo do banco|status do chamado|ja foi resolvido|quantas horas eu tenho|meu plano)/.test(
        t,
      );

    const wantsPersonalData = personalMarker || Boolean(employeeId || ticketId);

    const wantsPolicy =
      /(politica|posso|regra|prazo|limite|sla|como funciona|quantos dias|qual o valor|preciso de|como faco|direito|exige)/.test(
        t,
      );

    const route = wantsPersonalData && wantsPolicy ? 'hybrid' : wantsPersonalData ? 'tool' : 'kb';

    return {
      route,
      tools: route === 'kb' ? [] : this.inferTools(t),
      ...(employeeId ? { employeeId: Number(employeeId) } : {}),
      ...(ticketId ? { ticketId: Number(ticketId) } : {}),
    };
  }

  private inferTools(t: string): string[] {
    const tools: string[] = [];

    if (/chamado/.test(t)) tools.push('get_ticket');
    if (/ferias|vender|abono/.test(t)) tools.push('get_vacation_balance');
    if (/banco de horas|horas|folga/.test(t)) tools.push('get_hours_bank');
    if (/beneficio|plano|dependente|gympass|vale/.test(t)) tools.push('get_benefits');

    return tools.length > 0 ? tools : ['get_vacation_balance'];
  }

  private compose(user: string): string {
    const excerpts = [...user.matchAll(/\[(\d+)\]\s*([^\n]+)/g)].map((m) => m[2].trim());

    if (excerpts.length === 0) {
      return 'Não encontrei informação suficiente nas fontes disponíveis para responder com segurança.';
    }

    return `Com base nas políticas internas: ${excerpts.slice(0, 2).join(' ')}`.slice(0, 600);
  }
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}
