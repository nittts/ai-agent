import { describe, it, expect } from 'vitest';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  dividirEmSecoes,
  gerarChunks,
  calcularCorpusVersion,
  type DocumentoBruto,
} from '../../src/retrieval/chunker';

const CORPUS = join(process.cwd(), 'corpus');

async function lerCorpus(): Promise<DocumentoBruto[]> {
  const arquivos = (await readdir(CORPUS)).filter((f) => f.endsWith('.md')).sort();
  return Promise.all(
    arquivos.map(async (arquivo) => ({
      arquivo,
      conteudo: await readFile(join(CORPUS, arquivo), 'utf-8'),
    })),
  );
}

describe('dividirEmSecoes', () => {
  it('quebra por ## e usa o cabeçalho como âncora de citação', () => {
    const secoes = dividirEmSecoes(
      ['# Título do doc', '', '## Primeira', 'a'.repeat(200), '', '## Segunda', 'b'.repeat(200)].join(
        '\n',
      ),
    );

    expect(secoes.map((s) => s.titulo)).toEqual(['Primeira', 'Segunda']);
  });

  it('mantém ### dentro da seção ## a que pertence', () => {
    const secoes = dividirEmSecoes(
      ['## Plano de saúde', 'c'.repeat(200), '### Inclusão de dependentes', 'd'.repeat(200)].join(
        '\n',
      ),
    );

    expect(secoes).toHaveLength(1);
    expect(secoes[0].titulo).toBe('Plano de saúde');
    expect(secoes[0].texto).toContain('Inclusão de dependentes');
  });

  it('anexa seções curtas demais à anterior, para não gerar chunks de ruído', () => {
    const secoes = dividirEmSecoes(
      ['## Longa', 'x'.repeat(400), '', '## Curta', 'poucas palavras'].join('\n'),
    );

    expect(secoes).toHaveLength(1);
    expect(secoes[0].texto).toContain('poucas palavras');
  });
});

describe('calcularCorpusVersion', () => {
  it('é estável e independente da ordem dos documentos', () => {
    const a: DocumentoBruto[] = [
      { arquivo: 'a.md', conteudo: '## X\ntexto' },
      { arquivo: 'b.md', conteudo: '## Y\noutro' },
    ];
    const invertido = [...a].reverse();

    expect(calcularCorpusVersion(a)).toBe(calcularCorpusVersion(invertido));
  });

  it('muda quando o conteúdo muda — é o que invalida o cache de respostas', () => {
    const antes = calcularCorpusVersion([{ arquivo: 'a.md', conteudo: 'limite de 10 dias' }]);
    const depois = calcularCorpusVersion([{ arquivo: 'a.md', conteudo: 'limite de 12 dias' }]);

    expect(antes).not.toBe(depois);
  });
});

describe('gerarChunks sobre o corpus real', () => {
  it('produz chunks com metadados completos e rastreáveis', async () => {
    const chunks = await gerarChunks(await lerCorpus());

    expect(chunks.length).toBeGreaterThan(20);

    for (const chunk of chunks) {
      expect(chunk.metadata.arquivo).toMatch(/\.md$/);
      expect(chunk.metadata.secao.length).toBeGreaterThan(0);
      expect(chunk.metadata.chunkId).toContain('#');
      expect(chunk.metadata.corpusVersion).toHaveLength(12);
      expect(chunk.texto.trim().length).toBeGreaterThan(0);
    }
  });

  it('prefixa o título da seção no texto do chunk', async () => {
    const chunks = await gerarChunks(await lerCorpus());
    const abono = chunks.find((c) => c.metadata.secao.includes('Abono pecuniário'));

    expect(abono).toBeDefined();

    expect(abono!.texto.startsWith('Abono pecuniário')).toBe(true);
  });

  it('gera chunkIds únicos', async () => {
    const chunks = await gerarChunks(await lerCorpus());
    const ids = chunks.map((c) => c.metadata.chunkId);

    expect(new Set(ids).size).toBe(ids.length);
  });
});
