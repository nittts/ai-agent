import { createHash } from 'node:crypto';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import type { Chunk } from '../../domain/knowledge';

const CHUNK_SIZE = 600;
const OVERLAP = 100;

const MIN_SECTION_SIZE = 120;

export interface RawDocument {
  file: string;
  content: string;
}

interface Section {
  title: string;
  text: string;
}

export function splitIntoSections(content: string): Section[] {
  const lines = content.split('\n');
  const sections: Section[] = [];

  let currentTitle = 'Introduction';
  let buffer: string[] = [];

  const close = () => {
    const text = buffer.join('\n').trim();
    if (text.length > 0) sections.push({ title: currentTitle, text });
    buffer = [];
  };

  for (const line of lines) {
    const h2 = /^##\s+(.+?)\s*$/.exec(line);
    const isH2 = h2 !== null && !line.startsWith('###');

    if (isH2) {
      close();
      currentTitle = h2[1];
    } else if (/^#\s+/.test(line)) {
      continue;
    } else {
      buffer.push(line);
    }
  }
  close();

  return mergeTinySections(sections);
}

function mergeTinySections(sections: Section[]): Section[] {
  const result: Section[] = [];

  for (const section of sections) {
    const previous = result[result.length - 1];
    const tooSmall = section.text.length < MIN_SECTION_SIZE;

    if (tooSmall && previous) {
      previous.text = `${previous.text}\n\n${section.text}`;
      previous.title = `${previous.title} / ${section.title}`;
    } else {
      result.push({ ...section });
    }
  }

  if (result.length > 1 && result[0].text.length < MIN_SECTION_SIZE) {
    result[1].text = `${result[0].text}\n\n${result[1].text}`;
    result[1].title = `${result[0].title} / ${result[1].title}`;
    result.shift();
  }

  return result;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
}

export function computeCorpusVersion(documents: RawDocument[]): string {
  const hash = createHash('sha256');

  for (const doc of [...documents].sort((a, b) => a.file.localeCompare(b.file))) {
    hash.update(doc.file);
    hash.update('\0');
    hash.update(doc.content);
    hash.update('\0');
  }

  return hash.digest('hex').slice(0, 12);
}

export async function buildChunks(documents: RawDocument[]): Promise<Chunk[]> {
  const corpusVersion = computeCorpusVersion(documents);

  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: CHUNK_SIZE,
    chunkOverlap: OVERLAP,
    separators: ['\n\n', '\n', '. ', ' ', ''],
  });

  const chunks: Chunk[] = [];

  for (const doc of documents) {
    for (const section of splitIntoSections(doc.content)) {
      const parts = await splitter.splitText(section.text);

      parts.forEach((part, index) => {
        chunks.push({
          text: `${section.title}\n\n${part.trim()}`,
          metadata: {
            file: doc.file,
            section: section.title,
            chunkId: `${doc.file}#${slugify(section.title)}:${index}`,
            corpusVersion,
          },
        });
      });
    }
  }

  return chunks;
}
