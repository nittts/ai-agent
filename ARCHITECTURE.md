# Arquitetura

Este documento explica **como o agente funciona**, **por que foi construído
assim** e **o que mudaria** sob mais carga, falhas de rede ou pressão de custo.

---

## 1. Visão geral

```
┌──────────────────────────────────────────────────────────────────┐
│  PRESENTATION       HTTP · SSE · CLI · MCP · API mock de RH       │
└───────────────────────────────┬──────────────────────────────────┘
                                │ chama
┌───────────────────────────────▼──────────────────────────────────┐
│  APPLICATION      AnswerQuestionUseCase  +  grafo LangGraph      │
│                   5 portas (interfaces) definidas aqui           │
└───────────────────────────────┬──────────────────────────────────┘
                                │ depende de
┌───────────────────────────────▼──────────────────────────────────┐
│  DOMAIN           Answer · Source · Cost · Chunk                 │
│                   zero imports de framework                       │
└──────────────────────────────────────────────────────────────────┘
                                ▲ implementa as portas
┌───────────────────────────────┴──────────────────────────────────┐
│  INFRASTRUCTURE   Gemini · Fake · Redis · InMemoryVectorStore    │
│                   HttpHrDirectory · OpenTelemetry · Pino         │
└──────────────────────────────────────────────────────────────────┘
```

A regra de dependência aponta **estritamente para dentro**. `domain/` e
`application/` não importam nada de `infrastructure/` — isso é verificável com
um `grep`, e é o que permite trocar Gemini, Redis ou o framework HTTP sem tocar
no significado do produto.

### As cinco portas

| Porta | Adaptadores | Por que existe |
|---|---|---|
| `ChatModelPort` | Gemini, Fake | Torna a suíte executável sem credencial |
| `EmbeddingsPort` | Gemini, Fake, Cached | Modelo distinto, ciclo de vida distinto |
| `VectorStorePort` | InMemory | Troca por pgvector/Redis não toca consumidor |
| `CachePort` | Redis, Null | Cache é otimização, nunca dependência |
| `HrDirectoryPort` | HTTP | Nomeada pela **capacidade**, não pelo transporte |

`HrDirectoryPort` merece uma nota: ela não se chama `HttpClientPort` porque o
agente precisa de **dados de colaborador**. Se isso chega por HTTP, gRPC ou
banco é decisão de infraestrutura que a aplicação não deve codificar.

### Quatro transportes, um caso de uso

`AnswerQuestionUseCase` tem quatro adaptadores de entrada — HTTP JSON, SSE, CLI
e MCP — e **nenhum deles conhece os outros**. Nenhuma linha de `application/`
ou `domain/` mudou para o MCP existir: o adaptador chama `execute()` e traduz o
resultado para o formato do protocolo.

Isso é a evidência prática de que a hexagonal está fazendo trabalho, e não
apenas nomeando pastas. O teste é direto: acrescentar uma boca nova custou um
arquivo em `presentation/` e um módulo de fiação.

O MCP expõe **uma** tool (`perguntar_rh`, o agente inteiro) e as 7 políticas
como *resources*. Deliberadamente **não** expõe as tools de RH cruas
(`get_vacation_balance` e afins): republicá-las entregaria dado sem
fundamentação, quando o que este sistema agrega é exatamente a camada de
grounding — recuperação com citação, limiar de recusa, degradação explícita e
custo medido. Um cliente que chama `perguntar_rh` herda tudo isso.

Duas notas de protocolo que são decisões, não detalhes:

- **Recusa não é `isError`.** `isError` significa "a tool quebrou". Uma recusa
  fundamentada é o agente funcionando corretamente; marcá-la como erro faria
  clientes bem-comportados tentarem de novo ou reportarem falha ao usuário. O
  motivo viaja em `structuredContent.refusalReason`.
- **Transporte sem sessão.** Um `McpServer` e um transporte novos por request,
  sem `sessionId`. Sem estado de sessão no processo, qualquer réplica atende
  qualquer request — a mesma propriedade que já vale para `POST /ask` e que o
  ADR usa como base para escalar horizontalmente.

