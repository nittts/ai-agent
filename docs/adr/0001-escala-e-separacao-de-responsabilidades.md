# ADR 0001 — Escala e separação de responsabilidades

**Status:** aceito
**Contexto:** desafio técnico Inova e-Business, seção "Defesa"
**Pergunta:** *Se este agente precisasse atender dezenas de usuários
concorrentes em produção, como você separaria responsabilidades? Quais riscos
identifica e como mitigá-los?*

---

## Contexto

O agente hoje é um processo único que faz tudo: recebe HTTP, orquestra o grafo,
consulta a base vetorial, chama a API de RH e fala com o Gemini. Para a entrega
do desafio isso é adequado e deliberado — menos partes móveis, uma linha de
comando para subir.

A pergunta é o que muda com dezenas de usuários simultâneos. A resposta começa
por um dado **medido**, não estimado.

---

## O dado que orienta a decisão

| Concorrência | Serviço isolado (sem provedor) | Produção, cache quente |
|---|---|---|
| 10 | 1 898 rps · p95 8 ms | 1 915 rps · p95 8 ms |
| 50 | **2 925 rps** · p95 23 ms | **2 960 rps** · p95 22 ms |

Zero erros. E, na medição de latência com o provedor real sob martelada,
**45% dos requests degradaram por throttling do tier gratuito** — enquanto o
serviço em si sustentava ~2 900 rps.

**Conclusão:** o gargalo de escala **não é o nosso serviço**. É a cota do
provedor de LLM.

Isso decorre da natureza do trabalho: o processo passa ~99% do tempo de parede
**bloqueado em I/O**, esperando o Gemini. Não há trabalho de CPU a paralelizar.
"Dezenas de usuários concorrentes" é, para este sistema, um problema de **cota e
de fila**, não de capacidade computacional.

Uma consequência prática: *escalar horizontalmente resolve pouco*. Dobrar as
réplicas dobra a pressão sobre a mesma cota. Sem um controle compartilhado, mais
réplicas pioram o problema.

---

## Decisão

Separar por **modo de falha e por perfil de recurso**, não por camada técnica.
Quatro responsabilidades:

```
                    ┌──────────────────────┐
   usuários ───────►│  API (stateless)     │  N réplicas atrás de LB
                    │  valida, cacheia,    │  responde ou enfileira
                    │  responde SSE        │
                    └──────┬────────┬──────┘
                           │        │
              cache hit ◄──┘        └──► fila (Azure Service Bus)
                                              │
                    ┌─────────────────────────▼──────────┐
                    │  WORKERS do agente                 │  M réplicas
                    │  executam o grafo, chamam o LLM    │  M limita a cota
                    └─────────┬──────────────────────────┘
                              │
              ┌───────────────┼────────────────┐
              ▼               ▼                ▼
        ┌──────────┐   ┌────────────┐   ┌────────────┐
        │  Redis   │   │ Vector DB  │   │  API de RH │
        │ cache +  │   │ pgvector   │   │  (externa) │
        │ rate lim │   │            │   │            │
        └──────────┘   └────────────┘   └────────────┘

     ┌─────────────────────────────────────────────────┐
     │  INGESTÃO (job agendado)                        │
     │  corpus -> chunks -> embeddings -> índice       │
     └─────────────────────────────────────────────────┘
```

### 1. API — stateless, sem LLM no caminho

Valida entrada, resolve o cache, e **responde direto quando há hit** (medido:
~1 ms). Em miss, publica na fila e streama o resultado ao cliente.

Escala horizontalmente sem limite prático porque não chama o modelo.

### 2. Workers do agente — onde a cota é administrada

Executam o grafo. **O número de workers é o botão que controla o consumo da
cota do provedor** — é aqui que "dezenas de usuários concorrentes" vira uma
decisão explícita, em vez de uma corrida entre réplicas.

Um worker que morre não derruba nenhuma conexão de usuário: a mensagem volta
para a fila.

### 3. Ingestão — job agendado, nunca no caminho do request

Já é assim hoje (`npm run ingest`), e a razão é medida: embeddar o corpus no
boot faria o primeiro request de **cada réplica** pagar a conta, poluindo
justamente o p95 que precisamos reportar.

### 4. Estado compartilhado — Redis e banco vetorial

Redis acumula três papéis: cache de respostas, cache de embeddings e **token
bucket compartilhado** para rate limiting. O último é o que impede a frota de
estourar a cota coletivamente.

### Por que esta divisão e não "um microsserviço por camada"

Cada fronteira acima separa componentes com **modos de falha distintos**:

- a API cai → usuários perdem conexão, mas nada em voo é perdido (fila);
- um worker cai → mensagem retorna à fila, usuário só vê latência;
- o LLM fica indisponível → workers degradam, API segue servindo cache;
- o Redis cai → tudo funciona mais lento (verificado: 20 ms por request, HTTP
  200, processo vivo).

Separar "controller / service / repository" em processos distintos não traria
nenhuma dessas propriedades — só latência de rede.

### O que o código já prepara

A migração é uma troca de **transporte**, não de lógica:

- `AnswerQuestionUseCase` não conhece HTTP. Um worker de fila o chama do mesmo
  jeito que o controller.
- As cinco portas isolam Gemini, Redis, o banco vetorial e a API de RH.
- `VectorStorePort` tem hoje uma implementação em memória; pgvector é uma
  classe nova, sem consumidor alterado.
