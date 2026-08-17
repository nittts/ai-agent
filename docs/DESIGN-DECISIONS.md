# Decisões de design

Cada decisão relevante do projeto, com **a alternativa descartada** e **por
quê**. Escrito para ser usado como material de apoio na apresentação: cada
seção é auto-contida e responde a uma pergunta que um avaliador provavelmente
faria.

Decisões que foram **medidas** trazem o número. Decisões que foram **julgadas**
dizem isso explicitamente.

---

## Índice

- [Arquitetura](#arquitetura)
- [O agente](#o-agente)
- [Retrieval](#retrieval)
- [Modelo e provedor](#modelo-e-provedor)
- [Resiliência e latência](#resiliência-e-latência)
- [Cache](#cache)
- [Observabilidade](#observabilidade)
- [Testes](#testes)
- [Interface](#interface)
- [Decisões que eu reverteria ou revisitaria](#decisões-que-eu-reverteria-ou-revisitaria)

---

## Arquitetura

### D1. Hexagonal + Clean Architecture, com a regra de dependência para dentro

**Alternativa descartada:** a estrutura padrão do NestJS
(`modules/*/controller|service|repository`).

**Por quê:** a estrutura padrão organiza por *mecanismo*. Este sistema tem uma
propriedade que vale mais: **rodar inteiro sem credencial**. Isso só é possível
se o modelo estiver atrás de uma interface que a aplicação possui e a
infraestrutura implementa.

A regra de dependência é verificável com `grep`: nada em `domain/` ou
`application/` importa de `infrastructure/`.

**Custo assumido:** mais arquivos e uma indireção a mais para quem só quer ler
"onde chama o Gemini". Mitigado pelo [guia do código](CODEBASE-GUIDE.md).

---

### D2. LangGraph mora em `application/`, não em `infrastructure/`

**Alternativa descartada:** tratar o LangGraph como detalhe de infraestrutura,
atrás de uma porta.

**Por quê:** o LangGraph não é um sistema externo com que conversamos — **ele é
a forma do caso de uso**. Fornecedores (Google, Redis, API de RH) ficam atrás de
portas porque poderiam ser trocados sem mudar o que o produto faz. Trocar o
motor de orquestração *muda* como o caso de uso é expresso.

Colocá-lo atrás de uma porta produziria uma abstração que existe só para
satisfazer um diagrama, com um único implementador e nenhum segundo candidato
plausível.

**Trade-off explícito:** trocar o LangGraph reescreve `application/agent/`.
Trocar Gemini ou Redis, não.

---

### D3. Porta nomeada `HrDirectoryPort`, não `HttpClientPort`

**Por quê:** o agente precisa de **dados de colaborador**. Se isso chega por
HTTP, gRPC ou uma consulta a banco é decisão de infraestrutura que a aplicação
não deve codificar no próprio nome.

Nomear pelo transporte é o erro clássico que transforma uma porta em um wrapper.

---

### D4. Cinco portas, não uma "LLMPort" única

**Alternativa descartada:** `ChatModelPort` e `EmbeddingsPort` fundidas.

**Por quê:** são modelos diferentes, com ciclos de vida, modos de falha e perfis
de custo diferentes. Embeddings são usados **offline** (ingestão) *e* online
(consulta); chat é só online. Uma porta única forçaria os dois a mudarem juntos.

---

### D5. CommonJS, não ESM

**Alternativa descartada:** ESM (`"type": "module"`).

**Por quê:** decisão de **risco**, não de estilo. O modelo de decorators e DI do
NestJS é construído e testado primariamente contra CJS, e o ESM exigiria
extensão `.js` em todo import relativo — algo que o `tsx` mascara em
desenvolvimento e o `tsc` + `node dist/main.js` não. Essa divergência é o
clássico "funciona local, quebra no Docker", e reprodutibilidade em Docker é
entregável.

Verificado antes de decidir: o LangChain publica build CJS com condição
`require`, então não custa nada.

---

## O agente

### D6. `StateGraph` explícito, não `createReactAgent`

**A decisão mais importante do projeto.**

**Por quê:**

1. **Latência de cauda previsível.** Um laço ReAct chama o modelo de 1 a N vezes
   para a mesma pergunta; o p95 vira função de quantos hops o modelo resolveu
   dar — algo que não se controla nem se explica. Com grafo explícito o número é
   **fixo por rota**: 2 para kb/tool/hybrid, 1 para outOfScope.
2. **Depurabilidade.** Cada nó tem nome, duração medida e uma responsabilidade.
   Quando o p95 sobe, dá para dizer *qual etapa* subiu.
3. **Falha parcial explícita.** Cada nó decide entre degradar e recusar. Num
   laço opaco, uma tool que falha vira mais uma iteração e, no limite, uma
   alucinação.

**O que se perde:** encadeamento autônomo de várias ferramentas para perguntas
que exigiriam descoberta em etapas. Para consultas pontuais de RH isso não
aparece.

**Como está protegido:** um teste fixa
`structuredCalls === 1 && generationCalls === 1`. Ele não verifica qualidade —
verifica o **perfil de custo**. Se alguém adicionar um grader por LLM, o teste
quebra e avisa que a história do p95 mudou.

---

### D7. Fan-out paralelo na rota híbrida

**Por quê:** busca vetorial e chamada de API são I/O independentes; serializá-las
somaria os dois tempos à toa. A aresta condicional devolve dois destinos e o
LangGraph os executa no mesmo superstep.

**Comprovado empiricamente** pelos spans do OpenTelemetry: `callHrApi` começou
em +7 ms e durou 34 ms, `retrieve` começou em +8 ms e durou 2,4 ms — sobrepostos
— e `grade` só começou em +44 ms, depois do ramo mais lento.

**Pré-requisito não óbvio:** o estado precisa declarar **reducers de append**
para `sources` e `toolResults`. Com o comportamento padrão de
última-escrita-vence, uma das fontes sumiria em silêncio e a resposta
continuaria fluente, bem citada e fundamentada pela metade.

---

### D8. `grade` por limiar de score, não por LLM juiz

**Alternativa descartada:** uma segunda chamada de modelo julgando se o contexto
fundamenta a resposta.

**Por quê:** o grader por LLM é mais preciso e acrescentaria um round-trip
completo a **toda** pergunta, praticamente dobrando o p95. Troca deliberada de
precisão por cauda previsível.

O limiar é **medido**, não chutado — e é propriedade do **modelo de embedding**,
não do código: relevantes pontuam 0,69–0,78 com `gemini-embedding-001` e
0,22–0,55 com o fake. A escala muda; a separação entre dentro e fora de escopo
se mantém.

---

### D9. Recusas são texto fixo, com zero chamadas de modelo

**Por quê:** três consequências, todas desejadas — custam ~0 ms e US$ 0, são
testáveis sem rede, e **não podem alucinar**. Uma recusa gerada por modelo é
justamente onde ele tentaria ser prestativo e inventar algo.

Efeito colateral interessante: o caso mais comum de abuso (pergunta fora de
escopo, injeção) é o **caminho mais barato** do sistema, invertendo o padrão em
que guardrails encarecem tudo.

---

### D10. Quatro motivos de recusa distintos, não um genérico

**Por quê:** dizer *"não encontrei essa informação"* quando o problema real é
*"você não informou sua matrícula"* desperdiça o tempo do usuário. Cada motivo
mapeia para uma mensagem acionável; a de identificação inclui um exemplo.

---

### D11. `degraded` é uma trava (`current || next`), não uma flag

**Por quê:** se uma tool falha e um nó posterior escrevesse `degraded: false`, o
request reportaria sucesso tendo respondido com metade da evidência. Uma vez
degradado, permanece degradado.

---

### D12. Seleção de tool por saída estruturada, não function calling em laço

**Por quê:** mesmo raciocínio de D6 — um hop fixo em vez de 1..N.

As tools **são** `tool()` do LangChain com schema zod de verdade: o schema
documenta, valida os argumentos e é o que seria enviado num function calling
nativo. O que é determinístico é a **seleção**, não a definição.

---

## Retrieval

### D13. Chunking por seção `##`, não por tamanho fixo

**Por quê:** o cabeçalho é a **âncora de citação** que aparece no painel
(`ferias.md § Abono pecuniário`). Cortar cegamente a cada 600 caracteres
produziria citações apontando para o meio de um parágrafo, e o avaliador não
conseguiria conferir a fundamentação.

`###` fica dentro da `##` a que pertence: separar *"Inclusão de dependentes"* de
*"Plano de saúde"* faria o trecho perder o referente.

---

### D14. Título da seção prefixado no texto do chunk

**Por quê:** o embedding passa a carregar o assunto mesmo quando o trecho,
isolado, não o menciona. Um parágrafo que diz apenas *"o limite é de 10 dias"*
seria irrecuperável sem o prefixo *"Abono pecuniário"*.

---

### D15. Seções muito curtas são absorvidas pela vizinha

**Por quê:** um chunk de 20 caracteres (`## Gympass`) tem embedding
praticamente aleatório e polui o top-k com ruído de alta similaridade.

*(Este código teve um bug real: a condição estava invertida, checando a seção
anterior em vez da corrente. Pego pelo teste que existia exatamente para isso.)*

---

### D16. `corpusVersion` no metadata de cada chunk

**Por quê:** entra na chave do cache de respostas. Editar uma política invalida
automaticamente as respostas que se apoiavam no texto antigo. Sem isso, corrigir
um erro não teria efeito visível por uma hora — o pior momento possível para
descobrir isso.

O hash ordena por nome de arquivo para não depender da ordem de leitura do
diretório: caso contrário o mesmo corpus geraria versões diferentes em máquinas
diferentes e invalidaria o cache à toa.

---

### D17. Ingestão offline, nunca no boot

**Por quê:** embeddar o corpus a cada start deixaria o boot lento, gastaria cota
por réplica e faria o **primeiro request de cada container pagar a conta** —
poluindo justamente o p95 que precisamos reportar.

---

### D18. Busca O(n) em memória

**Por quê:** ~50 chunks pesquisados em microssegundos contra ~1 s de chamada de
modelo. Trocar por HNSW/pgvector só compensa em outra ordem de grandeza.

**Honestidade:** está errado para 500 mil chunks, e é por isso que a
`VectorStorePort` existe — para que esse dia seja um dia de um arquivo só.

---

## Modelo e provedor

### D19. `gemini-3.5-flash-lite`, escolhido por medição

| Candidato | TTFT medido |
|---|---|
| gemini-3.7-flash | 98 737 ms |
| gemini-3.5-flash | 21 356 ms |
| gemini-3.1-flash-lite | 1 979 ms |
| **gemini-3.5-flash-lite** | **712 ms** |

**Por quê:** os modelos maiores gastam segundos em raciocínio que uma consulta
de política não precisa. Escolha por **número**, não por nome.

---

### D20. Modelo fixado, nunca `gemini-flash-latest`

**Por quê:** um ponteiro móvel torna o `latency.csv` **irreproduzível**: o
modelo pode mudar entre a medição e a apresentação, e os números deixam de
descrever qualquer coisa específica.

---

### D21. Streaming falado direto com a API do Gemini

**Alternativa descartada:** `ChatGoogleGenerativeAI.stream()` do LangChain.

**Por quê:** verificado — o `@langchain/google-genai` 2.2.0 devolve
`usage_metadata` **zerado** no streaming (4 chunks, todos `0/0`), enquanto o
`invoke()` devolve `17/39/56` corretamente e a **API crua** devolve
`usageMetadata` completo no último evento SSE. O dado existe; o wrapper o perde.

Contagem de tokens e custo são **entregáveis**. Reportar zero não era opção, e
estimar por tamanho de texto seria inventar número em cima de um dado que a API
fornece de graça.

**Contido atrás da `ChatModelPort`** — nenhum nó do grafo sabe da diferença. O
LangChain segue em uso na saída estruturada, nas tools com zod e em todo o
LangGraph.

---

### D22. `LLM_PROVIDER=fake` como cidadão de primeira classe

**Por quê:** é o que faz a suíte inteira rodar sem credencial, e portanto o CI
sem secrets. Não é mock: é outra implementação da porta, e o caminho de código
exercitado é o de produção.

---

### D23. O fake de embeddings usa hashing trick, não hash do texto

**Por quê:** um hash do texto inteiro seria determinístico e offline, mas
produziria vetores **sem relação semântica** entre si — e então todo teste de
retrieval viraria teatro: o top-k seria aleatório e asserções como *"a pergunta
sobre férias recupera ferias.md"* passariam por acaso.

O hashing trick sobre saco de palavras preserva **sobreposição lexical**.
Medido offline: recall@1 7/10, recall@3 9/10, com fora-de-escopo em 0,16 contra
0,41–0,55 das legítimas.

**Contrato explícito:** o fake serve para teste e desenvolvimento. Latência,
custo e recall são sempre medidos com o provedor real.

---

## Resiliência e latência

### D24. Prazo total por request, não só timeout por tentativa

**A correção de maior impacto do projeto.**

**Problema medido:** p99 = 51 327 ms — causado pela **nossa** política de retry,
não pelo Gemini. Timeout de 20 s com 2 retentativas permite 60 s legítimos, e
cada nó somava o próprio teto.

**Por quê o prazo absoluto:** timeout por tentativa **multiplica** a cauda; só um
prazo compartilhado a limita.

Aplicado em **dois** pontos, e ambos são necessários:

1. `withRetry` não inicia tentativa que já nasceria fora do prazo;
2. `remainingBudget()` limita o timeout de **cada chamada** ao que resta.

Só o primeiro deixava o prazo como intenção — max medido de 19 824 ms contra
prazo de 15 000 ms.

| | p50 | p95 | p99 | max |
|---|---|---|---|---|
| Sem prazo | 1 674 | 11 881 | **51 327** | 51 327 |
| Só no retry | 2 443 | 25 638 | 39 685 | 39 685 |
| **Nos dois** | 2 225 | 15 005 | **15 016** | 15 016 |

---

### D25. Retry só do que é transitório

**Por quê:** 429 e 5xx repetem; 404 e 400 não. Repetir um 404 não faz o
colaborador existir, e repetir um 400 só multiplica o erro de quem chamou —
gastando latência e cota para chegar à mesma resposta.

---

### D26. Backoff com jitter

**Por quê:** sem jitter, N requisições que tomam 429 ao mesmo tempo repetem
todas no mesmo instante, recriando o pico que causou o 429. Sob a concorrência
do teste de carga isso vira martelada sincronizada, e o gráfico de escala passa
a medir a **nossa retentativa** em vez do serviço.

Há um teste que verifica que os atrasos realmente se espalham.

---

### D27. `maxRetries: 0` no cliente LangChain

**Por quê:** o LangChain repetiria internamente, de forma **invisível** para
nós: inflaria a latência medida sem atribuição possível e empilharia
multiplicativamente com a nossa política.

---

### D28. Degradar em vez de derrubar, em todo nó

**Por quê:** uma dependência fora não deve virar indisponibilidade total.
Retrieval fora → responde pela API. Tool fora → responde pela política. Modelo
fora → recusa explícita com HTTP 200.

**A armadilha, aprendida na prática:** degradação graciosa torna falhas
**silenciosas**. O `HR_API_BASE_URL` apontava para `localhost`, que no Node 18+
resolve para IPv6 enquanto o servidor escuta em IPv4 — **toda** chamada de tool
falhava, e o sintoma era uma resposta educada dizendo que o RH estava fora.

**Mitigação:** não degradar menos, mas tornar a degradação **ruidosa nos
dados** — `degraded` e `warnings` são campos de primeira classe da resposta e
aparecem como badge no console.

---

## Cache

### D29. Chave com pergunta + modelo + corpusVersion

Cada componente previne um bug concreto — ver [D16](#d16-corpusversion-no-metadata-de-cada-chunk)
e a seção de cache do [ARCHITECTURE.md](../ARCHITECTURE.md#4-cache).

---

### D30. Normalização remove acentos

**Por quê:** num assistente brasileiro, metade digita "ferias" e metade
"férias", com resposta idêntica. Sem isso, duas entradas para a mesma pergunta.

**Risco avaliado:** conflar pares como "está"/"esta" — irrelevante porque o que
se compara é a **pergunta inteira**, não palavras isoladas.

---

### D31. Resposta com dado pessoal NUNCA é cacheada

**O bug de privacidade que quase foi escrito.**

A chave deriva só do texto. *"Qual o meu saldo de férias?"* de dois
colaboradores normaliza para a **mesma chave** — servir do cache vazaria o saldo
de um para o outro.

É bug de **privacidade**, não de performance, e só se manifesta com dois
usuários simultâneos: passaria por qualquer teste de usuário único, por qualquer
demo, e chegaria a produção.

**Assimetria que orienta a regra:** cachear de menos custa milissegundos;
cachear demais custa um incidente. A solução de produção (tenant na chave) está
no ADR.

---

### D32. Resposta degradada não é cacheada

**Por quê:** *"o RH não respondeu"* descreve o **instante**. Congelar isso por
uma hora significaria continuar reportando indisponibilidade muito depois da
recuperação — transformando um blip de 30 s numa indisponibilidade de 60 min do
ponto de vista do usuário.

---

### D33. Cache hit reporta custo zero

**Por quê:** o request não consumiu token nenhum. Reportar o custo original
cobraria duas vezes pelo mesmo trabalho e tornaria **invisível** a economia real
no `latency.csv`.

---

### D34. `enableOfflineQueue: false` no ioredis

**A linha mais importante do adaptador de cache, e o padrão está errado.**

Por padrão o ioredis **enfileira** comandos com a conexão caída e os executa
quando ela volta. Sensato para escrita em banco; catastrófico para cache: com o
Redis fora, cada request ficaria bloqueado esperando o timeout do comando. O
componente adicionado para acelerar deixaria o sistema **~50× mais lento** do
que não ter cache nenhum.

**Verificado com Redis morto:** 200 OK em ~20 ms, processo vivo, **um** aviso no
log em vez de um por request.

---

### D35. Cache de embeddings como decorador, não dentro do nó

**Por quê:** o grafo continua conhecendo só `EmbeddingsPort`. Remover a camada é
apagar uma linha de um factory.

---

## Observabilidade

### D36. Seam de tracing com uma única função

**Por quê:** instrumentação tende a se espalhar. Quando cada nó abre e fecha o
próprio span, o código de negócio afoga no ritual de telemetria — e a primeira
coisa que se perde é a legibilidade do fluxo, que é justamente o que a
telemetria deveria revelar.

Todo nó já passava por `timed()` para ser medido, então o span sai de graça ali.

---

### D37. Desligado por padrão, e desligado é custo zero

**Por quê:** sem SDK registrado, a API do OpenTelemetry devolve no-ops. Não há
`if (habilitado)` em lugar nenhum. **Verificado:** 0 spans, p50 inalterado.

---

### D38. `correlationId` via `AsyncLocalStorage`

**Por quê:** os nós do grafo são funções puras que não deveriam saber que HTTP
existe, e passar o id por toda a árvore poluiria cada assinatura. O ALS anexa ao
contexto assíncrono, e o `mixin` do pino carimba em toda linha, em qualquer
profundidade.

Um `x-correlation-id` recebido é **preservado**: correlacionar entre serviços
exige propagar, não gerar um novo a cada salto.

---

### D39. `tempos.perNode` exposto no contrato da API

**Por quê:** é a mesma informação dos spans, mas sem exigir um coletor de traces
para enxergá-la. É o que permite ao console desenhar a cascata e responder
"onde foi o p95?" com uma etapa concreta.

---

## Testes

### D40. A suíte inteira roda sem credencial

**Verificado com o `.env` removido do disco:** 202/202 passam.

**Por quê é arquitetural e não conveniência:** só é verdade se o provedor
estiver atrás de uma interface que um fake consegue satisfazer. Essa restrição
força a inversão de dependência que a JD pede, viabiliza CI sem secrets, e dá
uma forma determinística de testar roteamento e caminhos de falha — que são
exatamente os caminhos impossíveis de testar de forma confiável contra um LLM
real.

---

### D41. Testes de contrato validando corpus **contra** o seed

**Por quê:** as perguntas híbridas só têm resposta correta se os números do seed
conversarem com as regras do corpus. Essa ligação é **invisível** no código:
nada impediria alguém de mudar o saldo de 18 para 5 dias e transformar
silenciosamente a pergunta 16 da demo em algo sem sentido, com todos os outros
testes verdes.

---

### D42. Cliente HTTP testado contra servidor real, não mock de `fetch`

**Por quê:** um mock provaria apenas que o mock funciona. Timeout de socket,
retry seletivo e sobretudo **validação de contrato** só têm sentido contra
respostas HTTP de verdade.

---

### D43. `SseReader` extraído para ser testável

**Por quê:** foi onde morou o defeito mais caro do projeto. O parser estava
inline em `generate()`, alcançável só por chamada de rede — **código que só
pode ser exercitado pela rede é código que só será depurado em produção**.

Extraído, hoje tem 10 testes incluindo fragmentação byte a byte, que é o caso
que um socket real produz e um teste de caminho feliz nunca.

---

### D44. Integração com Redis é pulada, não falhada, quando não há Redis

**Por quê:** o CI não deve passar a depender de infraestrutura. A suíte
principal roda com `CACHE_ENABLED=false`.

---

## Interface

### D45. O console é um instrumento, não um app de chat

**Por quê:** os requisitos 4 a 7 do desafio são todos sobre **provar** o que
aconteceu. A conversa é a entrada; a evidência é o produto. Toda cor codifica um
estado — verde para cache HIT, âmbar para degradado, cinza para recusa.

---

### D46. Cascata de latência como elemento-assinatura

**Por quê:** responde visualmente a "onde foi o p95?" com uma **etapa concreta**
em vez de um agregado. A hachura marca nós que rodaram no mesmo superstep — e
**só aparece quando os dois realmente rodaram**, senão o painel afirmaria um
paralelismo que não houve.

---

### D47. Bundle commitado, sem build para o avaliador

**Por quê:** `docker compose up`, abrir `localhost:3000`, pronto. O CI verifica
que o bundle commitado corresponde ao fonte — se divergir, o console entregue
estaria desatualizado.

---

### D48. Console em TypeScript compartilhando o contrato do backend

**Por quê:** `web/app.ts` importa os tipos de
`src/presentation/http/api-contract.ts`, o **mesmo arquivo** que o controller
retorna. Renomear um campo quebra o `npm run typecheck` em vez de renderizar
`undefined` no painel na frente do avaliador.

---

### D49. SSE é GET com `?q=`, o JSON é POST

**Por quê:** imposição do `EventSource` do browser, que não envia corpo e só faz
GET. A assimetria é proposital e documentada — não é descuido de API.

`X-Accel-Buffering: no` é obrigatório: sem ele o nginx acumula a resposta e
entrega tudo junto, anulando o ganho que justifica o streaming. Falharia **só**
em produção, atrás de proxy.

---

### D50. Servido pelo mesmo processo, mesma origem

**Por quê:** sem CORS, sem segundo container, sem `VITE_API_URL` para
configurar errado. O modo de falha contra o qual se projeta não é elegância
técnica — é o avaliador assistindo você depurar um erro de conexão nos primeiros
dois minutos da call.

---

## MCP

### D51. O agente é publicado como MCP, não as tools de RH

**Por quê:** a alternativa óbvia era expor `get_vacation_balance`,
`get_benefits` e `get_hours_bank` como tools MCP — um proxy fino sobre a API de
RH. Foi descartada: isso entrega **dado sem fundamentação** e transfere para o
cliente toda a responsabilidade que este projeto assume — recuperar a política
aplicável, citar a fonte, recusar quando não há base, degradar de forma
explícita e contabilizar custo.

Publicando `perguntar_rh`, um cliente MCP herda o agente inteiro. O valor do
sistema está na camada de grounding, não no acesso ao dado; expor o acesso cru
publicaria justamente a parte que não é nossa.

**Descartado também:** publicar as duas coisas. Um cliente que enxerga os dois
caminhos vai escolher o mais barato, e o mais barato é o sem grounding.

---

### D52. Uma recusa retorna normalmente; `isError` fica para falha real

**Por quê:** `isError` no MCP significa "a execução da tool falhou". Uma recusa
fundamentada — pergunta fora de escopo, contexto insuficiente — é o agente
**funcionando como projetado**. Marcá-la como erro faria clientes
bem-comportados tentarem de novo (gastando cota para receber a mesma recusa) ou
exibirem uma falha de sistema ao usuário quando declinar era a resposta certa.

O motivo viaja em `structuredContent.refusalReason`, onde o cliente pode agir
sobre ele. `isError` fica reservado ao que é de fato entrada inválida — uma
pergunta vazia. É a mesma distinção que o HTTP faz ao devolver **200** numa
recusa (D14 e D18): recusar é uma resposta, não um defeito.

---

### D53. Transporte sem sessão, um servidor por request

**Por quê:** `StreamableHTTPServerTransport` com `sessionIdGenerator: undefined`.
Sem estado de sessão no processo, qualquer réplica atende qualquer request — a
mesma propriedade que já vale para `POST /ask` e sobre a qual o ADR apoia o
escalonamento horizontal.

O custo é instanciar `McpServer` e transporte por chamada. Foi **medido**, não
suposto: p50 0,48 ms / p95 1,07 ms por request, contra um p50 de request de
~1,9 s — três ordens de grandeza abaixo.

A primeira versão custava p50 1,02 ms porque listava o corpus a cada chamada. O
`readdir` subiu para o registro da rota: o corpus é fixo no boot, e I/O
bloqueante no event loop é exatamente o custo que deixa de ser irrelevante sob
concorrência.

**Descartado:** modo com sessão. Ganharia notificações do servidor para o
cliente, que este agente não emite, em troca de afinidade de sessão — exigindo
sticky sessions ou um store compartilhado no primeiro dia de duas réplicas.

---

### D54. Os *resources* saem de uma allowlist, não de um filtro de caminho

**Por quê:** URIs de resource chegam do cliente e terminam em leitura de
arquivo. Um filtro (`if (uri.includes('..')) reject`) é uma lista de proibições
que alguém precisa manter correta para sempre, contra normalizações,
codificação percentual e links simbólicos.

O corpus é lido uma vez no boot e vira um `Map<uri, caminhoAbsoluto>`. Só o que
foi listado é resolvível — `hr://policy/../../.env` não é *rejeitado*, ele
simplesmente **não existe**. A diferença entre garantia e filtro. Coberto por
teste com três variações de traversal, que também assertam que a resposta não
contém `GEMINI_API_KEY`.

---

### D55. `zod/v4` apenas no adaptador MCP

**Por quê:** o SDK do MCP declara seus tipos de schema contra `zod/v4`; o resto
do projeto roda zod v3, que é o que o LangChain espera. Misturar entrypoints é
normalmente um cheiro, então ficou **contido em um arquivo e declarado em
comentário**.

A alternativa era migrar o projeto inteiro para zod v4 para satisfazer um
adaptador — colocando em risco todo schema de tool do LangChain e a validação
de env em troca de servir um transporte. O zod 3.25 publica a API v4 nesse
subpath exatamente para permitir a convivência.

---

### D56. O MCP é registrado no Fastify, não em um controller do Nest

**Por quê:** o SDK assume o ciclo de vida cru de request/response —
`reply.hijack()` e escrita direta no socket. Enfiar isso em um controller do
Nest significaria lutar contra o pipeline de serialização do framework para
depois contorná-lo.

Registrar como rota Fastify em `configureApp()` põe a fronteira no lugar certo:
o MCP é um **transporte**, e transporte é assunto do servidor HTTP. O acesso ao
caso de uso vem pelo container do Nest via o provider `MCP_SETUP`, então a
fiação continua sendo uma só.

A ordem importa e está comentada no código: o handler de estáticos reivindica o
prefixo `/`, então `/mcp` precisa ser declarado **antes** dele.

---

## Conversa

### D57. Uma rota `meta`, porque "o que você faz?" não é fora de escopo

**O defeito:** um "olá" recebia *"Não consigo ajudar com esse assunto."*

**Por que acontecia:** a taxonomia tinha quatro rotas. Uma pergunta sobre as
capacidades do próprio assistente não está nas políticas, não é dado pessoal, e
sobrava só `outOfScope` — cuja definição ("não é assunto de RH/TI desta
empresa") ela genuinamente satisfaz. **O classificador estava certo.** Faltava
palavra no vocabulário que demos a ele.

Isso importa mais do que o bug: o sintoma parecia calibração (um limiar
apertado, um prompt a ajustar) e a causa era **modelagem** — uma categoria
ausente no domínio. Ajustar o prompt teria produzido um classificador que erra
de forma menos previsível, não um que acerta.

**A ironia que diagnosticou:** o texto de recusa de `outOfScope` lista
exatamente tudo o que o assistente sabe fazer. O usuário perguntava "o que você
pode fazer?" e recebia a resposta certa, embrulhada numa negativa. Conteúdo
certo, rótulo errado.

**Descartado — suavizar o texto de recusa.** Era a mudança mais barata e a
pior: o sistema continuaria reportando `refused: true` e `route: outOfScope`.
Uma saudação contaria como recusa no painel de evidência, nas métricas de
qualidade e no `structuredContent` que um cliente MCP lê. Corrigiria a
aparência mantendo o fato errado.

**Descartado — gerar a resposta com o modelo.** Fraseado mais natural, e sem
contexto recuperado para o nó `grade` avaliar: nada no grafo impediria o modelo
de oferecer "posso abrir um chamado para você" ou "consigo aprovar suas férias".
O único lugar onde o agente descreve a si mesmo é o último onde ele deveria
improvisar. O texto é fixo, como os de recusa.

**Medido:** `meta` custa 1 chamada ao modelo (só a classificação), p50 920 ms —
junto com a recusa, o caminho mais barato do sistema.

---

### D58. O teste com o fake não prova o que parece provar

**Por quê:** este defeito passou por 177 testes. O classificador fake não tinha
padrão para "o que você pode fazer" e caía no default `kb` — **sob a suíte, a
pergunta funcionava**. Só o modelo real, raciocinando a partir da taxonomia,
produzia a recusa.

A lição não é "o fake é ruim". É que ele responde a uma pergunta diferente da
que parece: um teste com o fake prova que **o grafo trata a rota corretamente**;
ele não prova que **o classificador escolhe a rota**. São garantias distintas, e
a segunda só se verifica contra o modelo real.

É a mesma classe do bug do "reembolsáveis" — que contém "bolsa" e caía num
padrão de fora de escopo. Os dois foram encontrados olhando a tela, não rodando
a suíte.

**O que se fez a respeito:** o fake aprendeu a rota (senão nenhum teste
conseguiria exercitá-la), e a verificação contra o Gemini real virou parte do
procedimento — inclusive testando a **fronteira**: "Você pode me dar conselhos
de investimento?" contém a expressão exata que marca uma pergunta meta e
precisa continuar sendo recusada. Continua sendo.

---

## Memória de conversa

### D59. O histórico é do cliente e viaja no request

**Por quê:** o desenho reflexo é um `conversationId` com os turnos no Redis. Ele
funciona e cobra caro: destrói a propriedade sobre a qual o ADR apoia o
escalonamento — *"a API não guarda sessão, então qualquer réplica atende
qualquer request"*. Servidor dono de conversa precisa de sticky session ou store
compartilhado no primeiro dia da segunda réplica, e o transporte MCP,
deliberadamente sem sessão, teria de ganhar uma.

Com o transcript no cliente — `sessionStorage` no console, memória de processo
na CLI, argumento de tool no MCP — o servidor lê o que recebeu e esquece. É como
a API da OpenAI funciona, pela mesma razão.

**O custo, dito:** o cliente **pode mentir** sobre o histórico. Hoje isso não
muda nada, porque quem forja um turno também poderia fazer a pergunta
diretamente — não há autenticação em lugar nenhum. Sob uma ACL passaria a
importar, e o histórico teria de ser assinado ou guardado no servidor. Cai junto
com o risco nº 2 do ADR, e não antes dele.

**Descartado — `localStorage`:** o transcript contém dado do colaborador.
`sessionStorage` é escopado à aba e apaga quando ela fecha, o que é uma decisão
de retenção, não de armazenamento.

---

### D60. A reescrita sai do schema que o classificador já devolvia

**Por quê:** o padrão da indústria é uma chamada de condensação antes de
classificar — pega o histórico, devolve a pergunta auto-contida. Funciona, e
custa **mais uma ida ao modelo**: ~700-900 ms, +45% no p50 da rota `kb`. Pior,
quebra a propriedade que este grafo inteiro é argumentado em cima: número fixo
de chamadas por rota.

O nó `classify` já fazia uma chamada estruturada e já extraía `employeeId` e
`ticketId`. Acrescentar `standaloneQuestion` à saída custa ~30 tokens e **zero
chamadas**. É o tipo de economia que só aparece quando o passo já existe pelo
motivo certo.

**Medido:** +86 ms (+5,5%) de latência e +47% em tokens com ~375 tokens de
histórico. Repare que 375 viram ~854 na entrada — o histórico é pago em **toda**
chamada de modelo da rota.

---

### D61. É a pergunta reescrita que vai para a recuperação

**Por quê:** é aqui que a maioria das implementações deixa o buraco. Passar o
histórico só para o prompt de geração conserta a redação e **não** conserta a
busca: *"e no ano que vem?"* vetorizado como veio não chega perto de
`ferias.md`, a recuperação volta vazia, e o nó `grade` recusa por falta de
fundamentação.

O usuário então lê *"não encontrei essa informação nas políticas"* quando o
problema real era que ninguém resolveu o pronome — um diagnóstico errado
entregue com confiança, que é o pior modo de falha de um sistema RAG.

Uma substituição de uma linha em `retrieve.node.ts` é o que faz a memória
funcionar de verdade.

---

### D62. Um follow-up não lê o cache, mas escreve nele

**Por quê:** a chave deriva da pergunta normalizada. Com contexto, *"e no ano que
vem?"* significa coisas diferentes em conversas diferentes, e servir uma da
entrada da outra seria um bug de **correção** fantasiado de performance.

Então um follow-up **pula a leitura**. Mas escreve sob a chave da pergunta
*reescrita*, que é auto-contida e portanto genuinamente compartilhável: uma
conversa que perguntou *"e posso vender quantos desses?"* popula a entrada de
*"quantos dos 30 dias de férias posso vender?"*, e quem perguntar isso direto
depois acerta.

Efeito líquido: o tráfego de turno único — a maioria esmagadora, e o que os
2 960 rps mediram — mantém exatamente o comportamento que tinha. Conversas pagam
um miss e deixam o cache melhor do que encontraram.

---

### D63. `unresolvedFollowUp` é uma rota, não uma variação de `outOfScope`

**Por quê:** foi o problema que originou todo este trabalho. Sem ela, *"e aquilo
que a gente falou?"* recebe **a mesma mensagem de quem pergunta sobre futebol**.
Isso não lê como "não tenho esse contexto" — lê como *"o bot é burro"*, e
transforma uma limitação declarada em defeito aparente aos olhos de quem assiste
a uma demonstração.

A mensagem própria diz o que aconteceu e o que fazer, com exemplo. Mesmo quando
o sistema erra, ele erra parecendo deliberado. É a mesma tese de [D14] e da rota
`meta`: cada motivo de recusa merece um texto que o usuário possa **agir** em
cima.

---

### D64. `interpretedAs` na resposta, porque memória invisível não é conferível

**Por quê:** sem isso, uma boa resposta para *"e no ano que vem?"* parece
idêntica quer o agente tenha resolvido a referência, quer tenha acertado por
sorte nas palavras-chave. E acertar por sorte acontece bastante: o documento
recuperado costuma repetir o contexto que a conversa tinha, o que faz um sistema
sem memória nenhuma parecer ter memória.

Expor a reescrita transforma *"parece que ele entendeu"* em *"foi exatamente
isto que ele entendeu"*. É o mesmo argumento que as citações fazem para
fundamentação, aplicado à compreensão — e o console mostra o campo **só quando
ele difere** da pergunta, porque um painel que ecoa a pergunta de volta em toda
resposta ensina o leitor a ignorá-lo.

---

### D65. O console passou a fazer streaming por POST, e o GET continuou existindo

**Por quê:** `EventSource` só emite GET, então a conversa teria de caber na query
string — frágil e limitada por tetos de URL que ninguém controla. Ler o corpo com
`fetch` remove o teto e, de brinde, elimina a reconexão automática do
`EventSource`, que exigia uma guarda explícita porque repetir o request
duplicava a resposta.

O `GET /ask/stream?q=` **ficou**: o `curl -N` de uma linha está no README e no
roteiro de demo, e um comando que funciona vale ser mantido. Os dois caminhos
compartilham o mesmo handler e os dois têm teste.

Os quadros são parseados pelo **mesmo `SseReader`** que o servidor usa para ler o
stream do Gemini — incluindo a normalização de CRLF que um bug muito caro pagou.

---

## Detalhes que custaram caro para descobrir

### D66. `setNoDelay` ficou, mas a hipótese que o motivou estava errada

**O relato:** *"a resposta chega toda de uma vez em vez de letra a letra"*.

**A hipótese:** o algoritmo de Nagle estaria juntando as escritas de token no
socket. Adicionei `reply.raw.socket?.setNoDelay(true)`.

**O teste que a derrubou:** um servidor emitindo eventos a cada 100 ms entrega
a 100 ms de distância **com ou sem** a chamada, em loopback — medi 93, 101, 100,
101 ms nos dois casos. O ACK volta imediatamente, então Nagle não tinha o que
segurar.

**A causa real:** o Gemini manda ~80 caracteres por chunk. A resposta chega em
um punhado de blocos, e isso é o provedor, não a rede.

**Por que a linha ficou:** o raciocínio continua valendo numa rede **real**,
onde o RTT não é ~0 e o Nagle de fato agrupa escritas pequenas. Custa nada e
remove uma classe de problema que não dá para reproduzir localmente. O que mudou
foi o comentário — passou a contar a história certa em vez da hipótese.

A lição é a que interessa: **eu me provei errado com um teste controlado em vez
de deixar a correção plausível de pé.** Uma correção que "parece ter funcionado"
sem causa confirmada é dívida disfarçada de conserto.

---

### D67. `min-height: 0`, ou por que `overflow: auto` não fazia nada

**O sintoma:** o painel de evidência rolava junto com a conversa, então ler uma
resposta longa tirava da tela justamente a evidência daquela resposta.

**A causa:** item de flex ou de grid nasce com `min-height: auto`, que significa
*"nunca encolha abaixo do seu conteúdo"*. Sob essa regra o `overflow-y: auto`
que já existia nos dois painéis era **decorativo** — eles cresciam até caber
tudo, estouravam a altura do container e quem rolava acabava sendo o documento.

Zerar o mínimo é o que **autoriza** o painel a ficar menor que o conteúdo, e só
então a barra de rolagem dele existe. O `body` virou moldura fixa da viewport
(`100dvh` + `overflow: hidden`).

No celular a lógica se inverte de propósito: uma coluna só, e aí a página
inteira rolando é o certo — prender a viewport deixaria o painel inalcançável.

---

### D68. `degraded` é um latch, não um valor

**Por quê:** o reducer é `(current, next) => current || next`. Uma vez ligado,
não desliga.

Na rota `hybrid` dois nós escrevem no estado no mesmo superstep. Com um reducer
de sobrescrita, um nó que teve sucesso apagaria a degradação que o outro acabou
de registrar — e a resposta sairia sem tarja, afirmando estar íntegra enquanto
uma das fontes falhou. É o modo de falha mais perigoso do sistema: **parecer
saudável**.

Mesma família dos reducers de append em `sources` e `toolResults`, e pela mesma
razão: escrita concorrente exige dizer como combinar, não como substituir.

---

### D69. O `connect()` do Redis precisa ser aguardado

**O sintoma:** os primeiros requests depois do boot **sempre** davam miss, mesmo
repetindo a mesma pergunta.

**A causa:** o cliente era construído e o `connect()` disparado sem `await`.
Toda leitura que chegasse antes da conexão estabelecer falhava em silêncio e era
tratada como miss — porque cache indisponível **deve** degradar para miss, nunca
quebrar o request. O acerto do design escondeu o defeito.

**A correção:** uma promise `ready` guardada na construção e aguardada em `get`,
`set` e `clear`.

Combina com `enableOfflineQueue: false`: sem isso, comandos enfileiram enquanto o
Redis está fora e disparam todos juntos quando ele volta, transformando uma queda
curta numa avalanche.

---

### D70. O console nunca usa `innerHTML`

**Por quê:** o texto da resposta é produzido pelo modelo e derivado do corpus —
que é editável por gente de RH, fora de engenharia. Transformar isso em HTML
faria de uma resposta um vetor de injeção na página.

Por isso o parser de markdown devolve uma **estrutura de dados**, nunca HTML, e
um pintor separado constrói nós da DOM com `document.createElement` e
`textContent`. Injeção de script fica impossível **por construção**, não por
sanitização — a diferença entre uma garantia e um filtro que alguém precisa
manter correto para sempre.

É a mesma tese da allowlist dos resources do MCP.

---

### D71. O limite de 2 000 caracteres na pergunta é controle de custo

**Por quê:** não é frescura de validação. O texto da pergunta entra no prompt de
classificação **e** no prompt de resposta, então cada caractere é pago duas
vezes por request. Sem teto, um cliente escolhe sozinho quanto vamos gastar.

Foi também o que quebrou a primeira medição do custo de histórico: o campo de
histórico precisou ser separado da pergunta exatamente porque somá-los estourava
esse teto.

---

## Verificação da resposta

### D72. Verificação determinística pós-geração, sem chamada extra ao modelo

**O pedido foi "faça com que não alucine".** Isso não é alcançável: alucinação é
propriedade do modelo, não do código, e nenhum arranjo de prompt a elimina. O
que é alcançável, e foi feito, é impedir que **uma classe** dela passe calada.

Duas checagens rodam depois da geração, em código, custo zero:

- **Números sem respaldo.** Todo número afirmado na resposta precisa aparecer
  nas fontes, na pergunta, ou ser derivável por soma, subtração, multiplicação
  ou divisão entre dois deles. O que sobra é figura fabricada.
- **Citações inválidas.** Todo marcador `[n]` precisa apontar para uma fonte que
  existe. `[7]` com cinco fontes é referência inventada.

**Por que números:** neste produto, toda resposta real é um número com uma fonte
ao lado — 30 dias, 10 dias, R$ 150,00, 3 dias úteis. É a forma que uma afirmação
falsa assume aqui.

**Reporta, não recusa.** Um falso positivo que apaga resposta correta custa mais
que um número sinalizado que o leitor confere no painel de evidência, que está
na mesma tela. Se a taxa de acerto do detector subir com o uso, dá para
endurecer; começar recusando seria endurecer sem dado.

**O que ele NÃO pega, dito claramente:** raciocínio errado sobre números certos.
O `30 - 10 = 20` daquele defeito é aritmética válida sobre dois números que
estavam mesmo nas fontes — só a premissa estava errada. Nenhuma checagem
sintática distingue isso; o que resolveu aquele caso foi ancorar o fato no
corpus. O detector cobre a figura fabricada, não a inferência ruim.

---

### D73. A pergunta conta como evidência para efeito de números

**Por quê:** medido contra o agente real. *"Qual o valor do auxílio home-office
multiplicado por 12 meses?"* produz R$ 1.800,00, correto, e o `12` não está em
fonte nenhuma — veio da pergunta. A primeira versão do detector acusou a própria
resposta certa.

Número que o **usuário** forneceu não é invenção do modelo. Sinalizá-lo
transformaria o detector em ruído, e detector ruidoso é ignorado — o que é o
mesmo que não existir.

**Medido depois do ajuste:** 0 alertas em 26 perguntas do conjunto de avaliação,
e 12 testes de unidade provando que ele dispara quando deve. Detector que nunca
dispara é indistinguível de detector quebrado.

---

## Decisões que eu reverteria ou revisitaria

Escrito porque um documento que só lista acertos não é confiável.

**1. O `MockHrApiModule` roda no mesmo processo.**
Conveniente para entrega, mas cria a possibilidade de alguém acidentalmente
acoplar o agente ao mock. Num projeto real seria um container separado desde o
início.

**2. O corpus é fixture e produto ao mesmo tempo.**
Os testes de consistência entre corpus e seed são bons, mas o acoplamento é
desconfortável: mudar uma política de exemplo pode quebrar testes. Idealmente o
corpus de teste seria separado do corpus de demonstração.

**3. `AnswerQuestionUseCase` está começando a acumular responsabilidades.**
Hoje faz cache, orquestra o grafo e monta o resultado. Com uma segunda regra de
cache viraria candidato natural a extrair um `AnswerCachePolicy`.

**4. Não há teste de carga contra o provedor real com perguntas distintas.**
Foi decisão consciente (mediria a cota do Google, não a arquitetura), mas
significa que não temos número para "quantos usuários simultâneos com perguntas
novas o sistema atende". O ADR trata disso qualitativamente; um número seria
melhor.

**5. O limiar de recusa é global.**
Um único `RETRIEVAL_MIN_SCORE` para todo o corpus. Documentos com vocabulário
mais raro provavelmente merecem limiar distinto — mas isso exigiria um conjunto
de avaliação bem maior que 14 perguntas para calibrar com honestidade.
