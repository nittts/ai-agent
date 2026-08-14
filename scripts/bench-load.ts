import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import autocannon from 'autocannon';

interface Scenario {
  name: string;
  provider: 'fake' | 'gemini';
  warmCache: boolean;
  description: string;
}

interface Row {
  scenario: string;
  concurrency: number;
  rps: number;
  latencyP50: number;
  latencyP95: number;
  latencyP99: number;
  errors: number;
  non2xx: number;
  durationS: number;
}

const CONCURRENCIES = (process.env.CONCURRENCIES ?? '1,5,10,25,50')
  .split(',')
  .map((n) => Number(n.trim()));
const DURATION = Number(process.env.DURATION ?? 10);

const SCENARIOS: Scenario[] = [
  {
    name: 'servico-isolado',
    provider: 'fake',
    warmCache: false,
    description: 'Service capacity with the provider out of the path (event loop, HTTP, retrieval).',
  },
  {
    name: 'production-warm-cache',
    provider: 'gemini',
    warmCache: true,
    description: 'Vazão realista: questions repetidas servidas do cache Redis.',
  },
];

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

async function waitForHealth(base: string, attempts = 60): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    try {
      const r = await fetch(`${base}/health`);
      if (r.ok) return;
    } catch {
      void 0;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Service did not respond at ${base}/health`);
}

function startServer(port: number, scenario: Scenario): ChildProcess {
  return spawn('node', ['dist/main.js'], {
    env: {
      ...process.env,
      PORT: String(port),
      LLM_PROVIDER: scenario.provider,
      MOCK_API_BASE_URL: `http://127.0.0.1:${port}/mock/v1`,
      LOG_LEVEL: 'error',
      OTEL_ENABLED: 'false',

      INDEX_PATH: scenario.provider === 'fake' ? './eval/index-test.json' : './eval/index-snapshot.json',
      RETRIEVAL_MIN_SCORE: scenario.provider === 'fake' ? '0.18' : '0.55',
    },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
}

async function main(): Promise<void> {
  const file = JSON.parse(
    await readFile(resolve(process.cwd(), 'eval', 'questions.json'), 'utf-8'),
  ) as { questions: { text: string }[] };

  const questions = pickQuestions(file);

  const rows: Row[] = [];

  for (const scenario of SCENARIOS) {
    const port = await freePort();
    const base = `http://127.0.0.1:${port}`;
    const server = startServer(port, scenario);

    try {
      await waitForHealth(base);

      if (scenario.warmCache) {
        for (const question of questions) {
          await fetch(`${base}/ask`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ question }),
          }).catch(() => undefined);
        }
      }

      console.log(`\n=== cenário: ${scenario.name} (provider=${scenario.provider}) ===`);
      console.log(`    ${scenario.description}\n`);

      for (const concurrency of CONCURRENCIES) {
        const result = await autocannon({
          url: `${base}/ask`,
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          connections: concurrency,
          duration: DURATION,
          requests: questions.map((question) => ({ body: JSON.stringify({ question }) })),
        });

        const row: Row = {
          scenario: scenario.name,
          concurrency,
          rps: Number(result.requests.average.toFixed(1)),
          latencyP50: result.latency.p50,
          latencyP95: result.latency.p97_5,
          latencyP99: result.latency.p99,
          errors: result.errors,
          non2xx: result.non2xx,
          durationS: DURATION,
        };

        rows.push(row);
        console.log(
          `  conc=${String(concurrency).padStart(3)}  ` +
            `rps=${String(row.rps).padStart(8)}  ` +
            `p50=${String(row.latencyP50).padStart(6)}ms  ` +
            `p95=${String(row.latencyP95).padStart(6)}ms  ` +
            `p99=${String(row.latencyP99).padStart(6)}ms  ` +
            `errors=${row.errors}  não2xx=${row.non2xx}`,
        );
      }
    } finally {
      server.kill('SIGTERM');
      await new Promise((r) => setTimeout(r, 800));
    }
  }

  const columns: (keyof Row)[] = [
    'scenario',
    'concurrency',
    'rps',
    'latencyP50',
    'latencyP95',
    'latencyP99',
    'errors',
    'non2xx',
    'durationS',
  ];

  const csv = [columns.join(','), ...rows.map((l) => columns.map((c) => l[c]).join(','))].join('\n');

  const outDir = join(process.cwd(), 'eval', 'results');
  await mkdir(outDir, { recursive: true });
  await writeFile(join(outDir, 'scale.csv'), csv, 'utf-8');

  console.log(`\nCSV: eval/results/scale.csv`);
}

function pickQuestions(file: { questions: { text: string }[] }): string[] {
  return file.questions.slice(0, 6).map((p) => p.text);
}

main().catch((err) => {
  console.error('\nLoad test failed:\n', err instanceof Error ? err.message : err);
  process.exit(1);
});