- O `correlationId` já se propaga via `AsyncLocalStorage` e é preservado quando
  chega no header — pronto para atravessar serviços.

---

## Riscos e mitigações

### 1. Cota do provedor de LLM — **o risco principal**

*Medido: 45% de requests degradados sob martelada no tier gratuito.*

| Mitigação | Estado |
|---|---|
| Cache de respostas (tira o LLM do caminho) | **Implementado** |
| Prazo total por request | **Implementado** (p99 51 s → 15 s) |
| Retry com jitter (evita martelada sincronizada) | **Implementado** |
| Token bucket compartilhado no Redis | A fazer |
| Fila com backpressure em vez de rejeitar | A fazer |
| Fallback para modelo secundário | A fazer |

### 2. Vazamento de dados entre usuários — **o risco mais grave**

A chave de cache deriva **só do texto da pergunta**. *"Qual o meu saldo de
férias?"* de dois colaboradores normaliza para a **mesma chave** — servir do
cache vazaria o saldo de um para o outro.

É bug de **privacidade**, não de performance, e só se manifesta com dois
usuários simultâneos: passaria por qualquer teste de usuário único e por
qualquer demo.

| Mitigação | Estado |
|---|---|
| Resposta com dado pessoal **nunca** é cacheada | **Implementado** |
| Teste automatizado fixando essa regra | **Implementado** |
| Tenant/colaborador na chave de cache | A fazer — pré-requisito de produção |
| ACL no retrieval (filtrar chunks por permissão) | A fazer |

O corpus atual é público a todos os colaboradores. Num cenário com políticas
restritas por cargo, o filtro precisa acontecer **na busca**, não no prompt:
recuperar e depois pedir ao modelo para ignorar é confiar o controle de acesso a
um sistema probabilístico.

### 3. Injeção de prompt pelo corpus

O ataque pelo usuário é o óbvio e está tratado. O que importa em produção é o
**corpus**: documentos de política costumam ser editáveis por RH, fora de
engenharia. Um parágrafo malicioso entra no prompt como contexto confiável.

| Mitigação | Estado |
|---|---|
| Prompt declara que contexto é informação, não instrução | **Implementado** |
| Teste fixando essa cláusula | **Implementado** |
| Revisão/aprovação de alterações no corpus | A fazer |
| Sanitização na ingestão | A fazer |

### 4. Custo descontrolado

Medido: US$ 0,00017–0,00101 por pergunta. Com 500 colaboradores × 5
perguntas/dia ≈ **US$ 60–75/mês** — barato, até alguém automatizar chamadas.

| Mitigação | Estado |
|---|---|
| Tokens e custo por request na resposta e no log | **Implementado** |
| Limite de tamanho da pergunta | **Implementado** |
| Cache | **Implementado** |
| Rate limit por usuário | A fazer |
| Orçamento mensal com alerta | A fazer |

### 5. Índice desatualizado

Se a ingestão falhar silenciosamente, o agente responde com política velha —
com toda a confiança e citando a fonte errada.

| Mitigação | Estado |
|---|---|
| `corpusVersion` na chave de cache (edição invalida) | **Implementado** |
| Boot recusa índice de outro modelo de embedding | **Implementado** |
| Serviço sobe sem índice em vez de crashar | **Implementado** |
| Alerta se a ingestão não roda há N dias | A fazer |
| Avaliação de retrieval no CI | A fazer |

### 6. Falha silenciosa por degradação graciosa

Descoberto neste próprio desenvolvimento: o `HR_API_BASE_URL` apontava para
`localhost`, que no Node 18+ resolve para IPv6 enquanto o servidor escuta em
IPv4. **Toda** chamada de tool falhava, e o sintoma era uma resposta educada
dizendo que o RH estava indisponível.

A mitigação não é degradar menos — é tornar a degradação **ruidosa nos dados**:
`degraded` e `warnings` são campos de primeira classe da resposta, aparecem como
badge no console e ficam nos logs estruturados. Em produção, `degraded: true`
deveria ser uma métrica com alerta.

---

## Consequências

**Positivas**

- Cada componente escala pelo recurso que realmente o limita.
- Falhas ficam contidas; nenhuma derruba o sistema inteiro.
- A cota do provedor passa a ser administrada num ponto só.
- A migração é troca de transporte: o caso de uso e o grafo não mudam.

**Negativas**

- Mais partes móveis: fila, workers, banco vetorial gerenciado.
- Latência extra do salto pela fila em cache miss (~10–50 ms), irrelevante
  perto dos ~2 s do modelo.
- Streaming via fila exige um canal de volta (SSE ancorado na API, com o worker
  publicando tokens) — é a parte de implementação mais delicada.
- Complexidade operacional injustificada abaixo de ~dezenas de usuários. Para o
  volume atual, o monolito é a escolha certa, e este ADR descreve o **gatilho**
  para mudar, não um plano para executar já.

---

## Gatilhos para migrar

Não migrar por antecipação. Migrar quando:

1. `degraded: true` por throttling passar de ~1% dos requests em regime normal;
2. o p95 sob carga real de produção passar de 5 s de forma sustentada;
3. surgir a necessidade de políticas com acesso restrito (aí a ACL no retrieval
   vira obrigatória, não opcional);
4. o custo mensal passar do orçamento definido pela área.
