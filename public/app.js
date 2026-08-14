"use strict";
(() => {
  // web/app.ts
  var el = (id) => {
    const node = document.getElementById(id);
    if (!node) throw new Error(`Elemento #${id} n\xE3o encontrado no index.html`);
    return node;
  };
  async function carregarHealth() {
    const alvo = el("health");
    try {
      const resp = await fetch("/health");
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const health = await resp.json();
      alvo.textContent = [
        `status: ${health.status}`,
        `provider: ${health.llm.provider}`,
        `modelo: ${health.llm.chatModel ?? "(fake)"}`,
        `cache: ${health.cache.enabled ? "ligado" : "desligado"}`,
        `chaos: ${health.chaosEnabled ? "dispon\xEDvel" : "desligado"}`
      ].join("\n");
    } catch (err) {
      alvo.textContent = `falha ao consultar /health: ${err instanceof Error ? err.message : err}`;
    }
  }
  void carregarHealth();
})();
