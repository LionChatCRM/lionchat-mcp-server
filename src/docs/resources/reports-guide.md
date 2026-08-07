# Guia de Relatórios e Métricas

Como interpretar cada um dos endpoints de relatório (`lionchat_reports_*`) e métricas correlatas. Use sempre que o usuário pedir métricas, KPIs, dashboards ou comparativos.

## ⚠️ Unidades de tempo

**TODOS os tempos médios são retornados em SEGUNDOS.** Sempre converta antes de exibir:

```
245 segundos → "4 min 5 seg" ou "4:05"
3600 segundos → "1 hora"
86400 segundos → "24 horas" ou "1 dia"
```

## Por que o número "não bate" — leia ANTES de responder ao usuário (2026-07-24)

Quando o usuário disser "o relatório está errado / não bate", quase sempre é UMA destas semânticas
(verificadas no código e com prova empírica em conta real):

1. **"Conversas" e "Resolvidas" têm âncoras de tempo DIFERENTES.** conversations_count = conversas
   CRIADAS no período; resolutions_count = eventos de resolução OCORRIDOS no período (a conversa pode
   ter sido criada antes). Um atendente pode "resolver mais do que recebeu" — correto, não é bug.
2. **"Resolvidas" conta EVENTOS, não conversas.** Resolver → reabrir → resolver = 2. Pode passar do
   total de conversas. **NUNCA divida `resolutions_count` por `conversations_count` para apresentar
   "taxa de resolução".** São universos diferentes (evento ocorrido na janela ÷ conversa nascida na
   janela) e o resultado passa de 100%: medido em 7 dias, 678%, 325%, 207%, 140% em quatro contas
   reais. Esse cartão foi REMOVIDO do produto em 29/07/2026 justamente por isso — o painel hoje
   mostra "Resoluções no período" em contagem. Se o usuário pedir taxa, explique que não existe e
   entregue os dois números separados.
3. **Recorte por ATENDENTE só enxerga conversas ATRIBUÍDAS.** Conversa sem responsável (auto-atribuição
   desligada, disparo em massa) não aparece em NENHUM atendente — a soma dos atendentes pode ser uma
   fração minúscula do total da conta (caso real: 202 de 4001). Sempre diga quantas estão sem atendente.
   **Desde 29/07/2026 esse balde é visível:** o resumo por agente (`lionchat_reports_list`) devolve
   também uma linha com `id: null` = "Sem atendente", e a planilha de agentes (`lionchat_reports_list_7`,
   CSV) traz a linha **"Sem atendente"** no FIM da lista. Ela **não é um atendente** — nunca inclua no
   ranking nem cruze o `id: null` com `lionchat_agents_list`. Antes disso o balde era descartado do CSV:
   na conta 19 ficavam de fora 4.222 conversas e 580 resoluções.
4. **A contagem de conversas por atendente usa o responsável ATUAL** — reatribuir conversa antiga move
   o histórico de um atendente pro outro. Já resoluções/tempos usam quem era o dono NA HORA do evento.
   Os dois cards podem divergir legitimamente em conta que reatribui.
5. **timezone_offset NÃO altera totais** de summary — só o agrupamento dos pontos da série temporal.
   Diferenças de ~1% entre relatório e lista filtrada são borda de janela/fuso, não defeito.
6. **since/until são unix SEGUNDOS** na família `reports_*`, no CSAT e no SLA. Data por extenso
   (`"2026-07-01"`) é lida como epoch: o `"2026"` vira 01/01/1970 e a janela some. Na conta 19 havia
   4.396 conversas no período e a resposta veio ZERO, com HTTP 200.
   **Desde 29/07/2026 a maioria dos relatórios RECUSA o formato errado** com HTTP **400** e a mensagem
   "since e until devem ser timestamp Unix em segundos (ex.: 1751328000), não data por extenso".
   Se receber esse 400, converta a data e repita — não é permissão, não é instabilidade, não é plano.
   - **Recusa com 400 (erro visível):** `reports_summary`, `reports_list` (agente), `_1` (time),
     `_2` (caixa), `_3` (etiqueta), `_4` (canal), `_5` (série temporal), `_6` (bot), `_7`–`_10`
     (CSVs), `_11` (lista de conversas), `_12`, `_13` (tráfego), `_14` (bot detalhado) — mais as
     rotas de matriz caixa×etiqueta, distribuição de primeira resposta e contagem de mensagens
     enviadas. A guarda é um `before_action` sem restrição de ação nos dois controladores, então
     vale para toda a família. Nos CSVs (`_7`–`_10` e `_12`) as DUAS pontas são obrigatórias, em
     segundos — faltando uma, também é 400.
   - **AINDA quebra em SILÊNCIO (HTTP 200 com número errado):** `csat_metrics`, `csat_list`,
     `csat_download`, `sla_metrics`, `sla_list`, `sla_download`. Nesses seis, confira você mesmo
     que está mandando segundos — não existe erro para te avisar.
   - **Funil de jornada e Origem dos Leads usam OUTRO formato:** ali o período é **ISO 8601**
     (`2026-07-01T00:00:00-03:00`), não Unix. Também não têm guarda: mandar segundos ali é o erro
     equivalente, e volta o padrão (30 dias) rotulado como o período pedido.
   - Tempo real (`_16`/`_17`) fica de fora da conversa: não aceita período nenhum.
