# Kanban — Guia Profundo

Tudo sobre o módulo Kanban/CRM do LionChat: funis, etapas, cards, valor, automações, integrações com conversação.

## Estrutura

### Funnel (Funil)
Container de etapas. Conta pode ter vários funis (ex: "Vendas", "Pós-venda", "Renovação").

| Campo | Descrição |
|---|---|
| `id` | Identificador |
| `name` | Nome do funil (ex: "Vendas B2B") |
| `description` | Descrição livre |
| `stages` | jsonb com etapas (ver abaixo) |
| `archived` | Boolean — funis arquivados não aparecem na UI ativa |
| `active` | Boolean — controla se aceita movimentação |
| `settings` | jsonb — config customizada (ex: cores, automações) |
| `settings.agents` | agentes do funil. Grave `[{"id": <id do agente>}]` — cada item é um OBJETO, nunca número solto (ids de `lionchat_agents_list`); o sistema completa nome, e-mail, cargo e foto — é o que o editor do funil, o card e a conversa mostram. Agente de outra conta fica sem nome e sem acesso. `settings` é substituído INTEIRO no update: leia o funil antes e reenvie goals+agents+teams+automations. `settings.removed_stages` (lista das etapas já excluídas, usada para redirecionar cards) é do SERVIDOR: se você mandar essa chave ela é ignorada, sem erro, e o servidor a mantém sozinho. |

### Stages (Etapas) — dentro de `funnel.stages`

Stages NÃO são tabela separada. São armazenadas como jsonb dentro do Funnel:

```json
{
  "novo_lead": {
    "name": "Novo Lead",
    "color": "#3B82F6",
    "position": 1,
    "description": "Lead ainda não qualificado"
  },
  "qualificado": {
    "name": "Qualificado",
    "color": "#10B981",
    "position": 2,
    "description": "Lead com interesse confirmado"
  },
  "ganho": {
    "name": "Ganho",
    "color": "#22C55E",
    "position": 99
  },
  "perdido": {
    "name": "Perdido",
    "color": "#EF4444",
    "position": 100
  }
}
```

**Etapa que não existe no funil (desde 19/08/2026):**
- `kanban_items_create`/`_update`/`_move` com `funnel_stage` que o funil não tem **não falha e não
  some**: o card é REDIRECIONADO — pro destino gravado quando a etapa foi apagada, senão pra etapa
  da mesma posição, senão pra primeira. **Confira o `funnel_stage` da resposta**: pode ser diferente
  do que você mandou. Leia `funnels_show` antes e use o slug exato.
- `funnels_update` que tira do `stages` uma etapa com card responde **422 `STAGE_HAS_ITEMS`** com
  `stages: {"<slug>": <quantos cards>}`. **Para EXCLUIR uma etapa que tem cards, use
  `lionchat_funnels_remove_stage`** (`POST /funnels/{id}/remove_stage`, ver "Excluir etapa" abaixo): ela move
  os cards para o destino EM SILÊNCIO e apaga a etapa. **Não** use a receita antiga (mover com `migrate_stage` e depois reenviar
  o funil sem aquela etapa) — o `migrate_stage` (`lionchat_funnels_create_2`) NÃO exclui a etapa: move os
  cards DISPARANDO tudo o que está ligado ao destino (automações do funil, regras, fluxos, webhooks, conversões)
  e a etapa de origem continua no funil, só vazia. Usar `migrate_stage` para "limpar antes de excluir" dispara
  automação e aviso ao cliente por card movido.
- Funil apagado continua sendo erro (o card não é criado).

### Excluir etapa (20/10/2026) — `lionchat_funnels_remove_stage`

`POST /funnels/{id}/remove_stage` com `from_stage` (CHAVE da etapa a excluir), `to_funnel_id` (obrigatório; pode ser o
próprio funil) e `to_stage` (CHAVE do destino). Os cards **mudam de etapa e não são apagados**; nada dispara (nenhuma
automação do funil, regra, fluxo, webhook, conversão nem aviso ao cliente). Desde 20/10/2026 o card passa a contar o
tempo na etapa nova **a partir da exclusão** (`stage_entered_at` = o instante da exclusão; antes mantinha a data): é o
que mantém os relatórios de meses passados mostrando cada card onde ele estava ("etapa removida"). Exige
administrador ou a permissão "gerenciar funis" (sem ela: **401**; vale também para o `migrate_stage`).

**Como a IA deve usar:**

1. `lionchat_funnels_show` para pegar as chaves; conte os cards com `lionchat_funnels_stage_report` (id do funil + a
   chave em `stage`, com `show_won`, `show_lost` e `show_snoozed` = `true` — sem isso o relatório conta só os abertos
   não adiados e a etapa parece ter menos cards do que vai mover).
2. Diga ao usuário quantos cards vão para onde e que a etapa será excluída; **peça o OK uma vez**.
3. Chame com `confirm: true` — **toda** chamada leva `confirm: true`, inclusive a primeira. A ferramenta trabalha em
   pedidos curtos (cerca de 8 segundos de cards por pedido, lotes de 125): **repita a chamada, sem perguntar de novo,
   até vir `done: true`**.

**Respostas:**

| Resposta | Significa |
|---|---|
| `200 {done: true, moved, stage_removed: true, funnel}` | Terminou. `moved` é o TOTAL da exclusão inteira |
| `200 {done: true, moved: 0}` (sem `stage_removed`) | A etapa já estava excluída para o mesmo destino (fim normal, por exemplo repetição do pedido) |
| `200 {done: false, moved, remaining, reason}` | Ainda falta. `moved` é só deste pedido. `remaining` = cards que faltam; **nulo** = a contagem não coube no tempo (não é erro, repita); **100001** = "mais de 100 mil" |

`reason` quando `done: false`: `tempo` = repita agora; `travado` ou `faxina` = o banco estava ocupado, espere ~30 s e
repita; `destino_excluido` = a etapa de destino deixou de existir, pergunte ao usuário outro destino; `assumido` =
OUTRA pessoa assumiu a exclusão desta etapa (vêm `holder_name` e `to_stage_name`, que podem ser nulos): avise quem está
excluindo e para onde (sem nome, diga só "outra pessoa está excluindo esta etapa") e **pare, não repita**. Duas
respostas seguidas com `moved: 0` e `done: false` = algo está preso: **pare e avise**.

**Erros:** `422 {error, code}` com `code` = `DESTINATION_NOT_FOUND`, `SAME_STAGE`, `LAST_STAGE` (o funil precisa ficar
com pelo menos uma etapa), `ORIGIN_NOT_FOUND`, `STAGE_ALREADY_REMOVED_BY_OTHER`, `FINAL_SAVE_FAILED` (os cards já
foram movidos mas o funil não pôde ser salvo) e `FUNNEL_INVALID` — o texto de `error` já vem no idioma da conta,
mostre-o ao usuário. `409 STAGE_REMOVAL_IN_PROGRESS` = outra pessoa está excluindo esta etapa agora (`holder_name` e
`to_stage_name` podem ser nulos): avise e pare. **Qualquer Salvar do funil (com ou sem `stages`) também pode dar `409 FUNNEL_BUSY`**
(o funil está sendo alterado agora, por outra pessoa ou por uma exclusão de etapa): espere alguns instantes e repita.

### KanbanConfig (Configuração Global do Kanban) — CRÍTICO

**Tabela separada do Funnel.** 1:1 com a conta. Guarda configurações que valem pra TODOS os funis. Tem 5 campos jsonb importantes:

| Campo | Tipo | O que guarda |
|---|---|---|
| `win_reasons` | jsonb array | **Motivos de Ganho** — `[{id, title}]`, `id` em **texto estável** (nunca número). Aparecem como dropdown quando o vendedor marca "Ganho" num card. NATIVO. NÃO usar custom_attribute. |
| `loss_reasons` | jsonb array | **Motivos de Perda** — mesma estrutura e mesma regra do `id`. Aparece ao marcar "Descartado". |
| `checklist_templates` | jsonb array | Templates de checklist reusáveis — `[{id, name, items: [{id, text}]}]`. Aplicados manualmente ou via automação `apply_checklist_template`. |
| `global_custom_attributes` | jsonb array | Atributos globais que aparecem em TODOS os cards de TODOS os funis — `[{name, type, is_list, list_values}]`. |
| `config` | jsonb hash | Configurações gerais (title, default_view, auto_assignment, support_email, dragbar_enabled, etc) |
| `webhook_url`, `webhook_secret`, `webhook_events` | string/array | Webhook externo do Kanban (recebe eventos `kanban.item.created`, `kanban.item.stage_changed`, etc) |

