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

### KanbanConfig (Configuração Global do Kanban) — CRÍTICO

**Tabela separada do Funnel.** 1:1 com a conta. Guarda configurações que valem pra TODOS os funis. Tem 5 campos jsonb importantes:

| Campo | Tipo | O que guarda |
|---|---|---|
| `win_reasons` | jsonb array | **Motivos de Ganho** — `[{id, title}]`. Aparecem como dropdown quando o vendedor marca "Ganho" num card. NATIVO. NÃO usar custom_attribute. |
| `loss_reasons` | jsonb array | **Motivos de Perda** — mesma estrutura. Aparece ao marcar "Descartado". |
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

**GOTCHA — body precisa estar wrapped:**

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

Se mandar `{"win_reasons": [...]}` direto (sem o wrapper `kanban_config`) → **HTTP 500 silencioso**. Strong params do Rails exige `params.require(:kanban_config)`.

**`win_reasons` e `loss_reasons` aceitam array de OBJETOS `{id, title}`, NÃO strings simples.** Strings causam 500. O `id` é qualquer string única (UUID ou slug curto tipo `wr-1`).

**Substituição vs merge:** quando você envia `win_reasons`, a lista inteira é substituída. Pra preservar, leia primeiro com GET e mande a lista completa.

#### ⚠️ Quando NÃO criar como custom_attribute

| Quero | Use | NÃO use |
|---|---|---|
| Motivo de Ganho/Perda no card | `kanban_config.win_reasons` / `loss_reasons` | ❌ custom_attribute em conversation/contact |
| Atributo que aparece em TODO card | `kanban_config.global_custom_attributes` | ❌ custom_attribute de conversation |
| Atributo só de um contato (CPF, endereço) | `custom_attribute_definitions` model=contact_attribute | ❌ kanban_config |
| Atributo só de uma conversa (motivo, tag interna) | `custom_attribute_definitions` model=conversation_attribute | ❌ kanban_config |
| Atributo só de um card | `kanban_item.custom_attributes` (jsonb direto no card) | — |

### KanbanItem (Card)
Um card individual dentro de uma etapa.