7. **Mande SEMPRE as DUAS pontas do período.** Mandar só `since` (ou só `until`) fazia o filtro de
   data ser ignorado por inteiro, em silêncio: vinham os números da vida toda rotulados como do
   período pedido. Corrigido em 2026-07-25 (meia janela virou período aberto de um lado), mas a
   recomendação continua: mande as duas.
8. **"Não atendidas" NÃO é "nunca foi respondida".** A regra real é: **o cliente falou por último e
   ninguém respondeu ainda**. A definição antiga ("sem primeira resposta") foi abandonada de
   propósito, porque marcava como não atendida a conversa em que o robô/atendente falou primeiro e o
   cliente nunca respondeu. Numa conta real as duas leituras dão 32 contra 17 — nunca explique esse
   número como "N pessoas nunca foram respondidas".
9. **Relatório ao vivo e `conversations_meta` NÃO contam o mesmo universo.** O ao vivo conta tudo da
   conta, inclusive conversa de caixa apagada, e não checa permissão; o `meta` exclui caixa apagada,
   exige contato vivo e respeita as caixas que o usuário enxerga. Podem divergir com razão.

### Números que estavam ERRADOS — corrigidos nas atualizações de 26/07 e 29/07/2026

Achados numa validação de cada resposta contra o banco de produção. **A correção é do sistema, não
do conector: se a instalação do cliente ainda não recebeu essa atualização, o comportamento ANTIGO
continua valendo.** A coluna "antes" serve pra você reconhecer e avisar o usuário em vez de repetir
um número errado com confiança.

| Relatório | Antes (errado) | Depois |
|---|---|---|
| Por CANAL | Conversa **silenciada** não era contada: sumia do canal e do total, e a soma dos canais nunca fechava com o total do resumo (numa conta: Instagram 46 tendo 58) | Silenciada entra; a soma fecha |
| Tempo médio por ETIQUETA | Calculado **sem janela de data**: a mesma linha dizia "37 resolvidas" e mostrava a média de 6; pedir mês fechado do passado trazia resolução ocorrida DEPOIS. Sempre pra baixo — 1,7 dia no lugar de 43,6 (**25x**) | Usa a janela do evento, como agente/caixa/time |
| Etiqueta sem dado | Mostrava "0s" (lia como resolução instantânea) | Vem vazio |
| Receita/ganhos do KANBAN | Venda fechada no período de card criado ANTES dele não contava (numa conta: metade dos ganhos e R$ 3.750 fora) | Conta tudo |
| "Pendentes" do relatório ao vivo | **Sempre 0**, por condição impossível | Número real |
| Cumprimento de prazo (SLA) | "100%" para conta com ZERO prazo aplicado — escondia "o SLA não está rodando" | Vazio = sem dados |
| Por CANAL — conversa de caixa EXCLUÍDA (29/07) | Sumia do relatório: excluir a caixa deixa a conversa sem caixa, e o join descartava essas linhas em silêncio. 512 conversas órfãs de 10 contas em 30 dias; a **conta 60 perdia 76%** do total, a 40 perdia 38%, a 38 perdia 24% | Entram sob a chave **`Channel::None`** ("Caixa excluída"). Some essa chave também — se ignorar, você subconta de novo |
| Horário de PICO do mapa de calor (29/07) | Dias e horas saíam em **UTC** mesmo mandando `timezone_offset`: no Brasil, o pico aparecia **3 horas adiantado** (o movimento das 11:00 de Brasília era rotulado como 14:00). O cabeçalho do CSV escrevia "(GMT-03:00) Brasília", o que dava aparência de certo | Balde de dia/hora sai do fuso pedido |
| "Nº de Conversas" por ETIQUETA (07/08) | Contava conversas **CRIADAS** no período que têm a etiqueta — etiquetar hoje uma conversa antiga não mexia no relatório de hoje (caso real: dono etiquetou 2 e o número ficou em 1) | Conta conversas que **RECEBERAM a etiqueta** no período (`taggings.created_at`), no resumo E no detalhe (cartão + gráfico). Renomear etiqueta preserva as datas. Consequência: mês fechado passa a MUDAR se etiquetas forem adicionadas/removidas retroativamente |

