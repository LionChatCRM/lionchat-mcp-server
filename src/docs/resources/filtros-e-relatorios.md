# Filtros e Relatórios — Guia Completo

Como filtrar conversas, contatos e cards do Kanban com precisão, e como montar relatórios por
período/atendente/etapa/valor sem tentativa e erro. Tabelas extraídas do código da plataforma
(2026-07-24) — operador fora da lista da chave retorna **422 "Operador inválido"**.

## Os DOIS padrões de transporte de filtro (não confundir)

| Padrão | Onde | Como enviar |
|---|---|---|
| **A — array no BODY** | `conversations_filter`, `contacts_filter`, `audience`/`exclusion` de campanhas | Array NATIVO de objetos no parâmetro (`payload`, `audience`, `exclusion`) |
| **B — JSON-string na QUERY** | `*_custom_attribute_filters` do Kanban, `conversation_filters`/`contact_filters`/`kanban_filters` das buscas | STRING com o JSON serializado (`"[{\"attribute_key\":...}]"`) |

Regra de bolso: ferramenta POST de filtro = array nativo; parâmetro de filtro em ferramenta GET =
JSON-string. NUNCA mande array-de-objetos em parâmetro de query.

## 1. Conversas — `lionchat_conversations_filter`

`payload` = array de condições `{attribute_key, filter_operator, values[], query_operator:'and'|'or',
custom_attribute_type?}`. Ordenação FIXA `last_activity_at DESC`, 25/página (param `page`).
E/OU é encadeado condição a condição (sem parênteses).

| attribute_key | Operadores |
|---|---|
| `status` (open/resolved/pending/snoozed, aceita 'all') | equal_to, not_equal_to |
| `chat_type` (individual/group/channel/broadcast/status) | equal_to, not_equal_to |
| `priority` | equal_to, not_equal_to |
| `assignee_id` (atendente), `inbox_id`, `team_id`, `campaign_id`, `captain_assistant_id` (IA), `labels` | equal_to, not_equal_to, is_present, is_not_present |
| `display_id` | equal_to, not_equal_to, contains, does_not_contain (o `contains`, busca por trecho do número, passou a funcionar de verdade em 2026-07-25 — antes dava erro de banco) |
| `referer`, `mail_subject` | equal_to, not_equal_to, contains, does_not_contain |
| `browser_language`, `conversation_language` | equal_to, not_equal_to |
| `created_at`, `last_activity_at` (valor = data) | is_greater_than, is_less_than, days_before + relativos `today`, `yesterday`, `last_days`, `days_ago` (novo 01/08 — ver abaixo) |
| `card_funnel_stage` (conversa POR CARD do Kanban — valor `funnel:<id>` ou `stage:<id>:<chave_etapa>`) | equal_to, not_equal_to |
| **qualquer outra chave** = atributo personalizado | conforme o tipo do atributo (ver tabela em api-conventions) |

Atributo personalizado: informe `custom_attribute_type` na condição — `'conversation_attribute'`
(atributo da conversa) ou `'contact_attribute'`. Sem ele o escopo pode sair errado.

### Data relativa — "Hoje", "Ontem", "últimos X dias" (novo 2026-08-01)

Não calcule data no seu lado pra perguntar "quantas conversas entraram hoje". Existem operadores
próprios, e eles resolvem tudo em **dias INTEIROS no fuso da CONTA** (`Account#timezone`, padrão
`America/Sao_Paulo`). Valem em `created_at` e `last_activity_at`, tanto em
`lionchat_conversations_filter` quanto em `lionchat_contacts_filter`.

| Operador | Valor | Janela |
|---|---|---|
| `today` | **nenhum** | hoje, 00:00 → 23:59 |
| `yesterday` | **nenhum** | ontem, 00:00 → 23:59 |
| `last_days` | `values: [N]` | últimos N dias **incluindo hoje** (N=7 → de 6 dias atrás 00:00 até hoje 23:59) |
| `days_ago` | `values: [N]` | o dia EXATO de N dias atrás (um dia só, não um intervalo) |
| `days_before` | `values: [N]` | tudo **mais antigo** que N dias atrás (o comportamento que já existia) |

