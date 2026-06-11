# FlowBuilder — Guia de Design

Como criar fluxos do LionChat (FlowBuilder) que abrem certinhos no canvas, sem nodes empilhados, sem edges quebradas, sem campos inventados. Consulte sempre que for chamar `flows_create` ou `flows_update`.

---

## 1. Decisão de node — qual usar pra cada caso

| Cliente quer | Use o node | NÃO use |
|---|---|---|
| Mandar mensagem (texto, template WhatsApp, áudio, imagem, lista de botões) | `send_message` | `action` pra mandar mensagem |
| Esperar resposta com opções fixas (1, 2, 3) | `wait_response` com `validation: 'options'` | `condition` depois — o próprio wait_response roteia pelas opções |
| Esperar resposta livre | `wait_response` com `validation: 'any'` | - |
| Validar CPF/email/telefone | `wait_response` com `validation: 'regex'` | `condition` com regex |
| Ramificar por valor de variável/atributo | `condition` | `wait_response` |
| Atribuir agente, time, label, status, prioridade, kanban, captain | `action` com `key` específica | - |
| Chamar API externa | `api` | `action` (não tem chamada HTTP genérica) |
| Esperar X tempo | `wait` | - |
| Esperar "segunda-feira às 9h" | `wait` com `waitUnit: 'weekday'` | `condition` por horário |
| Salvar valor calculado em variável | `set_variable` | `action` |
| Gerar resposta com IA | `ai` mode `generate` | - |
| Extrair info da mensagem (ex: pegar valor numérico) | `ai` mode `extract` | regex no wait_response |
| Classificar intenção da mensagem | `ai` mode `intent` | - |
| Analisar sentimento | `ai` mode `sentiment` | - |
| Encerrar fluxo no meio | `action` com `key: 'deactivate_flow'` OU `exit_conditions` no nível do flow | - |
| Distribuir aleatório entre branches | `randomizer` | - |
| Atualizar info de grupo WhatsApp (WAHA) | `update_group` | - |
| Iniciar outro fluxo | `action` com `key: 'start_flow'` OU node `activate_flow` | - |
| Encerrar ramo / definir retorno de ai_tool | `end` | - |
| Anotação visual no canvas (não executa) | `note` | - |

---

## 2. Schema válido por tipo de node

Todo node tem essa estrutura base:

```json
{
  "id": "uuid-ou-string-unica",
  "type": "<tipo do node>",
  "position": { "x": 0, "y": 0 },
  "data": { "...": "campos específicos do tipo" }
}
```

### 2.1 `start`

```json
{
  "id": "node-start",
  "type": "start",
  "position": { "x": 50, "y": 300 },
  "data": {
    "label": "Início",
    "triggers": [
      { "type": "message_received", "keywords": ["oi", "ola"], "match_type": "contains" }
    ]
  }
}
```

**Triggers válidos:** `message_received`, `conversation_created`, `conversation_resolved`, `conversation_reopened`, `label_added`, `label_removed`, `card_created`, `card_moved`, `cron`, `webhook`.

**Campos de filtro por trigger (IMPORTANTE — nomes exatos):**
- `message_received`: `keywords` (array, obrigatório, cada termo com mín 3 chars) + `match_type` (`'exact'` ou `'contains'`, default `contains`). NÃO use `match_mode` aqui. Dispara em QUALQUER mensagem do cliente que case (não só na primeira) — só mensagem de cliente dispara, nunca de agente.
- `conversation_created` / `conversation_reopened`: filtro opcional de keywords via `match_mode` (`'any'`, `'contains'`, `'exact'`, `'customer_initiated'`, `'agent_initiated'`) + `keywords`. Só ESTES dois triggers usam `match_mode`.
- `label_added` / `label_removed`: `label_names` (array de slugs). NÃO use `label` (singular) — é ignorado.
- `card_created` / `card_moved`: `funnel_ids` (array) + `funnel_stages` (array de `"funnel_id:stage"`).