**Como reconhecer instalação antiga:** soma dos canais menor que o total do resumo; tempo médio por
etiqueta absurdamente baixo perto do tempo por atendente; "pendentes" zerado no ao vivo tendo
conversa pendente na lista; "100%" de prazo com nenhum prazo aplicado; etiqueta aplicada hoje em
conversa antiga que NÃO aparece no relatório de hoje (régua antiga por criação da conversa).

## Mapeamento dos endpoints `lionchat_reports_*`

> ⚠️ **A numeração `_N` é gerada automaticamente e NÃO segue uma ordem lógica.** Use SEMPRE a tabela
> abaixo pra saber qual ferramenta chamar. Nunca chute pelo número.

| Ferramenta MCP | O que faz |
|---|---|
| `lionchat_reports_summary` | Resumo geral da conta (conversations, mensagens, tempos médios) com `previous` |
| `lionchat_reports_list` | Resumo POR AGENTE (summary/agent) |
| `lionchat_reports_list_1` | Resumo POR TIME (team) |
| `lionchat_reports_list_2` | Resumo POR INBOX |
| `lionchat_reports_list_3` | Resumo POR LABEL |
| `lionchat_reports_list_4` | Resumo POR CANAL (channel) |
| `lionchat_reports_list_5` | Série temporal / evolução (timeseries de um `metric`) |
| `lionchat_reports_list_6` | Resumo do BOT (bot_summary) |
| `lionchat_reports_list_7` | Exportação de AGENTES em CSV |
| `lionchat_reports_list_8` | Exportação de INBOXES em CSV |
| `lionchat_reports_list_9` | Exportação de LABELS em CSV |
| `lionchat_reports_list_10` | Exportação de TIMES em CSV |
| `lionchat_reports_list_11` | Lista de conversas do relatório (conversations) |
| `lionchat_reports_list_12` | Resumo de conversas em CSV (conversations_summary) |
| `lionchat_reports_list_13` | Conversation Traffic / tráfego por hora (heatmap, CSV) |
| `lionchat_reports_list_14` | Métricas do BOT detalhadas (bot_metrics) |
| `lionchat_reports_list_15` | Retrospectiva do ano (year_in_review) |
| `lionchat_reports_list_16` / `_17` | Relatórios em TEMPO REAL (live_reports: conversation_metrics / grouped) |

**Métricas correlatas (fora da família `reports_*`):**

| Ferramenta MCP | O que faz |
|---|---|
| `lionchat_csat_metrics` | Agregado de CSAT (contagem total + distribuição por nota) |
| `lionchat_csat_list` | Respostas CSAT individuais (paginadas) |
| `lionchat_csat_download` | CSV de CSAT |
| `lionchat_sla_metrics` | Agregado de SLA — **ENTERPRISE-ONLY** (total, falhas, hit_rate) |
| `lionchat_sla_list` | Conversas que estouraram SLA — **ENTERPRISE-ONLY** |
| `lionchat_sla_download` | CSV de SLA — **ENTERPRISE-ONLY** |

---

## Tabela "qual usar pra cada pergunta"

| Usuário pede... | Ferramenta |
|---|---|
| "resumo da semana", "como tá o desempenho?", "visão geral" | `lionchat_reports_summary` |
| "produtividade por atendente", "ranking de agentes" | `lionchat_reports_list` |
| "comparar times", "time A vs time B" | `lionchat_reports_list_1` |
| "qual canal tem mais demanda", "comparar WhatsApp vs Email" | `lionchat_reports_list_2` (inbox) ou `lionchat_reports_list_4` (tipo de canal) |
| "quantas conversas urgentes", "por etiqueta" | `lionchat_reports_list_3` |
| "evolução dia a dia", "mês a mês", "gráfico de linha" | `lionchat_reports_list_5` |
| "como tá o bot resolvendo", "% de handoff pra humano" | `lionchat_reports_list_6` ou `lionchat_reports_list_14` |
| "exportar planilha de agentes/inboxes/labels/times" | `_7` / `_8` / `_9` / `_10` (CSV) |
| "horário de pico", "quando tem mais demanda" | `lionchat_reports_list_13` |
| "quem tá online agora", "carga atual" | `lionchat_reports_list_16` / `_17` (live) |
| "retrospectiva do ano" | `lionchat_reports_list_15` |
| "satisfação", "CSAT", "nota dos clientes" | `lionchat_csat_metrics` |
| "SLA", "cumprimento de prazo" (se a conta tiver Enterprise) | `lionchat_sla_metrics` |