#### Endpoints

| Método | Path | O que faz |
|---|---|---|
| GET | `/api/v1/accounts/{id}/kanban_config` | Lê (cria automaticamente se não existir) |
| POST | `/api/v1/accounts/{id}/kanban_config` | Cria explícito |
| PUT | `/api/v1/accounts/{id}/kanban_config` | Atualiza parcial |
| DELETE | `/api/v1/accounts/{id}/kanban_config` | Remove (não afeta cards/funis) |
| POST | `/api/v1/accounts/{id}/kanban_config/test_webhook` | Dispara payload de teste |

**Body raiz ou com o envelope `kanban_config` — os dois funcionam** (conferido 21/09: `{"loss_reasons": [...]}` na
raiz grava e recusa normalmente). Exemplo com envelope:

```json
PUT /api/v1/accounts/43/kanban_config
{
  "kanban_config": {
    "win_reasons": [
      {"id": "wr-1", "title": "Preço competitivo"},
      {"id": "wr-2", "title": "Indicação forte"}
    ],
    "loss_reasons": [
      {"id": "lr-1", "title": "Preço alto"},
      {"id": "lr-2", "title": "Sem retorno"}
    ]
  }
}
```

**Regras dos motivos** (servidor, desde 21/09): `id` em texto estável — número é convertido (`7` → `"7"`), mas mande
texto; a lista SUBSTITUI a atual, então reenvie os MESMOS `id` dos motivos que já existem (trocar o `id` tira o nome
dos cards já marcados); lista de textos soltos, motivo sem `id`/`title` ou `id` repetido → **422** com o formato
(antes, a lista de textos APAGAVA os motivos em silêncio). No card: `item_details.loss_reason`/`win_reason` = o `id`
(texto) + `reason` = o título. Detalhes em `lionchat://docs/api-conventions` → "Estrutura interna das listas".

**`win_reasons` e `loss_reasons` aceitam array de OBJETOS `{id, title}`, NÃO strings simples.** Strings causam 500. O `id` é qualquer string única (UUID ou slug curto tipo `wr-1`).

**Substituição vs merge:** quando você envia `win_reasons`, a lista inteira é substituída. Pra preservar, leia primeiro com GET e mande a lista completa.

#### ⚠️ Quando NÃO criar como custom_attribute

| Quero | Use | NÃO use |
|---|---|---|
| Motivo de Ganho/Perda no card | `kanban_config.win_reasons` / `loss_reasons` | ❌ custom_attribute em conversation/contact |
| Atributo que aparece em TODO card | `kanban_config.global_custom_attributes` | ❌ custom_attribute de conversation |
| Atributo só de um contato (CPF, endereço) | `custom_attribute_definitions` model=contact_attribute | ❌ kanban_config |
| Atributo só de uma conversa (motivo, tag interna) | `custom_attribute_definitions` model=conversation_attribute | ❌ kanban_config |
| Valor de um campo num card (aparece na aba Campos) | `item_details.custom_attributes` — LISTA `[{name, type, value}]`, com o campo definido em `kanban_config.global_custom_attributes` | ❌ `kanban_item.custom_attributes` (coluna que nenhuma tela mostra) |

### KanbanItem (Card)
Um card individual dentro de uma etapa.

| Campo | Descrição |
|---|---|
| `id` | Identificador |
| `funnel_id` | Funil ao qual pertence |
| `funnel_stage` | Chave da etapa (ex: `"novo_lead"`) |
| `position` | Ordem dentro da etapa |
| `stage_entered_at` | Quando entrou na etapa atual (pra métrica de tempo) |
| `conversation_display_id` | Conversa principal vinculada. **O sistema move este ponteiro sozinho (desde 04/08/2026)**: quando nasce uma conversa nova do mesmo contato naquela caixa, o card passa a apontar pra ela. O card é da PESSOA, não do atendimento. **NÃO trate este valor como estável** — releia antes de usar. Enviar `conversation_display_id` num UPDATE de card é ignorado de propósito (senão o reenvio do formulário regravaria o número antigo por cima). |
| `origin_conversation_display_id` | Conversa em que o card NASCEU (só preenchida se o vínculo já foi movido). É o que o relatório de origem de lead usa, pra uma venda não mudar de mês nem de anúncio quando o card anda. |
| `linked_conversations` | jsonb array `[{display_id: 123}, {display_id: 456}]` — múltiplas conversas |
| `item_details` | jsonb (ver abaixo) |
| `custom_attributes` | jsonb (coluna própria) — **NÃO aparece na aba Campos, no filtro do quadro nem na busca**. Os campos visíveis do card moram em `item_details.custom_attributes` (ver abaixo) |
| `assigned_agents` | jsonb array de agentes responsáveis |
| `activities` | jsonb array — log de atividades |
| `checklist` | **O que fica guardado:** jsonb array de tarefas do card (item: `text`/`completed`/`position` + `group_id`/`group_name` opcionais para agrupar). **O que a API devolve é OUTRA coisa** — ver o aviso logo abaixo |
| `timer_started_at`, `timer_duration` | Timer interno do card |
| `effective_status` | **Só na resposta, não é coluna (11/10/2026).** A situação EFETIVA do card: `open`, `snoozed` (adiado), `won` ou `lost`. `item_details.status` continua `open` num card adiado — quem quer saber se ele está adiado lê ESTE campo. Vem em `kanban_items_list`/`_show`/`_filter`/`_search`, na busca geral, na ficha do contato e no card embutido em `conversations_show`. Ver "Card adiado" no fim |
| `snoozed_until` | **Só na resposta (11/10/2026).** Até quando o card está adiado (ISO 8601); `null` quando não está adiado |

> **ATENÇÃO — na maioria das respostas o `checklist` NÃO é a lista de tarefas, e sim um resumo com
> os números:** `{ total_count, completed_count, groups: [{ group_id, group_name, total_count,
> completed_count }] }`. Não existe nenhum `text` ali. Procurar a tarefa nesse campo faz a IA
> concluir "esse card não tem checklist" num card que tem 12 tarefas.
>
> O formato **muda por ferramenta** — não é o mesmo em todas:
>
> | Ferramenta | `checklist` | `attachments` | `item_details.notes` / `offers` / `custom_attributes` | `activities` / `funnel` |
> |---|---|---|---|---|
> | `kanban_items_list` | **array completo** | `{ total_count }` | completos | ausentes |
> | `kanban_items_show` | **resumo** | `{ total_count }` | completos | presentes |
> | `kanban_items_filter` / `_search` | **resumo** | `{ total_count }` | `notes` vira `{ total_count }`; `offers`/`custom_attributes` **removidos** | ausentes |
> | card embutido em `conversations_show` | **resumo** | — | — | — |
>
> - Para ler as tarefas de verdade em QUALQUER caso: **`lionchat_kanban_items_kanban_checklist_list`**
>   (`GET .../kanban_items/{id}/get_checklist`) → `{ item_id, checklist: [ ...itens completos... ],
>   checklist_count }`.
> - No resumo, `groups` só conta o que está agrupado: tarefa **avulsa** (sem `group_id`) entra no
>   `total_count`/`completed_count` gerais mas **não aparece** em `groups`. Somar os grupos ≠ total.
> - O card embutido em `conversations_list`/`conversations_filter` **não traz `checklist` nenhum** —
>   nem resumo. Só `conversations_show` traz o resumo.

### item_details (detalhes do card)

```json
{
  "title": "Cliente XYZ - Plano Pro",
  "value": 5000.0,
  "priority": "high",
  "description": "Cliente interessado em upgrade",
  "notes": [
    {"text": "Ligou pedindo proposta", "created_at": "2026-05-15T10:00:00Z"}
  ],
  "offers": [
    {"id": 12, "title": "Pro 12 meses", "value": 4800}
  ],
  "custom_attributes": [
    {"name": "Origem do Lead", "type": "string", "value": "Facebook Ads"}
  ]
}
```

**`value`** é onde fica o valor monetário do negócio (usado em pipelines). Sempre NÚMERO — texto quebra a
soma das colunas.

**`custom_attributes` é uma LISTA, nunca um objeto `{chave: valor}`** (conferido no código em 18/09/2026).
Cada item é `{name, type, value}` e só aparece na aba Campos se `name` **e** `type` baterem exatamente com
um campo de `kanban_config.global_custom_attributes` (leia com `lionchat_kanban_config_list`).

Como gravar pelo `lionchat_kanban_items_update` (`kanban_item.item_details`):
- O `item_details` é MESCLADO só no 1º nível: cada chave enviada **troca a chave inteira** no card. Por isso
  a lista `custom_attributes` enviada **substitui a lista toda** — leia o card com `lionchat_kanban_items_show`
  e reenvie TODOS os campos, com o alterado.