**Trigger `webhook` — Webhook Universal EMBUTIDO (novo 2026-06):** o flow pode ser disparado por um webhook próprio, criado automaticamente. Receita via API:
1. Criar o flow normalmente (`flows_create`).
2. `POST /custom_webhook_integrations` com `{ "custom_webhook_integration": { "flow_id": <id do flow> } }` — o sistema cria a integração embutida (idempotente: repetir retorna a mesma; nome automático "Flow: <nome>"; auto-mapeia todos os eventos → este flow) e retorna a URL única do webhook.
3. No node `start`, adicionar item `{ "type": "webhook_received", "config": { "integration_id": <id da integração> } }`.
4. Salvar o flow (`flows_update`) — o save sincroniza a ativação do webhook embutido (remover o item desativa a integração automaticamente).
Webhooks embutidos NÃO aparecem na listagem de integrações standalone; excluir o flow destrói o webhook; duplicar o flow NÃO copia o gatilho embutido. Rate limit do endpoint público: 60/min por token.

**Handles que SAEM:** `success`.

### 2.2 `send_message`

```json
{
  "id": "node-send-1",
  "type": "send_message",
  "position": { "x": 370, "y": 300 },
  "data": {
    "label": "Boas-vindas",
    "messageItems": [
      { "id": "m1", "type": "text", "content": "Oi {{contact.name}}! Como posso ajudar?" },
      { "id": "m2", "type": "delay", "seconds": 2 },
      { "id": "m3", "type": "whatsapp_template", "templateId": 123, "params": ["valor1"] }
    ]
  }
}
```

**Tipos de item válidos:** `text`, `whatsapp_template` (ou `template`), `canned_response`, `user_input` (pausa esperando resposta livre), `delay`, `attachment`, `audio`.

**ATENÇÃO:** usa `messageItems` (NÃO `items`).

**Botões interativos:** um item `text` com `buttons_enabled: true` e `buttons: [{ title, value }, ...]` vira mensagem com botões. Ao clicar, o flow roteia pelo handle **`button_<value>`** (ex: botão com `value: "sim"` → handle `button_sim`). Se o cliente digitar texto livre em vez de clicar, cai no handle **`no_response`**. Se houver timeout configurado, cai em **`no_reply_timeout`**.

```json
{ "id": "m1", "type": "text", "content": "Confirma o agendamento?",
  "buttons_enabled": true,
  "buttons": [ { "title": "Sim", "value": "sim" }, { "title": "Não", "value": "nao" } ] }
```
→ edges: `sourceHandle: "button_sim"`, `sourceHandle: "button_nao"`, e opcionalmente `"no_response"`.

**Handles que SAEM:** `success` (sem botões); com botões → `button_<value>` (um por botão) + `no_response` (+ `no_reply_timeout` se tiver timeout). Também `error`.

### 2.3 `wait_response`

```json
{
  "id": "node-wait-1",
  "type": "wait_response",
  "position": { "x": 690, "y": 300 },
  "data": {
    "label": "Pergunta menu",
    "waitTime": 60,
    "waitUnit": "minutes",
    "validation": "options",
    "acceptedOptions": ["1", "2", "3"],
    "invalidMessage": "Por favor responda com 1, 2 ou 3",
    "maxRetries": 3,
    "saveTo": "conversation_attr",
    "saveAttrKey": "escolha_menu"
  }
}
```

**`validation` válidos:** `any`, `options`, `regex`.

**`saveTo` válidos (nomes EXATOS — qualquer outro valor NÃO salva nada):**
- `variable` — variável temporária do flow (use `saveVariable` pra nomear; senão usa o próprio `saveTo`)
- `contact_name` — sobrescreve o nome do contato
- `contact_email` — sobrescreve o email do contato
- `contact_phone` — sobrescreve o telefone do contato
- `contact_attr` — custom attribute do CONTATO (precisa de `saveAttrKey`)
- `conversation_attr` — custom attribute da CONVERSA (precisa de `saveAttrKey`)
- `""` — não salva

**NÃO existem** `attribute` nem `contact_attribute` — use `conversation_attr` / `contact_attr`.

**Handles que SAEM dependem da validation:**
- `validation: 'any'` → `success`, `timeout`
- `validation: 'options'` → `option_<valor>` para cada valor em `acceptedOptions` (ex: `option_1`, `option_2`, `option_sim`) + `timeout`
- `validation: 'regex'` → `success`, `timeout`

**Timeout AGORA dispara de verdade (corrigido 2026-06-09):** `waitTime` + `waitUnit` agendam o estouro — se o cliente não responder no prazo, o flow segue pelo handle `timeout`. Antes dessa data o backend ignorava o waitTime (flows antigos que dependiam do timeout passaram a funcionar). Sempre ligue um edge no handle `timeout` quando definir waitTime; sem edge, o flow simplesmente para ali no estouro.