---

## Detalhe dos principais endpoints

### `lionchat_reports_summary` — Resumo geral
**Use quando:** "como tá o desempenho?", "resumo da semana", "visão geral"

**Retorna (campos confirmados no código):**
```json
{
  "conversations_count": 142,
  "incoming_messages_count": 1250,
  "outgoing_messages_count": 980,
  "avg_first_response_time": 245,       // segundos — MÉDIA
  "avg_resolution_time": 7200,          // segundos — MÉDIA
  "median_first_response_time": 180,    // segundos — MEDIANA (novo em 29/07/2026)
  "median_resolution_time": 5400,       // segundos — MEDIANA (novo em 29/07/2026)
  "resolutions_count": 98,
  "reply_time": 320,                    // segundos
  "previous": { ...mesma estrutura para comparativo... }
}
```

> ⚠️ **Use a MEDIANA para os dois tempos — é o que o painel mostra.** A média é distorcida pela IDADE
> da conversa: responder hoje uma conversa de 40 dias entra no cálculo com 40 dias. Medido na conta 38
> em 28-29/07: 78 eventos de primeira resposta deram média de **164,6 horas** contra mediana de
> **1,1 hora**. Se você reportar a média, o usuário compara com a tela e diz que o relatório está errado.
> As duas vêm no mesmo payload; a média continua publicada e não foi removida.
> **Só o resumo geral tem mediana.** Os resumos por agente/time/caixa/etiqueta/canal e a série temporal
> (`_5`) devolvem SOMENTE média — ali, reporte com a ressalva de outlier.

**Parâmetros principais:**
- `type`: `account` (padrão), `agent`, `inbox`, `label`, `team`
- `since` / `until`: Unix timestamp (segundos) — período
- `business_hours`: `true` exclui horários fora do expediente
- `timezone_offset`: deslocamento de fuso (horas) usado no agrupamento

### `lionchat_reports_list` — Por agente
**Use quando:** "produtividade por atendente", "ranking de agentes"

Retorna array de métricas, **uma por usuário da conta** — mais, desde 29/07/2026, **uma linha extra
com `id: null`** quando existem conversas sem responsável no período. Campos confirmados (e SÓ esses):
```json
{
  "id": 6,
  "conversations_count": 23,
  "resolved_conversations_count": 18,
  "avg_resolution_time": 5400,          // segundos (pode vir null)
  "avg_first_response_time": 180,       // segundos (pode vir null)
  "avg_reply_time": 320                 // segundos (pode vir null)
}
```

> ⚠️ **Não existe `name`, `csat_score_average` nem `online_at_total` neste retorno.**
> - O campo é só `id` (id do agente). Para o nome, cruze com `lionchat_agents_list`.
> - **`id: null` NÃO é um agente** — é o balde "Sem atendente". Não cruze com `agents_list` (não vai
>   achar), não coloque no ranking, e cite o número dele separado ao apresentar o total.
> - **CSAT por agente:** use `lionchat_csat_list` com filtro `user_ids=<id>` e calcule a média.
> - **Tempo online / status:** use `lionchat_agent_availability` ou os live_reports (`_16`/`_17`).

**Filtro por caixa (novo em 2026-07-24):** aceita `inbox_id` — o desempenho dos agentes DENTRO de
uma caixa específica. É exclusivo deste relatório; os resumos de time/caixa/etiqueta/canal
(`_1` a `_4`) NÃO aceitam `inbox_id`.

`_1` (time), `_2` (inbox), `_3` (label), `_4` (canal) seguem a mesma ideia de resumo agrupado,
trocando a chave de agrupamento.

### `lionchat_reports_list_5` — Série temporal (timeseries)
**Use quando:** "dia a dia da última semana", "evolução temporal", "gráfico de linha"

