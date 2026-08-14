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

export interface OpcoesRetry {
  tentativas: number;
  baseMs?: number;
  aoRepetir?: (tentativa: number, erro: unknown) => void;
}

export async function comRetry<T>(
  operacao: () => Promise<T>,
  { tentativas, baseMs = 150, aoRepetir }: OpcoesRetry,
): Promise<T> {
  let ultimoErro: unknown;

  for (let tentativa = 0; tentativa <= tentativas; tentativa++) {
    try {
      return await operacao();
    } catch (erro) {
      ultimoErro = erro;

      const podeRepetir = tentativa < tentativas && ehTransitorio(erro);
      if (!podeRepetir) break;

      aoRepetir?.(tentativa + 1, erro);

      const teto = baseMs * 2 ** tentativa;
      await new Promise((r) => setTimeout(r, Math.random() * teto));
    }
  }

  throw ultimoErro;
}
