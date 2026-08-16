import type {
  AskResponse,
  DemoQuestion,
  HealthResponse,
  Source,
  SseEvent,
} from '../src/presentation/http/api-contract';
import { parseMarkdown, type Inline } from '../src/shared/markdown/parse';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Element #${id} is missing from index.html`);
  return node as T;
};

const el = (tag: string, className?: string, text?: string): HTMLElement => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

const row = (label: string, value: string, valueClass = ''): HTMLElement => {
  const line = el('div', 'row');
  line.append(el('dt', '', label), el('span', 'dots'), el('dd', valueClass, value));
  return line;
};

const ms = (value: number | null): string => (value === null ? '—' : `${value} ms`);

const thread = $('thread');
const threadInner = $('thread-inner');
const welcome = $('welcome');
const suggestions = $('suggestions');
const input = $<HTMLInputElement>('input');
const send = $<HTMLButtonElement>('send');
const form = $<HTMLFormElement>('form');
const chaos = $<HTMLInputElement>('chaos');
const chaosLabel = $('chaos-label');
const facts = $('facts');

const measure = $('measure');
const falls = $('falls');
const fallsNote = $('falls-note');
const sourcesEl = $('sources');
const warningsEl = $('warnings');
const notesEl = $('notes');
const secFalls = $('sec-falls');
const secSrc = $('sec-src');
const secWarn = $('sec-warn');
const secNote = $('sec-note');

let busy = false;

const ROUTE_LABEL: Record<string, string> = {
  kb: 'políticas',
  tool: 'dados do RH',
  hybrid: 'políticas + RH',
  outOfScope: 'fora de escopo',
  meta: 'sobre o assistente',
};

const REFUSAL_LABEL: Record<string, string> = {
  outOfScope: 'fora de escopo',
  notGrounded: 'sem fundamentação',
  missingIdentification: 'falta matrícula',
  sourcesUnavailable: 'fontes indisponíveis',
  timedOut: 'tempo esgotado',
};

const SUGGESTED: { category: string; label: string; take: number }[] = [
  { category: 'kbSimple', label: 'Políticas', take: 3 },
  { category: 'hybrid', label: 'Suas informações + política', take: 2 },
  { category: 'outOfScope', label: 'Fora de escopo (o agente recusa)', take: 1 },
  { category: 'meta', label: 'Sobre o assistente', take: 1 },
];

function renderIdleEvidence(health: HealthResponse | null): void {
  measure.replaceChildren();

  if (!health) {
    measure.append(el('p', 'hint', 'Faça uma pergunta para ver a medição desta resposta.'));
    return;
  }

  measure.append(
    row('provider', health.llm.provider, health.llm.provider === 'fake' ? 'tag t-warn' : 'tag t-ok'),
    row('modelo', health.llm.chatModel ?? 'determinístico'),
    row('embeddings', health.llm.embeddingModel ?? 'determinístico'),
    row('cache', health.cache.enabled ? `ligado · ${health.cache.ttlSeconds}s` : 'desligado',
      health.cache.enabled ? 'tag t-ok' : 't-quiet'),
  );

  measure.append(
    el(
      'p',
      'hint',
      'Faça uma pergunta: aqui aparecem a rota escolhida, o tempo de cada etapa do grafo, ' +
        'as fontes citadas e o custo em tokens.',
    ),
  );
}

function renderMeasurements(result: AskResponse): void {
  measure.replaceChildren();

  const cacheClass = result.cache === 'HIT' ? 'tag t-ok' : result.cache === 'OFF' ? 't-quiet' : '';

  const state = result.refused
    ? `recusado · ${REFUSAL_LABEL[result.refusalReason ?? ''] ?? 'recusado'}`
    : result.degraded
      ? 'degradado'
      : 'respondido';

  const stateClass = result.degraded ? 'tag t-warn' : result.refused ? 't-quiet' : 'tag t-ok';

  measure.append(
    row('rota', ROUTE_LABEL[result.route] ?? result.route, 'tag t-accent'),
    row('estado', state, stateClass),
    row('cache', result.cache, cacheClass),
    row('1º token', ms(result.timings.ttftMs)),
    row('total', ms(result.timings.totalMs)),
    row('tokens', `${result.cost.inputTokens} / ${result.cost.outputTokens}`),
    row(
      'custo',

      result.cost.usd === 0 ? 'US$ 0' : `US$ ${result.cost.usd.toFixed(6)}`,
      result.cost.usd === 0 ? 't-ok' : '',
    ),
  );
}

