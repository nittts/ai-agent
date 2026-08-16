import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { ENV } from '../src/infrastructure/config/config.module';
import type { Env } from '../src/infrastructure/config/env';
import { CACHE, type CachePort } from '../src/application/ports/cache.port';

import type { AskResponse } from '../src/presentation/http/api-contract';
import { ROUTES } from '../src/domain/answer';

interface DemoQuestion {
  id: string;
  category: string;
  text: string;
}

interface Sample {
  id: string;
  category: string;
  round: number;
  route: string;
  cache: string;
  refused: boolean;
  degraded: boolean;
  totalMs: number;
  ttftMs: number | null;
  retrievalMs: number | null;
  llmMs: number | null;
  classifyMs: number | null;
  answerMs: number | null;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

const ROUNDS = Number(process.env.ROUNDS ?? 3);
const MODE = (process.env.MODE ?? 'cold') as 'cold' | 'warm';

async function freePort(): Promise<number> {
  return new Promise((res, rej) => {
    const s = createServer();
    s.once('error', rej);
    s.listen(0, '127.0.0.1', () => {
      const e = s.address();
      const p = typeof e === 'object' && e ? e.port : 0;
      s.close(() => res(p));
    });
  });
}

function percentile(valores: number[], p: number): number {
  if (valores.length === 0) return 0;
  const ordenado = [...valores].sort((a, b) => a - b);
  const indice = Math.ceil((p / 100) * ordenado.length) - 1;
  return ordenado[Math.min(Math.max(indice, 0), ordenado.length - 1)];
}

function summarise(label: string, samples: Sample[]): string {
  if (samples.length === 0) return `${label.padEnd(16)} (no samples)`;

  const totals = samples.map((a) => a.totalMs);
  const cost = samples.reduce((s, a) => s + a.costUsd, 0);

  return (
    label.padEnd(16) +
    String(samples.length).padStart(4) +
    String(percentile(totals, 50)).padStart(9) +
    String(percentile(totals, 95)).padStart(9) +
    String(percentile(totals, 99)).padStart(9) +
    String(Math.min(...totals)).padStart(9) +
    String(Math.max(...totals)).padStart(9) +
    ('US$' + (cost / samples.length).toFixed(6)).padStart(14)
  );
}

async function main(): Promise<void> {
  const porta = await freePort();
  process.env.PORT = String(porta);
  process.env.HR_API_BASE_URL = `http://127.0.0.1:${porta}/mock/v1`;
  process.env.LOG_LEVEL ??= 'error';

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: false }),
    { logger: ['error'] },
  );
  await configureApp(app);
  await app.init();
  await app.listen({ port: porta, host: '127.0.0.1' });

  const env = app.get<Env>(ENV);
  const cache = app.get<CachePort>(CACHE);
  const base = `http://127.0.0.1:${porta}`;

  const file = JSON.parse(
    await readFile(resolve(process.cwd(), 'eval', 'questions.json'), 'utf-8'),
  ) as { questions: DemoQuestion[] };

  const questions = file.questions;

  console.log(
    `\nLatency benchmark\n` +
      `  model=${env.GEMINI_CHAT_MODEL}  embeddings=${env.GEMINI_EMBED_MODEL}\n` +
      `  provider=${env.LLM_PROVIDER}  mode=${MODE}  rounds=${ROUNDS}\n` +
      `  questions=${questions.length}  total samples=${questions.length * ROUNDS}\n`,
  );

  if (MODE === 'cold') await cache.clear();

  const samples: Sample[] = [];

  for (let round = 1; round <= ROUNDS; round++) {
    process.stdout.write(`  round ${round}/${ROUNDS}: `);

    for (const question of questions) {
      const response = await fetch(`${base}/ask`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },

        body: JSON.stringify({ question: question.text, bypassCache: MODE === 'cold' }),
      });

      const data = (await response.json()) as AskResponse;
      const perNode = data.timings.perNode ?? {};

      samples.push({
        id: question.id,
        category: question.category,
        round,
        route: data.route,
        cache: data.cache,
        refused: data.refused,
        degraded: data.degraded,
        totalMs: data.timings.totalMs,
        ttftMs: data.timings.ttftMs,
        retrievalMs: data.timings.retrievalMs,
        llmMs: data.timings.llmMs,
        classifyMs: perNode.classify ?? null,
        answerMs: perNode.generateAnswer ?? null,
        inputTokens: data.cost.inputTokens,
        outputTokens: data.cost.outputTokens,
        costUsd: data.cost.usd,
      });

      process.stdout.write('.');
    }

    process.stdout.write(' ok\n');
  }

  const columns: (keyof Sample)[] = [
    'id',
    'category',
    'round',
    'route',
    'cache',
    'refused',
    'degraded',
    'totalMs',
    'ttftMs',
    'retrievalMs',
    'llmMs',
    'classifyMs',
    'answerMs',
    'inputTokens',
    'outputTokens',
    'costUsd',
  ];

  const csv = [
    columns.join(','),
    ...samples.map((a) => columns.map((c) => a[c] ?? '').join(',')),
  ].join('\n');

  const outDir = join(process.cwd(), 'eval', 'results');
  await mkdir(outDir, { recursive: true });
  const csvName = MODE === 'cold' ? 'latency.csv' : 'latency-cache-warm.csv';
  await writeFile(join(outDir, csvName), csv, 'utf-8');

  const header =
    'group'.padEnd(16) +
    'n'.padStart(4) +
    'p50'.padStart(9) +
    'p95'.padStart(9) +
    'p99'.padStart(9) +
    'min'.padStart(9) +
    'max'.padStart(9) +
    'avg cost'.padStart(14);

  const lines: string[] = ['', header, '-'.repeat(header.length)];
  lines.push(summarise('ALL', samples));
  lines.push('');

  for (const route of ROUTES) {
    const forRoute = samples.filter((a) => a.route === route);
    if (forRoute.length > 0) lines.push(summarise(`route ${route}`, forRoute));
  }

  lines.push('');
  for (const category of [...new Set(samples.map((a) => a.category))]) {
    lines.push(summarise(category, samples.filter((a) => a.category === category)));
  }

  const totalCost = samples.reduce((s, a) => s + a.costUsd, 0);
  const totalTokens = samples.reduce((s, a) => s + a.inputTokens + a.outputTokens, 0);

  const failed = samples.filter((a) => a.degraded);
  const healthy = samples.filter((a) => !a.degraded);
  const healthyTotals = healthy.map((a) => a.totalMs);

  lines.push(
    '',
    `infrastructure failures (degraded=true): ${failed.length}/${samples.length} ` +
      `(${((failed.length / samples.length) * 100).toFixed(1)}%)`,
    `percentiles EXCLUDING degraded requests — the agent's performance when the ` +
      `provider responds:`,
    `  n=${healthy.length}  p50=${percentile(healthyTotals, 50)}ms  ` +
      `p95=${percentile(healthyTotals, 95)}ms  p99=${percentile(healthyTotals, 99)}ms  ` +
      `max=${Math.max(...healthyTotals, 0)}ms`,
  );

  lines.push(
    '',
    `times in ms · percentile by nearest-rank (an OBSERVED value, never interpolated)`,
    `total benchmark cost: US$${totalCost.toFixed(6)}  ·  tokens: ${totalTokens}`,
    `CSV: eval/results/${csvName}`,
  );

  const report = lines.join('\n');
  console.log(report);

  await writeFile(
    join(outDir, MODE === 'cold' ? 'latency-resumo.txt' : 'latency-resumo-warm.txt'),
    `Latency benchmark — model=${env.GEMINI_CHAT_MODEL} modo=${MODE} rodadas=${ROUNDS}\n` +
      `gerado em ${new Date().toISOString()}\n${report}\n`,
    'utf-8',
  );

  await app.close();
}

main().catch((err) => {
  console.error('\nBenchmark failed:\n', err instanceof Error ? err.message : err);
  process.exit(1);
});
