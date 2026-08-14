import pino, { type Logger } from 'pino';
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

export interface RequestContext {
  correlationId: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function runWithContext<T>(ctx: RequestContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

export function currentCorrelationId(): string | undefined {
  return storage.getStore()?.correlationId;
}

export function newCorrelationId(): string {
  return randomUUID();
}

let root: Logger | undefined;

export function createLogger(level: string, pretty: boolean): Logger {
  root = pino({
    level,
    mixin() {
      const id = currentCorrelationId();
      return id ? { correlationId: id } : {};
    },
    ...(pretty
      ? { transport: { target: 'pino-pretty', options: { colorize: true, singleLine: false } } }
      : {}),
  });
  return root;
}

export function logger(): Logger {
  if (!root) {
    root = pino({ level: process.env.LOG_LEVEL ?? 'info' });
  }
  return root;
}