Retorna pontos (data + valor) para UM `metric` por vez:
- `metric` (médias, em segundos): `avg_first_response_time`, `avg_resolution_time`, `reply_time`
- `metric` (contagens): `conversations_count`, `incoming_messages_count`, `outgoing_messages_count`, `resolutions_count`, `bot_resolutions_count`, `bot_handoffs_count`
- `group_by`: `hour`, `day`, `week`, `month`, `year`
- `since` / `until`: período (Unix timestamp em segundos)
- `business_hours`: `true` faz médias contarem só o horário de atendimento
- `timezone_offset`: deslocamento de fuso (horas) — afeta como os pontos são agrupados por dia/hora

### `lionchat_reports_list_6` — Resumo do Bot
**Use quando:** "como tá o bot resolvendo", "quantos handoffs pra humano"

Retorna SOMENTE estes dois campos (não existe taxa pronta):
```json
{
  "bot_resolutions_count": 45,
  "bot_handoffs_count": 12
}
```
> A "taxa de resolução do bot" NÃO vem pronta. Se o usuário pedir, calcule:
> `bot_resolutions_count / (bot_resolutions_count + bot_handoffs_count)`.

### `lionchat_reports_list_13` — Conversation Traffic (tráfego)
**Use quando:** "horário de pico", "quando tem mais demanda"

Heatmap de volume por hora. Aceita SÓ `timezone_offset` (sem ele o pico sai em UTC). ATENÇÃO: janela FIXA a partir de hoje — NÃO aceita `since`/`until`.

> ⚠️ **Instalação anterior a 29/07/2026: o pico sai em UTC MESMO mandando `timezone_offset`.** O fuso
> era resolvido por nome (`"-3"` não é nome de zona), caía em UTC e o horário vinha **3 horas adiantado**
> no Brasil — o movimento das 11:00 aparecia como 14:00. O cabeçalho do CSV mostrava "(GMT-03:00)
> Brasília" mesmo assim, então o erro não se anunciava. Como reconhecer: pico deslocado exatamente 3h
> para frente do que o cliente sabe da operação dele. Corrigido — hoje o balde de dia/hora usa o fuso
> pedido.

### `lionchat_reports_list_16` / `_17` — Tempo real (live)
**Use quando:** "quem tá online agora", "carga atual", "conversas abertas no momento"

São os live_reports (`conversation_metrics` e a versão agrupada). Use estes — e não os resumos
históricos — quando o usuário quiser o agora.

`_16` retorna (campo `snoozed` novo em 29/07/2026):
```json
{ "open": 105, "unattended": 12, "unassigned": 4, "pending": 3777, "snoozed": 1 }
```

> ⚠️ **A FILA REAL é `open + pending + snoozed`.** Só `open` esconde quem está esperando: na conta 19
> davam 105 abertas havendo **3.883 conversas sem resolução** (3.777 pendentes + 1 adiada) — o gestor
> lê que está tranquilo com a fila cheia. Ao responder "quantas estão esperando agora?", some os três
> e diga a quebra. `unattended` e `unassigned` são recortes de `open`, **não some com os outros**.
>
> `_17` (agrupado por time/atendente) NÃO tem `snoozed` nem `pending` — só `open`, `unattended` e
> `unassigned`. Para a fila real por atendente não há campo pronto; avise em vez de somar o que não veio.

**Filtros aceitos (expostos na tool desde 2026-07-24):** `inbox_id`, `assignee_id` e `team_id`,
todos opcionais e combináveis — é o mesmo recorte da tela Visão Geral. Em `_17` o `group_by`
(`team_id` ou `assignee_id`) continua obrigatório e os filtros recortam a base ANTES de agrupar.

### `lionchat_csat_metrics` — CSAT agregado
**Use quando:** "satisfação", "nota média dos clientes", "CSAT"

