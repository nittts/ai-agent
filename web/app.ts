import type { AskResponse, DemoQuestion, Source, SseEvent } from '../src/presentation/http/api-contract';

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

const readout = (label: string, value: string, className = ''): HTMLElement => {
  const row = el('div', 'readout');
  row.append(el('dt', '', label), el('span', 'leader'), el('dd', className, value));
  return row;
};

const ms = (value: number | null): string => (value === null ? '—' : `${value} ms`);

const transcript = $('transcript');
const empty = $('empty');
const input = $<HTMLInputElement>('input');
const send = $<HTMLButtonElement>('send');
const form = $<HTMLFormElement>('form');
const presets = $<HTMLSelectElement>('presets');
const chaos = $<HTMLInputElement>('chaos');
const chaosLabel = $('chaos-label');

const measurements = $('measurements');
const waterfall = $('waterfall');
const waterfallNote = $('waterfall-note');
const sourcesEl = $('sources');
const warningsEl = $('warnings');
const waterfallSection = $('waterfall-section');
const sourcesSection = $('sources-section');
const warningsSection = $('warnings-section');

let busy = false;

const ROUTE_LABELS: Record<string, string> = {
  kb: 'políticas',
  tool: 'dados do RH',
  hybrid: 'políticas + RH',
  outOfScope: 'fora de escopo',
};

function renderMeasurements(result: AskResponse): void {
  measurements.replaceChildren();

  const cacheClass =
    result.cache === 'HIT' ? 'pill v-ok' : result.cache === 'OFF' ? 'v-neutral' : 'pill';

  const state = result.refused ? 'recusado' : result.degraded ? 'degradado' : 'respondido';
  const stateClass = result.degraded ? 'pill v-warn' : result.refused ? 'v-neutral' : 'pill v-ok';

  measurements.append(
    readout('rota', ROUTE_LABELS[result.route] ?? result.route, 'pill v-accent'),
    readout('estado', state, stateClass),
    readout('cache', result.cache, cacheClass),
    readout('1º token', ms(result.timings.ttftMs)),
    readout('total', ms(result.timings.totalMs)),
    readout('tokens', `${result.cost.inputTokens} / ${result.cost.outputTokens}`),
    readout(
      'custo',

      result.cost.usd === 0 ? 'US$ 0' : `US$ ${result.cost.usd.toFixed(6)}`,
      result.cost.usd === 0 ? 'v-ok' : '',
    ),
  );
}

function renderWaterfall(perNode: Record<string, number> | null): void {
  waterfall.replaceChildren();
  waterfallNote.textContent = '';

  if (!perNode || Object.keys(perNode).length === 0) {
    waterfallSection.hidden = true;
    return;
  }

  const order = ['classify', 'retrieve', 'callHrApi', 'grade', 'generateAnswer', 'refuse'];

  const hadFanOut = 'retrieve' in perNode && 'callHrApi' in perNode;
  const parallel = new Set(hadFanOut ? ['retrieve', 'callHrApi'] : []);

  const entries = order.filter((name) => name in perNode).map((name) => ({ name, ms: perNode[name] }));

  if (entries.length === 0) {
    waterfallSection.hidden = true;
    return;
  }

  const longest = Math.max(...entries.map((e) => e.ms), 1);

  for (const { name, ms: duration } of entries) {
    const lane = el('div', 'lane');
    const track = el('div', 'track');
    const bar = el('div', 'bar');

    bar.style.width = `${Math.max(2, (duration / longest) * 100)}%`;
    if (parallel.has(name)) bar.dataset.parallel = 'true';

    track.append(bar);
    lane.append(el('span', 'name', name), track, el('span', 'ms', String(duration)));
    waterfall.append(lane);
  }

  waterfallNote.textContent = hadFanOut
    ? 'As barras hachuradas rodaram em paralelo, no mesmo superstep do grafo — somá-las superestimaria o total.'
    : '';

  waterfallSection.hidden = false;
}