- Mandar objeto (`{"origem_lead": "Facebook Ads"}`) no lugar da lista **APAGA todos os campos do card**: o
  servidor só aceita itens `{name, type, value}` e o objeto vira vazio.
- Lista fechada de chaves do `item_details` (outras são descartadas em silêncio): title, description, status,
  reason, win_reason, loss_reason, attributed_to, co_attributed_to (13/10/2026, ver "Co-participante da venda"),
  duplicated_from_id, priority, value, currency, custom_attributes, offers, closed_offers, closed_offer, deadline_at,
  scheduling_type, scheduled_at, conversation_id, automations, notes.
- Para mudar UM campo sem reenviar a lista, as ações de automação/macro `update_card_attribute`
  (`[{funnel_id, attribute_key: "<nome do campo>", value}]`) mexem só naquela entrada.

### assigned_agents

```json
[
  {
    "id": 5,
    "name": "Maria Souza",
    "email": "maria@empresa.com",
    "avatar_url": "https://...",
    "assigned_at": "2026-05-14T09:00:00Z",
    "assigned_by": 1,
    "source": "manual"
  }
]
```

Múltiplos agentes podem ter o mesmo card. `source` pode ser `manual`, `automation`, `inherited_from_conversation`.

**Para GRAVAR** (`kanban_items_create`/`_update`, `kanban_item.assigned_agents`) o formato é outro: LISTA de
NÚMEROS — `[5, 12]`. O sistema completa nome, e-mail e foto. A lista enviada **substitui** a atual (mande
todos que devem ficar). Objetos `{id, ...}` são ignorados em silêncio e a lista não muda.

**Agente do card vira participante das conversas (2026-06):** atribuir um agente a um card do Kanban
(via `kanban_agents` ou ao vincular uma conversa) agora também o adiciona como PARTICIPANTE de todas
as conversas do card (a principal `conversation_display_id` + as de `linked_conversations`). É a 4ª
forma de virar participante — aditivo e idempotente (não duplica nem remove os participantes que já
existiam).

### linked_conversations — IMPORTANTE

```json
[{"display_id": 123}, {"display_id": 456}]
```

**NUNCA gravar inteiros direto** — sempre objetos com `{display_id: ...}`. Inteiros diretos causam TypeError no `as_json`.

## Posição (ordering)

Cada KanbanItem tem `position` (integer). Cards ordenados ASC dentro da etapa.

Reordenação:
- API endpoint: `POST /api/v2/kanban/items/reorder`
- Recebe array com nova ordem `[{id: 5, position: 1}, {id: 8, position: 2}]`
- Recalcula `position` em todas as etapas afetadas

Mover entre etapas:
- API endpoint: `POST /api/v2/kanban/items/{id}/move`
- Body: `{funnel_stage: "qualificado", position: 1}`
- Atualiza `funnel_stage`, `stage_entered_at`, e `position`

## Atividades (activities)

Log automático de eventos do card:

```json
[
  {
    "type": "stage_changed",
    "from": "novo_lead",
    "to": "qualificado",
    "by_user_id": 1,
    "at": "2026-05-15T10:00:00Z"
  },
  {
    "type": "agent_assigned",
    "agent_id": 5,
    "by_user_id": 1,
    "at": "2026-05-15T10:01:00Z"
  },
  {
    "type": "note_added",
    "note_id": 42,
    "by_user_id": 5,
    "at": "2026-05-15T10:05:00Z"
  }
]
```

Tipos comuns: `created`, `stage_changed`, `agent_assigned`, `agent_removed`, `note_added`, `value_changed`, `priority_changed`, `archived`.

Desde 11/10/2026 também `item_snoozed` (o card foi adiado — leva `snoozed_until`) e `item_unsnoozed` (o card adiado
abriu — leva `reason`: `person` = alguém abriu, `automation` = automação, macro ou fluxo, `due` = chegou a data; e a
data que estava marcada).

Quem fez: `by_user_id`/`user` traz a pessoa; ação de automação ou flow vem com o nome da regra/fluxo;
ação da IA (desde 21/08/2026 — entra com o próximo deploy do app depois de 21/08/2026) vem como
`"IA: <nome do assistente>"` com `id` nulo — antes saía sem autor. Ao explicar um histórico de card,
use esse campo pra dizer se foi gente, automação ou IA.

## Checklist (tarefas dentro do card)

Array plano de itens. Cada item pode (opcionalmente) pertencer a um grupo via `group_id` +
`group_name`. Item SEM `group_id` = avulso (solto, fora de qualquer grupo).

```json
[
  {
    "id": "abc-123",
    "text": "Enviar proposta por email",
    "completed": true,
    "position": 0,
    "group_id": "grp-uuid-1",
    "group_name": "Modelo Comercial"
  },
  {
    "id": "abc-124",
    "text": "Agendar follow-up",
    "completed": false,
    "position": 1,
    "group_id": "grp-uuid-1",
    "group_name": "Modelo Comercial"
  },
  {
    "id": "abc-125",
    "text": "Ligar amanhã",
    "completed": false,
    "position": 2
  }
]
```

Campos: `text` (não `title`), `completed` (não `checked`), `position` (ordem), e o par opcional
`group_id`/`group_name`. `group_name` é um snapshot (não muda se o modelo for renomeado depois).

### Checklist por grupo (importante pro MCP)

- Cada **modelo de checklist aplicado** vira um **grupo independente**: todos os itens do modelo
  recebem o mesmo `group_id` + `group_name`. Aplicar o mesmo modelo duas vezes = dois grupos.
- **Aplicar um modelo como grupo via MCP:** gere um `group_id` único (ex.: um UUID) e chame
  `lionchat_kanban_items_kanban_checklist_create` uma vez por item, passando o MESMO `group_id`
  e `group_name` em todos. (Não existe uma tool de "aplicar modelo inteiro de uma vez" — é o loop.)
- **Marcar/desmarcar** item: `lionchat_kanban_items_kanban_checklist_create_1` (toggle).
- **Remover um grupo inteiro** de uma vez: `lionchat_kanban_items_kanban_checklist_group_destroy`
  (body `group_id`). Remover um item só: `..._checklist_destroy`.
- No card do quadro, cada grupo mostra sua própria barra de progresso (com 3+ grupos, o card fica
  enxuto por padrão e expande sob demanda).

Útil pra workflows internos. Não confundir com `tasks` (que é módulo separado de tarefas globais).

## Pipeline (visão por valor)

Pipeline = soma de `item_details.value` agrupado por etapa.

Exemplo:
```
Funil "Vendas"
├── Novo Lead: 12 cards | R$ 47.000
├── Qualificado: 8 cards | R$ 38.000
├── Negociação: 3 cards | R$ 22.000
├── Ganho: 5 cards | R$ 28.000 (fechados no mês)
└── Perdido: 2 cards | R$ 4.000
```

Endpoint: `GET /api/v2/kanban/items/counts` retorna contagem + soma por etapa.

## Controle de acesso por funil (2026-06-10)

Funis agora têm visibilidade por usuário. Um funil é visível pra alguém quando:
- é admin da conta, OU
- tem permissão `kanban_view`/`kanban_manage` (custom role), OU
- tem `funnel_manage` (21/09): quem pode criar/editar/arquivar qualquer funil passou a **enxergar** qualquer funil
  na lista — antes editava pela API um funil restrito que não aparecia em `funnels_list`. Só o FUNIL: os cards do
  funil restrito seguem a régua de card, OU
- o funil está aberto a todos, OU
- a pessoa participa do funil (está em `settings.agents`, OU é membro de um TIME em `settings.teams` — novo 2026-07-21, membros resolvidos ao vivo — ou tem card atribuído)

**Efeitos práticos nas tools:**
- `funnels_list` retorna SÓ os funis visíveis pro usuário do token
- `funnels_show` / `stage_stats` de funil não-visível → **404** (não "lista vazia")
- A resposta dos cards traz selos de permissão calculados no backend:
  `can_edit`, `can_move`, `can_delete`, `can_assign` (booleans)
- `kanban_items_move` sem permissão → **403** com mensagem traduzida (antes dava 500/sucesso falso)
- Cards embutidos na tela da conversa também respeitam a visibilidade
- **Aviso em tempo real do card (21/09):** `kanban_item.created/updated` deixou de ir para a conta inteira — vai só
  para quem VÊ aquele card (mesma régua acima) + administradores. Quem perde a visão (card passou a outro
  responsável, mudou de funil) recebe `kanban_item.deleted` com só `{id, funnel_id}`. Integração que escuta o
  WebSocket com token de usuário restrito recebe menos eventos que antes; com token de administrador, nada muda.

