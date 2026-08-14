export class ErroTimeout extends Error {
  constructor(public readonly ms: number) {
    super(`Tempo esgotado após ${ms}ms`);
    this.name = 'ErroTimeout';
  }
}

export async function comTimeout<T>(promessa: Promise<T>, ms: number): Promise<T> {
  const controlador = new AbortController();
  const timer = setTimeout(() => controlador.abort(), ms);

  try {
    return await Promise.race([
      promessa,
      new Promise<never>((_, rejeitar) => {
        controlador.signal.addEventListener('abort', () => rejeitar(new ErroTimeout(ms)));
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export function ehTransitorio(erro: unknown): boolean {
  if (erro instanceof ErroTimeout) return true;

  const status = (erro as { status?: number })?.status;
  if (typeof status === 'number') return status === 429 || status >= 500;

  const codigo = (erro as { code?: string })?.code;
  return ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN', 'UND_ERR_SOCKET'].includes(
    codigo ?? '',
  );
}

export class ErroPrazoEsgotado extends Error {
  constructor() {
    super('Prazo total do request esgotado');
    this.name = 'ErroPrazoEsgotado';
  }
}

export interface OpcoesRetry {
  tentativas: number;
  baseMs?: number;
  aoRepetir?: (tentativa: number, erro: unknown) => void;

  prazoFinal?: number;
}

export async function comRetry<T>(
  operacao: () => Promise<T>,
  { tentativas, baseMs = 150, aoRepetir, prazoFinal }: OpcoesRetry,
): Promise<T> {
  let ultimoErro: unknown;

  for (let tentativa = 0; tentativa <= tentativas; tentativa++) {
    if (prazoFinal !== undefined && Date.now() >= prazoFinal) {
      throw ultimoErro ?? new ErroPrazoEsgotado();
    }

    try {
      return await operacao();
    } catch (erro) {
      ultimoErro = erro;

      const podeRepetir = tentativa < tentativas && ehTransitorio(erro);
      if (!podeRepetir) break;

      const teto = baseMs * 2 ** tentativa;
      const espera = Math.random() * teto;

      if (prazoFinal !== undefined && Date.now() + espera >= prazoFinal) break;

      aoRepetir?.(tentativa + 1, erro);
      await new Promise((r) => setTimeout(r, espera));
    }
  }

  throw ultimoErro;
}

export function prazoRestante(prazoFinal: number | undefined, timeoutTentativaMs: number): number {
  if (prazoFinal === undefined) return timeoutTentativaMs;
  return Math.max(250, Math.min(timeoutTentativaMs, prazoFinal - Date.now()));
}