**REGRA:** depois de wait_response com options, NUNCA coloque node `condition` pra ramificar — ligue os edges direto nos handles `option_X`.

### 2.4 `condition`

```json
{
  "id": "node-cond-1",
  "type": "condition",
  "position": { "x": 1010, "y": 300 },
  "data": {
    "label": "Tipo de cliente",
    "conditions": [
      { "id": "c1", "label": "VIP", "field": "contact.custom_attribute.plano", "operator": "equal", "value": "premium" },
      { "id": "c2", "label": "Padrão", "field": "contact.custom_attribute.plano", "operator": "equal", "value": "standard" }
    ]
  }
}
```

**ATENÇÃO — atributo customizado é SINGULAR:** `contact.custom_attribute.X` e `conversation.custom_attribute.X` (também `account.custom_attribute.X`). Usar plural `custom_attributes` resolve VAZIO — vale tanto no `field` da condição quanto em mensagens/variáveis `{{...}}`.

**Dados cadastrais — forma curta é a canônica (2026-06):** `{{contact.cpf}}`, `{{contact.cnpj}}`, `{{contact.rg}}`, `{{contact.address.number}}`, `{{contact.address.street}}` etc. O backend traduz internamente pra `contact.cadastral.*` (flows antigos com a forma longa continuam resolvendo). NÃO use `contact.attributes.cpf` nem `contact.custom_attribute.cpf` — cadastral NÃO é custom attribute.

**Operadores válidos (lista real do runtime):**

| Operador | Uso |
|---|---|
| `equal` (ou `field_equals`) / `not_equal` | igualdade |
| `contains` / `not_contains` | substring |
| `starts_with` / `ends_with` | prefixo/sufixo |
| `is_empty` / `is_not_empty` | vazio/preenchido (NÃO existe `is_present`/`is_blank`) |
| `greater_than` / `less_than` | comparação numérica |
| `number_range` | faixa; `value` no formato `"min-max"` (ex `"10-50"`) |
| `has_length` | comprimento exato (`value` = número) |
| `is_number` / `is_letter` / `is_email` / `is_phone` | validação de formato |
| `regex` | padrão regex em `value` |
| `equal_any` / `not_equal_any` / `contains_any` | multi-valor (usa `values` array) |
| `business_hours` / `outside_business_hours` | horário comercial |
| `can_reply` / `can_reply_closed` | janela 24h aberta/fechada |
| `conversation_has_agent` / `conversation_no_agent` / `conversation_not_agent` | agente atribuído |
| `contact_has_label` / `contact_no_label` / `conversation_has_label` / `conversation_no_label` | labels |
| `kanban_exists` / `kanban_in_stage` / `kanban_won` / `kanban_lost` | card no funil (usa `funnel_id` + `stage`) |
| `card_attr_equals` / `card_attr_contains` | atributo do card (`attrSource: 'card'` + `attr_key`) |
| `pagetrack_visited` / `pagetrack_event` | LionTrack |

**Restrição por TIPO de atributo (a UI só oferece um subconjunto, e é o que faz sentido):**
- **Texto/string:** `equal`, `not_equal`, `contains`, `not_contains`, `starts_with`, `ends_with`, `is_empty`, `is_not_empty`
- **Número:** `equal`, `not_equal`, `greater_than`, `less_than`, `number_range`, `is_empty`, `is_not_empty`
- **Lista/Data:** `equal`, `not_equal`, `contains`, `not_contains`

Use operador numérico (`greater_than`, `less_than`, `number_range`) SÓ em atributo de tipo número.

**Handles que SAEM:** `cond_0`, `cond_1`, `cond_2`, ... (UM POR CONDIÇÃO, pela ordem do array — NÃO use o `id` da condição) + `default` (quando nenhuma bate).

**ATENÇÃO — lógica first-match-wins (if / elsif):** as condições são avaliadas em ordem e PARA na primeira que bate. A ordem do array importa. O handle é `cond_INDEX` baseado na posição, NÃO o `id` da condição. Se `conditions[0].id = "vip"`, o handle ainda é `cond_0`.

### 2.5 `action`

```json
{
  "id": "node-action-1",
  "type": "action",
  "position": { "x": 1330, "y": 300 },
  "data": {
    "label": "Finalizar atendimento",
    "items": [
      { "key": "assign_team", "config": { "team_id": 5 } },
      { "key": "add_label", "config": { "labels": ["lead-qualificado"] } },
      { "key": "create_kanban_item", "config": { "funnel_id": 3, "funnel_stage": "novo_lead" } }
    ]
  }
}
```