**Pro MCP:** antes de tentar mover/editar card, confira os campos `can_*` do show — se `can_move`
é false, explique ao usuário que ele não tem acesso àquele funil em vez de tentar mesmo assim.

## Controle de acesso por CAIXA (conversas + cards) e a "ponte" da conversa atribuída (2026-06)

Além da visibilidade por funil (acima), há um controle de acesso POR CAIXA que vale tanto pro
Kanban quanto pras CONVERSAS. Um agente NÃO-admin só vê as conversas e os cards das caixas das quais
ele é membro (membro comum OU supervisor — ver "Supervisor de caixa" no glossário). Admin vê tudo.

**A ponte (exceção pontual):** estar ATRIBUÍDO a um card dá acesso PONTUAL à conversa daquele card,
mesmo que o agente não seja membro da caixa. A ponte vale pra:
- a conversa PRINCIPAL do card (`conversation_display_id`), e
- as conversas em `linked_conversations`.

O que a ponte libera: ABRIR e RESPONDER aquela conversa específica. O que a ponte NÃO libera: a
caixa inteira (o agente continua sem ver as outras conversas/cards daquela caixa). A atribuição é a
qualquer agente no card (`assigned_agents`), não só ao responsável da conversa.

**Efeitos práticos nas tools (lado conversas):**
- `conversations_list` / `conversations_search` retornam SÓ conversas de caixas acessíveis (mais as
  liberadas pela ponte de card atribuído).
- `conversations_show` / `conversations_messages_*` de conversa inacessível → **404**.
- Buscar card por ID de caixa inacessível → **404** (não revela sequer que o card existe).
- Ação em massa de CARD (`kanban_bulk_create` = mover, `kanban_bulk_create_1` = atribuir agente,
  `kanban_bulk_create_2` = definir prioridade) em que NENHUM dos `item_ids` é acessível → **404**
  `{ "error": "Nenhum item valido encontrado" }`. Se só PARTE for inacessível, a ação roda nos
  acessíveis e ignora o resto em silêncio.
- `kanban_items_export` **não dá 404** — ele filtra: exporta só os cards das caixas que o agente vê
  (pode voltar vazio). Em nenhum dos casos a resposta vaza card de caixa sem acesso.

> **Não confunda:** apesar do nome, **`kanban_bulk_bulk_actions` NÃO é ação em massa de card do
> Kanban** — ela bate em `POST /accounts/{id}/bulk_actions`, que é a ação em massa de **conversas e
> contatos** (`type: Conversation` ou `Contact`). Card do Kanban tem as **três** ferramentas
> listadas acima, todas com `item_ids: [...]`, e nenhuma delas aceita etiqueta.

**Pro MCP:** se uma conversa/card "some" da listagem ou dá 404 pra um agente que jura que existe,
provavelmente é acesso por caixa — explique que ele só vê as caixas das quais participa, e que o
acesso a uma conversa solta vem de estar atribuído ao card dela.

## Funil arquivado vs ativo

- `archived = true`: funil escondido da UI principal. Cards ainda existem mas não aparecem nas listas
- `active = false`: bloqueia movimentação (modo "somente leitura")

Use cases:
- Arquivar funis antigos no fim do ano
- Pausar funil em manutenção sem deletar cards

## Integração com Conversation

### Quando uma conversa vincula a um card
- Manual via UI ("vincular ao Kanban")
- Automação via `automation_rule.actions` com action `add_to_kanban`
- API call em `POST /api/v2/kanban/items` com `conversation_display_id`

### Como o card "sabe" sobre o cliente

```
KanbanItem
  └─ conversation_display_id → Conversation
                                  └─ contact → Contact (nome, telefone, email)
```

NÃO existe `contact_id` direto no KanbanItem. Sempre via conversation_display_id.

### Múltiplas conversas no mesmo card

`linked_conversations` permite agrupar várias conversas (ex: cliente que falou em WhatsApp e Email):

```json
[
  {"display_id": 100},
  {"display_id": 101},
  {"display_id": 105}
]
```

A `conversation_display_id` (singular) ainda é a "principal" — mas todas as `linked_conversations` aparecem na sidebar do card.

## Automações relacionadas a Kanban — 2 SISTEMAS DIFERENTES

Existem **dois sistemas paralelos** de automação. Não confundir.

### Sistema 1: `funnel.settings.automations` — DENTRO de um funil específico

Automações que rodam ao criar um card, mover de etapa ou mudar o STATUS (Ganho/Perdido). Atuam sobre o card e podem mover/duplicar entre funis. **Configurado por funil**, dentro de `funnel.settings.automations`.

```json
PUT /api/v1/accounts/43/funnels/43
{
  "funnel": {
    "settings": {
      "automations": [
        {
          "id": "automation_1776517249424",
          "enabled": true,
          "trigger_type": "status_change",
          "trigger_value": "won",
          "action": "duplicate_item",
          "action_config": {
            "funnel_id": 44,
            "stage": "agendar_instalacao"
          }
        },
        {
          "id": "automation_1776517249425",
          "enabled": true,
          "trigger_type": "card_created",
          "trigger_value": "card_created",
          "action": "apply_checklist_template",
          "action_config": {
            "template_id": "ct-onboarding-001"
          }
        }
      ]
    }
  }
}
```

**Triggers (`trigger_type` + `trigger_value` — SEMPRE preencher os dois):**

| trigger_type | trigger_value |
|---|---|
| `card_created` | `"card_created"` (literal — NUNCA vazio) |
| `status_change` | `"won"`, `"lost"` ou `"snoozed"` (desde 11/10/2026: roda quando o card é ADIADO; trocar a data de um card já adiado NÃO roda de novo). NÃO existe `"open"` aqui |
| `stage_moved` | chave da etapa de DESTINO no hash `funnel.stages` (ex. `"agendar_instalacao"` — a chave, NÃO o campo `id` interno) |

**Ações (`action` + `action_config`):**

| action | action_config | Observação |
|---|---|---|
| `move_to_stage` | `{stage}` | NUNCA executa com trigger `stage_moved` (anti-loop do backend) |
| `assign_agent` | `{agent_id}` | Agente precisa ter acesso ao funil, senão é ignorado. **Não use com gatilho `won`/`lost`**: a automação roda com o card já fechado e card fechado não aceita responsável novo — não faz nada (a tela não oferece mais desde 22/10) |
| `create_note` | `{note_text}` | Cria nota no card com autor "Sistema" |
| `notify_team` | `{message}` | HOJE só registra em log interno — não notifica ninguém de verdade. **Não use** (a tela não oferece mais desde 22/10) |
| `duplicate_item` | `{funnel_id, stage}` | Cria cópia noutro funil/etapa; título ganha sufixo "(cópia)" |
| `send_webhook` | `{webhook_url}` | POST com payload completo do card (fire-and-forget) |
| `apply_checklist_template` | `{template_id}` | Template de `kanban_config.checklist_templates`; aditivo (appenda) — cada aplicação vira um grupo (carimba `group_id`/`group_name` nos itens) |
| `update_checklist` | `{checklist_updates: [{checklist_item_id, completed, text}]}` | Não aparece na UI — só via API |
| `create_task` (20/10/2026) | `{title, description?, task_type, agenda_id?, priority?, occupies_agenda?, duration_minutes?, due: {amount, unit: 'hours'\|'days', at?: 'HH:MM', business_days?: true}, responsible: {mode: 'card_owner'\|'fixed'\|'funnel_rotation'\|'team_rotation', fallback_user_id (card_owner), user_id (fixed), team_id (team_rotation)}}` | Cria uma tarefa COMUM da Agenda presa ao card (ver "Tarefa automática do card" abaixo). Exige a Agenda unificada ligada na conta |

**Regras críticas (gravar diferente disso = automação perdida ou morta):**

- `trigger_value` vazio ou `enabled: false` → a UI DESCARTA a automação no próximo "Salvar" do usuário. Nunca grave automação desabilitada "pra ativar depois".
- Nomes de trigger/action fora das tabelas acima (ex.: `status_changed`, `duplicate_to_funnel`, `send_message`, `set_priority` — NÃO existem) são salvos mas NUNCA disparam, sem erro nenhum.
- `id` no formato `automation_<timestamp_ms>` — a UI usa pra editar/remover a automação.
- Trigger `card_created` + ação `duplicate_item` funciona (backend tem anti-loop), mas a UI esconde essa combinação.
- **A ordem da lista `automations` é a ordem de execução**: quando várias regras disparam no mesmo acontecimento (ex.:
  duas em `won`), elas rodam de cima para baixo. Para mudar a ordem, reenvie a lista inteira na ordem desejada (no
  painel, desde 22/10, a pessoa segura e arrasta cada regra). Mudar a ordem não mexe na configuração de nenhuma regra.
