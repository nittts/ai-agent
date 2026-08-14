"use strict";
(() => {
  // web/app.ts
  var $ = (id) => {
    const node = document.getElementById(id);
    if (!node) throw new Error(`Elemento #${id} n\xE3o existe no index.html`);
    return node;
  };
  var criar = (tag, classe, texto) => {
    const el = document.createElement(tag);
    if (classe) el.className = classe;
    if (texto !== void 0) el.textContent = texto;
    return el;
  };
  var linhaLeitura = (rotulo, valor, classe = "") => {
    const linha = criar("div", "leitura");
    linha.append(
      criar("dt", "", rotulo),
      criar("span", "pontilhado"),
      criar("dd", classe, valor)
    );
    return linha;
  };
  var ms = (v) => v === null ? "\u2014" : `${v} ms`;
  var transcricao = $("transcricao");
  var vazio = $("vazio");
  var entrada = $("entrada");
  var enviar = $("enviar");
  var form = $("form");
  var presets = $("presets");
  var chaos = $("chaos");
  var rotuloChaos = $("rotulo-chaos");
  var medicao = $("medicao");
  var cascata = $("cascata");
  var fontesEl = $("fontes");
  var avisosEl = $("avisos");
  var secaoCascata = $("secao-cascata");
  var secaoFontes = $("secao-fontes");
  var secaoAvisos = $("secao-avisos");
  var ocupado = false;
  function renderMedicao(r) {
    medicao.replaceChildren();
    const classeCache = r.cache === "HIT" ? "v-ok" : r.cache === "OFF" ? "v-neutro" : "";
    const estado = r.recusado ? "recusado" : r.degradado ? "degradado" : "respondido";
    const classeEstado = r.degradado ? "v-alerta" : r.recusado ? "v-neutro" : "v-ok";
    medicao.append(
      linhaLeitura("rota", r.rota),
      linhaLeitura("estado", estado, classeEstado),
      linhaLeitura("cache", r.cache, classeCache),
      linhaLeitura("1\xBA token", ms(r.tempos.ttftMs)),
      linhaLeitura("total", ms(r.tempos.totalMs)),
      linhaLeitura("tokens", `${r.custo.tokensEntrada} / ${r.custo.tokensSaida}`),
      linhaLeitura(
        "custo",

        r.custo.custoUsd === 0 ? "US$ 0" : `US$ ${r.custo.custoUsd.toFixed(6)}`,
        r.custo.custoUsd === 0 ? "v-ok" : ""
      )
    );
  }
  function renderCascata(porNo) {
    cascata.replaceChildren();
    if (!porNo || Object.keys(porNo).length === 0) {
      secaoCascata.hidden = true;
      return;
    }
    const ordem = ["classificar", "recuperar", "consultarApi", "avaliar", "responder"];
    const houveFanOut = "recuperar" in porNo && "consultarApi" in porNo;
    const paralelos = new Set(houveFanOut ? ["recuperar", "consultarApi"] : []);
    const entradas = ordem.filter((nome) => nome in porNo).map((nome) => ({ nome, dur: porNo[nome] }));
    if (entradas.length === 0) {
      secaoCascata.hidden = true;
      return;
    }
    const maior = Math.max(...entradas.map((e) => e.dur), 1);
    for (const { nome, dur } of entradas) {
      const faixa = criar("div", "faixa");
      const trilha = criar("div", "trilha");
      const barra = criar("div", "barra");
      barra.style.width = `${Math.max(2, dur / maior * 100)}%`;
      if (paralelos.has(nome)) barra.dataset.paralelo = "true";
      trilha.append(barra);
      faixa.append(criar("span", "nome", nome), trilha, criar("span", "ms", String(dur)));
      cascata.append(faixa);
    }
    secaoCascata.hidden = false;
  }
  function renderFontes(fontes) {
    fontesEl.replaceChildren();
    if (fontes.length === 0) {
      secaoFontes.hidden = false;
      fontesEl.append(
        criar(
          "p",
          "placeholder",
          "Nenhuma fonte citada \u2014 a resposta foi uma recusa, e recusar sem fundamenta\xE7\xE3o \xE9 o comportamento correto."
        )
      );
      return;
    }
    fontes.forEach((fonte, i) => {
      const bloco = criar("div", "fonte");
      const corpo = criar("div");
      if (fonte.tipo === "documento") {
        corpo.append(criar("div", "onde", `${fonte.arquivo} \xA7 ${fonte.secao}`));
        corpo.append(criar("div", "detalhe", `similaridade ${fonte.score.toFixed(3)}`));
        corpo.append(criar("div", "trecho", fonte.trecho));
      } else {
        corpo.append(criar("div", "onde", fonte.endpoint));
        corpo.append(
          criar("div", "detalhe", `campos: ${fonte.campos.join(", ")} \xB7 ${fonte.latenciaMs} ms`)
        );
      }
      bloco.append(criar("div", "n", String(i + 1)), corpo);
      fontesEl.append(bloco);
    });
    secaoFontes.hidden = false;
  }
  function renderAvisos(avisos) {
    avisosEl.replaceChildren();
    secaoAvisos.hidden = avisos.length === 0;
    for (const aviso of avisos) avisosEl.append(criar("div", "", `\u2022 ${aviso}`));
  }
  function pintarCitacoes(alvo, texto) {
    alvo.replaceChildren();
    const partes = texto.split(/(\[\d+\])/g);
    for (const parte of partes) {
      if (/^\[\d+\]$/.test(parte)) alvo.append(criar("sup", "cit", parte));
      else alvo.append(document.createTextNode(parte));
    }
  }
  function adicionarPergunta(texto) {
    vazio.remove();
    transcricao.append(criar("div", "turno-pergunta", texto));
  }
  function adicionarResposta() {
    const el = criar("div", "turno-resposta cursor");
    transcricao.append(el);
    return el;
  }
  var rolar = () => transcricao.scrollTo({ top: transcricao.scrollHeight, behavior: "smooth" });
  function perguntar(texto) {
    if (ocupado || !texto.trim()) return;
    ocupado = true;
    enviar.disabled = true;
    entrada.value = "";
    adicionarPergunta(texto);
    const alvo = adicionarResposta();
    rolar();
    let acumulado = "";
    const fonte = new EventSource(`/ask/stream?q=${encodeURIComponent(texto)}`);
    const encerrar = () => {
      fonte.close();
      alvo.classList.remove("cursor");
      ocupado = false;
      enviar.disabled = false;
      entrada.focus();
    };
    fonte.onmessage = (evento) => {
      const dados = JSON.parse(evento.data);
      switch (dados.tipo) {
        case "token":
          acumulado += dados.texto;
          pintarCitacoes(alvo, acumulado);
          rolar();
          break;
        case "fontes":
          renderFontes(dados.fontes);
          break;
        case "fim": {
          const r = dados.resumo;
          if (r.recusado) alvo.dataset.recusado = "true";
          if (!acumulado && r.resposta) pintarCitacoes(alvo, r.resposta);
          if (r.degradado) {
            alvo.append(criar("div", "selo", "respondido com uma fonte indispon\xEDvel"));
          }
          renderMedicao(r);
          renderCascata(r.tempos.porNo);
          renderAvisos(r.avisos);
          rolar();
          encerrar();
          break;
        }
        case "erro":
          alvo.textContent = `Falha ao responder: ${dados.mensagem} (correlationId ${dados.correlationId})`;
          encerrar();
          break;
      }
    };
    fonte.onerror = () => {
      if (!acumulado) alvo.textContent = "Conex\xE3o interrompida. O servi\xE7o est\xE1 no ar?";
      encerrar();
    };
  }
  async function carregarPresets() {
    try {
      const resposta = await fetch("/demo/perguntas");
      if (!resposta.ok) return;
      const { perguntas, chaosDisponivel } = await resposta.json();
      const categorias = [...new Set(perguntas.map((p) => p.categoria))];
      for (const categoria of categorias) {
        const grupo = document.createElement("optgroup");
        grupo.label = categoria.replace(/_/g, " ");
        for (const pergunta of perguntas.filter((p) => p.categoria === categoria)) {
          const opcao = document.createElement("option");
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
  async function alternarChaos(ativo) {
    rotuloChaos.dataset.ativo = String(ativo);
    try {
      await fetch("/mock/v1/_chaos", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ modo: ativo ? "500" : "ok" })
      });
    } catch {
      chaos.checked = !ativo;
      rotuloChaos.dataset.ativo = String(!ativo);
    }
  }
  form.addEventListener("submit", (evento) => {
    evento.preventDefault();
    perguntar(entrada.value);
  });
  presets.addEventListener("change", () => {
    const escolhida = presets.value;
    if (!escolhida) return;
    entrada.value = escolhida;
    presets.selectedIndex = 0;
    perguntar(escolhida);
  });
  chaos.addEventListener("change", () => void alternarChaos(chaos.checked));
  void carregarPresets();
  entrada.focus();
})();