**ATENÇÃO:** items usa `config` (NÃO `params`).

**Keys de action válidas:**

| Key | config esperado | Efeito |
|---|---|---|
| `assign_agent` | `{ agent_id }` | Atribui agente humano à conversa |
| `assign_team` | `{ team_id }` | Atribui time |
| `change_status` | `{ status: 'open' \| 'resolved' \| 'pending' \| 'snoozed' }` | Muda status da conversa |
| `change_priority` | `{ priority: 'urgent' \| 'high' \| 'medium' \| 'low' }` | Muda prioridade |
| `add_label` | `{ labels: ['slug1', 'slug2'] }` | Adiciona labels ao CONTATO |
| `remove_label` | `{ labels: ['slug'] }` | Remove labels do CONTATO |
| `add_conversation_label` | `{ labels: ['slug'] }` | Adiciona labels à CONVERSA (não ao contato) |
| `remove_conversation_label` | `{ labels: ['slug'] }` | Remove labels da CONVERSA |
| `mute_conversation` | `{}` | Silencia notificações |
| `add_private_note` | `{ content: 'texto' }` | Adiciona nota interna |
| `create_kanban_item` | `{ funnel_id, funnel_stage, title?, description? }` | Cria card no Kanban — `funnel_id` e `funnel_stage` OBRIGATÓRIOS; `title`/`description` aceitam variáveis `{{ }}` |
| `move_kanban_item_to_stage` | `{ funnel_stage }` | Move card (precisa ter card vinculado) |
| `move_kanban_stage` | `{ funnel_id, funnel_stage }` | Idem |
| `set_kanban_item_status` | `{ status: 'won' \| 'lost' \| 'active' }` | Marca status do card |
| `set_won` | `{}` | Atalho pra ganho |
| `set_lost` | `{ reason? }` | Atalho pra perdido |
| `assign_agent_card` | `{ agent_id }` | Atribui agente ao card |
| `add_card_note` | `{ content }` | Nota no card |
| `send_webhook` | `{ url, headers?, body? }` | Dispara webhook externo |
| `start_flow` | `{ flow_id }` | Inicia outro fluxo |
| `deactivate_flow` ou `disable_flow` | `{}` | Encerra fluxo atual |
| `update_attribute` | `{ attr_source: 'contact'\|'conversation'\|'card', attr_key, attr_value }` | Seta custom_attribute (ver abaixo) |
| `assign_captain` (ou `assign_captain_assistant`) | `{ assistant_id }` | Atribui IA Captain |
| `deactivate_captain` | `{}` | Tira a IA da conversa |

**Handles que SAEM:** `success`. Não tem handle `error` — falhas viram warning silencioso e o flow continua.

**`update_attribute` — campos EXATOS:** `attr_source` (`'contact'`, `'conversation'` ou `'card'`), `attr_key` (nome do atributo), `attr_value` (valor). NÃO existem `entity`/`key`/`value` — esses são ignorados e não salvam nada.

**Somar/subtrair NÃO é operação dedicada** — é filtro Liquid no próprio `attr_value`. O valor é resolvido como template antes de salvar. Exemplos:

```json
{ "key": "update_attribute", "config": {
  "attr_source": "contact", "attr_key": "numero_tokens",
  "attr_value": "{{ contact.custom_attribute.numero_tokens | minus: 1 }}"
} }
```
- Subtrair 1 token: `{{ contact.custom_attribute.numero_tokens | minus: 1 }}`
- Somar 5: `{{ conversation.custom_attribute.pontos | plus: 5 }}`
- Multiplicar: `| times: 2` · Dividir: `| divided_by: 2`

Lembre: o atributo lido é SINGULAR (`custom_attribute`).

### 2.6 `api`

```json
{
  "id": "node-api-1",
  "type": "api",
  "position": { "x": 1330, "y": 480 },
  "data": {
    "label": "Consulta CRM externo",
    "method": "POST",
    "url": "https://api.example.com/leads",
    "headers": [
      { "key": "Authorization", "value": "Bearer {{env.CRM_TOKEN}}" },
      { "key": "Content-Type", "value": "application/json" }
    ],
    "body": "{\"name\":\"{{contact.name}}\",\"email\":\"{{contact.email}}\"}",
    "apiResponseVar": "crm_response"
  }
}
```