- `assign_agent` com `status_change` `won`/`lost` e `notify_team` são aceitos pelo servidor mas **não fazem nada**: não
  grave regras novas com eles. Regra antiga que já os tenha aparece no painel com um aviso amarelo.

Use para: "ao ganhar um card de Vendas → criar automaticamente em Pós-Venda na etapa Agendar Instalação" (`status_change`/`won` + `duplicate_item`).

#### Tarefa automática do card — ação `create_task` (20/10/2026)

- `title` é obrigatório (texto; aceita variáveis do card). `task_type`: um dos 7 de fábrica ou um tipo ativo da conta.
  `agenda_id` nulo = a agenda padrão da conta. `priority`: `none|low|medium|high|urgent`.
- **Prazo (`due`)**: `unit: 'hours'` aceita `amount` de 1 a 720; `unit: 'days'` aceita 0 a 365, com `at` ("HH:MM") e
  `business_days: true` (dias úteis) **só em dias**. Dia útil = segunda a sexta **sem feriado de dia inteiro** da agenda
  da tarefa (feriado de meio período não conta). O fuso é o da agenda da tarefa. Prazo que já passou nasce atrasado,
  nunca é empurrado.
- **Duração**: `duration_minutes` (22/10/2026): minutos que a tarefa ocupa, inteiro de 1 a 1440; ausente ou `null` = o tempo do TIPO (Tarefa/Follow-up/Prazo 15, Ligação/Personalizado 30, Reunião/Call 60, tipo criado pela conta 30). Com `occupies_agenda: true` o horário ocupado vai do prazo até o fim da duração.
- **Responsável (`responsible.mode`)**: `card_owner` (primeiro responsável do card; senão o da conversa; senão a reserva `fallback_user_id`,
  obrigatória), `fixed` (exige `user_id`), `funnel_rotation` (rodízio de quem acessa o funil) e `team_rotation` (exige
  `team_id`).
- **Formato conferido no Salvar**: regra `create_task` NOVA ou alterada é conferida uma a uma; regra torta recebe 422 que
  diz a posição da regra e o campo a consertar, e as demais regras do funil não são afetadas.
- **Uma tarefa por acontecimento** (repetir o gatilho do mesmo acontecimento não duplica). Card importado por planilha
  não cria; card importado e movido depois por uma pessoa cria.
- A tarefa nasce **presa ao card** (campo `kanban_item_id` da tarefa; `occupies_agenda` diz se ela bloqueia o horário).
  Ao **excluir o card** (`lionchat_kanban_items_destroy`), só é apagada a tarefa presa a ESTE card que seja
  SIMPLES: sem conversa, sem contato, sem agendamento, sem sessão de programa, sem anexo, que não veio do Google
  Agenda e que não é somente leitura. Toda outra tarefa presa ao card apenas se SOLTA (continua na agenda, na
  conversa e no contato), e a tarefa que só aponta para o card por `linked_kanban_item_id` também só se solta.
  **A tarefa AUTOMÁTICA de um card que TEM conversa grava a conversa** (o servidor associa a conversa do card à
  tarefa), portanto NÃO é "simples": ao excluir esse card ela sobrevive e fica na conversa. Só a tarefa automática
  de card SEM conversa morre com o card. Conversa e contato nunca são apagados. Antes de excluir, avise o usuário
  de que as tarefas simples presas ao card também somem.
- Excluir etapa com `remove_stage` **não** dispara esta ação (nem nenhuma outra); `migrate_stage` dispara.

### Sistema 2: AutomationRule global — eventos da conta

`AutomationRule` é o motor geral da conta (mensagens, contatos, conversas, e também eventos Kanban). Bem mais genérico, com sistema completo de condições/ações.

Eventos Kanban: `kanban_item_created`, `kanban_item_moved`, `kanban_item_stage_changed`.

```json
{
  "event_name": "kanban_item_moved",
  "conditions": [
    {"attribute_key": "funnel_stage", "operator": "equal_to", "value": "ganho"}
  ],
  "actions": [
    {"action_name": "send_message", "params": ["Parabéns pelo fechamento!"]},
    {"action_name": "add_label", "params": ["cliente-pagante"]}
  ]
}
```

Use para: ações cross-cutting que envolvem conversa/contato/label, ou regras complexas com múltiplas condições.

### Qual usar?

| Cenário | Sistema |
|---|---|
| Mover/duplicar card entre funis | **Sistema 1** (`funnel.settings.automations`) |
| Aplicar template de checklist em card novo | **Sistema 1** |
| Enviar mensagem ao mover pra etapa | Qualquer um — Sistema 2 é mais flexível |
| Aplicar label no contato baseado em mudança no card | **Sistema 2** |
| Ação envolvendo conversa | **Sistema 2** |

## Bulk operations

- `POST /api/v1/accounts/{account_id}/bulk_actions` — operações em massa (mover, atribuir, arquivar) — `lionchat_kanban_bulk_bulk_actions`
- `POST /api/v1/accounts/{account_id}/kanban_items/import` — importar planilha de cards (só pela tela: exige o arquivo)
- `GET /api/v1/accounts/{account_id}/kanban_items/export` — exportar funil completo — `lionchat_kanban_items_export`

### Importar cards com campos personalizados (2026-10-23)

A importação de cards (Kanban > botão azul **+** > **Importar itens**) liga colunas da planilha a **campos do card** e a
**atributos do contato**, no mesmo formato da importação de contatos. O conector não sobe o arquivo, então oriente a
pessoa a importar pela tela; o que segue serve para explicar o que ela vai ver e para ler o resultado.

- **O que pode ser importado** vem da prévia (`lionchat_kanban_items_create_3`, campo `attribute_fields`): campos do card
  da conta (sem nome protegido nem secreto; dois campos com o mesmo nome = vale o primeiro) e atributos do contato (sem os
  do sistema — rastreio, identificadores do WhatsApp — nem secretos). **Atributos do contato só aparecem para quem também
  pode importar contatos** (administrador ou cargo "Exportar e importar contatos").
- **Como o card grava** (`item_details.custom_attributes`, nasce com o card): data `DD/MM/AAAA` ou `DD/MM/AA` vira
  `AAAA-MM-DD`; número com ou sem milhar (`1.500`, `1.234,56`) vira texto (`"1500"`); hora vira `HH:MM`; campo de LISTA
  aceita várias opções na mesma célula separadas por `;` e só grava opção que existe. Os demais tipos gravam o texto como
  está na planilha.
- **Contato**: mesma conversão da importação de contatos. Vai só para o **contato principal do card** (numa linha com
  vários contatos). Contato novo nasce com os atributos; contato que **já existe** tem o valor **substituído** — conta como
  alteração (fluxo "Atributo do contato muda", webhook `contact_updated`). Célula vazia nunca apaga.
- **Resultado** (`lionchat_kanban_items_import_status`): `attributes_applied: true` confirma que os campos foram aplicados;
  `skipped` lista os valores que **não** entraram (`row`, `field`, `message`) e `skipped_count` dá o total. O card nasce
  do mesmo jeito — só aquele valor fica de fora (formato que não converte, opção fora da lista, texto longo demais, ou
  linha sem telefone válido, que não tem contato para receber o atributo). `row` é a linha da planilha (cabeçalho = 1).
- **Armadilhas**: `422` = escolha de campo com formato errado, campo que não existe mais/é do sistema, ou coluna que a
  planilha não tem (a mensagem lista quais); `403` = atributo de contato sem a permissão de importar contatos. Sem
  `attributes_applied` no resultado de uma importação que ligou campos = o servidor estava sendo atualizado e os cards
  nasceram sem eles (preencher nos cards, ou excluir e importar de novo — reimportar cria cards novos).

## Custom attributes em cards — TRÊS LUGARES POSSÍVEIS

Cada card pode receber atributos custom de 3 origens diferentes. **A escolha do lugar muda completamente o resultado:**

### 1. `item_details.custom_attributes` (o VALOR de cada campo, dentro do card)

```json
[
  {"name": "Origem do Lead", "type": "string", "value": "Google Ads"},
  {"name": "Score", "type": "number", "value": 85}
]
```

