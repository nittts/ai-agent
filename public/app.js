"use strict";
(() => {
  // web/app.ts
  var $ = (id) => {
    const node = document.getElementById(id);
    if (!node) throw new Error(`Element #${id} is missing from index.html`);
    return node;
  };
  var el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== void 0) node.textContent = text;
    return node;
  };
  var readout = (label, value, className = "") => {
    const row = el("div", "readout");
    row.append(el("dt", "", label), el("span", "leader"), el("dd", className, value));
    return row;
  };
  var ms = (value) => value === null ? "\u2014" : `${value} ms`;
  var transcript = $("transcript");
  var empty = $("empty");
  var input = $("input");
  var send = $("send");
  var form = $("form");
  var presets = $("presets");
  var chaos = $("chaos");
  var chaosLabel = $("chaos-label");
  var measurements = $("measurements");
  var waterfall = $("waterfall");
  var waterfallNote = $("waterfall-note");
  var sourcesEl = $("sources");
  var warningsEl = $("warnings");
  var waterfallSection = $("waterfall-section");
  var sourcesSection = $("sources-section");
  var warningsSection = $("warnings-section");
  var busy = false;
  var ROUTE_LABELS = {
    kb: "pol\xEDticas",
    tool: "dados do RH",
    hybrid: "pol\xEDticas + RH",
    outOfScope: "fora de escopo"
  };
  function renderMeasurements(result) {
    measurements.replaceChildren();
    const cacheClass = result.cache === "HIT" ? "pill v-ok" : result.cache === "OFF" ? "v-neutral" : "pill";
    const state = result.refused ? "recusado" : result.degraded ? "degradado" : "respondido";
    const stateClass = result.degraded ? "pill v-warn" : result.refused ? "v-neutral" : "pill v-ok";
    measurements.append(
      readout("rota", ROUTE_LABELS[result.route] ?? result.route, "pill v-accent"),
      readout("estado", state, stateClass),
      readout("cache", result.cache, cacheClass),
      readout("1\xBA token", ms(result.timings.ttftMs)),
      readout("total", ms(result.timings.totalMs)),
      readout("tokens", `${result.cost.inputTokens} / ${result.cost.outputTokens}`),
      readout(
        "custo",

        result.cost.usd === 0 ? "US$ 0" : `US$ ${result.cost.usd.toFixed(6)}`,
        result.cost.usd === 0 ? "v-ok" : ""
      )
    );
  }
  function renderWaterfall(perNode) {
    waterfall.replaceChildren();
    waterfallNote.textContent = "";
    if (!perNode || Object.keys(perNode).length === 0) {
      waterfallSection.hidden = true;
      return;
    }
    const order = ["classify", "retrieve", "callHrApi", "grade", "generateAnswer", "refuse"];
    const hadFanOut = "retrieve" in perNode && "callHrApi" in perNode;
    const parallel = new Set(hadFanOut ? ["retrieve", "callHrApi"] : []);
    const entries = order.filter((name) => name in perNode).map((name) => ({ name, ms: perNode[name] }));
    if (entries.length === 0) {
      waterfallSection.hidden = true;
      return;
    }
    const longest = Math.max(...entries.map((e) => e.ms), 1);
    for (const { name, ms: duration } of entries) {
      const lane = el("div", "lane");
      const track = el("div", "track");
      const bar = el("div", "bar");
      bar.style.width = `${Math.max(2, duration / longest * 100)}%`;
      if (parallel.has(name)) bar.dataset.parallel = "true";
      track.append(bar);
      lane.append(el("span", "name", name), track, el("span", "ms", String(duration)));
      waterfall.append(lane);
    }
    waterfallNote.textContent = hadFanOut ? "As barras hachuradas rodaram em paralelo, no mesmo superstep do grafo \u2014 som\xE1-las superestimaria o total." : "";
    waterfallSection.hidden = false;
  }
  function renderSources(sources) {
    sourcesEl.replaceChildren();
    if (sources.length === 0) {
      sourcesSection.hidden = false;
      sourcesEl.append(
        el(
          "p",
          "placeholder",
          "Nenhuma fonte citada \u2014 a resposta foi uma recusa, e recusar sem fundamenta\xE7\xE3o \xE9 o comportamento correto."
        )
      );
      return;
    }
    sources.forEach((source, i) => {
      const block = el("div", "source");
      const body = el("div");
      if (source.kind === "document") {
        body.append(el("div", "where", `${source.file} \xA7 ${source.section}`));
        body.append(el("div", "detail", `similaridade ${source.score.toFixed(3)}`));
        body.append(el("div", "excerpt", source.excerpt));
      } else {
        body.append(el("div", "where", source.endpoint));
        body.append(
          el("div", "detail", `campos: ${source.fields.join(", ")} \xB7 ${source.latencyMs} ms`)
        );
      }
      block.append(el("div", "n", String(i + 1)), body);
      sourcesEl.append(block);
    });
    sourcesSection.hidden = false;
  }
  function renderWarnings(warnings) {
    warningsEl.replaceChildren();
    warningsSection.hidden = warnings.length === 0;
    for (const warning of warnings) warningsEl.append(el("div", "", `\u2022 ${warning}`));
  }
  function paintCitations(target, text) {
    target.replaceChildren();
    for (const part of text.split(/(\[\d+\])/g)) {
      if (/^\[\d+\]$/.test(part)) target.append(el("sup", "cite", part));
      else target.append(document.createTextNode(part));
    }
  }
  function addQuestion(text) {
    empty.remove();
    const turn = el("div", "turn-question");
    turn.append(el("span", "", text));
    transcript.append(turn);
  }
  function addAnswer() {
    const node = el("div", "turn-answer caret");
    transcript.append(node);
    return node;
  }
  var scroll = () => transcript.scrollTo({ top: transcript.scrollHeight, behavior: "smooth" });
  function ask(text) {
    if (busy || !text.trim()) return;
    busy = true;
    send.disabled = true;
    input.value = "";
    addQuestion(text);
    const target = addAnswer();
    scroll();
    let accumulated = "";
    const stream = new EventSource(`/ask/stream?q=${encodeURIComponent(text)}`);
    const finish = () => {
      stream.close();
      target.classList.remove("caret");
      busy = false;
      send.disabled = false;
      input.focus();
    };
    stream.onmessage = (message) => {
      const event = JSON.parse(message.data);
      switch (event.type) {
        case "token":
          accumulated += event.text;
          paintCitations(target, accumulated);
          scroll();
          break;
        case "sources":
          renderSources(event.sources);
          break;
        case "done": {
          const result = event.summary;
          if (result.refused) target.dataset.refused = "true";
          if (!accumulated && result.answer) paintCitations(target, result.answer);
          if (result.degraded) {
            target.append(el("div", "badge", "respondido com uma fonte indispon\xEDvel"));
          }
          renderMeasurements(result);
          renderWaterfall(result.timings.perNode);
          renderWarnings(result.warnings);
          scroll();
          finish();
          break;
        }
        case "error":
          target.textContent = `Falha ao responder: ${event.message} (correlationId ${event.correlationId})`;
          finish();
          break;
      }
    };
    stream.onerror = () => {
      if (!accumulated) target.textContent = "Conex\xE3o interrompida. O servi\xE7o est\xE1 no ar?";
      finish();
    };
  }
  var CATEGORY_LABELS = {
    kbSimple: "pol\xEDtica \u2014 direta",
    kbMulti: "pol\xEDtica \u2014 m\xFAltiplos documentos",
    tool: "dados do colaborador",
    hybrid: "pol\xEDtica + dados",
    outOfScope: "fora de escopo",
    adversarial: "adversarial"
  };
  async function loadPresets() {
    try {
      const response = await fetch("/demo/questions");
      if (!response.ok) return;
      const { questions, chaosAvailable } = await response.json();
      for (const category of [...new Set(questions.map((q) => q.category))]) {
        const group = document.createElement("optgroup");
        group.label = CATEGORY_LABELS[category] ?? category;
        for (const question of questions.filter((q) => q.category === category)) {
          const option = document.createElement("option");
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
  async function toggleChaos(on) {
    chaosLabel.dataset.on = String(on);
    try {
      await fetch("/mock/v1/_chaos", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: on ? "500" : "ok" })
      });
    } catch {
      chaos.checked = !on;
      chaosLabel.dataset.on = String(!on);
    }
  }
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    ask(input.value);
  });
  presets.addEventListener("change", () => {
    const chosen = presets.value;
    if (!chosen) return;
    input.value = chosen;
    presets.selectedIndex = 0;
    ask(chosen);
  });
  chaos.addEventListener("change", () => void toggleChaos(chaos.checked));
  void loadPresets();
  input.focus();
})();
