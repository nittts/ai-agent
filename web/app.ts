import type { AskResponse, Fonte, SseEvent } from '../src/http/contracts';

interface PerguntaDemo {
  id: string;
  categoria: string;
  texto: string;
  esperado: string;
  docEsperado: string | null;
}

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Elemento #${id} não existe no index.html`);
  return node as T;
};

const criar = (tag: string, classe?: string, texto?: string): HTMLElement => {
  const el = document.createElement(tag);
  if (classe) el.className = classe;
  if (texto !== undefined) el.textContent = texto;
  return el;
};

const linhaLeitura = (rotulo: string, valor: string, classe = ''): HTMLElement => {
  const linha = criar('div', 'leitura');
  linha.append(
    criar('dt', '', rotulo),
    criar('span', 'pontilhado'),
    criar('dd', classe, valor),
  );
  return linha;
};

const ms = (v: number | null): string => (v === null ? '—' : `${v} ms`);

const transcricao = $('transcricao');
const vazio = $('vazio');
const entrada = $<HTMLInputElement>('entrada');
const enviar = $<HTMLButtonElement>('enviar');
const form = $<HTMLFormElement>('form');
const presets = $<HTMLSelectElement>('presets');
const chaos = $<HTMLInputElement>('chaos');
const rotuloChaos = $('rotulo-chaos');

const medicao = $('medicao');
const cascata = $('cascata');
const fontesEl = $('fontes');
const avisosEl = $('avisos');
const secaoCascata = $('secao-cascata');
const secaoFontes = $('secao-fontes');
const secaoAvisos = $('secao-avisos');

let ocupado = false;

function renderMedicao(r: AskResponse): void {
  medicao.replaceChildren();

  const classeCache = r.cache === 'HIT' ? 'v-ok' : r.cache === 'OFF' ? 'v-neutro' : '';
  const estado = r.recusado ? 'recusado' : r.degradado ? 'degradado' : 'respondido';
  const classeEstado = r.degradado ? 'v-alerta' : r.recusado ? 'v-neutro' : 'v-ok';

  medicao.append(
    linhaLeitura('rota', r.rota),
    linhaLeitura('estado', estado, classeEstado),
    linhaLeitura('cache', r.cache, classeCache),
    linhaLeitura('1º token', ms(r.tempos.ttftMs)),
    linhaLeitura('total', ms(r.tempos.totalMs)),
    linhaLeitura('tokens', `${r.custo.tokensEntrada} / ${r.custo.tokensSaida}`),
    linhaLeitura(
      'custo',

      r.custo.custoUsd === 0 ? 'US$ 0' : `US$ ${r.custo.custoUsd.toFixed(6)}`,
      r.custo.custoUsd === 0 ? 'v-ok' : '',
    ),
  );
}

function renderCascata(porNo: Record<string, number> | null): void {
  cascata.replaceChildren();

  if (!porNo || Object.keys(porNo).length === 0) {
    secaoCascata.hidden = true;
    return;
  }

  const ordem = ['classificar', 'recuperar', 'consultarApi', 'avaliar', 'responder'];

  const houveFanOut = 'recuperar' in porNo && 'consultarApi' in porNo;
  const paralelos = new Set(houveFanOut ? ['recuperar', 'consultarApi'] : []);

  const entradas = ordem
    .filter((nome) => nome in porNo)
    .map((nome) => ({ nome, dur: porNo[nome] }));

  if (entradas.length === 0) {
    secaoCascata.hidden = true;
    return;
  }

  const maior = Math.max(...entradas.map((e) => e.dur), 1);

  for (const { nome, dur } of entradas) {
    const faixa = criar('div', 'faixa');
    const trilha = criar('div', 'trilha');
    const barra = criar('div', 'barra');

    barra.style.width = `${Math.max(2, (dur / maior) * 100)}%`;
    if (paralelos.has(nome)) barra.dataset.paralelo = 'true';

    trilha.append(barra);
    faixa.append(criar('span', 'nome', nome), trilha, criar('span', 'ms', String(dur)));
    cascata.append(faixa);
  }

  secaoCascata.hidden = false;
}

function renderFontes(fontes: Fonte[]): void {
  fontesEl.replaceChildren();

  if (fontes.length === 0) {
    secaoFontes.hidden = false;
    fontesEl.append(
      criar(
        'p',
        'placeholder',
        'Nenhuma fonte citada — a resposta foi uma recusa, e recusar sem fundamentação é o comportamento correto.',
      ),
    );
    return;
  }

  fontes.forEach((fonte, i) => {
    const bloco = criar('div', 'fonte');
    const corpo = criar('div');

    if (fonte.tipo === 'documento') {
      corpo.append(criar('div', 'onde', `${fonte.arquivo} § ${fonte.secao}`));
      corpo.append(criar('div', 'detalhe', `similaridade ${fonte.score.toFixed(3)}`));
      corpo.append(criar('div', 'trecho', fonte.trecho));
    } else {
      corpo.append(criar('div', 'onde', fonte.endpoint));
      corpo.append(
        criar('div', 'detalhe', `campos: ${fonte.campos.join(', ')} · ${fonte.latenciaMs} ms`),
      );
    }

    bloco.append(criar('div', 'n', String(i + 1)), corpo);
    fontesEl.append(bloco);
  });

  secaoFontes.hidden = false;
}