function renderSources(sources: Source[]): void {
  sourcesEl.replaceChildren();

  if (sources.length === 0) {
    sourcesSection.hidden = false;
    sourcesEl.append(
      el(
        'p',
        'placeholder',
        'Nenhuma fonte citada — a resposta foi uma recusa, e recusar sem fundamentação é o comportamento correto.',
      ),
    );
    return;
  }

  sources.forEach((source, i) => {
    const block = el('div', 'source');
    const body = el('div');

    if (source.kind === 'document') {
      body.append(el('div', 'where', `${source.file} § ${source.section}`));
      body.append(el('div', 'detail', `similaridade ${source.score.toFixed(3)}`));
      body.append(el('div', 'excerpt', source.excerpt));
    } else {
      body.append(el('div', 'where', source.endpoint));
      body.append(
        el('div', 'detail', `campos: ${source.fields.join(', ')} · ${source.latencyMs} ms`),
      );
    }

    block.append(el('div', 'n', String(i + 1)), body);
    sourcesEl.append(block);
  });

  sourcesSection.hidden = false;
}

function renderWarnings(warnings: string[]): void {
  warningsEl.replaceChildren();
  warningsSection.hidden = warnings.length === 0;
  for (const warning of warnings) warningsEl.append(el('div', '', `• ${warning}`));
}

function paintCitations(target: HTMLElement, text: string): void {
  target.replaceChildren();

  for (const part of text.split(/(\[\d+\])/g)) {
    if (/^\[\d+\]$/.test(part)) target.append(el('sup', 'cite', part));
    else target.append(document.createTextNode(part));
  }
}

function addQuestion(text: string): void {
  empty.remove();
  const turn = el('div', 'turn-question');
  turn.append(el('span', '', text));
  transcript.append(turn);
}

function addAnswer(): HTMLElement {
  const node = el('div', 'turn-answer caret');
  transcript.append(node);
  return node;
}

const scroll = () => transcript.scrollTo({ top: transcript.scrollHeight, behavior: 'smooth' });

function ask(text: string): void {
  if (busy || !text.trim()) return;

  busy = true;
  send.disabled = true;
  input.value = '';

  addQuestion(text);
  const target = addAnswer();
  scroll();

  let accumulated = '';
  const stream = new EventSource(`/ask/stream?q=${encodeURIComponent(text)}`);

  const finish = () => {
    stream.close();
    target.classList.remove('caret');
    busy = false;
    send.disabled = false;
    input.focus();
  };

  stream.onmessage = (message) => {
    const event = JSON.parse(message.data) as SseEvent;

    switch (event.type) {
      case 'token':
        accumulated += event.text;
        paintCitations(target, accumulated);
        scroll();
        break;

      case 'sources':
        renderSources(event.sources);
        break;

      case 'done': {
        const result = event.summary;
        if (result.refused) target.dataset.refused = 'true';

        if (!accumulated && result.answer) paintCitations(target, result.answer);

        if (result.degraded) {
          target.append(el('div', 'badge', 'respondido com uma fonte indisponível'));
        }

        renderMeasurements(result);
        renderWaterfall(result.timings.perNode);
        renderWarnings(result.warnings);
        scroll();
        finish();
        break;
      }

      case 'error':
        target.textContent = `Falha ao responder: ${event.message} (correlationId ${event.correlationId})`;
        finish();
        break;
    }
  };

  stream.onerror = () => {
    if (!accumulated) target.textContent = 'Conexão interrompida. O serviço está no ar?';
    finish();
  };
}

const CATEGORY_LABELS: Record<string, string> = {
  kbSimple: 'política — direta',
  kbMulti: 'política — múltiplos documentos',
  tool: 'dados do colaborador',
  hybrid: 'política + dados',
  outOfScope: 'fora de escopo',
  adversarial: 'adversarial',
};

async function loadPresets(): Promise<void> {
  try {
    const response = await fetch('/demo/questions');
    if (!response.ok) return;

    const { questions, chaosAvailable } = (await response.json()) as {
      questions: DemoQuestion[];
      chaosAvailable: boolean;
    };

    for (const category of [...new Set(questions.map((q) => q.category))]) {
      const group = document.createElement('optgroup');
      group.label = CATEGORY_LABELS[category] ?? category;

      for (const question of questions.filter((q) => q.category === category)) {
        const option = document.createElement('option');
        option.value = question.text;
        option.textContent = question.text;
        option.title = `Esperado: ${question.expected}`;
        group.append(option);
      }

      presets.append(group);
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

presets.addEventListener('change', () => {
  const chosen = presets.value;
  if (!chosen) return;

  input.value = chosen;
  presets.selectedIndex = 0;
  ask(chosen);
});

chaos.addEventListener('change', () => void toggleChaos(chaos.checked));

void loadPresets();
input.focus();