### Onde o LangGraph mora, e por quê

O grafo fica em `application/`, não em `infrastructure/`. É uma leitura
deliberada de Clean Architecture: **o LangGraph não é um sistema externo com
que conversamos — ele é a forma do caso de uso**. Fornecedores (Google, Redis,
a API de RH) ficam atrás de portas; o motor que sequencia os nossos próprios
passos *é* o caso de uso.

O trade-off é explícito: trocar o LangGraph significa reescrever essa pasta.
Trocar o Gemini ou o Redis, não.

---

## 2. Fluxo do agente

```
              ┌──────────┐
  START ─────►│ classify │  1 chamada estruturada: rota + entidades
              └────┬─────┘
        ┌──────────┼───────────────┬──────────────┬──────────┐
        ▼          ▼               ▼              ▼          ▼
  ┌──────────┐ ┌───────────┐  as duas, EM   ┌────────┐  ┌────────┐
  │ retrieve │ │ callHrApi │   PARALELO     │ refuse │  │  meta  │
  └────┬─────┘ └─────┬─────┘                └───┬────┘  └───┬────┘
       └──────┬──────┘                          │           │
              ▼                                 │           │
        ┌──────────┐                            │           │
        │  grade   │                            │           │
        └────┬─────┘                            │           │
      ┌──────┴───────┐                          │           │
      ▼              ▼                          │           │
┌────────────────┐ ┌────────┐                   │           │
│ generateAnswer │ │ refuse │◄──────────────────┘           │
└────────┬───────┘ └───┬────┘                               │
         └──────┬──────┘                                    │
                └──────────────────┬─────────────────────────┘
                                   ▼
                                  END
```

| Nó | Responsabilidade | Chamadas ao modelo |
|---|---|---|
| `classify` | Rota + extração de `employeeId`/`ticketId` | 1 |
| `retrieve` | Busca vetorial no corpus (fonte A) | 0 |
| `callHrApi` | Tools sobre a API de RH (fonte B) | 0 |
| `grade` | Decide responder ou recusar | **0** |
| `generateAnswer` | Gera a resposta fundamentada, com streaming | 1 |
| `refuse` | Texto fixo de recusa | **0** |
| `meta` | Texto fixo sobre o próprio assistente | **0** |

**Número fixo de chamadas por rota:** `kb`, `tool` e `hybrid` fazem 2;
`outOfScope` e `meta` fazem 1. É isso que torna o p95 explicável — e as duas
rotas de uma chamada só são, medidas, as mais rápidas do sistema (p50 885 ms e
920 ms contra 1 831 ms da rota `kb`).

### A rota `meta`, e o defeito que a originou

`meta` responde a quem fala **com** o assistente em vez de **através** dele:
uma saudação, "o que você faz", "quais assuntos você cobre".

Ela existe porque a taxonomia original tinha quatro rotas e nenhuma servia. Uma
pergunta sobre as capacidades do assistente não está em `ferias.md` e não é dado
pessoal, então o classificador a mandava para `outOfScope` — cuja definição
("não é assunto de RH/TI") ela genuinamente satisfazia. O modelo classificava
**corretamente**; faltava palavra no vocabulário que demos a ele.

O sintoma era um "olá" recebendo *"Não consigo ajudar com esse assunto"* — e o
texto dessa recusa, ironicamente, lista tudo o que o assistente sabe fazer. O
conteúdo certo, com o rótulo errado.

Duas consequências que valem registrar:

- **O defeito era de modelagem, não de calibração.** Parecia limiar mal
  ajustado; era categoria faltando no domínio.
- **A suíte não podia pegá-lo.** O classificador fake não tinha padrão para o
  caso e caía no default `kb`, então sob teste a pergunta *funcionava*. Só o
  modelo real, raciocinando a partir da taxonomia, produzia a recusa. Um teste
  com o fake prova que o grafo trata a rota; ele não prova que o classificador
  escolhe a rota. São garantias diferentes, e vale não confundi-las.