- É o que a aba **Campos** do card mostra e edita (e o que o filtro do quadro, a busca e o fluxo leem)
- LISTA de `{name, type, value}`; `name` + `type` precisam bater com um campo do item 2 abaixo, senão o
  valor fica gravado e **não aparece**
- Grava via `kanban_items_update` em `kanban_item.item_details.custom_attributes` — a lista enviada
  **substitui a inteira** (leia o card antes e reenvie tudo). Objeto `{chave: valor}` no lugar da lista
  **apaga** os campos do card
- Um campo só, sem reenviar a lista: ação `update_card_attribute` da automação/macro

> **NÃO confundir com a coluna `kanban_item.custom_attributes`** (objeto `{chave: valor}` direto no card):
> nenhuma tela a mostra — nem a aba Campos, nem o filtro, nem a busca. Só a ação "Alterar atributo do card"
> do FlowBuilder e a leitura do fluxo a usam. Para o cliente ver o dado, use a lista acima.

### 2. `kanban_config.global_custom_attributes` (atributos globais do Kanban)

```json
[
  {"name": "Origem do Lead", "type": "string", "is_list": true, "list_values": ["Google", "Meta", "Indicação"]},
  {"name": "Score", "type": "number", "is_list": false}
]
```

- Definido no `kanban_config` da conta (`lionchat_kanban_config_update`) — é a DEFINIÇÃO; o valor de cada
  card mora no item 1
- Aparece em TODOS os cards de TODOS os funis (aba Campos do card)
- Tipos que a tela cria: `string` (texto), `number`, `date`, `boolean`; lista de opções = `is_list: true` +
  `list_values`
- A lista enviada **substitui a inteira** — campo que não vier some da aba de todos os cards. Leia antes com
  `lionchat_kanban_config_list`
- **Não confundir com `funnel.global_custom_attributes`** (coluna do funil): nenhuma tela lê aquele campo
- Use para: atributos que TODO card precisa ter

### 3. `custom_attribute_definitions` (atributos globais de contato/conversa)

```json
{
  "attribute_display_name": "CPF",
  "attribute_display_type": "text",
  "attribute_model": "contact_attribute"
}
```

- Definido via `POST /api/v1/accounts/{id}/custom_attribute_definitions`
- `attribute_model` = `contact_attribute` (na ficha do contato) ou `conversation_attribute` (na conversa)
- Aparece na sidebar de TODA conversa (independente de Kanban)
- Use para: cadastro do contato (CPF, CNPJ, endereço) ou atributos por conversa que NÃO são específicos de card

### Não confunda com Motivos / Templates / Funnel Settings

| Quero | NÃO use isso | Use isso |
|---|---|---|
| Motivos de Ganho/Perda | custom_attribute em qualquer lugar | **`kanban_config.win_reasons` / `loss_reasons`** (NATIVO) |
| Checklist reusável de card | custom_attribute em jsonb | **`kanban_config.checklist_templates`** |
| Automação ao ganhar | custom_attribute | **`funnel.settings.automations`** (Sistema 1) |

## Métricas úteis (via GET /api/v2/kanban/items)

- Tempo médio em cada etapa: `stage_entered_at` vs agora
- Taxa de conversão: cards em "ganho" vs total criado no período
- Pipeline ativo: soma de `value` em etapas != ganho/perdido
- Velocity: cards movidos pra "ganho" por mês

## Diagnóstico: "Card sumiu do funil"

1. Está arquivado? `archived = true` em algum nível?
2. Etapa atual existe ainda? Desde 19/08/2026 card em etapa inexistente é redirecionado na
   gravação (e os 621 antigos foram movidos pra primeira etapa) — se ainda sumiu, filtre por
   `funnel_stage` com o slug que aparece em `kanban_items_show` e compare com `funnels_show`.
3. `position` está faltando? (cards sem position vão pro fim)
4. Está em outro funil? (mover entre funis muda `funnel_id`)
5. Está **adiado**? (desde 11/10/2026) Card adiado sai da coluna e só aparece com o botão **Adiados** ligado no topo
   do quadro. Confira `effective_status`/`snoozed_until` em `lionchat_kanban_items_show`: ele volta sozinho na data, ou
   abra agora com `lionchat_kanban_items_unsnooze`. Ver "Card adiado" abaixo.

## Diagnóstico: "Valor do pipeline errado"

1. Algum card sem `item_details.value`?
2. Cards arquivados estão sendo contados?
3. Etapas "ganho"/"perdido" estão incluídas no cálculo?

## Conciliação de vendas — "Importar vendas" (2026-09-24)

O problema que ela resolve: **vendedor não marca a venda certa no card**. Aí o relatório de faturamento
mente — ou porque o card ficou aberto, ou porque o valor do card não é o valor que o cliente pagou.

A planilha do financeiro (ou de outro sistema) entra e:

| Situação do card no funil | O que acontece |
|---|---|
| Card **aberto** (mais antigo, se houver vários) | Grava o valor e marca **ganho com a DATA DA VENDA** |
| Card **já ganho** | Atualiza **só o valor**; a data do ganho dele **não muda** |
| Card marcado como **perdido** | **Não é tocado** — vai pra conferência humana |
| **Sem card nenhum** | Cria card já ganho (só se `criar_sem_card: true`) |
| Linha com telefone sem DDI, valor ilegível ou data no futuro | Vira **erro da linha**, com motivo |

### Ferramentas

1. `lionchat_kanban_sales_reconciliation_preview` — **confere e não grava nada**. Chame SEMPRE antes.
2. `lionchat_kanban_sales_reconciliation_apply` — aplica em segundo plano, devolve `run_id`.
3. `lionchat_kanban_sales_reconciliation_status` — acompanha até `completed`/`failed`.

O MCP **não sobe arquivo**: as linhas vão em `rows` (lista de objetos). Se a pessoa anexar uma planilha
na conversa, LEIA o arquivo, monte as linhas em JSON e chame a ferramenta — não peça pra ela converter.
Quem tem CSV/Excel e prefere a tela usa Kanban > botão azul **+** > **Importar vendas**, que lê o
arquivo, aponta as colunas e ainda oferece uma planilha de exemplo pra baixar.

### Formato de cada linha de `rows`

| Campo | Obrigatório | Como mandar |
|---|---|---|
| `phone` | sim | Com o código do país: `5511999887766` |
| `value` | sim | `1500`, `"1500,00"`, `"R$ 1.500,00"` ou `"1,500.00"` |
| `sale_date` | sim | `"01/08/2026"` ou `"2026-08-01"` — o dia em que a venda aconteceu |
| `name` | não | Nome do cliente (usado no título do card novo) |
| `email` | não | |
| `agent` | não | Nome ou e-mail do vendedor |
| `order_id` | não | Número do pedido, guardado no card |

### O que você PRECISA saber antes de aplicar

- **O telefone tem que vir com o código do país** (`5511999887766`). O sistema **não** completa o 55 —
  linha sem DDI é recusada com motivo. Celular antigo sem o nono dígito é encontrado do mesmo jeito.
- **A data da venda é o ponto da funcionalidade.** É ela que faz a venda contar no mês certo do
  relatório. Sem data, a linha é recusada — nunca vira "hoje" em silêncio.
- **A conciliação não dispara conversão por conta própria.** Quem dispara é o caminho normal do ganho
  (Meta/GA4/Google Ads), e só nos funis com o evento de Ganho configurado. Por isso rodar a mesma
  planilha duas vezes não reenvia conversão: o identificador do evento de ganho é estável.
- **Rodar a mesma planilha duas vezes é seguro**: card já com aquele valor volta como `sem_mudanca` e
  nem é gravado.
- **`criar_sem_card: true` abre uma CONVERSA nova por card criado**, e conversa nova acorda o que a conta
  tiver em "Conversa criada" (automação, fluxo, notificação). Avise a pessoa antes de ligar isso numa
  planilha grande.
- **Automação de funil que duplica o card no ganho continua rodando** (é um dos dois motores de
  automação, ver a seção acima). A conferência conta quantos cards de pós-venda vão nascer.
- **O vendedor da planilha só entra em card SEM responsável** — nunca troca quem já está lá.
- **Porta:** administrador ou cargo com "importar e exportar cards".

### Diagnóstico: "a venda entrou no mês errado"

Olhe `item_details.status_changed_at` do card: ele é comparado como **texto** contra a janela do
relatório, e tem que terminar em `Z`. `2026-08-01T03:00:00Z` é 1º de agosto em Brasília; gravar
`2026-08-01T00:00:00Z` joga a venda pra julho.

---

## Lançamento retroativo — marcar ganho/perda com data passada (2026-09-25)

