# Guia do código

O que cada arquivo faz e **em que ordem lê-los**. Feito para leitura dirigida,
não para consulta alfabética.

---

## Leia nesta ordem (≈30 minutos)

Se você tem meia hora e quer entender o sistema, siga estes seis arquivos:

| # | Arquivo | Por que primeiro |
|---|---|---|
| 1 | `src/domain/answer.ts` | O que o sistema produz: resposta, fonte, motivo de recusa |
| 1b | `src/domain/conversation.ts` | Por que o histórico é do cliente e não do servidor — o trade-off inteiro em um comentário |
| 2 | `src/application/ports/` | As cinco fronteiras — o "contrato" com o mundo externo |
| 3 | `src/application/agent/agent-graph.ts` | O fluxo inteiro, em um diagrama e ~40 linhas |
| 4 | `src/application/use-cases/answer-question.use-case.ts` | O caso de uso: cache, grafo, custo |
| 5 | `src/infrastructure/modules/agent.module.ts` | Onde as portas viram adaptadores concretos |
| 6 | `docs/DESIGN-DECISIONS.md` | Por que cada escolha, com a alternativa descartada |

Depois disso, os nós individuais em `src/application/agent/nodes/` fazem sentido
sozinhos.

---

## Mapa por camada

### `src/domain/` — regras de negócio

Zero imports de framework. É o que o sistema **é**, independente de como é
entregue.

| Arquivo | Conteúdo |
|---|---|
| `answer.ts` | `Route`, `RefusalReason`, `Source` (documento ou API). A união `Source` é a expressão em tipos do requisito 5: resposta sem procedência não é entregável |
| `cost.ts` | `TokenUsage`, `addUsage` (o reducer do estado), `computeCost`. Custo é conceito de domínio porque "ver quanto custou" é promessa do produto |
| `knowledge.ts` | `Chunk`, `ChunkMetadata`, `SearchResult`, `IndexSnapshot`. O `corpusVersion` no metadata é o que invalida o cache quando uma política muda |

---

### `src/application/` — casos de uso e portas

#### `ports/` — as cinco fronteiras

| Porta | O que abstrai | Nota |
|---|---|---|
| `chat-model.port.ts` | Geração e saída estruturada | Interface **estreita** de propósito: duas capacidades, não um framework inteiro. É o que um fake consegue implementar por completo |
| `embeddings.port.ts` | Vetorização | Separada do chat: modelos diferentes, ciclos diferentes, usada também offline |
| `vector-store.port.ts` | Busca por similaridade | O ponto de extensão para pgvector/Redis |
| `cache.port.ts` | Cache de respostas | Note que nenhum método pode falhar de forma que o chamador tenha de tratar — cache é otimização, nunca dependência |
| `hr-directory.port.ts` | Dados de colaborador | Nomeada pela **capacidade**, não pelo transporte. Também define `RecordNotFoundError` e `ContractViolationError` |

#### `agent/` — a orquestração

| Arquivo | Conteúdo |
|---|---|
| `agent-graph.ts` | **O fluxo inteiro.** Diagrama em comentário + a montagem do `StateGraph`. Comece por aqui |
| `agent-state.ts` | O estado e — a parte que merece atenção — os **reducers**. São eles que tornam o fan-out paralelo seguro |
| `prompts.ts` | Prompts em português (conteúdo de produto), montagem do contexto numerado `[n]`, e os textos fixos de recusa |
| `tools.ts` | Catálogo de tools com schema zod + o executor com dispatch explícito |
| `nodes/node-context.ts` | O que um nó pode alcançar, e a função `timed()` — **único ponto de instrumentação** do grafo |
| `nodes/classify.node.ts` | Rota + entidades em uma chamada. Falha cai para `kb` em vez de derrubar |
| `nodes/retrieve.node.ts` | Busca vetorial (fonte A). Falha degrada |
| `nodes/call-hr-api.node.ts` | Tools sobre a API de RH (fonte B), em paralelo, com `allSettled` |
| `nodes/grade.node.ts` | Responder ou recusar, por **limiar de score** — decisão de latência documentada no arquivo |
| `nodes/answer.node.ts` | Geração com streaming. Chamado `generateAnswer` porque o LangGraph proíbe nó com nome de canal de estado |
| `nodes/refuse.node.ts` | Texto fixo, zero chamadas de modelo |

#### `use-cases/`

| Arquivo | Conteúdo |
|---|---|
| `answer-question.use-case.ts` | **O único caso de uso.** Cache L1, execução do grafo, montagem do resultado, e as regras de **o que pode ser cacheado** — incluindo a regra de privacidade |

---

### `src/infrastructure/` — adaptadores