Retorna SOMENTE estes campos (nem satisfação, nem média, nem taxa de resposta vêm prontas):
```json
{
  "total_count": 80,                    // total de respostas respondidas
  "ratings_count": { "5": 50, "4": 18, "3": 8, "2": 2, "1": 2 },
  "total_sent_messages_count": 210      // pesquisas CSAT enviadas no período
}
```
> ⚠️ **"Satisfação (CSAT)" no LionChat é o PERCENTUAL de notas 4 e 5 — não é a nota média.**
> Sempre foi assim (`store/modules/csat.js`, cartão da tela e cálculo do painel).
>
> **Satisfação** = `(ratings_count[4] + ratings_count[5]) / total_count`.
> No exemplo: (18 + 50) / 80 = **85%**.
>
> **Nota média** = `Σ(nota × ratings_count[nota]) / total_count`.
> No exemplo: (5×50 + 4×18 + 3×8 + 2×2 + 1×2) / 80 = 352/80 = **4,4**.
>
> Os dois números são legítimos, mas **têm nomes diferentes e não podem ser trocados**: 85% e 4,4
> descrevem a mesma conta. Se o usuário pediu "satisfação"/"CSAT", entregue o percentual e diga
> "percentual de notas 4 e 5". Se você apresentar a média, rotule **"nota média"** — nunca
> "satisfação", nunca "CSAT de 4,4". Apresentar a média como satisfação faz o número não bater com o
> painel e o usuário conclui que o relatório está quebrado.
>
> **Taxa de resposta** = `total_count / total_sent_messages_count`.
> No exemplo: 80/210 = **38%**.

**Filtros aceitos (expostos na tool desde 2026-07-24):** `user_ids[]`, `inbox_id`, `team_id`, `rating`, `since`/`until` (unix segundos). Agora dá pra recortar CSAT por caixa/atendente direto.

### `lionchat_sla_metrics` — SLA agregado (ENTERPRISE-ONLY)
**Use quando:** "cumprimento de SLA", "quantos prazos estouraram"

> ⚠️ **Pode não existir na conta.** SLA é recurso Enterprise. Se a chamada falhar/retornar vazio,
> informe ao usuário que o relatório de SLA não está disponível no plano dele.

Retorna:
```json
{
  "total_applied_slas": 200,
  "number_of_sla_misses": 9,
  "hit_rate": "95.5%"                   // STRING com "%", NÃO uma fração
}
```
> O `hit_rate` já vem calculado como string (ex.: `"95.5%"`, ou `"100%"` quando não há falhas).
> Não divida nada — apenas exiba o valor.

**Filtros aceitos (expostos na tool desde 2026-07-24):** `inbox_id`, `team_id`, `sla_policy_id`, `label_list[]`, `assigned_agent_id`, `since`/`until` (unix segundos).

## Padrões de interpretação

### Comparando períodos
O `previous` (período anterior de mesmo tamanho) é retornado pelo `lionchat_reports_summary` e pelo
resumo do bot (`_6`). Os resumos agrupados (agente/time/inbox/label/canal) e a timeseries NÃO trazem
`previous` — pra comparar, chame o endpoint duas vezes (período atual e período anterior):

```
Esta semana: 142 conversas
Semana anterior: 120 conversas
→ Crescimento de 18%
```

**Dica:** sempre apresente comparativos pra dar contexto.

### Business hours
- Sem `business_hours: true`: tempos médios incluem madrugada/feriado (puxa pra cima)
- Com `business_hours: true`: conta SÓ o tempo dentro do expediente **das caixas que têm expediente
  configurado** (`working_hours_enabled`)

> ⚠️ **NÃO ligue `business_hours: true` por padrão.** O tempo em horário comercial só é gravado para
> caixa com expediente configurado — e a maioria das contas não configura nenhuma (medido em produção:
> **nenhuma das 105 caixas** tinha expediente ligado). Três estados possíveis, e você precisa saber
> reconhecer qual está vendo:
> 1. **Registros antigos (anteriores a 29/07/2026):** foram gravados com **0** quando não havia
>    expediente. Ligar o filtro devolve "tempo médio de primeira resposta: 0 segundos" — número
>    FABRICADO, lido como atendimento instantâneo. Esse histórico não foi migrado, então continua
>    puxando a média para baixo mesmo hoje.
> 2. **Registros novos, sem expediente configurado:** vêm vazios/nulos e o cálculo os ignora. O
>    relatório volta **sem dado** (traço), que é honesto — não é bug, não é falta de conversa.
> 3. **Janela que atravessa 29/07/2026:** mistura os dois. Número não confiável — não use.
>
> **Regra prática:** só use `business_hours: true` se o usuário confirmar que as caixas dele têm
> horário de atendimento configurado. Recebeu 0 ou vazio com o filtro ligado? Refaça SEM o filtro e
> explique o motivo, em vez de reportar "0 segundos" ou "sem atendimento no período".

### CSAT
- Score: 1-5 estrelas
- **"Satisfação"/"CSAT" da plataforma = percentual de notas 4 e 5** (`(4+5) / total`), NÃO a média.
  Não há faixa de referência oficial no produto para esse percentual — para dar contexto, compare com
  o período anterior da própria conta