```json
{ "attribute_key": "created_at", "filter_operator": "today", "values": [], "query_operator": null }
{ "attribute_key": "created_at", "filter_operator": "last_days", "values": [7], "query_operator": null }
```

**Regras que derrubam a chamada se ignoradas:**
- `today` e `yesterday` NÃO levam valor — o servidor nem espera o campo.
- Nos outros três, N tem que ser inteiro entre **1 e 998**. Zero, negativo, texto ou vazio = HTTP 422
  (`InvalidValue`). Não existe `last_days: 0` pra dizer "hoje" — pra hoje use `today`.
- `is_greater_than` / `is_less_than` continuam sendo o caminho da data FIXA (`values: ["2026-08-01"]`).
  Use-os quando o cliente citou um dia específico; use os relativos quando ele disse "hoje", "ontem"
  ou "últimos X dias".

Por que mudou: até 01/08 a borda do dia era montada em UTC, o que errava **3 horas** no Brasil —
conversa criada às 22h aparecia no dia seguinte. Agora a borda é a do fuso da conta.

## 2. Contatos — `lionchat_contacts_filter`

Mesmo shape de condição. 15/página.

| attribute_key | Operadores |
|---|---|
| `id` (id interno do contato) | equal_to, not_equal_to |
| `name`, `email`, `identifier`, `city`, `company`, `profession` | equal_to, not_equal_to, contains, does_not_contain |
| `phone_number` | + starts_with (busca por DDD/prefixo) — **corrigido na atualização de 26/07/2026**; em instalação anterior devolve SEMPRE lista vazia (virava igualdade exata). Vazio com prefixo que existe = instalação antiga |
| `cpf`, `cnpj`, `rg` (cadastral) | equal_to, not_equal_to, contains, does_not_contain, is_present, is_not_present |
| `country_code` | equal_to, not_equal_to |
| `labels` | equal_to, not_equal_to, is_present, is_not_present |
| `created_at`, `last_activity_at` | is_greater_than, is_less_than, days_before |
| `blocked` | equal_to, not_equal_to |
| **qualquer outra chave** = atributo personalizado do contato | conforme o tipo |

**Registros vinculados** (acha o contato pelo que aconteceu com ele):
- `conversation_status`, `conversation_inbox_id` (equal_to/not_equal_to), `conversation_labels`
  (+is_present/is_not_present) — conversa vinculada.
- `card_funnel_id`, `card_stage`, `card_priority`, `card_status` (equal_to/not_equal_to) — card
  do Kanban vinculado.
- Condição com `custom_attribute_type:'conversation_attribute'` — atributo da conversa vinculada.

### Duas regras que enganam nos filtros

- **Vários valores na mesma condição** (ex.: cidade é "Sorocaba" OU "Campinas"): em CONTATOS isso só
  passou a valer na atualização de 26/07/2026 — em instalação anterior o filtro usa só o PRIMEIRO
  valor e descarta o resto em silêncio. Conversa sempre usou todos. Na dúvida, faça uma consulta por
  valor e some.
- **"Entre duas datas" não existe como operador** — são duas condições (`is_greater_than` +
  `is_less_than`), e as duas pontas ficam **de fora**. Pra incluir os dias 01 e 10, peça de 30/06 a
  11/07. O corte do dia é em UTC, então conversa do fim da noite conta no dia seguinte.

## 3. Kanban — `lionchat_kanban_items_filter` (lista rica de cards)

GET com parâmetros FLAT (não usa payload). Filtros REAIS (2026-07-24 — parâmetros fantasmas
stage_id/inbox_id/sort_by/sort_direction/page foram REMOVIDOS, eram ignorados pelo backend):

- `funnel_id` (obrigatório), `stages[]` (chaves internas das etapas), `priorities[]`,
  `statuses[]` (open/won/lost), `agent_id`, `value_min`/`value_max`