### Por que um StateGraph explícito e não `createReactAgent`

1. **Latência previsível.** Um laço ReAct chamaria o modelo de 1 a N vezes para
   a mesma pergunta, e o p95 viraria função de quantos hops o modelo resolveu
   dar — algo que não se controla nem se explica a um stakeholder.

2. **Depurabilidade.** Cada nó tem nome, duração medida e uma responsabilidade.
   Quando o p95 sobe, dá para dizer **qual etapa** subiu, em vez de "o agente
   está lento".

3. **Falha parcial explícita.** Cada nó decide entre degradar e recusar. Dentro
   de um laço opaco, uma tool que falha vira mais uma iteração e, no limite,
   uma alucinação.

Há um teste que fixa exatamente isso:
`expect(model.structuredCalls).toBe(1); expect(model.generationCalls).toBe(1)`.
Ele não verifica qualidade de resposta — verifica o **perfil de custo**. Se
alguém adicionar um grader por LLM, o teste quebra e avisa que a história do
p95 mudou.

### O fan-out paralelo, comprovado

Na rota `hybrid`, a aresta condicional devolve **dois** destinos e o LangGraph
executa ambos no mesmo superstep. Isso foi verificado empiricamente pelos spans
do OpenTelemetry:

```
agent.classify     início=+     0µs   dur=  1381µs
agent.callHrApi    início=+  7000µs   dur= 33829µs
agent.retrieve     início=+  8000µs   dur=  2385µs   ← sobrepõe callHrApi
agent.grade        início=+ 44000µs   dur=   139µs   ← só após o mais LENTO
agent.generateAnswer início=+47000µs  dur=   436µs
```

`retrieve` e `callHrApi` se sobrepõem no tempo, e `grade` só começa depois do
ramo mais lento — o join do superstep, visível como dado e não como afirmação.

Isso só é seguro porque o estado declara **reducers de append** para `sources`
e `toolResults`. Com o comportamento padrão de última-escrita-vence, uma das
fontes sumiria em silêncio, e a resposta continuaria fluente, bem citada e
fundamentada pela metade.

### Decisão de latência no nó `grade`

O `grade` usa **limiar de score de retrieval**, não uma segunda chamada de
modelo para julgar a fundamentação. Um grader por LLM seria mais preciso, mas
acrescentaria um round-trip completo a **toda** pergunta, praticamente dobrando
o p95.

Trocamos alguma precisão por uma cauda previsível — e o limiar é **medido**, não
chutado. Note que ele é propriedade do **modelo de embedding**, não do código:
documentos relevantes pontuam 0,69–0,78 com `gemini-embedding-001` e 0,22–0,55
com o fake offline. A escala absoluta muda; o que se mantém é a **separação**
entre dentro e fora de escopo.

---

## 3. Comportamento sob falha

O princípio é **degradar, não cair**. Cada nó decide explicitamente.

| Falha | Comportamento | Visível como |
|---|---|---|
| Classificação falha | Cai para a rota `kb` | `degraded: true` |
| Retrieval indisponível | Responde só pela API | `degraded: true` + aviso |
| Uma tool falha | Responde com as outras (`allSettled`) | `degraded: true` + aviso |
| Colaborador inexistente (404) | Recusa com mensagem clara, **sem retry** | `refused: true` |
| Sem matrícula na pergunta | **Pede** a matrícula, não inventa | `missingIdentification`, **sem** `degraded` |
| Geração falha | Recusa explícita, **HTTP 200** | `sourcesUnavailable` |
| Redis fora | Serviço continua, mais lento | `cache: "MISS"` |
| Contrato da API quebrado | Erro nomeando o campo | aviso + `degraded` |

Nenhum desses casos vira HTTP 500. Uma recusa é uma **resposta válida**, e o
usuário recebe algo acionável.

### Falha não é o mesmo que entrada incompleta