| Campo | Descrição |
|---|---|
| `id` | Identificador |
| `funnel_id` | Funil ao qual pertence |
| `funnel_stage` | Chave da etapa (ex: `"novo_lead"`) |
| `position` | Ordem dentro da etapa |
| `stage_entered_at` | Quando entrou na etapa atual (pra métrica de tempo) |
| `conversation_display_id` | Conversa principal vinculada |
| `linked_conversations` | jsonb array `[{display_id: 123}, {display_id: 456}]` — múltiplas conversas |
| `item_details` | jsonb (ver abaixo) |
| `custom_attributes` | jsonb — campos custom (igual contatos) |
| `assigned_agents` | jsonb array de agentes responsáveis |
| `activities` | jsonb array — log de atividades |
| `checklist` | jsonb array de tarefas dentro do card (item: `text`/`completed`/`position` + `group_id`/`group_name` opcionais para agrupar) |
| `timer_started_at`, `timer_duration` | Timer interno do card |

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
  "custom_attributes": {
    "origem_lead": "Facebook Ads"
  }
}
```

**`value`** é onde fica o valor monetário do negócio (usado em pipelines).

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
- o funil está aberto a todos, OU
- a pessoa participa do funil (está em `settings.agents`, OU é membro de um TIME em `settings.teams` — novo 2026-07-21, membros resolvidos ao vivo — ou tem card atribuído)

**Efeitos práticos nas tools:**
- `funnels_list` retorna SÓ os funis visíveis pro usuário do token
- `funnels_show` / `stage_stats` de funil não-visível → **404** (não "lista vazia")
- A resposta dos cards traz selos de permissão calculados no backend:
  `can_edit`, `can_move`, `can_delete`, `can_assign` (booleans)
- `kanban_items_move` sem permissão → **403** com mensagem traduzida (antes dava 500/sucesso falso)
- Cards embutidos na tela da conversa também respeitam a visibilidade

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
- Buscar card por ID ou rodar ação em massa (`kanban_bulk_bulk_actions`, export) numa caixa
  inacessível → **404** (a ação não vaza cards de caixa que o agente não pode ver).

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
| `status_change` | `"won"` ou `"lost"` |
| `stage_moved` | chave da etapa de DESTINO no hash `funnel.stages` (ex. `"agendar_instalacao"` — a chave, NÃO o campo `id` interno) |

**Ações (`action` + `action_config`):**

| action | action_config | Observação |
|---|---|---|
| `move_to_stage` | `{stage}` | NUNCA executa com trigger `stage_moved` (anti-loop do backend) |
| `assign_agent` | `{agent_id}` | Agente precisa ter acesso ao funil, senão é ignorado |
| `create_note` | `{note_text}` | Cria nota no card com autor "Sistema" |
| `notify_team` | `{message}` | HOJE só registra em log interno — não notifica ninguém de verdade |
| `duplicate_item` | `{funnel_id, stage}` | Cria cópia noutro funil/etapa; título ganha sufixo "(cópia)" |
| `send_webhook` | `{webhook_url}` | POST com payload completo do card (fire-and-forget) |
| `apply_checklist_template` | `{template_id}` | Template de `kanban_config.checklist_templates`; aditivo (appenda) — cada aplicação vira um grupo (carimba `group_id`/`group_name` nos itens) |
| `update_checklist` | `{checklist_updates: [{checklist_item_id, completed, text}]}` | Não aparece na UI — só via API |

**Regras críticas (gravar diferente disso = automação perdida ou morta):**

- `trigger_value` vazio ou `enabled: false` → a UI DESCARTA a automação no próximo "Salvar" do usuário. Nunca grave automação desabilitada "pra ativar depois".
- Nomes de trigger/action fora das tabelas acima (ex.: `status_changed`, `duplicate_to_funnel`, `send_message`, `set_priority` — NÃO existem) são salvos mas NUNCA disparam, sem erro nenhum.
- `id` no formato `automation_<timestamp_ms>` — a UI usa pra editar/remover a automação.
- Trigger `card_created` + ação `duplicate_item` funciona (backend tem anti-loop), mas a UI esconde essa combinação.

Use para: "ao ganhar um card de Vendas → criar automaticamente em Pós-Venda na etapa Agendar Instalação" (`status_change`/`won` + `duplicate_item`).

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

- `POST /api/v2/kanban/items/bulk_actions` — operações em massa (mover, atribuir, arquivar)
- `POST /api/v2/kanban/items/import` — importar CSV de cards
- `GET /api/v2/kanban/items/export` — exportar funil completo

## Custom attributes em cards — TRÊS LUGARES POSSÍVEIS

Cada card pode receber atributos custom de 3 origens diferentes. **A escolha do lugar muda completamente o resultado:**

### 1. `kanban_item.custom_attributes` (jsonb direto no card)

```json
{
  "origem_lead": "Google Ads",
  "campanha": "Black Friday 2026",
  "score": 85
}
```

- Vai direto no card via `kanban_items_update`
- Só aparece NESSE card específico
- Sem typing/validação — qualquer chave/valor
- Use para: campos específicos de um card, importação rápida sem cadastro prévio

### 2. `kanban_config.global_custom_attributes` (atributos globais do Kanban)

```json
[
  {"name": "Origem do Lead", "type": "list", "is_list": true, "list_values": ["Google", "Meta", "Indicação"]},
  {"name": "Score", "type": "number", "is_list": false}
]
```

- Definido no `kanban_config` da conta
- Aparece em TODOS os cards de TODOS os funis (na sidebar do card)
- Com tipo (`text`, `number`, `date`, `list`, `boolean`)
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
2. Etapa atual existe ainda? (etapa removida do funil deixa card "órfão")
3. `position` está faltando? (cards sem position vão pro fim)
4. Está em outro funil? (mover entre funis muda `funnel_id`)

## Diagnóstico: "Valor do pipeline errado"

1. Algum card sem `item_details.value`?
2. Cards arquivados estão sendo contados?
3. Etapas "ganho"/"perdido" estão incluídas no cálculo?