- `date_start`/`date_end` (criação do card, YYYY-MM-DD)
- `stage_date_start`/`stage_date_end` (2026-08-07) — **quando o card ENTROU na etapa em que ele está
  agora** (`stage_entered_at`, caindo em `created_at` para card que nunca se moveu). NÃO confundir com
  `date_start`/`date_end`: um card criado em janeiro e arrastado ontem casa AQUI e não casa lá. É o que
  responde "o que se mexeu essa semana". Pontas independentes, e os dois períodos podem ser combinados.
  Nuance ao explicar pro usuário: card criado ontem que nunca se moveu TAMBÉM entra (ele entrou na
  etapa ao nascer) — o que o filtro separa de verdade é o card VELHO que se moveu.
- `scheduled_date_start`/`scheduled_date_end` (agendamento: scheduled_at/deadline_at do card E
  tarefas da agenda vinculadas)
- `task_filter`: has_task | no_task | today | tomorrow | this_week | overdue
- `channel` (tipo de canal SEM prefixo: Waha, Whatsapp, Instagram...), `label` (etiqueta da
  conversa do card), `offer` (descrição exata de oferta no card)
- `card_custom_attribute_filters` / `contact_custom_attribute_filters` /
  `conversation_custom_attribute_filters` — **JSON-string** (padrão B) de condições
  `{attribute_key, filter_operator, values[]}`, operadores: equal_to, not_equal_to, contains,
  does_not_contain, is_present, is_not_present. `custom_attribute_match`: 'all' (E) | 'any' (OU).

ATENÇÃO: **sem paginação** — até 5000 cards, ordem created_at DESC, shape `{items, total, filters}`.
NÃO há filtro por time aqui (por time: use o relatório agregado abaixo, ou filtre por agent_id).

## 4. Relatório agregado do Kanban — `lionchat_kanban_items_list_3`

`GET /kanban_items/reports` — a resposta é um OBJETO de métricas (não lista): valores GANHOS,
contagem/valor por etapa, forecast ponderado, top negócios, cards parados, metas do funil.
Params: `funnel_id` (obrigatório), `from`, `to`, `user_ids[]` (agentes), `team_id`, `date_basis`.
É a ferramenta certa pra "relatório de vendas/ganhos do mês por agente ou time".

**`date_basis` (2026-08-07) — qual data o período considera.** A resposta devolve a régua aplicada em
`dateBasis`; valor inválido cai no padrão sem erro.

| Valor | O que o período recorta | Quando usar |
|---|---|---|
| `any` (PADRÃO) | criado no período **OU** fechado no período | É a régua histórica e a mais larga. **Omitir mantém exatamente os números de sempre.** É a certa pra RECEITA: com qualquer outra, venda fechada no período de um lead antigo some (medido 07/08: 17% dos ganhos da frota) |
| `created` | só quando o card nasceu | "quantos leads entraram" |
| `moved` | só quando entrou na etapa atual (mesma expressão do `stage_date_*` da seção 3) | "o que se mexeu no período" |
| `closed` | só ganhos/perdidos no período | **a pergunta de receita** — é a régua certa pra "quanto vendemos em julho" |

