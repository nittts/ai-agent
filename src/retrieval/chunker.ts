import { createHash } from 'node:crypto';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import type { Chunk } from './types';

const TAMANHO_CHUNK = 600;
const SOBREPOSICAO = 100;

const TAMANHO_MINIMO_SECAO = 120;

export interface DocumentoBruto {
  arquivo: string;
  conteudo: string;
}

interface Secao {
  titulo: string;
  texto: string;
}

export function dividirEmSecoes(conteudo: string): Secao[] {
  const linhas = conteudo.split('\n');
  const secoes: Secao[] = [];

  let tituloAtual = 'Introdução';
  let bufferAtual: string[] = [];

  const fechar = () => {
    const texto = bufferAtual.join('\n').trim();
    if (texto.length > 0) secoes.push({ titulo: tituloAtual, texto });
    bufferAtual = [];
  };

  for (const linha of linhas) {
    const h2 = /^##\s+(.+?)\s*$/.exec(linha);

    const ehH2 = h2 !== null && !linha.startsWith('###');

    if (ehH2) {
      fechar();
      tituloAtual = h2[1];
    } else if (/^#\s+/.test(linha)) {
      continue;
    } else {
      bufferAtual.push(linha);
    }
  }
  fechar();

  return juntarSecoesMinusculas(secoes);
}

function juntarSecoesMinusculas(secoes: Secao[]): Secao[] {
  const resultado: Secao[] = [];

  for (const secao of secoes) {
    const anterior = resultado[resultado.length - 1];
    const pequenaDemais = secao.texto.length < TAMANHO_MINIMO_SECAO;

    if (pequenaDemais && anterior) {
      anterior.texto = `${anterior.texto}\n\n${secao.texto}`;
      anterior.titulo = `${anterior.titulo} / ${secao.titulo}`;
    } else {
      resultado.push({ ...secao });
    }
  }

  if (resultado.length > 1 && resultado[0].texto.length < TAMANHO_MINIMO_SECAO) {
    resultado[1].texto = `${resultado[0].texto}\n\n${resultado[1].texto}`;
    resultado[1].titulo = `${resultado[0].titulo} / ${resultado[1].titulo}`;
    resultado.shift();
  }

  return resultado;
}

function slug(texto: string): string {
  return texto
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
}

export function calcularCorpusVersion(documentos: DocumentoBruto[]): string {
  const hash = createHash('sha256');
  for (const doc of [...documentos].sort((a, b) => a.arquivo.localeCompare(b.arquivo))) {
    hash.update(doc.arquivo);
    hash.update('\0');
    hash.update(doc.conteudo);
    hash.update('\0');
  }
  return hash.digest('hex').slice(0, 12);
}

export async function gerarChunks(documentos: DocumentoBruto[]): Promise<Chunk[]> {
  const corpusVersion = calcularCorpusVersion(documentos);

  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: TAMANHO_CHUNK,
    chunkOverlap: SOBREPOSICAO,
    separators: ['\n\n', '\n', '. ', ' ', ''],
  });

  const chunks: Chunk[] = [];

  for (const doc of documentos) {
    for (const secao of dividirEmSecoes(doc.conteudo)) {
      const partes = await splitter.splitText(secao.texto);

      partes.forEach((parte, indice) => {
        chunks.push({
          texto: `${secao.titulo}\n\n${parte.trim()}`,
          metadata: {
            arquivo: doc.arquivo,
            secao: secao.titulo,
            chunkId: `${doc.arquivo}#${slug(secao.titulo)}:${indice}`,
            corpusVersion,
          },
        });
      });
    }
  }

  return chunks;
}