function renderAvisos(avisos: string[]): void {
  avisosEl.replaceChildren();
  secaoAvisos.hidden = avisos.length === 0;
  for (const aviso of avisos) avisosEl.append(criar('div', '', `• ${aviso}`));
}

function pintarCitacoes(alvo: HTMLElement, texto: string): void {
  alvo.replaceChildren();

  const partes = texto.split(/(\[\d+\])/g);
  for (const parte of partes) {
    if (/^\[\d+\]$/.test(parte)) alvo.append(criar('sup', 'cit', parte));
    else alvo.append(document.createTextNode(parte));
  }
}

function adicionarPergunta(texto: string): void {
  vazio.remove();
  transcricao.append(criar('div', 'turno-pergunta', texto));
}

function adicionarResposta(): HTMLElement {
  const el = criar('div', 'turno-resposta cursor');
  transcricao.append(el);
  return el;
}

const rolar = () => transcricao.scrollTo({ top: transcricao.scrollHeight, behavior: 'smooth' });

function perguntar(texto: string): void {
  if (ocupado || !texto.trim()) return;

  ocupado = true;
  enviar.disabled = true;
  entrada.value = '';

  adicionarPergunta(texto);
  const alvo = adicionarResposta();
  rolar();

  let acumulado = '';
  const fonte = new EventSource(`/ask/stream?q=${encodeURIComponent(texto)}`);

  const encerrar = () => {
    fonte.close();
    alvo.classList.remove('cursor');
    ocupado = false;
    enviar.disabled = false;
    entrada.focus();
  };

  fonte.onmessage = (evento) => {
    const dados = JSON.parse(evento.data) as SseEvent;

    switch (dados.tipo) {
      case 'token':
        acumulado += dados.texto;
        pintarCitacoes(alvo, acumulado);
        rolar();
        break;

      case 'fontes':
        renderFontes(dados.fontes);
        break;

      case 'fim': {
        const r = dados.resumo;
        if (r.recusado) alvo.dataset.recusado = 'true';

        if (!acumulado && r.resposta) pintarCitacoes(alvo, r.resposta);

        if (r.degradado) {
          alvo.append(criar('div', 'selo', 'respondido com uma fonte indisponível'));
        }

        renderMedicao(r);
        renderCascata(r.tempos.porNo);
        renderAvisos(r.avisos);
        rolar();
        encerrar();
        break;
      }

      case 'erro':
        alvo.textContent = `Falha ao responder: ${dados.mensagem} (correlationId ${dados.correlationId})`;
        encerrar();
        break;
    }
  };

  fonte.onerror = () => {
    if (!acumulado) alvo.textContent = 'Conexão interrompida. O serviço está no ar?';
    encerrar();
  };
}

async function carregarPresets(): Promise<void> {
  try {
    const resposta = await fetch('/demo/perguntas');
    if (!resposta.ok) return;

    const { perguntas, chaosDisponivel } = (await resposta.json()) as {
      perguntas: PerguntaDemo[];
      chaosDisponivel: boolean;
    };

    const categorias = [...new Set(perguntas.map((p) => p.categoria))];

    for (const categoria of categorias) {
      const grupo = document.createElement('optgroup');
      grupo.label = categoria.replace(/_/g, ' ');

      for (const pergunta of perguntas.filter((p) => p.categoria === categoria)) {
        const opcao = document.createElement('option');
        opcao.value = pergunta.texto;
        opcao.textContent = pergunta.texto;
        opcao.title = `Esperado: ${pergunta.esperado}`;
        grupo.append(opcao);
      }

      presets.append(grupo);
    }

    rotuloChaos.hidden = !chaosDisponivel;
  } catch {
    void 0;
  }
}

async function alternarChaos(ativo: boolean): Promise<void> {
  rotuloChaos.dataset.ativo = String(ativo);

  try {
    await fetch('/mock/v1/_chaos', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ modo: ativo ? '500' : 'ok' }),
    });
  } catch {
    chaos.checked = !ativo;
    rotuloChaos.dataset.ativo = String(!ativo);
  }
}

form.addEventListener('submit', (evento) => {
  evento.preventDefault();
  perguntar(entrada.value);
});

presets.addEventListener('change', () => {
  const escolhida = presets.value;
  if (!escolhida) return;

  entrada.value = escolhida;
  presets.selectedIndex = 0;
  perguntar(escolhida);
});

chaos.addEventListener('change', () => void alternarChaos(chaos.checked));

void carregarPresets();
entrada.focus();
