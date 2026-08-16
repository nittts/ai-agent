# Assistente RH/TI — agente LangGraph com RAG + tools HTTP

Agente de IA que responde perguntas de colaboradores sobre políticas internas de
RH e TI, consumindo **duas fontes**: uma base de conhecimento (RAG) e uma API
HTTP de sistema de RH (function calling).

Entregue para o desafio técnico da Inova e-Business.

---

## O que este projeto é

Um assistente interno que responde, **em português**, perguntas como:

| Pergunta | Como é respondida |
|---|---|
| *"Quantos dias de férias eu tenho por ano?"* | Base de conhecimento (fonte A) |
| *"Qual o meu saldo de férias? Meu id é 1042."* | API de RH (fonte B) |
| *"Tenho 18 dias (id 1042). Posso vender 10?"* | **As duas**, em paralelo |
| *"Qual a previsão do tempo amanhã?"* | Recusa explícita, sem custo de geração |

Cada resposta carrega **de onde veio, quanto tempo levou em cada etapa e quanto
custou** — e o console de demonstração mostra isso ao lado do texto.

---

## Início rápido

### Pré-requisitos

- Node 22+
- Uma `GEMINI_API_KEY` do [Google AI Studio](https://aistudio.google.com/apikey)
- Docker (opcional, mas é o caminho mais curto)

### Com Docker (recomendado)

```bash
cp .env.example .env          # coloque sua GEMINI_API_KEY
npm install
npm run ingest                # gera o índice vetorial (~4s, ~50 chunks)
docker compose up --build
```

Abra **http://localhost:3000** — o console já está lá. Não há build de
front-end nem segundo processo.

### Sem Docker

```bash
cp .env.example .env          # coloque sua GEMINI_API_KEY
npm install
npm run ingest
npm run dev                   # http://localhost:3000
```

O Redis é **opcional**: sem ele o serviço sobe, funciona e reporta
`cache: "OFF"` nas respostas.

### Sem credencial nenhuma

```bash
LLM_PROVIDER=fake npm run ingest
LLM_PROVIDER=fake npm run dev
```

Sobe com um modelo determinístico embutido. É o mesmo modo que a suíte de
testes usa — útil para explorar o código sem gastar cota.

---

## Como usar

### Console web

`http://localhost:3000`. Tem um seletor com as **25 perguntas do roteiro**, um
painel de evidência por resposta e um interruptor **"Derrubar API de RH"** que
demonstra o comportamento degradado ao vivo.

### CLI

```bash
npm run cli -- "Tenho 18 dias de férias (id 1042). Posso vender 10 dias?"
```

```
Sim, você pode vender 10 dias [1].

O limite de venda é calculado sobre o direito do período aquisitivo (30 dias),
e não sobre o saldo atual disponível. Portanto, mesmo tendo um saldo de 18
dias, o limite máximo de venda permanece em 10 dias [1].

Sources:
  • GET /employees/1042/vacation-balance  [availableDays, daysAlreadySold, expiresAt]  25ms
  • ferias.md § Abono pecuniário (venda de férias)  (score 0.761)
  ...

route=hybrid  total=2751ms  tokens=1185/109  cost=US$0.000628
```

### HTTP

> Os exemplos usam `127.0.0.1` em vez de `localhost` de propósito: onde
> `localhost` resolve para `::1` primeiro, o curl conecta no IPv6, o servidor
> escuta em `0.0.0.0` e a conexão morre **sem tentar IPv4** — o TCP chegou a
> conectar, então não há fallback. No navegador o `localhost` funciona normal.

```bash
# JSON — resposta completa de uma vez
curl -s -X POST 127.0.0.1:3000/ask \
  -H 'content-type: application/json' \
  -d '{"question":"Posso vender parte das minhas férias?"}' | jq

# SSE — tokens conforme são gerados
curl -N "127.0.0.1:3000/ask/stream?q=Posso%20vender%20f%C3%A9rias%3F"

# Estado do serviço (mostra qual provider e modelo estão ativos)
curl -s 127.0.0.1:3000/health | jq
```

### MCP

O mesmo agente também é um **servidor MCP** (Model Context Protocol), em
`POST /mcp`, no mesmo processo. Um cliente MCP — Claude Desktop, um IDE, outro
agente — consulta o RH pelo protocolo padrão em vez de uma API própria.

O que é exposto:

| Primitiva | Nome | O que faz |
|---|---|---|
| Tool | `perguntar_rh` | O agente inteiro: RAG + tools de RH, resposta em português com fontes citadas |
| Resources | `hr://policy/<arquivo>.md` | As 7 políticas do corpus, para o cliente ler o documento que uma citação aponta |

```bash
curl -s -X POST 127.0.0.1:3000/mcp \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{
        "name":"perguntar_rh",
        "arguments":{"pergunta":"Qual o meu saldo de férias? Meu id é 1042."}}}'
```

A resposta traz o texto em `content` e a evidência completa em
`structuredContent` — rota, fontes, custo, `degraded`, `refused` —, a mesma que
o `POST /ask` devolve:

```
rota: tool | recusou: false
fontes: GET /employees/1042/vacation-balance
custo: US$ 0.000342 | 1687ms
texto: O seu saldo de férias é de 18 dias disponíveis [1].
```

Duas decisões que valem nota:

- **As tools de RH cruas não são publicadas.** Um cliente MCP recebe
  `perguntar_rh`, não `get_vacation_balance`. Republicar a API de RH entregaria
  dado sem fundamentação; o que este sistema agrega é justamente o grounding —
  recuperação com citação, limiar de recusa, degradação explícita e custo medido.
- **Uma recusa não é `isError`.** `isError` significa "a tool quebrou". Uma
  recusa fundamentada é o agente funcionando; marcá-la como erro faria clientes
  bem-comportados tentarem de novo.

---

## Escolhas do desafio

**Cenário:** processo interno — assistente de RH/TI para colaboradores.

**Fonte de dados: A e B.** O enunciado permite escolher uma; implementamos as
duas porque a pergunta mais interessante do domínio exige ambas ao mesmo tempo.
*"Tenho 18 dias, posso vender 10?"* só tem resposta correta cruzando o **saldo**
(API) com a **regra de 1/3** (política) — e a resposta certa é contraintuitiva,
porque o limite incide sobre o direito de 30 dias, não sobre o saldo de 18.

**Modelo:** `gemini-3.5-flash-lite`, escolhido por **medição**, não por nome:

| Candidato | TTFT medido |
|---|---|
| gemini-3.7-flash | 98 737 ms |
| gemini-3.5-flash | 21 356 ms |
| gemini-3.1-flash-lite | 1 979 ms |
| **gemini-3.5-flash-lite** | **712 ms** |

Os modelos maiores gastam segundos em raciocínio que uma consulta de política
não precisa. O modelo é **fixado**, nunca um ponteiro `-latest`, para que o
`latency.csv` continue reproduzível.

---

## Evidências

Todos os números abaixo foram **medidos**, não estimados. Os artefatos brutos
estão em `eval/results/`.

### Latência (`npm run bench:latency`)

25 perguntas × 3 rodadas, em série, cache ignorado. Percentil por *nearest
rank* — o valor relatado é uma latência que realmente aconteceu.

| | p50 | p95 | p99 | max |
|---|---|---|---|---|
| Todas as amostras | 1 627 ms | 3 677 ms | 15 005 ms | 15 005 ms |
| **Excluindo requests degradados** | **1 873 ms** | **3 677 ms** | **4 276 ms** | 4 276 ms |

Por rota (p50 / p95):

| Rota | p50 | p95 | Chamadas ao modelo |
|---|---|---|---|
| `outOfScope` (recusa) | 758 ms | 4 276 ms | **1** |
| `tool` | 823 ms | 1 323 ms | 2 |
| `kb` | 2 355 ms | 3 882 ms | 2 |
| `hybrid` | 2 455 ms | 3 348 ms | 2 |

**Gargalo identificado e corrigido.** A primeira medição deu **p99 = 51 327 ms**
— e a causa não era o Gemini, era a nossa própria política de retry: 20 s de
timeout com 2 retentativas permite 60 s legítimos, e cada nó do grafo somava o
próprio teto. Timeout por tentativa **multiplica** a cauda; só um prazo absoluto
a limita.

A correção foi o `REQUEST_DEADLINE_MS`: um prazo total, contado do início,
compartilhado por todos os nós e aplicado em **dois** pontos — o retry não
inicia tentativa que não caberia, e cada chamada individual é limitada ao que
resta do prazo.

| | p50 | p95 | p99 | max |
|---|---|---|---|---|
| Sem prazo | 1 674 | 11 881 | **51 327** | 51 327 |
| Prazo só no retry | 2 443 | 25 638 | 39 685 | 39 685 |
| **Prazo aplicado ao timeout** | 2 225 | 15 005 | **15 016** | 15 016 |

> **Sobre a taxa de falha.** As execuções mais recentes acusam 45% de requests
> degradados. Isso é *throttling do tier gratuito* do Gemini depois de algumas
> centenas de chamadas em pouco tempo — não é comportamento do agente. Por isso
> o relatório separa os percentis limpos: reportar uma cauda sem a taxa de falha
> ao lado seria enganoso, porque uma cauda causada pelo provedor conta uma
> história completamente diferente de uma cauda causada pelo código.

### Escala (`npm run bench:load`)

Dois cenários, de propósito. Medir só um responderia à pergunta errada:
martelar o provedor real mediria a cota do Google e chamaria isso de "nossa
capacidade".

| Concorrência | Serviço isolado (fake) | Produção, cache quente |
|---|---|---|
| 1 | 181 rps · p95 6 ms | 172 rps · p95 6 ms |
| 5 | 713 rps · p95 11 ms | 723 rps · p95 11 ms |
| 10 | 1 898 rps · p95 8 ms | 1 915 rps · p95 8 ms |
| 25 | 2 813 rps · p95 12 ms | 2 844 rps · p95 12 ms |
| **50** | **2 925 rps · p95 23 ms** | **2 960 rps · p95 22 ms** |

Zero erros em todos os pontos.

**O resultado é a coincidência entre as duas colunas.** Com cache quente, a
vazão em produção é indistinguível do serviço sem provedor no caminho — o que
prova que o cache tira o LLM do caminho quente por completo. O cache não é
otimização marginal: é o mecanismo de escala.

### Qualidade do retrieval (`npm run eval:retrieval`)

| Métrica | Valor |
|---|---|
| recall@1 | 1.000 |
| recall@3 | 1.000 |
| recall@5 | 1.000 |
| MRR | 1.000 |

14 perguntas com gabarito sobre 51 chunks. **Corpus pequeno e bem separado:
trate um resultado perfeito como piso de sanidade, não como prova de robustez
em escala.** O valor real desta medição é diagnóstico — quando uma resposta sai
errada, ela diz se o problema foi "não recuperou o contexto certo" ou "recuperou
e o modelo ignorou".

---

## Testes

```bash
npm test          # 135 testes
npm run typecheck # backend + console
npm run lint
```

**A suíte inteira roda sem nenhuma credencial.** Verificado com o `.env`
removido do disco e sem `GEMINI_API_KEY` no ambiente: 177/177 passam.

Isso não é conveniência — é uma propriedade arquitetural. O modelo está atrás de
uma porta (`ChatModelPort`), e os testes simplesmente sobem a aplicação com
outra implementação. Não há mock de módulo nem interceptação de rede: o caminho
de código exercitado é o de produção.

Os testes de integração com Redis rodam contra um Redis **real** e são *pulados*
(não falhados) quando ele não existe, para que o CI não passe a depender de
infraestrutura.

---

## Comandos

| Comando | O que faz |
|---|---|
| `npm run dev` | Sobe o serviço em modo watch |
| `npm run cli -- "pergunta"` | Pergunta pelo terminal |
| `npm run ingest` | Gera o índice vetorial a partir de `corpus/` |
| `npm test` | Suíte completa, sem credenciais |
| `npm run bench:latency` | Mede p50/p95/p99 → `eval/results/latency.csv` |
| `npm run bench:load` | Teste de carga → `eval/results/scale.csv` |
| `npm run eval:retrieval` | recall@k e MRR → `eval/results/retrieval-eval.json` |
| `npm run build` | Compila backend + bundle do console |

---

## Configuração

Todas as variáveis estão documentadas em [`.env.example`](.env.example). As que
mais importam:

| Variável | Padrão | Por quê |
|---|---|---|
| `LLM_PROVIDER` | `gemini` | `fake` roda tudo sem credencial |
| `GEMINI_CHAT_MODEL` | `gemini-3.5-flash-lite` | Fixado; escolhido por medição |
| `REQUEST_DEADLINE_MS` | `15000` | Teto **total** do request — o que limita a cauda |
| `LLM_TIMEOUT_MS` | `8000` | Teto de **uma** tentativa |
| `RETRIEVAL_MIN_SCORE` | `0.55` | Limiar de recusa. Propriedade do modelo de embedding |
| `REDIS_URL` | — | Ausente ⇒ sem cache, serviço continua funcionando |
| `CHAOS_ENABLED` | `true` | Habilita o interruptor de falha. **Desligue em produção** |

---

## Documentação

| Documento | Conteúdo |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | Fluxo do agente, camadas, trade-offs, o que muda sob carga |
| [docs/DESIGN-DECISIONS.md](docs/DESIGN-DECISIONS.md) | Cada decisão relevante, com a alternativa descartada e o porquê |
| [docs/CODEBASE-GUIDE.md](docs/CODEBASE-GUIDE.md) | O que cada arquivo faz, para leitura dirigida |
| [docs/adr/0001-escala-e-separacao-de-responsabilidades.md](docs/adr/0001-escala-e-separacao-de-responsabilidades.md) | ADR: dezenas de usuários concorrentes, riscos e mitigações |
| [docs/demo-script.md](docs/demo-script.md) | Roteiro de demonstração com 8 perguntas e resultado esperado |

---

## Estrutura

```
src/
├── domain/          tipos e regras de negócio — zero imports de framework
├── application/     portas (interfaces) + grafo do agente + caso de uso
├── infrastructure/  adaptadores que implementam as portas + fiação do Nest
├── presentation/    HTTP, SSE, CLI, MCP e a API mock de RH
└── shared/          resiliência, SSE, tracing

corpus/              7 políticas de RH/TI em markdown (a base de conhecimento)
eval/                perfil de perguntas, índice e resultados medidos
web/                 console de demonstração em TypeScript
```

A regra de dependência aponta estritamente para dentro:
`presentation`/`infrastructure` → `application` → `domain`.
