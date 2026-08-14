import type { ChatModelPort, ParamsEstruturado, ParamsGeracao, UsoTokens } from './chat-model';

export class FakeChatModel implements ChatModelPort {
  readonly nomeModelo = 'fake-deterministic';

  public chamadasEstruturado = 0;
  public chamadasGeracao = 0;

  public falharProximaGeracao: Error | null = null;

  async estruturado<T>({ usuario, schema }: ParamsEstruturado<T>): Promise<{
    dados: T;
    uso: UsoTokens;
  }> {
    this.chamadasEstruturado++;

    const dados = schema.parse(this.classificar(usuario));
    return { dados, uso: { entrada: contarPalavras(usuario), saida: 12 } };
  }

  async gerar({ sistema, usuario, aoReceberToken }: ParamsGeracao): Promise<{
    texto: string;
    uso: UsoTokens;
  }> {
    this.chamadasGeracao++;

    if (this.falharProximaGeracao) {
      const erro = this.falharProximaGeracao;
      this.falharProximaGeracao = null;
      throw erro;
    }

    const texto = this.compor(usuario);

    if (aoReceberToken) {
      for (const pedaco of texto.match(/\S+\s*/g) ?? [texto]) aoReceberToken(pedaco);
    }

    return {
      texto,
      uso: { entrada: contarPalavras(sistema) + contarPalavras(usuario), saida: contarPalavras(texto) },
    };
  }

  private classificar(texto: string): Record<string, unknown> {
    const t = normalizar(texto);

    const idColaborador = /\b(?:id|matricula|colaborador)\D{0,12}(\d{3,6})\b/.exec(t)?.[1];
    const idChamado = /\bchamado\D{0,12}(\d{3,6})\b/.exec(t)?.[1];

    const foraDeEscopo = /(previsao do tempo|tempo em |investiment|faturou|faturamento|bolsa|acoes da)/.test(
      t,
    );
    const injecao = /(ignore as instrucoes|revele o seu prompt|prompt de sistema|system prompt)/.test(
      t,
    );

    if (foraDeEscopo || injecao) {
      return { rota: 'out_of_scope', motivo: injecao ? 'tentativa de injeção' : 'fora do domínio' };
    }

    const marcadorPessoal =
      /(meu saldo|meus beneficios|beneficios ativos|meu banco de horas|saldo de ferias|saldo do banco|status do chamado|ja foi resolvido|quantas horas eu tenho|meu plano)/.test(
        t,
      );

    const pedeDadoPessoal = marcadorPessoal || Boolean(idColaborador || idChamado);

    const pedePolitica =
      /(politica|posso|regra|prazo|limite|sla|como funciona|quantos dias|qual o valor|preciso de|como faco|direito|exige)/.test(
        t,
      );

    const rota = pedeDadoPessoal && pedePolitica ? 'hybrid' : pedeDadoPessoal ? 'tool' : 'kb';

    return {
      rota,
      ferramentas: rota === 'kb' ? [] : this.inferirFerramentas(t),
      ...(idColaborador ? { colaboradorId: Number(idColaborador) } : {}),
      ...(idChamado ? { chamadoId: Number(idChamado) } : {}),
    };
  }

  private inferirFerramentas(t: string): string[] {
    const ferramentas: string[] = [];

    if (/chamado/.test(t)) ferramentas.push('consultar_chamado');
    if (/ferias|vender|abono/.test(t)) ferramentas.push('consultar_saldo_ferias');
    if (/banco de horas|horas|folga/.test(t)) ferramentas.push('consultar_banco_horas');
    if (/beneficio|plano|dependente|gympass|vale/.test(t)) ferramentas.push('consultar_beneficios');

    return ferramentas.length > 0 ? ferramentas : ['consultar_saldo_ferias'];
  }

  private compor(usuario: string): string {
    const trechos = [...usuario.matchAll(/\[(\d+)\]\s*([^\n]+)/g)].map((m) => m[2].trim());

    if (trechos.length === 0) {
      return 'Não encontrei informação suficiente nas fontes disponíveis para responder com segurança.';
    }

    return `Com base nas políticas internas: ${trechos.slice(0, 2).join(' ')}`.slice(0, 600);
  }
}

function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

function contarPalavras(texto: string): number {
  return texto.split(/\s+/).filter(Boolean).length;
}