function renderWaterfall(perNode: Record<string, number> | null): void {
  falls.replaceChildren();
  fallsNote.textContent = '';

  if (!perNode || Object.keys(perNode).length === 0) {
    secFalls.hidden = true;
    return;
  }

  const order = ['classify', 'retrieve', 'callHrApi', 'grade', 'generateAnswer', 'refuse'];

  const hadFanOut = 'retrieve' in perNode && 'callHrApi' in perNode;
  const parallel = new Set(hadFanOut ? ['retrieve', 'callHrApi'] : []);

  const entries = order.filter((n) => n in perNode).map((n) => ({ name: n, ms: perNode[n] }));
  if (entries.length === 0) {
    secFalls.hidden = true;
    return;
  }

  const longest = Math.max(...entries.map((e) => e.ms), 1);

  for (const { name, ms: duration } of entries) {
    const lane = el('div', 'fall');
    const rail = el('div', 'rail');
    const bar = el('div', 'bar');

    bar.style.width = `${Math.max(2, (duration / longest) * 100)}%`;
    if (parallel.has(name)) bar.dataset.par = 'true';

    rail.append(bar);
    lane.append(el('span', 'n', name), rail, el('span', 'ms', String(duration)));
    falls.append(lane);
  }

  fallsNote.textContent = hadFanOut
    ? 'As barras hachuradas rodaram em paralelo, no mesmo superstep do grafo — somá-las superestimaria o total.'
    : '';

  secFalls.hidden = false;
}

function renderSources(sources: Source[]): void {
  sourcesEl.replaceChildren();

  if (sources.length === 0) {
    secSrc.hidden = false;
    sourcesEl.append(
      el(
        'p',
        'hint',
        'Nenhuma fonte citada — a resposta foi uma recusa, e recusar sem fundamentação é o comportamento correto.',
      ),
    );
    return;
  }

  sources.forEach((source, i) => {
    const block = el('div', 'src');
    const body = el('div');

    if (source.kind === 'document') {
      body.append(el('div', 'w', `${source.file} § ${source.section}`));
      body.append(el('div', 'd', `similaridade ${source.score.toFixed(3)}`));
      body.append(el('div', 'x', source.excerpt));
    } else {
      body.append(el('div', 'w', source.endpoint));
      body.append(el('div', 'd', `campos: ${source.fields.join(', ')} · ${source.latencyMs} ms`));
    }

    block.append(el('div', 'i', String(i + 1)), body);
    sourcesEl.append(block);
  });

  secSrc.hidden = false;
}

function renderWarnings(warnings: string[]): void {
  warningsEl.replaceChildren();
  secWarn.hidden = warnings.length === 0;
  for (const warning of warnings) warningsEl.append(el('div', '', `• ${warning}`));
}

function renderNotes(notes: string[]): void {
  notesEl.replaceChildren();
  secNote.hidden = notes.length === 0;
  for (const note of notes) notesEl.append(el('div', '', note));
}

function paintInline(parent: Node, tokens: Inline[]): void {
  for (const token of tokens) {
    switch (token.type) {
      case 'strong':
        parent.appendChild(el('strong', '', token.value));
        break;
      case 'em':
        parent.appendChild(el('em', '', token.value));
        break;
      case 'code':
        parent.appendChild(el('code', '', token.value));
        break;
      case 'citation':
        parent.appendChild(el('sup', 'cite', token.value));
        break;
      default:
        parent.appendChild(document.createTextNode(token.value));
    }
  }
}

function renderAnswer(target: HTMLElement, markdown: string): void {
  target.replaceChildren();

  for (const block of parseMarkdown(markdown)) {
    switch (block.type) {
      case 'heading': {
        const heading = el('div', `md-h md-h${Math.min(block.level, 3)}`);
        paintInline(heading, block.inline);
        target.append(heading);
        break;
      }
      case 'list': {
        const list = el(block.ordered ? 'ol' : 'ul', 'md-list');
        for (const item of block.items) {
          const li = el('li');
          paintInline(li, item);
          list.append(li);
        }
        target.append(list);
        break;
      }
      case 'code':
        target.append(el('pre', 'md-pre', block.text));
        break;
      default: {
        const paragraph = el('p', 'md-p');
        paintInline(paragraph, block.inline);
        target.append(paragraph);
      }
    }
  }
}

function addQuestion(text: string): void {
  welcome.remove();
  threadInner.append(el('div', 'q', text));
}

function addAnswer(): HTMLElement {
  const node = el('div', 'a caret');
  threadInner.append(node);
  return node;
}

const scroll = () => thread.scrollTo({ top: thread.scrollHeight, behavior: 'smooth' });

const REVEAL_FRAMES = 12;

const prefersReducedMotion = () =>
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

