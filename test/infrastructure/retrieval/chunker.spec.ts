import { describe, it, expect } from 'vitest';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  splitIntoSections,
  buildChunks,
  computeCorpusVersion,
  type RawDocument,
} from '../../../src/infrastructure/retrieval/chunker';

const CORPUS = join(process.cwd(), 'corpus');

async function readCorpus(): Promise<RawDocument[]> {
  const files = (await readdir(CORPUS)).filter((f) => f.endsWith('.md')).sort();
  return Promise.all(
    files.map(async (file) => ({ file, content: await readFile(join(CORPUS, file), 'utf-8') })),
  );
}

describe('splitIntoSections', () => {
  it('splits at ## and uses the heading as the citation anchor', () => {
    const sections = splitIntoSections(
      ['# Doc title', '', '## First', 'a'.repeat(200), '', '## Second', 'b'.repeat(200)].join('\n'),
    );

    expect(sections.map((s) => s.title)).toEqual(['First', 'Second']);
  });

  it('keeps ### inside its parent ## section', () => {
    const sections = splitIntoSections(
      ['## Health plan', 'c'.repeat(200), '### Adding dependents', 'd'.repeat(200)].join('\n'),
    );

    expect(sections).toHaveLength(1);
    expect(sections[0].title).toBe('Health plan');
    expect(sections[0].text).toContain('Adding dependents');
  });

  it('absorbs too-small sections rather than emitting noise chunks', () => {
    const sections = splitIntoSections(
      ['## Long', 'x'.repeat(400), '', '## Tiny', 'few words'].join('\n'),
    );

    expect(sections).toHaveLength(1);
    expect(sections[0].text).toContain('few words');
  });
});

describe('computeCorpusVersion', () => {
  it('is stable and independent of document order', () => {
    const docs: RawDocument[] = [
      { file: 'a.md', content: '## X\ntext' },
      { file: 'b.md', content: '## Y\nother' },
    ];

    expect(computeCorpusVersion(docs)).toBe(computeCorpusVersion([...docs].reverse()));
  });

  it('changes when content changes — this is what invalidates the answer cache', () => {
    const before = computeCorpusVersion([{ file: 'a.md', content: 'limit of 10 days' }]);
    const after = computeCorpusVersion([{ file: 'a.md', content: 'limit of 12 days' }]);

    expect(before).not.toBe(after);
  });
});

describe('buildChunks over the real corpus', () => {
  it('produces chunks with complete, traceable metadata', async () => {
    const chunks = await buildChunks(await readCorpus());

    expect(chunks.length).toBeGreaterThan(20);

    for (const chunk of chunks) {
      expect(chunk.metadata.file).toMatch(/\.md$/);
      expect(chunk.metadata.section.length).toBeGreaterThan(0);
      expect(chunk.metadata.chunkId).toContain('#');
      expect(chunk.metadata.corpusVersion).toHaveLength(12);
      expect(chunk.text.trim().length).toBeGreaterThan(0);
    }
  });

  it('prefixes the section title onto the chunk text', async () => {
    const chunks = await buildChunks(await readCorpus());
    const sellingVacation = chunks.find((c) => c.metadata.section.includes('Abono pecuniário'));

    expect(sellingVacation).toBeDefined();

    expect(sellingVacation!.text.startsWith('Abono pecuniário')).toBe(true);
  });

  it('generates unique chunk ids', async () => {
    const ids = (await buildChunks(await readCorpus())).map((c) => c.metadata.chunkId);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