Serve para o caso do dia a dia: o negócio fechou semanas atrás e só agora alguém registra. Sem isso, o
relatório contaria a venda no mês em que o registro foi feito, não no mês em que ela aconteceu.

Na tela: ao marcar **Ganho** ou **Perdido** aparece a chavinha **"Lançamento retroativo"**; ligando, abre
um campo de data. Pela API/MCP é a chave `retroativo_em` dentro de `item_details`, no
`lionchat_kanban_items_update`:

```json
{ "item_details": { "status": "won", "win_reason": "indicacao", "retroativo_em": "2026-08-05" } }
```

| Regra | Detalhe |
|---|---|
| Quando vale | SÓ junto de um `status` `won`/`lost` que **muda** o status. Card que já está ganho ignora a data. |
| O que ela faz | Decide o carimbo `item_details.status_changed_at` — o que TODOS os relatórios contam. |
| O que ela NÃO faz | **Não é gravada no card.** Não muda conversão para Meta/GA4/Google Ads: essas continuam saindo com a data de hoje. |
| Data futura ou ilegível | Recusada com **422** (a regra vive no servidor, não na tela — API e MCP passam por ela). |
| Data anterior à criação do card | Permitida. |
| Só no atualizar | No `lionchat_kanban_items_create` a chave é **descartada**. Para importar venda antiga já fechada, use a Conciliação de vendas (seção acima), que foi feita para isso. |

**Corrigir uma data lançada errado:** marcar `won` de novo por cima **não muda nada** (o carimbo só é
escrito quando o status muda). Mande `status: "open"` — isso apaga o carimbo — e depois `won`/`lost`
com o `retroativo_em` certo.

A hora é montada em **UTC**, com o horário atual no dia escolhido. É o mesmo motivo do diagnóstico
acima: o relatório compara o carimbo como texto, então a data escolhida tem que ser a data contada.

## Card adiado — "Adiar até" (2026-10-11)

O card ganha uma situação a mais: **Adiado** — "este negócio só volta a importar no dia X". Ele sai da coluna e, na
data marcada, **abre sozinho** e volta para a coluna (disparando o fluxo "Card aberto", se houver).

| Regra | Detalhe |
|---|---|
| O que é | Situação **do card**, não da conversa. Mensagem do cliente NÃO abre o card; adiar o card não mexe na conversa. |
| Como fica gravado | `item_details.status` **continua `open`** — o adiamento mora numa tabela à parte (`kanban_item_snoozes`). Por isso o aplicativo de celular, os webhooks do cliente e a IA de atendimento continuam vendo `open`/`won`/`lost`. Para saber se está adiado, leia `effective_status` (`snoozed`) e `snoozed_until`. |
| Quem pode | Quem pode editar o card. Só card **aberto** pode ser adiado (ganho/perdido = 422). |
| Data | Pelo menos **1 hora** à frente (menos que isso = 422). Sem prazo máximo. Adiar um card já adiado **troca a data**. |
| O que NÃO encerra | Mover de etapa ou de funil, editar, nota, tarefa, responsável. |
| O que encerra | Marcar **ganho** ou **perdido** (por qualquer caminho); **abrir** de propósito (`lionchat_kanban_items_unsnooze`, `lionchat_kanban_items_create_2` com `status: "open"`, ação "Aberto" de automação/macro/fluxo); e a chegada da data. |
| `status: "open"` no `lionchat_kanban_items_update` | **NÃO abre** card adiado (é o mesmo salvar que o aplicativo faz o tempo todo). Para abrir, use `lionchat_kanban_items_unsnooze` ou o `change_status`. |
| Na data | O sistema abre o card numa rodada de até ~5 minutos depois da hora e dispara "Card aberto" **uma vez por card**. Esse fluxo entra na fila de disparos agendados: depois dos lembretes de consulta e, em caixa QR Code, no ritmo da caixa (um lote grande que vence junto sai aos poucos). |
| "Criar card" acha um adiado | Trata como card que **já existe**: não cria outro, move se a etapa for diferente e **não muda a situação** (continua adiado). Vale para automação, macro, fluxo e IA. |

**Ferramentas:**
- `lionchat_kanban_items_snooze` — `POST .../kanban_items/{id}/snooze` com `snoozed_until`.
- `lionchat_kanban_items_unsnooze` — `DELETE .../kanban_items/{id}/snooze` (abre agora e dispara "Card aberto").
- Automações de dentro do funil (`settings.automations`): gatilho `status_change` com `trigger_value: "snoozed"`
  ("Adiado" na tela do funil) roda quando o card passa de aberto para adiado.
- Automação e macro: ação `snooze_kanban_item` — `[{"funnel_id": 31, "amount": 3, "unit": "days"}]` (`unit` `hours`
  ou `days`; `amount` inteiro, 1 ou mais). Em regra de evento de CARD basta `[{"amount": 3, "unit": "days"}]` (o card
  é o do evento). Diferente das outras ações de card, ela **falha visível** quando não dá para adiar (card fechado,
  sem card no funil, tempo inválido) — nunca passa verde sem adiar.
- Fluxo: ação `snooze_kanban_item`, gatilhos `card_opened` ("Card aberto") e `card_snoozed` ("Card adiado") e
  condição `kanban_snoozed`. Ver o resource do FlowBuilder.
- Fluxo, **card parado (NOVO 28/10/2026)**: gatilhos de prazo `card_open_in_stage` ("Card aberto na etapa") e
  `card_open_in_funnel` ("Card aberto no funil"). Config `{ "funnel_ids": ["12"], "funnel_stages": ["12:novo_lead"],
  "duration_value": 1, "duration_unit": "hours" }` (`funnel_stages` só na etapa; vazio = qualquer funil/etapa;
  `minutes`|`hours`|`days`, de 15 minutos a 365 dias). Relógio da etapa = tempo desde que o card ENTROU na etapa atual
  (o segundo número "1d" do card; trocar de funil também recomeça); do funil = idade do card (o primeiro número "2d";
  trocar de funil não recomeça). Conta card aberto ou adiado, nunca ganho/perdido. Dispara uma vez por entrada na etapa
  (etapa) ou uma vez por card (funil), só para quem cruza o prazo com o fluxo ligado (card que já passou do prazo ao ligar
  não dispara; mudar prazo/etapa/funil do gatilho = gatilho novo). Conferência de 5 em 5 minutos (pode chegar ~5 min
  depois). Inicia só o fluxo dono do gatilho, em cada conversa do card; o card que disparou é o "card do gatilho"
  (`card_source: 'trigger'`, condições "Card na etapa" e "Card adiado"). Dois fluxos iguais na mesma caixa disparam os dois.

**Onde o adiado aparece e como filtrar:**

| Lugar | Comportamento |
|---|---|
| Quadro (`lionchat_kanban_items_list`) | Sem nenhum `show_*`, a lista traz TODAS as situações (o adiado vem com `status: "open"` e `effective_status: "snoozed"`). Com qualquer `show_*`: `show_open` vale `true` salvo se vier `"false"` (= aberto e **não** adiado) e `show_snoozed=true` inclui os adiados. **Só os adiados:** `show_snoozed=true` **e** `show_open=false`. Esta lista **ignora** `statuses`. |
| Filtro rico (`lionchat_kanban_items_filter`), exportação e relatório da etapa | `statuses: ["open"]` = aberto e **não** adiado; `statuses: ["snoozed"]` = adiados. |
| Ficha do contato (`lionchat_contacts_kanban_items_list`) | `status=snoozed` = adiados; `status=open` deixa os adiados de fora. |
| Busca geral (`lionchat_search_kanban_items`) | `kanban_filters` com `statuses: ["snoozed"]`. |
| Números | `lionchat_funnels_open_counts` conta aberto e **não** adiado. `lionchat_funnels_stage_report` traz a linha `snoozed` — mas esse relatório SEMPRE aplica os botões de situação com o padrão da tela: sem `show_*` conta só os abertos não adiados e as linhas `won`/`lost`/`snoozed` voltam zeradas (mande `show_won`/`show_lost`/`show_snoozed=true`). No relatório agregado (`lionchat_kanban_items_list_3`), `statusDistribution.open` **continua incluindo** os adiados (é a soma que o aplicativo lê) e `statusDistribution.snoozed` vem ao lado: abertos de verdade = `open − snoozed`. Parados, maiores negócios, ranking e previsão já deixam o adiado de fora. |
| Histórico do card | `item_snoozed` (com a data) e `item_unsnoozed` (com o motivo). |