**Handles que SAEM:** `success`, `error`.

### 2.7 `ai`

```json
{
  "id": "node-ai-1",
  "type": "ai",
  "position": { "x": 1010, "y": 300 },
  "data": {
    "label": "Classifica intenção",
    "aiMode": "intent",
    "aiPrompt": "Classifique a intenção da última mensagem",
    "aiIntents": [
      { "name": "compra" },
      { "name": "suporte" },
      { "name": "reclamacao" },
      { "name": "outro" }
    ]
  }
}
```

**`aiMode` válidos:** `generate`, `intent`, `sentiment`, `extract`.

**Contexto da conversa:** campo `contextMessages` define quantas mensagens recentes a IA enxerga — valores válidos `25`, `50`, `75`, `100` (ampliado em 2026-06; antes o teto era ~20). Os modos `intent`/`sentiment`/`extract` rodam no motor contido (texto puro, sem persona nem ferramentas — mais barato e sem risco de vazamento); `generate` usa o assistente Captain.

**Intent — campo EXATO:** `aiIntents` é um ARRAY DE OBJETOS `{ "name": "..." }`. NÃO use `aiIntentOptions` (array de strings) — é ignorado. A intenção classificada também fica disponível na variável de sessão **`ai_intent`** (use como `{{ai_intent}}` adiante).

**Handles que SAEM dependem do mode:**
- `generate` → `success`, `error`
- `intent` → uma saída por intenção (`intent_<name>`, ex: `intent_compra`, `intent_suporte`) **+ `no_intent`** (quando nenhuma bate) + `error`
- `sentiment` → `positive`, `negative`, `neutral` + `error`
- `extract` → `success`, `error` (resultado salvo em `aiResponseVar`)

### 2.8 `wait`

```json
{
  "id": "node-wait-time-1",
  "type": "wait",
  "position": { "x": 690, "y": 300 },
  "data": {
    "label": "Espera 10 min",
    "waitTime": 10,
    "waitUnit": "minutes"
  }
}
```

**`waitUnit` válidos:** `seconds`, `minutes`, `hours`, `days`, `weekday` (espera próximo dia da semana).

Pra `weekday`, use também `targetWeekday` (0=domingo, 1=segunda... 6=sábado) e `targetHour` (0-23).

**Handles que SAEM:** `success`.

### 2.9 `set_variable`

```json
{
  "id": "node-setvar-1",
  "type": "set_variable",
  "position": { "x": 370, "y": 300 },
  "data": {
    "label": "Define contexto",
    "variables": [
      { "name": "origem_lead", "value": "Facebook Ads" },
      { "name": "score", "value": "{{contact.custom_attribute.lead_score}}" }
    ]
  }
}
```

**Handles que SAEM:** `success`.

### 2.10 `randomizer`

```json
{
  "id": "node-rand-1",
  "type": "randomizer",
  "position": { "x": 690, "y": 300 },
  "data": {
    "label": "A/B test mensagem",
    "mode": "branches",
    "branches": [
      { "id": "A", "label": "Variante A", "weight": 50 },
      { "id": "B", "label": "Variante B", "weight": 50 }
    ]
  }
}
```

**Handles que SAEM:** o `id` de cada branch (`A`, `B`, ...). Em `mode: 'distribute_agents'` é `success`.

### 2.11 `update_group` (WAHA apenas)

Atualiza nome/descrição/foto de grupo WhatsApp. Use só quando flow roda em inbox WAHA e a conversa for de grupo.

**Handles que SAEM:** `success`, `error`.

### 2.12 `activate_flow` (LEGADO — prefira action `start_flow`)

```json
{
  "id": "node-act-1",
  "type": "activate_flow",
  "position": { "x": 1010, "y": 300 },
  "data": { "label": "Inicia flow B", "flow_id": 42 }
}
```

**Handles que SAEM:** `success`, `error`.

**ATENÇÃO:** este node saiu do menu do editor (legado) — o motor ainda executa flows antigos que o usam, mas em flows NOVOS use `action` com `key: 'start_flow'` e `config: { flow_id }`. Não crie nodes `activate_flow` novos.

### 2.13 `end` (encerra ramo / define retorno do ai_tool)

Node terminal, sem handles de saída. Em flow `conversation` apenas encerra aquele ramo. Em flow `ai_tool` é OBRIGATÓRIO: o `data` do `end` define o que volta pro LLM (modo de saída + template do resultado).