function ask(text: string): void {
  if (busy || !text.trim()) return;

  busy = true;
  send.disabled = true;
  input.value = '';

  addQuestion(text);
  const target = addAnswer();
  scroll();

  const stream = new EventSource(`/ask/stream?q=${encodeURIComponent(text)}`);

  let pending = '';
  let revealed = '';
  let streamEnded = false;
  let frame = 0;
  let receivedAnything = false;

  const finish = () => {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;

    if (pending) {
      revealed += pending;
      pending = '';
      renderAnswer(target, revealed);
    }

    stream.close();
    target.classList.remove('caret');
    busy = false;
    send.disabled = false;
    input.focus();
  };

  const pump = () => {
    if (pending.length > 0) {
      const take = Math.max(2, Math.ceil(pending.length / REVEAL_FRAMES));
      revealed += pending.slice(0, take);
      pending = pending.slice(take);
      renderAnswer(target, revealed);
      scroll();
    }

    if (pending.length === 0 && streamEnded) {
      finish();
      return;
    }

    frame = requestAnimationFrame(pump);
  };

  const push = (chunk: string) => {
    receivedAnything = true;

    if (prefersReducedMotion()) {
      revealed += chunk;
      renderAnswer(target, revealed);
      scroll();
      return;
    }

    pending += chunk;
    if (!frame) frame = requestAnimationFrame(pump);
  };

  stream.onmessage = (message) => {
    const event = JSON.parse(message.data) as SseEvent;

    switch (event.type) {
      case 'token':
        push(event.text);
        break;

      case 'sources':
        renderSources(event.sources);
        break;

      case 'done': {
        const result = event.summary;
        if (result.refused) target.dataset.refused = 'true';

        if (!receivedAnything && result.answer) {
          revealed = result.answer;
          renderAnswer(target, revealed);
        }

        if (result.degraded && !result.refused) {
          target.append(el('div', 'flag', 'respondido com uma fonte indisponível'));
        }

        renderMeasurements(result);
        renderWaterfall(result.timings.perNode);
        renderWarnings(result.warnings);
        renderNotes(result.notes);
        scroll();

        streamEnded = true;
        if (!frame) finish();
        break;
      }

      case 'error':
        pending = '';
        target.textContent = `Falha ao responder: ${event.message} (correlationId ${event.correlationId})`;
        streamEnded = true;
        finish();
        break;
    }
  };

  stream.onerror = () => {
    if (!receivedAnything) target.textContent = 'Conexão interrompida. O serviço está no ar?';
    streamEnded = true;
    finish();
  };
}

async function loadHealth(): Promise<HealthResponse | null> {
  try {
    const response = await fetch('/health');
    if (!response.ok) return null;

    const health = (await response.json()) as HealthResponse;

    facts.replaceChildren();

    const modelFact = el('span', 'fact');
    modelFact.append(el('b', '', health.llm.chatModel ?? 'modelo determinístico'));
    facts.append(modelFact);

    const cacheFact = el('span', 'fact', health.cache.enabled ? 'cache ligado' : 'cache desligado');
    cacheFact.dataset.off = String(!health.cache.enabled);
    facts.append(cacheFact);

    return health;
  } catch {
    return null;
  }
}

async function loadSuggestions(): Promise<void> {
  try {
    const response = await fetch('/demo/questions');
    if (!response.ok) return;

    const { questions, chaosAvailable } = (await response.json()) as {
      questions: DemoQuestion[];
      chaosAvailable: boolean;
    };

    suggestions.replaceChildren();

    for (const group of SUGGESTED) {
      const picked = questions.filter((q) => q.category === group.category).slice(0, group.take);
      if (picked.length === 0) continue;

      const block = el('div', 'suggest-group');
      block.append(el('span', 'label', group.label));

      const chips = el('div', 'chips');
      for (const question of picked) {
        const chip = el('button', 'chip', question.text) as HTMLButtonElement;
        chip.type = 'button';
        chip.title = `Esperado: ${question.expected}`;
        chip.addEventListener('click', () => ask(question.text));
        chips.append(chip);
      }

      block.append(chips);
      suggestions.append(block);
    }

    chaosLabel.hidden = !chaosAvailable;
  } catch {
    void 0;
  }
}

async function toggleChaos(on: boolean): Promise<void> {
  chaosLabel.dataset.on = String(on);

  try {
    await fetch('/mock/v1/_chaos', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: on ? '500' : 'ok' }),
    });
  } catch {
    chaos.checked = !on;
    chaosLabel.dataset.on = String(!on);
  }
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  ask(input.value);
});

chaos.addEventListener('change', () => void toggleChaos(chaos.checked));

void (async () => {
  const health = await loadHealth();
  renderIdleEvidence(health);
  await loadSuggestions();
  input.focus();
})();
