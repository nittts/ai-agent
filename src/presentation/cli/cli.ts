import 'reflect-metadata';
import { createServer } from 'node:net';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from '../../app.module';
import { AnswerQuestionUseCase } from '../../application/use-cases/answer-question.use-case';
import { ENV } from '../../infrastructure/config/config.module';
import type { Env } from '../../infrastructure/config/env';
import {
  createLogger,
  newCorrelationId,
  runWithContext,
} from '../../infrastructure/observability/logger';
import type { Source } from '../../domain/answer';
import { createInterface } from 'node:readline/promises';
import { MAX_HISTORY_TURNS, type ConversationTurn } from '../../domain/conversation';

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

function formatSource(source: Source): string {
  return source.kind === 'document'
    ? `  • ${source.file} § ${source.section}  (score ${source.score.toFixed(3)})`
    : `  • ${source.endpoint}  [${source.fields.join(', ')}]  ${source.latencyMs}ms`;
}

async function main(): Promise<void> {
  const question = process.argv.slice(2).join(' ').trim();

  const interactive = question.length === 0;

  const port = await freePort();
  process.env.PORT = String(port);
  process.env.HR_API_BASE_URL = `http://127.0.0.1:${port}/mock/v1`;
  process.env.LOG_LEVEL ??= 'error';

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: false }),
    { logger: ['error'] },
  );

  const env = app.get<Env>(ENV);
  createLogger(env.LOG_LEVEL, false);
  app.enableShutdownHooks();

  await app.listen({ port, host: '127.0.0.1' });

  try {
    const answerQuestion = app.get(AnswerQuestionUseCase);
    const history: ConversationTurn[] = [];

    const askOnce = async (text: string): Promise<void> => {
      let streamed = false;

      const result = await runWithContext({ correlationId: newCorrelationId() }, () =>
        answerQuestion.execute(text, {
          history,

          onToken: (token) => {
            streamed = true;
            process.stdout.write(token);
          },
        }),
      );

      if (!streamed) process.stdout.write(result.answer);
      process.stdout.write('\n');

      if (result.interpretedAs) {
        console.log(`\n(entendi como: ${result.interpretedAs})`);
      }

      if (result.sources.length > 0) {
        console.log('\nSources:');
        for (const source of result.sources) console.log(formatSource(source));
      }

      const { timings, cost, route, degraded, refused } = result;
      console.log(
        `\nroute=${route}${refused ? ' (refused)' : ''}${degraded ? ' (degraded)' : ''}  ` +
          `total=${timings.totalMs}ms  tokens=${cost.inputTokens}/${cost.outputTokens}  ` +
          `cost=US$${cost.usd.toFixed(6)}`,
      );

      if (result.warnings.length > 0) {
        console.log(`warnings: ${result.warnings.join('; ')}`);
      }

      history.push({ role: 'user', content: text }, { role: 'assistant', content: result.answer });
      history.splice(0, Math.max(0, history.length - MAX_HISTORY_TURNS));
    };

    if (interactive) {
      console.log('Assistente RH/TI — conversa interativa. Ctrl+C ou "sair" para encerrar.\n');

      const rl = createInterface({ input: process.stdin, output: process.stdout, prompt: '> ' });
      rl.prompt();

      for await (const line of rl) {
        const text = line.trim();
        if (text === 'sair' || text === 'exit') break;

        if (text) {
          console.log('');
          await askOnce(text);
          console.log('');
        }

        rl.prompt();
      }

      rl.close();
    } else {
      await askOnce(question);
    }
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error('\nFailed to answer the question:\n');
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