```json
{ "id": "node-end", "type": "end", "position": { "x": 1330, "y": 300 }, "data": { "label": "Retorno", "mode": "structured" } }
```

### 2.14 `note` (anotação visual)

Sticky note no canvas, puramente visual. Sem handles, nunca executado (não ligue edges nele). Serve só pra documentar o flow.

```json
{ "id": "note-1", "type": "note", "position": { "x": 50, "y": 50 }, "data": { "content": "Fluxo de qualificação — revisar mensagens" } }
```

---

## 2-B. Dois tipos de flow: `conversation` vs `ai_tool`

O campo `flow_type` (definido na criação, IMUTÁVEL depois) decide a natureza do flow:

| | `conversation` (default) | `ai_tool` |
|---|---|---|
| Como dispara | Por evento de inbox (trigger no node `start`) | Invocado pelo AI Agente (Captain) como ferramenta |
| Inboxes | usa `inbox_ids` | **PROIBIDO** ter inboxes (validação barra) |
| Campos extra | — | `tool_name` (snake_case, `[a-z][a-z0-9_]`, max 50) + `tool_description` (max 500) OBRIGATÓRIOS |
| Retorno | manda mensagens | retorna dado estruturado ao LLM via node `end` |
| Nodes permitidos | todos | `start`, `end`, `api`, `condition`, `set_variable`, `ai`, `note`, `randomizer`, `action`, `send_message` |

Se o cliente pediu "uma ferramenta que a IA usa pra consultar X / calcular Y", é `ai_tool`. Se pediu "quando chega mensagem, faça Z", é `conversation`. Na dúvida, `conversation`.

**No flow `ai_tool`, o node `action` NÃO aceita as keys da aba "Sistema"** (`send_webhook` /
`start_flow`) — elas só valem em flow `conversation`. No `action` de um `ai_tool` use apenas keys
das abas Conversas / Contatos / Kanban (ex: `add_label`, `change_status`, `update_attribute`,
`create_kanban_item`). Para gravar atributo no `ai_tool`, use `action` com `update_attribute`
(o antigo node `save_attribute` foi removido — não existe mais em nenhum tipo de flow).

**Proteção anti-loop por profundidade (2026-06):** quando um flow dispara automação que dispara
outro flow (cadeia entre motores), cada hand-off incrementa um contador interno (`_activation_depth`).
No 5º hand-off (`MAX_CHAIN_DEPTH = 5`) a cadeia é cortada silenciosamente. Se um flow "não disparou"
no fim de uma cadeia automação→flow→automação, suspeite desse limite — é proteção, não bug.
Não tente contornar criando flows intermediários.

---

## 3. Edges

```json
{
  "id": "edge-1",
  "source": "node-start",
  "target": "node-send-1",
  "sourceHandle": "success",
  "type": "deletable",
  "animated": true
}
```

**REGRAS:**
- `sourceHandle` é OBRIGATÓRIO em todo edge
- Tem que casar com um handle que o node `source` EFETIVAMENTE EXPÕE (ver tabelas acima)
- `id`: usar formato `edge-N` ou `e<source>-<target>`
- `type: 'deletable'` e `animated: true` são os defaults visuais

**Handles INVENTADOS quebram o flow.** Exemplos do que NÃO usar:
- `c1`, `c2`, `c3` (use `cond_0`, `cond_1`)
- `branch1`, `branchA` (no condition; use `cond_X`)
- `out`, `output`, `next` (use o nome real do handle)
- `option1` sem underscore (use `option_1`)

---

## 4. Layout e positioning

Sem `position`, todos os nodes empilham no (0,0). Sempre informe.

### Regras de espaçamento

| Direção | Valor |
|---|---|
| Espaço horizontal entre nodes sequenciais | **+320** em X |
| Espaço vertical entre branches paralelos | **+150** em Y (2 ramos), **+180** (3 ramos), **+150** cada (4+) |
| Y do node start | **300** (ponto médio) |

### Exemplo de layout

Fluxo linear de 4 nodes:
```
(50, 300) → (370, 300) → (690, 300) → (1010, 300)
```

Fluxo com 1 wait_response 3 opções:
```
                                       (1330, 120)  -> option_1
                                              ↑
(50,300) → (370,300) → (690,300) → wait → (1330, 300)  -> option_2
                                              ↓
                                       (1330, 480)  -> option_3
```