Duas categorias distintas, em campos distintos da resposta:

| Campo | Significado | Ação do usuário |
|---|---|---|
| `warnings` + `degraded` | Uma dependência **falhou** | Esperar ou tentar de novo |
| `notes` | A pergunta está **incompleta** | Fornecer o dado que falta |

A separação existe porque as duas já compartilharam um canal, e o resultado foi
um sistema saudável exibindo o badge âmbar *"respondido com uma fonte
indisponível"* porque alguém não tinha digitado a matrícula. Isso não é um
aviso — é desinformação, e aponta o usuário para um sistema que está intacto.

Os textos também nomeiam **o dado**, não a ferramenta interna: *"não consultei
seu saldo de banco de horas porque a matrícula não foi informada"*, e não
`get_hours_bank: employee or ticket number not provided`.

> **Uma lição aprendida durante o desenvolvimento:** a degradação graciosa torna
> falhas *sobrevivíveis* mas também *silenciosas*. O `HR_API_BASE_URL` apontava
> para `localhost`, que no Node 18+ resolve para IPv6 `::1` enquanto o servidor
> escuta em `0.0.0.0` (IPv4). **Toda** chamada de tool falhava — e o sintoma era
> uma resposta educada dizendo que o sistema de RH estava indisponível. Nada
> quebrava visivelmente.
>
> A mitigação não é degradar menos: é tornar a degradação **ruidosa nos dados**.
> Por isso `degraded` e `warnings` são campos de primeira classe na resposta e
> aparecem como badge no console, em vez de viverem só no log.

---

## 4. Cache

Duas camadas, ambas atrás da `CachePort`.

**L1 — resposta completa.** Chave:
`sha256(pergunta normalizada + modelo + corpusVersion)`.

Cada componente previne um bug concreto:

- **modelo** — sem ele, um deploy que troca o modelo continuaria servindo
  respostas do modelo anterior até o TTL expirar, contaminando inclusive a
  medição de latência do novo.
- **corpusVersion** — sem ele, corrigir uma política não teria efeito visível
  por uma hora. O pior momento possível para descobrir isso é logo depois de
  corrigir um erro.

**L2 — embedding da consulta.** Um decorador da `EmbeddingsPort`; o grafo não
sabe que existe. Ganha quando o corpus é editado (L1 invalida, mas o embedding
da pergunta continua válido) e quando várias réplicas compartilham um Redis.

### O que NUNCA é cacheado

| Caso | Motivo |
|---|---|
| Resposta com **dado pessoal** | **Privacidade.** A chave deriva só do texto: *"qual o meu saldo?"* de dois colaboradores normaliza para a MESMA chave. Servir do cache vazaria o saldo de um para o outro. |
| Resposta **degradada** | Descreve um estado transitório. Congelar *"o RH está fora"* por uma hora transformaria um blip de 30 s numa indisponibilidade de 60 min. |
| Recusa por **falta de matrícula** | A próxima pessoa pode informar o id, e a pergunta normalizada é a mesma. |

O vazamento de dado pessoal é um bug de **privacidade**, não de performance, e
só se manifestaria em produção com dois usuários simultâneos. A solução de
produção (incluir o tenant na chave) está no ADR.

### Custo zero em cache hit

Um acerto reporta `cost.usd = 0` e zero tokens. Não é maquiagem contábil: o
request não consumiu token nenhum. Reportar o custo original cobraria duas vezes
pelo mesmo trabalho e tornaria invisível a economia real no `latency.csv`.

---

## 5. Latência: onde o tempo vai

```
request ──► [cache L1] ──HIT──► resposta                    ~1 ms
                │
               MISS
                ▼
           classify                                    ~700–900 ms  (modelo)
                ▼
      retrieve ∥ callHrApi                             ~200–400 ms  (embedding + HTTP)
                ▼
             grade                                          ~0 ms  (limiar)
                ▼
        generateAnswer                                ~900–2000 ms  (modelo)
```