| Arquivo | O que faz |
|---|---|
| `config/env.ts` | Schema zod do ambiente + carga do `.env`. As regras cruzadas ficam **fora** do schema porque `.superRefine` não roda quando o objeto base falha |
| `config/config.module.ts` | Provider global da configuração validada |
| `llm/gemini/gemini-chat-model.ts` | Adaptador Gemini. A geração fala **direto com a API** — o comentário explica por quê |
| `llm/gemini/gemini-embeddings.ts` | Embeddings Gemini, com timeout |
| `llm/fake/fake-chat-model.ts` | Modelo determinístico. Classifica por regras para exercitar o roteamento de verdade |
| `llm/fake/fake-embeddings.ts` | Hashing trick sobre saco de palavras — o comentário explica por que não é hash do texto |
| `llm/embeddings.factory.ts` | Escolhe o adaptador para os scripts offline |
| `cache/redis-cache.ts` | `RedisCache` e `NullCache`. `enableOfflineQueue: false` é a linha crítica |
| `cache/cached-embeddings.ts` | Decorador L2 sobre a porta de embeddings |
| `retrieval/chunker.ts` | Markdown → chunks por seção, com `corpusVersion` |
| `retrieval/in-memory-vector-store.ts` | Busca por cosseno, O(n) |
| `hr-directory/http-hr-directory.ts` | Cliente HTTP + **os schemas de contrato**. A validação é o que impede um campo renomeado de virar `undefined` no prompt |
| `observability/logger.ts` | Pino + `AsyncLocalStorage` para o `correlationId` |
| `observability/otel.ts` | Bootstrap do OpenTelemetry — precisa rodar antes de tudo |
| `modules/*.module.ts` | **A raiz de composição.** É aqui que porta vira adaptador |

---

### `src/presentation/` — entrada

| Arquivo | O que faz |
|---|---|
| `http/api-contract.ts` | **Contrato público, fonte única.** Importado pelo backend E pelo console |
| `http/ask.controller.ts` | `POST /ask` e `GET /ask/stream` (SSE). Mede o TTFT — só o transporte sabe quando o byte saiu |
| `http/health.controller.ts` | Reporta a configuração **efetiva**, para o avaliador saber qual provider está ativo |
| `http/demo.controller.ts` | Serve `eval/questions.json` ao console |
| `cli/cli.ts` | O mesmo caso de uso, outro transporte. Sem argumento, abre conversa interativa |
| `mcp/mcp-server.ts` | Monta o servidor MCP: a tool `perguntar_rh` e o corpus como *resources*, a partir de uma **allowlist** |
| `mcp/mcp.plugin.ts` | Registra `/mcp` no Fastify. Servidor e transporte novos por request — sem estado de sessão |
| `mock-hr-api/*` | A API de RH simulada + o interruptor de caos |

---

### `src/shared/` — primitivas transversais

| Arquivo | O que faz |
|---|---|
| `resilience/index.ts` | `withTimeout`, `withRetry` (jitter + **deadline**), `isTransient`, `remainingBudget`. O deadline é a correção que levou o p99 de 51 s para 15 s |
| `sse/sse-reader.ts` | Parser incremental de SSE. Onde morou o bug mais caro do projeto — o comentário conta a história |
| `observability/index.ts` | `withSpan` — a única função de tracing que o resto do código vê |

---

## Fora de `src/`

| Caminho | Conteúdo |
|---|---|
| `corpus/` | 7 políticas de RH/TI em markdown. **É a base de conhecimento**, com referências cruzadas deliberadas para exercitar perguntas multi-documento |
| `eval/questions.json` | As 26 perguntas. Alimenta o console **e** o benchmark — por isso os dois são provadamente o mesmo conjunto |
| `eval/results/` | Números medidos: `latency.csv`, `scale.csv`, `retrieval-eval.json` |
| `scripts/ingest.ts` | Corpus → chunks → embeddings → snapshot |
| `scripts/bench-latency.ts` | p50/p95/p99 por rota, com taxa de falha separada |
| `scripts/bench-load.ts` | Carga em dois cenários — a metodologia está no comentário do topo |
| `scripts/eval-retrieval.ts` | recall@k e MRR |
| `web/app.ts` | Console em TypeScript, compilado para `public/app.js` |
| `public/` | Shell HTML + bundle commitado |
| `test/` | Espelha a estrutura de `src/` |

---

## Onde procurar quando…

| Você quer… | Vá para |
|---|---|
| Entender o fluxo geral | `application/agent/agent-graph.ts` |
| Ver o que é cacheado e o que não é | `application/use-cases/answer-question.use-case.ts`, método `maybeCache` |
| Trocar de provedor de LLM | Implementar `ChatModelPort` e trocar uma linha em `modules/llm.module.ts` |
| Trocar o banco vetorial | Implementar `VectorStorePort`; nenhum consumidor muda |
| Mudar o comportamento de recusa | `application/agent/prompts.ts` (`REFUSAL_MESSAGES`) e `nodes/grade.node.ts` |
| Ajustar a política de retry | `shared/resilience/index.ts` |
| Adicionar uma tool | `application/agent/tools.ts` + o método correspondente na `HrDirectoryPort` |
| Mudar o corpus | `corpus/*.md`, depois `npm run ingest` |
| Entender por que algo foi feito assim | `docs/DESIGN-DECISIONS.md` |

---

## Convenções

**Idioma.** Código, testes e scripts em **inglês**. Prompts e corpus em
**português** — são conteúdo de produto, não código; traduzi-los mudaria o
comportamento do sistema. As respostas ao usuário são em português por
requisito do desafio.

**Comentários.** Explicam **por quê**, não o quê. Quando um comentário cita um
número (`p99 = 51 327 ms`), é um número medido, e o mesmo número aparece em
`eval/results/`.

**`@Inject` explícito** em dependências tipadas por classe. O esbuild — usado
pelo `tsx` nos scripts e no CLI — não emite decorator metadata, então confiar na
inferência funciona sob `tsc` e quebra sob `tsx`. Divergência entre ambientes é
pior que erro consistente.

**Nomes de porta pela capacidade**, não pelo transporte: `HrDirectoryPort`, não
`HttpClientPort`.

**Testes com nome descrevendo a regra**, não o método. `"tool route without an
id ASKS for identification instead of inventing one"` diz o que o sistema
promete; `"should return refused"` não diz nada.