Cada branch continua em seu próprio Y, X avança normal:
```
option_1 path: (1330, 120) → (1650, 120) → (1970, 120)
option_2 path: (1330, 300) → (1650, 300) → (1970, 300)
option_3 path: (1330, 480) → (1650, 480) → (1970, 480)
```

### Regra importante

Nodes nunca devem ficar com a mesma coordenada `(x, y)`. Se dois nodes têm posição idêntica, eles SOBREPÕEM visualmente no canvas.

---

## 5. Erros comuns (lista negra)

| Erro | Por que quebra | Forma certa |
|---|---|---|
| `items` no send_message | Schema usa `messageItems` | `messageItems: [...]` |
| `items[].params` no action | Schema usa `config` | `items: [{ key, config: {...} }]` |
| Falta `position` em algum node | Nodes empilham no canvas | Sempre `position: {x, y}` |
| `sourceHandle: "c1"` ou `"vip"` no condition | Não existem | `"cond_0"`, `"cond_1"`, etc |
| Node `condition` depois de `wait_response` com options | Redundante e atrapalha | Ligue `option_X` direto no próximo node |
| Edge sem `sourceHandle` | Frontend não consegue rotear | Sempre informe |
| Edge com `target` apontando pra ID que não existe | Quebra o grafo | Confira que `target` está em `nodes[]` |
| `channel_type: "WhatsApp"` | Precisa do nome de classe Rails | `"Channel::Whatsapp"`, `"Channel::Waha"`, `"Channel::WebWidget"` |
| `validation: "option"` (singular) | Não existe | `"options"` (plural) |
| `custom_attributes` (plural) em `{{...}}` ou `field` | Resolve vazio | `custom_attribute` (singular) |
| `update_attribute` com `{entity, key, value}` | Campos errados, não salva | `{attr_source, attr_key, attr_value}` |
| `saveTo: "attribute"` ou `"contact_attribute"` | Não existem, não salva | `"conversation_attr"` / `"contact_attr"` |
| `is_present` / `is_blank` na condition | Não existem | `is_not_empty` / `is_empty` |
| `aiIntentOptions` (array de strings) no node ai | Ignorado | `aiIntents: [{name}]` |
| `match_mode` no `message_received` | Ignorado | `match_type` (`exact`/`contains`) |
| `label` (singular) em `label_added`/`label_removed` | Ignorado | `label_names: [...]` |
| operador numérico (`greater_than` etc) em atributo texto | UI não oferece; semântica errada | usar só em atributo número |
| inboxes em flow `ai_tool` | Validação rejeita | ai_tool não tem inboxes |
| `waitTime: "60"` (string) | Espera Integer | `waitTime: 60` |
| `inbox_ids` aninhado em `{flow:{...}}` | No MCP, achata-se sozinho | Passa `inbox_ids: [1, 2]` no nível raiz |
| Mais de 1 node `start` | Flow precisa ter exatamente 1 ponto de entrada | Só 1 |
| Node sem edge entrando (exceto start) | Node nunca executa | Confira que todo node não-start tem ao menos 1 edge target apontando pra ele |
| `flow_data` sem `nodes` ou sem `edges` | Estrutura inválida | Inclua sempre, mesmo que `edges: []` |

---

## 6. Checklist pre-submit

Antes de chamar `flows_create` ou `flows_update`, valide mentalmente:

- [ ] Existe exatamente 1 node `type: 'start'`
- [ ] Todo node tem `id` único
- [ ] Todo node tem `type` válido (lista da seção 1)
- [ ] Todo node tem `position: { x: <int>, y: <int> }`
- [ ] Nenhum par de nodes tem a mesma posição `(x, y)`
- [ ] Todo node tem `data` com campos do schema do tipo
- [ ] Todo node não-start tem pelo menos 1 edge chegando (`edge.target = node.id`)
- [ ] Todo edge tem `source`, `target` e `sourceHandle`
- [ ] Todo `sourceHandle` é um handle real exposto pelo node source (seção 2)
- [ ] `channel_type` é classe Rails (`Channel::Waha` etc)
- [ ] `inbox_ids` (se enviado) tem inboxes do mesmo `channel_type`
- [ ] Não tem `condition` redundante depois de `wait_response` com options
- [ ] Layout: nodes em ordem visual da esquerda pra direita, sem sobreposição