**Laço de cadência é permitido:** um fluxo "Card aberto" que manda mensagem e adia de novo roda até alguém parar (no
máximo uma volta por hora por card). Avise o cliente antes de montar. **Abrir à mão também dispara "Card aberto"**: se o
fluxo manda mensagem, o cliente recebe na hora.

## Co-participante da venda (vendedor + SDR) — 2026-10-13

No ganho, além do vendedor (`attributed_to`, "Atribuir ganho a"), dá para marcar **UM co-participante** — ex.: o SDR
que trouxe a venda. A venda conta INTEIRA para o vendedor; o co-participante tem números próprios no relatório.
Marcar alguém como co-participante **não dá acesso ao card** nem o põe como responsável.

**Como gravar:**
- Junto com o ganho: `lionchat_kanban_items_create_2` (`change_status`) com `status: "won"` e `co_attributed_to: <id do
  agente>`. Fora de `won` o parâmetro é ignorado.
- Depois, num card JÁ ganho: `lionchat_kanban_items_update` com `kanban_item.item_details.co_attributed_to`. Para tirar,
  mande `null`.
- Mande SÓ o id (número). O nome (`co_attributed_name`) o próprio card preenche — nunca envie.
- Objeto ou lista no lugar do id = 422 antes de gravar.

**Recusas (422, com `error` legível):** id que não é número; pessoa que não é membro da conta; o próprio vendedor do
card; pessoa sem acesso ao funil (vale: funil sem lista de agentes, agente da lista do funil ou dos times dele,
administrador, ou quem já é responsável do card). A conferência só roda quando o valor MUDA — quem perdeu o acesso
depois não trava outro salvamento.

**O que mais saber:**
- Reabrir ou marcar como perdido **apaga** o co-participante (o campo só existe em card ganho).
- A ação "marcar como ganho" de fluxo, automação e macro NÃO marca co-participante (decisão do dono): ganho por ação
  nasce sem ele, que entra depois pela tela, por `lionchat_kanban_items_update` ou pela planilha de "Importar vendas"
  (coluna de co-participante, por nome ou e-mail).
- Duplicar o card não copia o co-participante.
- Histórico: marcado junto com o ganho vai dentro do registro da mudança de status; marcado depois gera
  `co_participant_changed` (antes e depois, com nome e quem marcou).
- Números: `coParticipantRanking`, `sharedSalesSummary`/`sharedSalesBySeller` (com `include_shared_sales=true`) no
  relatório agregado e a lista `lionchat_kanban_items_shared_sales` — ver `lionchat://docs/filtros-e-relatorios` §4.

---

## Analisar com IA — a IA sugere o que mudar nos cards (2026-10-28)

A mesma análise do botão **Analisar com IA** do Kanban (topo do quadro e menu da coluna). A IA lê os cards **abertos e
adiados** das etapas escolhidas de UM funil, com as conversas deles, e sugere: mudar de etapa (também para trás), levar
para outro funil, pôr/tirar etiqueta e marcar ganho/perdido. **Nada muda sem aplicar, e aplicar não tem como desfazer.**

### Ferramentas

1. `lionchat_kanban_ai_analyses_setup` — o que a janela mostra: etapas com a contagem de cards, se cada etapa e o funil
   têm descrição, `selection` (quantos cards entram e `estimated_cost_usd`), funis de destino, etiquetas, motivos de
   ganho/perda, `has_openai_key` e `latest_run` (análise viva do funil).
2. `lionchat_kanban_ai_analyses_create` — cria a análise. Os cards são escolhidos AQUI: até `filters.limit` (1 a 1.000,
   padrão 200), os parados há mais tempo, PULANDO os que a IA leu nos últimos 7 dias (a não ser que o cliente tenha
   escrito depois); `filters.include_read: true` lê de novo os já lidos.
3. `lionchat_kanban_ai_analyses_show` — andamento (`status`, contadores, custo).
4. `lionchat_kanban_ai_analyses_items` — a lista de sugestões (só depois de `ready`). Com `no_change: true` traz também
   `no_change_items`: os cards que a IA leu e deixou como estão, cada um com `lines` dizendo o porquê.
5. `lionchat_kanban_ai_analyses_apply` — aplica o que o usuário escolheu. Pede `confirm: true`.
6. `lionchat_kanban_ai_analyses_reanalyze` — analisa de novo UM card cuja linha travou.

### Passo a passo

1. `setup` com `funnel_id` (e `stages` para saber o total e o custo). Mostre ao usuário as etapas e quantos cards cada
   uma tem. Dica: marcar VÁRIAS etapas numa análise só evita ler a mesma conversa duas vezes.
2. Pergunte o que a IA pode fazer (`options`), quais cards (todos, `stale_days` ou `no_reply_days`) e QUANTOS
   (`filters.limit`, 1 a 1.000; mostre o `estimated_cost_usd` e o `estimated_minutes` do `setup` com o mesmo número). Se o
   `setup` disser `already_read` > 0, avise que esses serão pulados; para repetir nos mesmos cards, `include_read: true`.
3. `create`. Depois chame `show` a cada 5 a 10 segundos até `status = ready` (ou `failed`, com `error_code`).
4. `items`: mostre as sugestões agrupadas por etapa — card, ação, força ("Alta" >= 70%, "Média" 50-70%), motivo e o que
   a ação dispara (`hints`: conversão, regras do funil, fluxos; aviso de WhatsApp QR).
5. **Antes de aplicar, confirme com o usuário** quais cards e ações, quantas mudanças em quantos cards, e diga que **não
   tem como desfazer**: fica como se uma pessoa tivesse feito à mão, e automações, fluxos e conversões do funil disparam.
6. `apply` com `items: [{ item_id, actions: [ids] }]` e `confirm: true`. Os `actions` são os `id` das `suggestions`
   daquele item (`stage`, `funnel`, `outcome`, `label_add:...`, `label_remove:...`) — nunca invente: ação que não foi
   sugerida para o item volta em `ignored`.
7. `show` até `status = finished`; `items` traz `done`, `apply_code` e `return_code` de cada card.
8. **"Por que a IA não mudou nada?"** — chame `items` com `no_change: true` e explique pelos `no_change_items[].lines`:
   `kind` (`stage`, `funnel`, `outcome`, `label`) + `state`: `same` = confirmou o que já está (com `confidence` em %),
   `doubt` = as duas ordens discordaram (`value` x `other_value`), `weak` = pensou em `value` mas abaixo de 50%,
   `other_funnel` = achou que o card é de outro funil (anulou a etapa), `not_chosen` = sugeriu um funil que não estava
   entre os destinos, `add_no` / `remove_keeps` = etiqueta com a chance (`probability`). `lines: null` = análise antiga,
   sem detalhes.

### Regras que você PRECISA saber

- **Quem pode:** administrador ou cargo com a permissão `kanban_ai_analyze` ("Analisar funil com IA"), com o recurso de
  plano `kanban_ai_analysis` ligado na conta e o menu do Kanban visível. Funil que a pessoa não vê = 404
  `funnel_not_visible`. Sem o recurso = `feature_disabled`.
- **Custo:** usa a chave da OpenAI DA CONTA (`no_openai_key` sem ela). Costuma ficar abaixo de um centavo de dólar a cada
  dezenas de cards — mostre o `estimated_cost_usd` do `setup` antes de criar.
- **Uma análise por vez por funil** (`funnel_busy`, 409) e no máximo duas rodando por conta (`account_busy`). Criar uma
  análise nova **substitui a lista anterior** do mesmo funil que tiver etapa em comum (ela vira `superseded`).
- **A lista vale 24 horas** (`expires_at`); depois vira `expired` e é preciso analisar de novo.
- **O que vem marcado** (`checked: true`): sugestões de força Alta de etapa, funil e perdido. Ganho, Média e etiqueta vêm
  sempre desmarcados, com o motivo em `unchecked_reason`. Na dúvida, proponha aplicar só as marcadas.
- **Linha travada** (`locked`: `client_wrote` = o cliente escreveu depois da análise; `card_changed` = o card mudou):
  não aplique. Chame `reanalyze` com o `item_id` e depois `items` de novo.
- **Linha que voltou** (`return_code`): `interrupted` (sistema reiniciou), `card_busy` e `apply_failed` podem ser
  aplicadas de novo; `agent_no_access` (o responsável não acessa o funil de destino) exige dar o acesso antes.
- **"Por que não sugeriu nada?"** A IA só sugere quando responde a mesma coisa com as opções em duas ordens e com pelo
  menos 50% de certeza. Card sem conversa, ou com pouca conversa, costuma ficar como está (`counts.no_change`). Escrever
  a descrição das etapas e do funil melhora o resultado (o `setup` diz quais não têm).