- A **nota média** é outro número: 4.0+ é bom, 3.5-4.0 é OK, abaixo de 3.5 é alerta. Se apresentar,
  rotule "nota média" — nunca "satisfação"
- Satisfação, média e taxa de resposta NÃO vêm prontas — calcule a partir de `ratings_count`,
  `total_count` e `total_sent_messages_count` (fórmulas na seção do `lionchat_csat_metrics`)
- Taxa de resposta = `total_count / total_sent_messages_count` (baixa = pouco feedback)

### SLA (Enterprise-only)
- `number_of_sla_misses` alto = problema sério, agentes não cumprindo prazos
- `hit_rate` já vem pronto como STRING com `%` (ex.: `"95.5%"`) — só exibir, meta 95%+
- Se a conta não tem Enterprise, o relatório de SLA simplesmente não existe

## Workflows comuns

### "Relatório semanal completo"
```
1. reports_summary com since=7d, type=account → visão geral
2. reports_list (por agente) → ranking
3. reports_list_3 (por label) → tipos de demanda
4. csat_metrics → satisfação
5. sla_metrics → cumprimento
6. Compilar resumo em markdown
```

### "Quem tá com gargalo"
```
1. reports_list_16/_17 (live) → quem tá com muita conversa aberta agora
2. reports_list (por agente, últimos 7d) → quem tá com avg_first_response_time alto
3. Cruzar: agente sobrecarregado E com tempo médio alto
```

### "Mês a mês evolução"
```
reports_list_5 com group_by=month, metric=conversations_count, since=12 meses atrás
```

### "Tempo por etapa do funil" / "conversão de funil"
> ⚠️ NÃO existe endpoint nativo de relatório de funil/Kanban. Componha no client-side:
```
1. kanban_items_list (do funnel desejado) → traz cada card com funnel_stage e stage_entered_at
2. Agrupe por funnel_stage e calcule:
   - tempo por etapa: diferença entre stage_entered_at de etapas consecutivas do mesmo card
   - conversão: nº de cards que chegaram em cada etapa / nº de cards que entraram na anterior
3. Apresente como tabela/etapas — avisando que é um cálculo composto, não um relatório oficial
```

## Pegadinhas comuns

### ⚠️ O relatório por agente NÃO traz CSAT nem tempo online
`lionchat_reports_list` (por agente) retorna só `id`, contagens e tempos médios.
- Para **CSAT por agente**: `lionchat_csat_list` com `user_ids=<id>` e calcule a média.
- Para **status/tempo online**: `lionchat_agent_availability` ou live_reports (`_16`/`_17`).
- Para o **nome** do agente: cruze o `id` com `lionchat_agents_list`.

### ⚠️ Avg time pode ser enganador — e há mediana no resumo geral
Mediana é mais representativa que média (1 conversa que durou 5 dias puxa tudo).

**Desde 29/07/2026 o `lionchat_reports_summary` devolve `median_first_response_time` e
`median_resolution_time`** (segundos), ao lado das médias. **É a mediana que o painel mostra nos dois
cartões de tempo** — use ela. Conta 38, 28-29/07: média de 164,6 horas contra mediana de 1,1 hora,
porque 6 conversas antigas respondidas no dia entram com a idade inteira.

Nos demais (por agente/time/caixa/etiqueta/canal e série temporal `_5`) **só há média** — aí sim
reporte com ressalva: "Tempo MÉDIO de X — pode ter outliers."

### ⚠️ Reports não pegam conversas em tempo real
A maioria dos endpoints é eventually consistent (cache 5min). Pra info real-time use `conversations_meta`.

### ⚠️ Comparativos de período
No `lionchat_reports_summary` (e no resumo do bot), o `previous` já vem com o MESMO tamanho do período
atual. Se since-until = 7d, previous = 7d antes. Pra esses dois, passe `since/until` com o período
inteiro e use o `previous` retornado em vez de comparar na mão.
Nos demais (agente/time/inbox/label/canal e timeseries) NÃO há `previous` — chame duas vezes.

## Jornada do Lead (LionTrack) — relatório novo (2026-06)

`GET /api/v2/accounts/{id}/journey_funnel_reports` — mapa agregado de navegação dos
leads no site ANTES de virarem conversa (nós = páginas, arestas = transições página A → página B,
agrupado por fases configuradas em `liontrack/journey_stages`).