**O modelo domina.** Retrieval e a chamada de RH somam centenas de
milissegundos; as duas chamadas de modelo somam segundos. É por isso que o
número de chamadas por rota é fixo e testado.

### O que foi feito para reduzir latência

| Medida | Efeito |
|---|---|
| **Modelo escolhido por medição** | 712 ms de TTFT contra 98 737 ms do maior candidato |
| **Fan-out paralelo** na rota híbrida | Retrieval e API não somam |
| `grade` por limiar, não por LLM | Evita um round-trip por pergunta |
| Recusa sem chamada de modelo | Caminho mais comum de abuso é o mais barato |
| **Streaming (SSE)** | TTFT ~400 ms contra ~2 s de resposta completa |
| **Cache L1** | 1 ms contra ~2 s |
| **Prazo total do request** | p99 de 51 327 ms para 15 016 ms |
| Ingestão offline | Boot instantâneo; nenhum request paga embedding do corpus |

### O gargalo que era nosso

A primeira medição deu p99 = 51 s. A causa não era o provedor: `LLM_TIMEOUT_MS`
de 20 s com 2 retentativas permite 60 s legítimos, e cada nó somava o próprio
teto.

Timeout por tentativa **multiplica** a cauda. Só um prazo **absoluto** a limita.
O `REQUEST_DEADLINE_MS` é aplicado em dois pontos, e ambos são necessários:

1. `withRetry` não inicia uma tentativa que já nasceria fora do prazo;
2. `remainingBudget()` limita o timeout de **cada chamada** ao que resta.

Só o primeiro deixava o prazo como intenção: cada nó usava o teto cheio e a soma
estourava (max medido: 19 824 ms contra prazo de 15 000 ms). Com os dois, o
máximo observado passou a ser 15 016 ms — um teto real.

---

## 6. Escala

### O que medimos

| Concorrência | Serviço isolado | Produção, cache quente |
|---|---|---|
| 1 | 181 rps | 172 rps |
| 10 | 1 898 rps | 1 915 rps |
| 50 | **2 925 rps** · p95 23 ms | **2 960 rps** · p95 22 ms |

Zero erros. **As duas colunas coincidirem é o resultado**: com cache quente, o
provedor sai do caminho quente por completo.

### O que isso significa

O processo passa ~99% do tempo de parede **bloqueado em I/O**, esperando a
resposta do Gemini. Consequências:

- **Concorrência é quase de graça.** O event loop do Node lida com dezenas de
  requests simultâneos sem esforço; não há trabalho de CPU a paralelizar.
- **O teto real é a cota do provedor**, não o nosso hardware. Isso ficou
  visível nas medições: sob martelada no tier gratuito, 45% dos requests
  degradaram por throttling — enquanto o serviço em si respondia 2 900 rps.
- **Escalar horizontalmente é trivial** (o serviço é stateless), mas só ajuda
  até o limite de RPM do provedor.

Por isso o cache é o mecanismo de escala, e não uma otimização acessória.

O tratamento completo — separação de responsabilidades, filas, rate limiting,
multi-tenant — está no [ADR](docs/adr/0001-escala-e-separacao-de-responsabilidades.md).

---

## 7. Custo

Cada resposta reporta tokens de entrada, de saída e custo em dólares. Medido:
**US$ 0,00017 a US$ 0,00101 por pergunta**, conforme a rota.

| Rota | Custo médio |
|---|---|
| `outOfScope` | US$ 0,000169 |
| `tool` | US$ 0,000178 |
| `kb` | US$ 0,000604 |
| `hybrid` | US$ 0,000971 |

### O que mudaria sob pressão de custo

1. **Aumentar o TTL do cache.** É o de maior efeito: perguntas de política se
   repetem muito entre colaboradores.
2. **Cache semântico** (similaridade em vez de igualdade). Deliberadamente fora
   de escopo aqui pelo risco de servir a resposta de uma pergunta *parecida*
   mas diferente.
3. **Reduzir o `topK`.** Cada chunk recuperado entra no prompt; 4 → 3 corta
   ~20% dos tokens de entrada.
