import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from '../src/app.module';
import { configurarApp } from '../src/bootstrap';
import { ENV } from '../src/config/config.module';
import type { Env } from '../src/config/env';
import { CACHE } from '../src/cache/cache.module';
import type { CachePort } from '../src/cache/cache.port';
import type { AskResponse } from '../src/http/contracts';

interface PerguntaDemo {
  id: string;
  categoria: string;
  texto: string;
}

interface Amostra {
  id: string;
  categoria: string;
  rodada: number;
  rota: string;
  cache: string;
  recusado: boolean;
  degradado: boolean;
  totalMs: number;
  ttftMs: number | null;
  retrievalMs: number | null;
  llmMs: number | null;
  classificarMs: number | null;
  responderMs: number | null;
  tokensEntrada: number;
  tokensSaida: number;
  custoUsd: number;
}

const RODADAS = Number(process.env.RODADAS ?? 3);
const MODO = (process.env.MODO ?? 'frio') as 'frio' | 'quente';

async function portaLivre(): Promise<number> {
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

function percentil(valores: number[], p: number): number {
  if (valores.length === 0) return 0;
  const ordenado = [...valores].sort((a, b) => a - b);
  const indice = Math.ceil((p / 100) * ordenado.length) - 1;
  return ordenado[Math.min(Math.max(indice, 0), ordenado.length - 1)];
}

function resumir(rotulo: string, amostras: Amostra[]): string {
  if (amostras.length === 0) return `${rotulo.padEnd(16)} (sem amostras)`;

  const totais = amostras.map((a) => a.totalMs);
  const custo = amostras.reduce((s, a) => s + a.custoUsd, 0);

  return (
    rotulo.padEnd(16) +
    String(amostras.length).padStart(4) +
    String(percentil(totais, 50)).padStart(9) +
    String(percentil(totais, 95)).padStart(9) +
    String(percentil(totais, 99)).padStart(9) +
    String(Math.min(...totais)).padStart(9) +
    String(Math.max(...totais)).padStart(9) +
    ('US$' + (custo / amostras.length).toFixed(6)).padStart(14)
  );
}

async function main(): Promise<void> {
  const porta = await portaLivre();
  process.env.PORT = String(porta);
  process.env.MOCK_API_BASE_URL = `http://127.0.0.1:${porta}/mock/v1`;
  process.env.LOG_LEVEL ??= 'error';

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: false }),
    { logger: ['error'] },
  );
  await configurarApp(app);
  await app.init();
  await app.listen({ port: porta, host: '127.0.0.1' });

  const env = app.get<Env>(ENV);
  const cache = app.get<CachePort>(CACHE);
  const base = `http://127.0.0.1:${porta}`;

  const arquivo = JSON.parse(
    await readFile(resolve(process.cwd(), 'eval', 'questions.json'), 'utf-8'),
  ) as { perguntas: PerguntaDemo[] };

  const perguntas = arquivo.perguntas;

  console.log(
    `\nBenchmark de latência\n` +
      `  modelo=${env.GEMINI_CHAT_MODEL}  embeddings=${env.GEMINI_EMBED_MODEL}\n` +
      `  provider=${env.LLM_PROVIDER}  modo=${MODO}  rodadas=${RODADAS}\n` +
      `  perguntas=${perguntas.length}  total de amostras=${perguntas.length * RODADAS}\n`,
  );

  if (MODO === 'frio') await cache.limpar();

  const amostras: Amostra[] = [];

  for (let rodada = 1; rodada <= RODADAS; rodada++) {
    process.stdout.write(`  rodada ${rodada}/${RODADAS}: `);

    for (const pergunta of perguntas) {
      const resposta = await fetch(`${base}/ask`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },

        body: JSON.stringify({ pergunta: pergunta.texto, ignorarCache: MODO === 'frio' }),
      });

      const dados = (await resposta.json()) as AskResponse;
      const porNo = dados.tempos.porNo ?? {};

      amostras.push({
        id: pergunta.id,
        categoria: pergunta.categoria,
        rodada,
        rota: dados.rota,
        cache: dados.cache,
        recusado: dados.recusado,
        degradado: dados.degradado,
        totalMs: dados.tempos.totalMs,
        ttftMs: dados.tempos.ttftMs,
        retrievalMs: dados.tempos.retrievalMs,
        llmMs: dados.tempos.llmMs,
        classificarMs: porNo.classificar ?? null,
        responderMs: porNo.responder ?? null,
        tokensEntrada: dados.custo.tokensEntrada,
        tokensSaida: dados.custo.tokensSaida,
        custoUsd: dados.custo.custoUsd,
      });

      process.stdout.write('.');
    }

    process.stdout.write(' ok\n');
  }

  const colunas: (keyof Amostra)[] = [
    'id',
    'categoria',
    'rodada',
    'rota',
    'cache',
    'recusado',
    'degradado',
    'totalMs',
    'ttftMs',
    'retrievalMs',
    'llmMs',
    'classificarMs',
    'responderMs',
    'tokensEntrada',
    'tokensSaida',
    'custoUsd',
  ];

  const csv = [
    colunas.join(','),
    ...amostras.map((a) => colunas.map((c) => a[c] ?? '').join(',')),
  ].join('\n');

  const destino = join(process.cwd(), 'eval', 'results');
  await mkdir(destino, { recursive: true });
  const nomeCsv = MODO === 'frio' ? 'latency.csv' : 'latency-cache-quente.csv';
  await writeFile(join(destino, nomeCsv), csv, 'utf-8');

  const cabecalho =
    'grupo'.padEnd(16) +
    'n'.padStart(4) +
    'p50'.padStart(9) +
    'p95'.padStart(9) +
    'p99'.padStart(9) +
    'min'.padStart(9) +
    'max'.padStart(9) +
    'custo médio'.padStart(14);

  const linhas: string[] = ['', cabecalho, '-'.repeat(cabecalho.length)];
  linhas.push(resumir('TODAS', amostras));
  linhas.push('');

  for (const rota of ['kb', 'tool', 'hybrid', 'out_of_scope']) {
    linhas.push(resumir(`rota ${rota}`, amostras.filter((a) => a.rota === rota)));
  }

  linhas.push('');
  for (const categoria of [...new Set(amostras.map((a) => a.categoria))]) {
    linhas.push(resumir(categoria, amostras.filter((a) => a.categoria === categoria)));
  }

  const custoTotal = amostras.reduce((s, a) => s + a.custoUsd, 0);
  const tokensTotal = amostras.reduce((s, a) => s + a.tokensEntrada + a.tokensSaida, 0);

  const comFalha = amostras.filter((a) => a.degradado);
  const semFalha = amostras.filter((a) => !a.degradado);
  const totaisLimpos = semFalha.map((a) => a.totalMs);

  linhas.push(
    '',
    `falhas de infraestrutura (degradado=true): ${comFalha.length}/${amostras.length} ` +
      `(${((comFalha.length / amostras.length) * 100).toFixed(1)}%)`,
    `percentis EXCLUINDO requests degradados — o desempenho do agente quando o ` +
      `provedor responde:`,
    `  n=${semFalha.length}  p50=${percentil(totaisLimpos, 50)}ms  ` +
      `p95=${percentil(totaisLimpos, 95)}ms  p99=${percentil(totaisLimpos, 99)}ms  ` +
      `max=${Math.max(...totaisLimpos, 0)}ms`,
  );

  linhas.push(
    '',
    `tempos em ms · percentil por "nearest rank" (valor observado, não interpolado)`,
    `custo total do benchmark: US$${custoTotal.toFixed(6)}  ·  tokens: ${tokensTotal}`,
    `CSV: eval/results/${nomeCsv}`,
  );

  const relatorio = linhas.join('\n');
  console.log(relatorio);

  await writeFile(
    join(destino, MODO === 'frio' ? 'latency-resumo.txt' : 'latency-resumo-quente.txt'),
    `Benchmark de latência — modelo=${env.GEMINI_CHAT_MODEL} modo=${MODO} rodadas=${RODADAS}\n` +
      `gerado em ${new Date().toISOString()}\n${relatorio}\n`,
    'utf-8',
  );

  await app.close();
}

main().catch((err) => {
  console.error('\nFalha no benchmark:\n', err instanceof Error ? err.message : err);
  process.exit(1);
});
