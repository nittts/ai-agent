export type Inline =
  | { type: 'text'; value: string }
  | { type: 'strong'; value: string }
  | { type: 'em'; value: string }
  | { type: 'code'; value: string }

  | { type: 'citation'; value: string };

export type Block =
  | { type: 'paragraph'; inline: Inline[] }
  | { type: 'heading'; level: number; inline: Inline[] }
  | { type: 'list'; ordered: boolean; items: Inline[][] }
  | { type: 'code'; text: string };

const INLINE_PATTERN =
  /(`[^`\n]+`)|(\*\*[^\n]+?\*\*)|(\*[^*\n]+?\*)|(_[^_\n]+?_)|(\[\d+\])/g;

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;

  for (const match of text.matchAll(INLINE_PATTERN)) {
    const index = match.index ?? 0;

    if (index > last) out.push({ type: 'text', value: text.slice(last, index) });

    const [token] = match;

    if (token.startsWith('`')) out.push({ type: 'code', value: token.slice(1, -1) });
    else if (token.startsWith('**')) out.push({ type: 'strong', value: token.slice(2, -2) });
    else if (token.startsWith('*')) out.push({ type: 'em', value: token.slice(1, -1) });
    else if (token.startsWith('_')) out.push({ type: 'em', value: token.slice(1, -1) });
    else out.push({ type: 'citation', value: token });

    last = index + token.length;
  }

  if (last < text.length) out.push({ type: 'text', value: text.slice(last) });

  return out;
}

const HEADING = /^(#{1,6})\s+(.*)$/;
const BULLET = /^\s*[-*+]\s+(.*)$/;
const ORDERED = /^\s*\d+[.)]\s+(.*)$/;
const FENCE = /^\s*```/;

export function parseMarkdown(source: string): Block[] {
  const lines = source.split('\n');
  const blocks: Block[] = [];

  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let fence: string[] | null = null;

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    blocks.push({ type: 'paragraph', inline: parseInline(paragraph.join(' ').trim()) });
    paragraph = [];
  };

  const flushList = () => {
    if (!list) return;
    blocks.push({
      type: 'list',
      ordered: list.ordered,
      items: list.items.map((item) => parseInline(item)),
    });
    list = null;
  };

  const flushAll = () => {
    flushParagraph();
    flushList();
  };

  for (const line of lines) {
    if (fence !== null) {
      if (FENCE.test(line)) {
        blocks.push({ type: 'code', text: fence.join('\n') });
        fence = null;
      } else {
        fence.push(line);
      }
      continue;
    }

    if (FENCE.test(line)) {
      flushAll();
      fence = [];
      continue;
    }

    if (line.trim() === '') {
      flushAll();
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      flushAll();
      blocks.push({
        type: 'heading',
        level: heading[1].length,
        inline: parseInline(heading[2].trim()),
      });
      continue;
    }

    const ordered = ORDERED.exec(line);
    if (ordered) {
      flushParagraph();
      if (!list || !list.ordered) {
        flushList();
        list = { ordered: true, items: [] };
      }
      list.items.push(ordered[1].trim());
      continue;
    }

    const bullet = BULLET.exec(line);
    if (bullet) {
      flushParagraph();
      if (!list || list.ordered) {
        flushList();
        list = { ordered: false, items: [] };
      }
      list.items.push(bullet[1].trim());
      continue;
    }

    if (list && list.items.length > 0) {
      list.items[list.items.length - 1] += ` ${line.trim()}`;
      continue;
    }

    paragraph.push(line.trim());
  }

  if (fence !== null && fence.length > 0) blocks.push({ type: 'code', text: fence.join('\n') });
  flushAll();

  return blocks;
}
