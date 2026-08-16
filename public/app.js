"use strict";
(() => {
  // src/shared/markdown/parse.ts
  var INLINE_PATTERN = /(`[^`\n]+`)|(\*\*[^\n]+?\*\*)|(\*[^*\n]+?\*)|(_[^_\n]+?_)|(\[\d+\])/g;
  function parseInline(text) {
    const out = [];
    let last = 0;
    for (const match of text.matchAll(INLINE_PATTERN)) {
      const index = match.index ?? 0;
      if (index > last) out.push({ type: "text", value: text.slice(last, index) });
      const [token] = match;
      if (token.startsWith("`")) out.push({ type: "code", value: token.slice(1, -1) });
      else if (token.startsWith("**")) out.push({ type: "strong", value: token.slice(2, -2) });
      else if (token.startsWith("*")) out.push({ type: "em", value: token.slice(1, -1) });
      else if (token.startsWith("_")) out.push({ type: "em", value: token.slice(1, -1) });
      else out.push({ type: "citation", value: token });
      last = index + token.length;
    }
    if (last < text.length) out.push({ type: "text", value: text.slice(last) });
    return out;
  }
  var HEADING = /^(#{1,6})\s+(.*)$/;
  var BULLET = /^\s*[-*+]\s+(.*)$/;
  var ORDERED = /^\s*\d+[.)]\s+(.*)$/;
  var FENCE = /^\s*```/;
  function parseMarkdown(source) {
    const lines = source.split("\n");
    const blocks = [];
    let paragraph = [];
    let list = null;
    let fence = null;
    const flushParagraph = () => {
      if (paragraph.length === 0) return;
      blocks.push({ type: "paragraph", inline: parseInline(paragraph.join(" ").trim()) });
      paragraph = [];
    };
    const flushList = () => {
      if (!list) return;
      blocks.push({
        type: "list",
        ordered: list.ordered,
        items: list.items.map((item) => parseInline(item))
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
          blocks.push({ type: "code", text: fence.join("\n") });
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
      if (line.trim() === "") {
        flushAll();
        continue;
      }
      const heading = HEADING.exec(line);
      if (heading) {
        flushAll();
        blocks.push({
          type: "heading",
          level: heading[1].length,
          inline: parseInline(heading[2].trim())
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
    if (fence !== null && fence.length > 0) blocks.push({ type: "code", text: fence.join("\n") });
    flushAll();
    return blocks;
  }

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
  var row = (label, value, valueClass = "") => {
    const line = el("div", "row");
    line.append(el("dt", "", label), el("span", "dots"), el("dd", valueClass, value));
    return line;
  };
  var ms = (value) => value === null ? "\u2014" : `${value} ms`;
  var thread = $("thread");
  var threadInner = $("thread-inner");
  var welcome = $("welcome");
  var suggestions = $("suggestions");
  var input = $("input");
  var send = $("send");
  var form = $("form");
  var chaos = $("chaos");
  var chaosLabel = $("chaos-label");
  var facts = $("facts");
  var measure = $("measure");
  var falls = $("falls");
  var fallsNote = $("falls-note");
  var sourcesEl = $("sources");
  var warningsEl = $("warnings");
  var secFalls = $("sec-falls");
  var secSrc = $("sec-src");
  var secWarn = $("sec-warn");
  var busy = false;
  var ROUTE_LABEL = {
    kb: "pol\xEDticas",
    tool: "dados do RH",
    hybrid: "pol\xEDticas + RH",
    outOfScope: "fora de escopo"
  };
  var REFUSAL_LABEL = {
    outOfScope: "fora de escopo",
    notGrounded: "sem fundamenta\xE7\xE3o",
    missingIdentification: "falta matr\xEDcula",
    sourcesUnavailable: "fontes indispon\xEDveis",
    timedOut: "tempo esgotado"
  };
  var SUGGESTED = [
    { category: "kbSimple", label: "Pol\xEDticas", take: 3 },
    { category: "hybrid", label: "Suas informa\xE7\xF5es + pol\xEDtica", take: 2 },
    { category: "outOfScope", label: "Fora de escopo (o agente recusa)", take: 1 }
  ];
  function renderIdleEvidence(health) {
    measure.replaceChildren();
    if (!health) {
      measure.append(el("p", "hint", "Fa\xE7a uma pergunta para ver a medi\xE7\xE3o desta resposta."));
      return;
    }
    measure.append(
      row("provider", health.llm.provider, health.llm.provider === "fake" ? "tag t-warn" : "tag t-ok"),
      row("modelo", health.llm.chatModel ?? "determin\xEDstico"),
      row("embeddings", health.llm.embeddingModel ?? "determin\xEDstico"),
      row(
        "cache",
        health.cache.enabled ? `ligado \xB7 ${health.cache.ttlSeconds}s` : "desligado",
        health.cache.enabled ? "tag t-ok" : "t-quiet"
      )
    );
    measure.append(
      el(
        "p",
        "hint",
        "Fa\xE7a uma pergunta: aqui aparecem a rota escolhida, o tempo de cada etapa do grafo, as fontes citadas e o custo em tokens."
      )
    );
  }
  function renderMeasurements(result) {
    measure.replaceChildren();
    const cacheClass = result.cache === "HIT" ? "tag t-ok" : result.cache === "OFF" ? "t-quiet" : "";
    const state = result.refused ? `recusado \xB7 ${REFUSAL_LABEL[result.refusalReason ?? ""] ?? "recusado"}` : result.degraded ? "degradado" : "respondido";
    const stateClass = result.degraded ? "tag t-warn" : result.refused ? "t-quiet" : "tag t-ok";
    measure.append(
      row("rota", ROUTE_LABEL[result.route] ?? result.route, "tag t-accent"),
      row("estado", state, stateClass),
      row("cache", result.cache, cacheClass),
      row("1\xBA token", ms(result.timings.ttftMs)),
      row("total", ms(result.timings.totalMs)),
      row("tokens", `${result.cost.inputTokens} / ${result.cost.outputTokens}`),
      row(
        "custo",

        result.cost.usd === 0 ? "US$ 0" : `US$ ${result.cost.usd.toFixed(6)}`,
        result.cost.usd === 0 ? "t-ok" : ""
      )
    );
  }
  function renderWaterfall(perNode) {
    falls.replaceChildren();
    fallsNote.textContent = "";
    if (!perNode || Object.keys(perNode).length === 0) {
      secFalls.hidden = true;
      return;
    }
    const order = ["classify", "retrieve", "callHrApi", "grade", "generateAnswer", "refuse"];
    const hadFanOut = "retrieve" in perNode && "callHrApi" in perNode;
    const parallel = new Set(hadFanOut ? ["retrieve", "callHrApi"] : []);
    const entries = order.filter((n) => n in perNode).map((n) => ({ name: n, ms: perNode[n] }));
    if (entries.length === 0) {
      secFalls.hidden = true;
      return;
    }
    const longest = Math.max(...entries.map((e) => e.ms), 1);
    for (const { name, ms: duration } of entries) {
      const lane = el("div", "fall");
      const rail = el("div", "rail");
      const bar = el("div", "bar");
      bar.style.width = `${Math.max(2, duration / longest * 100)}%`;
      if (parallel.has(name)) bar.dataset.par = "true";
      rail.append(bar);
      lane.append(el("span", "n", name), rail, el("span", "ms", String(duration)));
      falls.append(lane);
    }
    fallsNote.textContent = hadFanOut ? "As barras hachuradas rodaram em paralelo, no mesmo superstep do grafo \u2014 som\xE1-las superestimaria o total." : "";
    secFalls.hidden = false;
  }
  function renderSources(sources) {
    sourcesEl.replaceChildren();
    if (sources.length === 0) {
      secSrc.hidden = false;
      sourcesEl.append(
        el(
          "p",
          "hint",
          "Nenhuma fonte citada \u2014 a resposta foi uma recusa, e recusar sem fundamenta\xE7\xE3o \xE9 o comportamento correto."
        )
      );
      return;
    }
    sources.forEach((source, i) => {
      const block = el("div", "src");
      const body = el("div");
      if (source.kind === "document") {
        body.append(el("div", "w", `${source.file} \xA7 ${source.section}`));
        body.append(el("div", "d", `similaridade ${source.score.toFixed(3)}`));
        body.append(el("div", "x", source.excerpt));
      } else {
        body.append(el("div", "w", source.endpoint));
        body.append(el("div", "d", `campos: ${source.fields.join(", ")} \xB7 ${source.latencyMs} ms`));
      }
      block.append(el("div", "i", String(i + 1)), body);
      sourcesEl.append(block);
    });
    secSrc.hidden = false;
  }
  function renderWarnings(warnings) {
    warningsEl.replaceChildren();
    secWarn.hidden = warnings.length === 0;
    for (const warning of warnings) warningsEl.append(el("div", "", `\u2022 ${warning}`));
  }
  function paintInline(parent, tokens) {
    for (const token of tokens) {
      switch (token.type) {
        case "strong":
          parent.appendChild(el("strong", "", token.value));
          break;
        case "em":
          parent.appendChild(el("em", "", token.value));
          break;
        case "code":
          parent.appendChild(el("code", "", token.value));
          break;
        case "citation":
          parent.appendChild(el("sup", "cite", token.value));
          break;
        default:
          parent.appendChild(document.createTextNode(token.value));
      }
    }
  }
  function renderAnswer(target, markdown) {
    target.replaceChildren();
    for (const block of parseMarkdown(markdown)) {
      switch (block.type) {
        case "heading": {
          const heading = el("div", `md-h md-h${Math.min(block.level, 3)}`);
          paintInline(heading, block.inline);
          target.append(heading);
          break;
        }
        case "list": {
          const list = el(block.ordered ? "ol" : "ul", "md-list");
          for (const item of block.items) {
            const li = el("li");
            paintInline(li, item);
            list.append(li);
          }
          target.append(list);
          break;
        }
        case "code":
          target.append(el("pre", "md-pre", block.text));
          break;
        default: {
          const paragraph = el("p", "md-p");
          paintInline(paragraph, block.inline);
          target.append(paragraph);
        }
      }
    }
  }
  function addQuestion(text) {
    welcome.remove();
    threadInner.append(el("div", "q", text));
  }
  function addAnswer() {
    const node = el("div", "a caret");
    threadInner.append(node);
    return node;
  }
  var scroll = () => thread.scrollTo({ top: thread.scrollHeight, behavior: "smooth" });
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
          renderAnswer(target, accumulated);
          scroll();
          break;
        case "sources":
          renderSources(event.sources);
          break;
        case "done": {
          const result = event.summary;
          if (result.refused) target.dataset.refused = "true";
          if (!accumulated && result.answer) renderAnswer(target, result.answer);
          if (result.degraded && !result.refused) {
            target.append(el("div", "flag", "respondido com uma fonte indispon\xEDvel"));
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
  async function loadHealth() {
    try {
      const response = await fetch("/health");
      if (!response.ok) return null;
      const health = await response.json();
      facts.replaceChildren();
      const modelFact = el("span", "fact");
      modelFact.append(el("b", "", health.llm.chatModel ?? "modelo determin\xEDstico"));
      facts.append(modelFact);
      const cacheFact = el("span", "fact", health.cache.enabled ? "cache ligado" : "cache desligado");
      cacheFact.dataset.off = String(!health.cache.enabled);
      facts.append(cacheFact);
      return health;
    } catch {
      return null;
    }
  }
  async function loadSuggestions() {
    try {
      const response = await fetch("/demo/questions");
      if (!response.ok) return;
      const { questions, chaosAvailable } = await response.json();
      suggestions.replaceChildren();
      for (const group of SUGGESTED) {
        const picked = questions.filter((q) => q.category === group.category).slice(0, group.take);
        if (picked.length === 0) continue;
        const block = el("div", "suggest-group");
        block.append(el("span", "label", group.label));
        const chips = el("div", "chips");
        for (const question of picked) {
          const chip = el("button", "chip", question.text);
          chip.type = "button";
          chip.title = `Esperado: ${question.expected}`;
          chip.addEventListener("click", () => ask(question.text));
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
  chaos.addEventListener("change", () => void toggleChaos(chaos.checked));
  void (async () => {
    const health = await loadHealth();
    renderIdleEvidence(health);
    await loadSuggestions();
    input.focus();
  })();
})();
