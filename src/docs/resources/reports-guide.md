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
   total de conversas.
3. **Recorte por ATENDENTE só enxerga conversas ATRIBUÍDAS.** Conversa sem responsável (auto-atribuição
   desligada, disparo em massa) não aparece em NENHUM atendente — a soma dos atendentes pode ser uma
   fração minúscula do total da conta (caso real: 202 de 4001). Sempre diga quantas estão sem atendente.
4. **A contagem de conversas por atendente usa o responsável ATUAL** — reatribuir conversa antiga move
   o histórico de um atendente pro outro. Já resoluções/tempos usam quem era o dono NA HORA do evento.
   Os dois cards podem divergir legitimamente em conta que reatribui.
5. **timezone_offset NÃO altera totais** de summary — só o agrupamento dos pontos da série temporal.
   Diferenças de ~1% entre relatório e lista filtrada são borda de janela/fuso, não defeito.
6. **since/until são unix SEGUNDOS** em TODOS os endpoints de relatório. ISO 8601 quebra a janela em
   silêncio (relatório vazio/errado).

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
  "avg_first_response_time": 245,       // segundos
  "avg_resolution_time": 7200,          // segundos
  "resolutions_count": 98,
  "reply_time": 320,                    // segundos
  "previous": { ...mesma estrutura para comparativo... }
}
```

**Parâmetros principais:**
- `type`: `account` (padrão), `agent`, `inbox`, `label`, `team`
- `since` / `until`: Unix timestamp (segundos) — período
- `business_hours`: `true` exclui horários fora do expediente
- `timezone_offset`: deslocamento de fuso (horas) usado no agrupamento

### `lionchat_reports_list` — Por agente
**Use quando:** "produtividade por atendente", "ranking de agentes"

Retorna array de métricas, **uma por usuário da conta**. Campos confirmados (e SÓ esses):
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
> - **CSAT por agente:** use `lionchat_csat_list` com filtro `user_ids=<id>` e calcule a média.
> - **Tempo online / status:** use `lionchat_agent_availability` ou os live_reports (`_16`/`_17`).

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

### `lionchat_reports_list_16` / `_17` — Tempo real (live)
**Use quando:** "quem tá online agora", "carga atual", "conversas abertas no momento"

São os live_reports (`conversation_metrics` e a versão agrupada). Use estes — e não os resumos
históricos — quando o usuário quiser o agora.

### `lionchat_csat_metrics` — CSAT agregado
**Use quando:** "satisfação", "nota média dos clientes", "CSAT"

Retorna SOMENTE estes campos (nem média, nem taxa de resposta vêm prontas):
```json
{
  "total_count": 80,                    // total de respostas respondidas
  "ratings_count": { "5": 50, "4": 18, "3": 8, "2": 2, "1": 2 },
  "total_sent_messages_count": 210      // pesquisas CSAT enviadas no período
}
```
> **Nota média** = `Σ(nota × ratings_count[nota]) / total_count`.
> No exemplo: (5×50 + 4×18 + 3×8 + 2×2 + 1×2) / 80 = 352/80 = **4,4**.
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
- Com `business_hours: true`: só conta período de atendimento configurado (mais preciso pra SLA)

**Use business_hours: true** quando o usuário perguntar de "produtividade real" ou comparar com SLA.

### CSAT
- Score: 1-5 estrelas
- Médias típicas: 4.0+ é bom, 3.5-4.0 é OK, abaixo de 3.5 é alerta
- A média e a taxa de resposta NÃO vêm prontas — calcule a partir de `ratings_count`, `total_count`
  e `total_sent_messages_count` (fórmulas na seção do `lionchat_csat_metrics`)
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

### ⚠️ Avg time pode ser enganador
Mediana é mais representativa que média (1 conversa que durou 5 dias puxa tudo).
**Mas o LionChat hoje só retorna média.** Reporte com ressalva: "Tempo MÉDIO de X — pode ter outliers."

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
