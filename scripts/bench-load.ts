import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import autocannon from 'autocannon';

interface Cenario {
  nome: string;
  provider: 'fake' | 'gemini';
  cacheQuente: boolean;
  descricao: string;
}

interface Linha {
  cenario: string;
  concorrencia: number;
  rps: number;
  latenciaP50: number;
  latenciaP95: number;
  latenciaP99: number;
  erros: number;
  naoDoisXX: number;
  duracaoS: number;
}

const CONCORRENCIAS = (process.env.CONCORRENCIAS ?? '1,5,10,25,50')
  .split(',')
  .map((n) => Number(n.trim()));
const DURACAO = Number(process.env.DURACAO ?? 10);

const CENARIOS: Cenario[] = [
  {
    nome: 'servico-isolado',
    provider: 'fake',
    cacheQuente: false,
    descricao: 'Capacidade do serviço sem o provedor no caminho (event loop, HTTP, retrieval).',
  },
  {
    nome: 'producao-cache-quente',
    provider: 'gemini',
    cacheQuente: true,
    descricao: 'Vazão realista: perguntas repetidas servidas do cache Redis.',
  },
];

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

async function esperarSaude(base: string, tentativas = 60): Promise<void> {
  for (let i = 0; i < tentativas; i++) {
    try {
      const r = await fetch(`${base}/health`);
      if (r.ok) return;
    } catch {
      void 0;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Serviço não respondeu em ${base}/health`);
}

function subirServidor(porta: number, cenario: Cenario): ChildProcess {
  return spawn('node', ['dist/main.js'], {
    env: {
      ...process.env,
      PORT: String(porta),
      LLM_PROVIDER: cenario.provider,
      MOCK_API_BASE_URL: `http://127.0.0.1:${porta}/mock/v1`,
      LOG_LEVEL: 'error',
      OTEL_ENABLED: 'false',

      INDEX_PATH: cenario.provider === 'fake' ? './eval/index-test.json' : './eval/index-snapshot.json',
      RETRIEVAL_MIN_SCORE: cenario.provider === 'fake' ? '0.18' : '0.55',
    },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
}

async function main(): Promise<void> {
  const arquivo = JSON.parse(
    await readFile(resolve(process.cwd(), 'eval', 'questions.json'), 'utf-8'),
  ) as { perguntas: { texto: string }[] };

  const perguntas = extrairPerguntas(arquivo);

  const linhas: Linha[] = [];

  for (const cenario of CENARIOS) {
    const porta = await portaLivre();
    const base = `http://127.0.0.1:${porta}`;
    const servidor = subirServidor(porta, cenario);

    try {
      await esperarSaude(base);

      if (cenario.cacheQuente) {
        for (const pergunta of perguntas) {
          await fetch(`${base}/ask`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ pergunta }),
          }).catch(() => undefined);
        }
      }

      console.log(`\n=== cenário: ${cenario.nome} (provider=${cenario.provider}) ===`);
      console.log(`    ${cenario.descricao}\n`);

      for (const concorrencia of CONCORRENCIAS) {
        const resultado = await autocannon({
          url: `${base}/ask`,
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          connections: concorrencia,
          duration: DURACAO,
          requests: perguntas.map((pergunta) => ({ body: JSON.stringify({ pergunta }) })),
        });

        const linha: Linha = {
          cenario: cenario.nome,
          concorrencia,
          rps: Number(resultado.requests.average.toFixed(1)),
          latenciaP50: resultado.latency.p50,
          latenciaP95: resultado.latency.p97_5,
          latenciaP99: resultado.latency.p99,
          erros: resultado.errors,
          naoDoisXX: resultado.non2xx,
          duracaoS: DURACAO,
        };

        linhas.push(linha);
        console.log(
          `  conc=${String(concorrencia).padStart(3)}  ` +
            `rps=${String(linha.rps).padStart(8)}  ` +
            `p50=${String(linha.latenciaP50).padStart(6)}ms  ` +
            `p95=${String(linha.latenciaP95).padStart(6)}ms  ` +
            `p99=${String(linha.latenciaP99).padStart(6)}ms  ` +
            `erros=${linha.erros}  não2xx=${linha.naoDoisXX}`,
        );
      }
    } finally {
      servidor.kill('SIGTERM');
      await new Promise((r) => setTimeout(r, 800));
    }
  }

  const colunas: (keyof Linha)[] = [
    'cenario',
    'concorrencia',
    'rps',
    'latenciaP50',
    'latenciaP95',
    'latenciaP99',
    'erros',
    'naoDoisXX',
    'duracaoS',
  ];

  const csv = [colunas.join(','), ...linhas.map((l) => colunas.map((c) => l[c]).join(','))].join('\n');

  const destino = join(process.cwd(), 'eval', 'results');
  await mkdir(destino, { recursive: true });
  await writeFile(join(destino, 'scale.csv'), csv, 'utf-8');

  console.log(`\nCSV: eval/results/scale.csv`);
}

function extrairPerguntas(arquivo: { perguntas: { texto: string }[] }): string[] {
  return arquivo.perguntas.slice(0, 6).map((p) => p.texto);
}

main().catch((err) => {
  console.error('\nFalha no teste de carga:\n', err instanceof Error ? err.message : err);
  process.exit(1);
});