**Filtros (query):** `since`/`until` (janela MÁX 30 dias — acima disso o servidor corta sozinho),
`utm_source`, `utm_campaign`, `device_name`, `country`, `contact_id` (trilha de 1 lead),
`with_conversation=true` (só quem virou conversa).

**Retorno:** `nodes` (página, fase, visitas, visitantes únicos), `edges` (transições com contagem),
totais. URLs vêm SEM querystring (proteção LGPD — e-mail/CPF em URL nunca aparecem).

**Gates:** feature flag `liontrack` (404 se desligada) + permissão de relatórios (admin ou
report_manage). As fases são geridas pelas tools `liontrack_journey_stages_*` (padrão de URL →
fase, match literal de substring, sem regex).

**Perguntas que esse relatório responde:** "por onde os leads entram?", "qual página perde mais
gente?", "quem veio da campanha X navegou por onde antes de chamar?".

## Origem dos Leads — relatório novo (2026-06)

`GET /api/v2/accounts/{id}/lead_origin_reports` (tool `lionchat_lead_origin_reports`) — agrega de
ONDE vieram os leads, cruzando os campos `origin_*` das conversas com os leads órfãos (que ainda não
viraram conversa). É um relatório de LEITURA puro — não cria nem altera nada.

**Filtros (query, todos opcionais):** `since` / `until` (ISO 8601; default = 30 dias atrás → agora),
`funnel_id`, `platform`, `kind`, `campaign`, `adset`, `group_by`.

**Retorno:**
- `period` — janela efetiva considerada.
- `totals` — `conversations`, `classified` (com origem identificada), `unclassified` (sem origem),
  `orphan_leads` (leads sem conversa ainda), `unique_leads` (deduplicados por TELEFONE),
  `won_leads` (leads em cards de estágio de Ganho) e `conversion_rate`.
- Arrays de quebra: `by_platform`, `by_kind`, `by_campaign`, `by_adset`, `by_creative`. Cada linha
  tem `{value, conversations, won, conversion_rate}`.

**Conceitos importantes:**
- `won` = cards parados em etapas de GANHO do funil (fechados como sucesso).
- `unique_leads` deduplica por telefone (mesmo lead que falou várias vezes conta 1).
- "orphan lead" = lead capturado (ex: Meta Lead) que ainda não tem conversa associada.

**Gates:** permissão de relatórios (admin ou report_manage).

**Perguntas que esse relatório responde:** "qual plataforma trouxe mais leads?", "qual campanha/
conjunto converteu melhor?", "quantos leads únicos vieram esse mês e quantos fecharam?".

### Atributos de anúncio (`ctwa_*`) — dois novos e nomes alinhados (2026-08-01)

Conversa que veio de anúncio "Clique para WhatsApp" carrega atributos `ctwa_*` (`ctwa_campaign_name`,
`ctwa_adset_name`, `ctwa_ad_name`, `ctwa_creative_name`, `ctwa_source_url`…). Eles são atributos de
conversa normais: dá pra filtrar (`lionchat_conversations_filter`), usar em público de campanha e ler
em flow (`{{trigger.ad.*}}`).

Dois deles apareciam no painel **sem cadastro nenhum** e por isso não dava pra filtrar por eles em
lugar algum. Foram criados em 01/08 e agora funcionam como os demais:

| Chave | Rótulo | Tipo |
|---|---|---|
| `ctwa_conversion_source` | Plataforma de Origem do Anúncio | texto |
| `ctwa_conversion_delay_seconds` | Tempo até a Conversão (s) | número |

Na mesma data os rótulos de exibição dos `ctwa_*` foram alinhados com os do painel. **As CHAVES não
mudaram** — flow, automação, campanha e filtro guardam a chave, nunca o rótulo, então nada que já
existia quebrou. Se o cliente disser que "o nome do campo mudou", é só o rótulo na tela.

## Quando o usuário pede algo MUITO específico que não existe num endpoint

Se a pergunta requer cálculos custom (ex: "conversas por agente que duraram mais de X minutos"):
1. Liste as conversations com filtros
2. Filtre no client-side
3. Agrege e apresente

Mas avise: "essa métrica não existe pronta — vou compor a partir de dados crus"

## Custos de chamadas (importante!)

Endpoints de relatório podem retornar **MUITOS** dados:
- `reports_list_5` com `group_by=day, since=1 ano` → 365 datapoints
- `csat_list` sem filtro → milhares

**Sempre limite período** quando o usuário não foi específico. Se pediu "esta semana", use 7d. Se pediu "vamos ver tudo", confirme antes (ano inteiro pode ser muito).
