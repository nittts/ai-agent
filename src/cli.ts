import 'reflect-metadata';
import { createServer } from 'node:net';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module';
import { AgentService } from './agent/agent.service';
import { createLogger, newCorrelationId, runWithContext } from './observability/logger';
import { ENV } from './config/config.module';
import type { Env } from './config/env';
import type { Fonte } from './http/contracts';

async function portaLivre(): Promise<number> {
  return new Promise((resolve, reject) => {
    const servidor = createServer();
    servidor.once('error', reject);
    servidor.listen(0, '127.0.0.1', () => {
      const endereco = servidor.address();
      const porta = typeof endereco === 'object' && endereco ? endereco.port : 0;
      servidor.close(() => resolve(porta));
    });
  });
}

function formatarFonte(fonte: Fonte): string {
  return fonte.tipo === 'documento'
    ? `  • ${fonte.arquivo} § ${fonte.secao}  (score ${fonte.score.toFixed(3)})`
    : `  • ${fonte.endpoint}  [${fonte.campos.join(', ')}]  ${fonte.latenciaMs}ms`;
}

async function main(): Promise<void> {
  const pergunta = process.argv.slice(2).join(' ').trim();

  if (!pergunta) {
    console.error('Uso: npm run cli -- "sua pergunta aqui"');
    process.exit(2);
  }

  const porta = await portaLivre();
  process.env.PORT = String(porta);
  process.env.MOCK_API_BASE_URL = `http://127.0.0.1:${porta}/mock/v1`;
  process.env.LOG_LEVEL ??= 'error';

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: false }),
    { logger: ['error'] },
  );

  const env = app.get<Env>(ENV);
  createLogger(env.LOG_LEVEL, false);

  await app.listen({ port: porta, host: '127.0.0.1' });

  try {
    const agente = app.get(AgentService);

    let streamou = false;

    const resposta = await runWithContext({ correlationId: newCorrelationId() }, () =>
      agente.perguntar(pergunta, {
        aoReceberToken: (token) => {
          streamou = true;
          process.stdout.write(token);
        },
      }),
    );

    if (!streamou) process.stdout.write(resposta.resposta);
    process.stdout.write('\n');

    if (resposta.fontes.length > 0) {
      console.log('\nFontes:');
      for (const fonte of resposta.fontes) console.log(formatarFonte(fonte));
    }

    const { tempos, custo, rota, degradado, recusado } = resposta;
    console.log(
      `\nrota=${rota}${recusado ? ' (recusado)' : ''}${degradado ? ' (degradado)' : ''}  ` +
        `total=${tempos.totalMs}ms  tokens=${custo.tokensEntrada}/${custo.tokensSaida}  ` +
        `custo=US$${custo.custoUsd.toFixed(6)}`,
    );

    if (resposta.avisos.length > 0) {
      console.log(`avisos: ${resposta.avisos.join('; ')}`);
    }
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error('\nFalha ao executar a pergunta:\n');
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
