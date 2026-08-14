export class TimeoutError extends Error {
  constructor(public readonly ms: number) {
    super(`Timed out after ${ms}ms`);
    this.name = 'TimeoutError';
  }
}

export class DeadlineExceededError extends Error {
  constructor() {
    super('Request deadline exceeded');
    this.name = 'DeadlineExceededError';
  }
}

export async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);

  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        controller.signal.addEventListener('abort', () => reject(new TimeoutError(ms)));
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export function isTransient(error: unknown): boolean {
  if (error instanceof TimeoutError) return true;

  const status = (error as { status?: number })?.status;
  if (typeof status === 'number') return status === 429 || status >= 500;

  const code = (error as { code?: string })?.code;
  return ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN', 'UND_ERR_SOCKET'].includes(
    code ?? '',
  );
}

export interface RetryOptions {
  attempts: number;
  baseMs?: number;
  onRetry?: (attempt: number, error: unknown) => void;

  deadline?: number;
}

export async function withRetry<T>(
  operation: () => Promise<T>,
  { attempts, baseMs = 150, onRetry, deadline }: RetryOptions,
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= attempts; attempt++) {
    if (deadline !== undefined && Date.now() >= deadline) {
      throw lastError ?? new DeadlineExceededError();
    }

    try {
      return await operation();
    } catch (error) {
      lastError = error;

      const mayRetry = attempt < attempts && isTransient(error);
      if (!mayRetry) break;

      const ceiling = baseMs * 2 ** attempt;
      const wait = Math.random() * ceiling;

      if (deadline !== undefined && Date.now() + wait >= deadline) break;

      onRetry?.(attempt + 1, error);
      await new Promise((r) => setTimeout(r, wait));
    }
  }

  throw lastError;
}

export function remainingBudget(deadline: number | undefined, attemptTimeoutMs: number): number {
  if (deadline === undefined) return attemptTimeoutMs;
  return Math.max(250, Math.min(attemptTimeoutMs, deadline - Date.now()));
}