O relatório de UMA etapa (`GET /funnels/:id/stage_report`, o painel que abre dentro do quadro) tem as
MESMAS 4 opções, mesmo parâmetro `date_basis` e as MESMAS expressões — mas o **padrão dele é `moved`**,
não `any`. Não é inconsistência: ele responde uma pergunta só ("quantos cards entraram nesta etapa no
período"), enquanto o `/kanban_items/reports` é uma rede larga que alimenta várias métricas de uma vez.
Se o usuário disser que as duas telas não batem, a resposta é: escolha a MESMA régua nas duas.

Ao apresentar número pro usuário, DIGA qual régua usou. Duas réguas diferentes respondem a mesma
pergunta com números diferentes, e o usuário conclui que o relatório está errado.

## 5. Busca com filtro estruturado

`search_search` (tudo), `conversations_search`, `contacts_search`, `kanban_items_search` aceitam
`conversation_filters`/`contact_filters` (JSON-string no MESMO shape do payload dos /filter, mesmo
motor, cap 10 condições) e `kanban_filters` (JSON-string do subset flat da seção 3). Paginação por
categoria: 15/página (kanban: primeiros 15, sem paginação).

## 6. Respostas: enxutas por padrão + paginação

- **Slim (2026-07-24, default LIGADO):** listas voltam SEM campos pesados/decorativos
  (`message_templates`, `working_hours`, `meta_history_import`, avatares — viram marcador
  `[omitido...]`). Pra resposta completa: `full_response:true` (disponível nas tools de
  lista/show pesadas). Anexos de mensagem (data_url/download_url) NUNCA são podados.
- **Segredos:** chaves de credencial (api_key, tokens, senhas) saem SEMPRE como `[REDACTED]` —
  sem exceção, nem com full_response. Precisa de um token? Painel, não robô.
- **Paginação:** os DOIS conectores agora informam `pagination.{current_page,total_pages,
  total_count,has_more}` — pagine até `has_more=false`. (No remoto o bloco é ADICIONADO ao lado
  do shape original.)
- **Corte:** resposta acima do teto é enxugada por ITENS INTEIROS (aviso `[LISTA ENXUGADA...]`
  com contagem exibida/total) — o JSON nunca vem quebrado no meio.

## 7. Receitas prontas

**R1 — Conversas de um período por atendente:**
```json
payload=[
  {"attribute_key":"assignee_id","filter_operator":"equal_to","values":[6],"query_operator":"and"},
  {"attribute_key":"created_at","filter_operator":"is_greater_than","values":["2026-07-01"],"query_operator":"and"},
  {"attribute_key":"created_at","filter_operator":"is_less_than","values":["2026-07-31"]}
]
```
(paginar até has_more=false; pra métricas agregadas prefira `reports_summary` type=agent)

**R2 — Cards por etapa + faixa de valor no mês:**
`kanban_items_filter funnel_id=37 stages=["negociacao"] value_min=5000 date_start=2026-07-01 date_end=2026-07-31`

**R3 — Ganhos do mês por agente/time:**
`kanban_items_list_3 funnel_id=37 from=2026-07-01 to=2026-07-31 user_ids=[6,12]` (ou `team_id=3`)

> ⚠️ **`from`/`to` deste relatório: mande SEMPRE timestamp UNIX.** Data por extenso (`2026-07-01`)
> só é aceita a partir da atualização de 26/07/2026; antes dela o relatório volta **inteiro zerado,
> sem erro nenhum** (vira 1970 por dentro). Timestamp funciona em qualquer versão — use ele e você
> nunca cai na armadilha. Se vier tudo zero e o funil tem cards, era isso.

**R4 — Conversas de uma campanha que FALHARAM/entregaram:** filtre por
`campaign_id equal_to <id>`; o status da MENSAGEM de template (sent/delivered/read/failed) está
nas mensagens da conversa (`conversations_messages_list`) — não é atributo da conversa.

**R5 — Contatos por atributo + etiqueta:**
```json
payload=[
  {"attribute_key":"faixa_investimento","filter_operator":"equal_to","values":["300k_1m"],"query_operator":"and"},
  {"attribute_key":"labels","filter_operator":"equal_to","values":["apoiador"]}
]
```

**R6 — Cards parados (sem tarefa) com atributo do contato:**
`kanban_items_filter funnel_id=37 task_filter=no_task contact_custom_attribute_filters="[{\"attribute_key\":\"ja_investe\",\"filter_operator\":\"equal_to\",\"values\":[\"ja_invisto\"]}]"`

**Erros clássicos a evitar:** `includes` em labels (não existe — use equal_to); operador de
número/data em texto; array-de-objetos em query (padrão B exige JSON-string); esquecer
`custom_attribute_type` quando contato e conversa têm atributo de mesmo nome; esperar paginação
no kanban_items_filter (não tem — estreite o filtro).