4. **Cascata de modelos:** classificar com o modelo mais barato e reservar o
   maior para as rotas híbridas.

> **Nota de instrumentação.** O `@langchain/google-genai` 2.2.0 devolve
> `usage_metadata` **zerado** no caminho de streaming (verificado: 4 chunks,
> todos `0/0`), enquanto o `invoke()` devolve corretamente e a API crua devolve
> `usageMetadata` completo no último evento SSE. Como custo por request é
> entregável, o streaming é falado **direto com a API do Gemini**, atrás da
> `ChatModelPort`. O LangChain continua sendo usado onde funciona bem: saída
> estruturada, definição de tools com zod e todo o LangGraph.

---

## 8. Segurança

| Vetor | Mitigação |
|---|---|
| Injeção pelo **usuário** | Classificada como `outOfScope`; o prompt declara que instruções na pergunta são dado, não comando |
| Injeção pelo **corpus** | O prompt declara que texto do contexto é informação, não instrução. **É o vetor que importa em produção**, quando uma política é editável por alguém fora de engenharia |
| Vazamento entre usuários | Resposta com dado pessoal nunca é cacheada |
| Alucinação | Limiar de fundamentação + recusa determinística + citação obrigatória |
| Custo descontrolado | Limite de tamanho da pergunta, prazo por request, contagem de tokens por resposta |
| DoS pelo interruptor de caos | Atrás de `CHAOS_ENABLED`, desligado em produção |
| Path traversal nos *resources* MCP | URIs vêm do cliente e viram leitura de arquivo. O corpus é lido uma vez e vira **allowlist**: só nomes listados são resolvíveis, o que torna `hr://policy/../../.env` impossível em vez de filtrado |

---

## 9. Limitações conhecidas

Ditas explicitamente, porque um documento de arquitetura que só lista acertos
não é confiável.

1. **Busca vetorial O(n) em memória.** Correto para ~50 chunks, errado para
   500 mil. A `VectorStorePort` existe exatamente para que esse dia seja um dia
   de um arquivo só.
2. **Sem multi-tenant.** A chave de cache não tem tenant; por isso rota com dado
   pessoal não cacheia. Resolver isso é pré-requisito para produção.
3. **Avaliação de retrieval com amostra pequena.** 14 perguntas com gabarito
   sobre um corpus bem separado. Piso de sanidade, não prova de robustez.
4. **Sem memória de conversa.** Cada pergunta é independente. Follow-ups do
   tipo *"e no ano que vem?"* não funcionam.
5. **Uma tool por hop.** A seleção é feita pelo classificador em um hop fixo;
   perguntas que exigissem descoberta em etapas não são atendidas. Foi uma
   troca consciente por previsibilidade de cauda.
6. **O endpoint MCP não tem autenticação.** Ele responde perguntas sobre dados
   de colaborador para quem o alcançar. Isso é **paridade** com o `POST /ask`,
   que já é aberto — não um buraco novo —, mas continua sendo bloqueante para
   produção. Resolver identidade (e a ACL de recuperação que vem junto) é o
   risco nº 2 do ADR.
7. **A suíte não cobre o julgamento do classificador.** Os testes rodam com o
   provider fake, então provam que o **grafo** trata cada rota corretamente —
   não que o **modelo** escolhe a rota certa. Dois defeitos reais escaparam por
   essa fresta (o "reembolsáveis" que continha "bolsa", e o "olá" classificado
   como fora de escopo), ambos encontrados olhando a tela. Fechar isso exigiria
   um conjunto de avaliação de classificação rodado contra o modelo real, com
   custo e não-determinismo — decisão consciente de não fazer aqui, mas é a
   lacuna que eu fecharia primeiro.
8. **`SimpleSpanProcessor` no OTel.** Faz I/O no caminho do request. Em produção
   seria `BatchSpanProcessor`; aqui é aceitável porque o destino é o console e o
   tracing fica desligado durante os benchmarks.
