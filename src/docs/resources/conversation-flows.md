# Fluxos de Conversação

Como conversas atravessam o LionChat: criação, auto-assignment, IA, automações, resolução. Use quando precisar entender ou diagnosticar comportamento de conversações.

## Ciclo de vida de uma conversa

```
                          [Cliente envia 1ª msg]
                                  │
                                  ▼
                    ┌──────────────────────────┐
                    │ ContactInbox criado/      │
                    │  encontrado por source_id │
                    └─────────┬────────────────┘
                              ▼
                    ┌──────────────────────────┐
                    │  Conversation.create     │
                    │  status: 0 (open)        │
                    └─────────┬────────────────┘
                              ▼
                  ┌───────────────────────────┐
                  │ Greeting (se ativo)       │ → Message outgoing
                  └─────────┬─────────────────┘
                            ▼
                  ┌───────────────────────────┐
                  │ AutomationRule:            │
                  │ "conversation_created"     │
                  └─────────┬─────────────────┘
                            ▼
                  ┌───────────────────────────┐
                  │ Auto-assignment:           │
                  │ - team OU agent           │
                  │ - via policy ou simples   │
                  └─────────┬─────────────────┘
                            ▼
                  ┌───────────────────────────┐
                  │ Captain (IA) Agent:        │
                  │ se atribuído              │
                  │ → debounce → LLM response │
                  └─────────┬─────────────────┘
                            ▼
                  ┌───────────────────────────┐
                  │ Conversa ativa             │
                  │ (status: open)            │
                  └─────────┬─────────────────┘
                            ▼
              [Agente humano ou IA atende ↔ cliente]
                            │
                    ┌───────┴────────┐
                    ▼                ▼
            [resolvida]      [adiada]
            status: 1        status: 3
                    │                │
                    │                └──→ desnooze automático
                    ▼
              ┌───────────────────────────┐
              │ Pós-resolução:             │
              │ - Captain memory + FAQ    │
              │ - Reporting events        │
              │ - Automation rules        │
              │ - CSAT survey send        │
              └────────────────────────────┘
```

## Etapas detalhadas

### 1. Criação da conversa

Mensagem chega via webhook do canal (WAHA, WhatsApp Cloud, Email, etc) → `Webhook::IncomingMessageJob` ou similar → `IncomingMessageService` → cria/encontra `Contact`, `ContactInbox`, `Conversation`, `Message`.

**Pontos importantes:**
- `Conversation` sempre criada com `status = 0` (open)
- `inbox_id` setado direto
- `assignee_id` começa `null` (pendente atribuição)
- `captain_assistant_id` começa `null` (a menos que automação atribua)

### 2. Greeting (mensagem de boas-vindas)

Se `inbox.greeting_enabled = true`:
- Após criar a conversa, envia `inbox.greeting_message`
- Vira `Message` outgoing automática
- NÃO substitui resposta humana — só inicia a conversa

### 3. AutomationRule: "conversation_created"

Cada inbox/conta pode ter regras com `event_name: 'conversation_created'`. Elas rodam **antes** do auto-assignment.

Ações comuns:
- Atribuir agente/time específico
- Adicionar labels
- Marcar prioridade
- Atribuir Captain Assistant (`captain_assistant_id`)

Avaliação:
- Condições combinadas com AND
- Operadores: `equal_to`, `contains`, `includes`, `is_present`
- Pode usar `inbox`, `content`, `country_code`, `email`, custom_attributes

### 4. Auto-assignment

Roda após automation rules. Lógica simplificada:

```
SE inbox.enable_auto_assignment_v2:
  SE inbox.assignment_policy associada:
    → Política decide (round-robin, balanced, etc)
  SENAO:
    → assignee_id fica null (manual)
```

V2 (Assignment Policy) é o motor moderno. V1 (campo `auto_assignment` simples) é legado.

### 5. Captain (IA Agente)

Se `captain_assistant_id` foi setado (manual ou via automação):
- Mensagem incoming dispara `Captain::ResponseBuilderJob`
- Job tem **debounce** (~10s) — agrupa mensagens em rajada
- Chama LLM com prompt do assistant + histórico
- LLM pode invocar tools (FAQ, update_contact, create_booking, etc)
- Resposta vira `Message` outgoing com `sender_type: Captain::Assistant`

**Quando IA é desativada manualmente:**
- Agente clica em "Desativar AI" → `captain_assistant_id` vira null
- `custom_attributes.captain_manually_disabled = true`
- IA não responde mais nessa conversa (mesmo se nova msg)

### 6. Estado "pending" (status 2)

Conversa em "pending" significa "aguardando algo":
- Cliente respondeu mas agente ainda não viu
- OU agente respondeu e tá aguardando cliente
- Geralmente movida automaticamente por automação ("se 24h sem resposta → pending")

### 7. Resolução (status 1)

Agente clica em "Resolver":
- `status` → 1 (resolved)
- `resolved_at` setado
- Dispara `conversation_resolved` event
- Listeners agem:
  - `CaptainListener`: gera memory + FAQ se IA atendeu
  - `HookListener`: dispara webhooks
  - `AutomationRuleListener`: regras de `conversation_resolved`
  - `ReportingEventListener`: salva métricas
  - `CsatSurveyJob` (se config ativa): envia pesquisa CSAT

### 8. Snoozed (status 3)

Adia conversa:
- `status` → 3 (snoozed)
- `snoozed_until` setado (datetime futuro)
- Job periódico `ReopenSnoozedConversationsJob` roda e reabre quando passa do `snoozed_until`

### 9. Reopen

Conversa resolvida que recebe nova mensagem do cliente:
- Comportamento depende de config `inbox.lock_to_single_conversation`
- Default: cria NOVA conversa (mantém histórico)
- Se locked: reabre a mesma conversa (`status` volta a 0)

## Estado relacional

```
Conversation
  ├─ messages: array em ordem cronológica
  ├─ contact: quem é o cliente
  ├─ inbox: canal de origem
  ├─ assignee: agente humano atual (null OK)
  ├─ team: time atribuído (null OK)
  ├─ captain_assistant: IA atribuída (null OK)
  ├─ kanban_item: card vinculado (null OK)
  └─ labels: tags aplicadas
```

## Como diagnosticar problemas

### "Conversa não atribuiu ninguém"

1. `inbox.enable_auto_assignment_v2` está true?
2. `inbox.assignment_policy` está setado?
3. Tem `InboxMember` ativos pra essa inbox?
4. Tem `automation_rule` que poderia ter atribuído antes?

### "IA não respondeu"

1. `conversation.captain_assistant_id` está setado?
2. Account tem OpenAI hook configurado?
3. Captain feature ativa na conta? (`feature_captain_integration`)
4. Custom attr `captain_manually_disabled = true`?
5. Sidekiq job `Captain::ResponseBuilderJob` rodou? Tem erro no log?

### "Conversa marcada como pending sem motivo"

1. Tem automation rule com `event_name: conversation_updated` ou similar?
2. Tem SLA policy ativando state change?
3. Veio de external API call?

## Receitas de ação (qual tool usar pra cada coisa)

### ENVIAR MENSAGEM (`conversations_messages_create`)

Endpoint: `POST /api/v1/accounts/{account_id}/conversations/{conversation_id}/messages`
Os campos vão na **raiz** do payload (NÃO há wrapper). Construídos pelo `Messages::MessageBuilder`.

**Payload mínimo (resposta de texto pro cliente):**
```json
{
  "content": "Olá! Como posso ajudar?",
  "message_type": "outgoing"
}
```

**Campos:**

| Campo | Obrigatório | Detalhe |
|---|---|---|
| `content` | sim* | Texto da mensagem (*pode ser vazio se houver `attachments`) |
| `message_type` | recomendado | `outgoing` (padrão, resposta do agente) ou `incoming`. **`incoming` SÓ é permitido em inbox do tipo API** — em outros canais levanta erro |
| `private` | não | `true` = nota interna (só agentes veem, não vai pro cliente). Default `false` |
| `attachments` | não | Array de arquivos (upload) ou `signed_id` (ActiveStorage). Escolhe endpoint de mídia pelo MIME |
| `content_attributes.in_reply_to` | não | ID da mensagem que está sendo respondida/citada |
| `template_params` | não | Parâmetros de template WhatsApp (header/body/buttons). JSON |
| `cc_emails` / `bcc_emails` / `to_emails` | não | SÓ em inbox Email. Lista separada por vírgula |

**Nota interna (não vai pro cliente):**
```json
{ "content": "Cliente parece irritado, tratar com cuidado", "private": true }
```

### AÇÃO → TOOL (mapa rápido)

NÃO confunda com `conversations_update`: o update só altera **prioridade** e **IA Agente**
(`captain_assistant_id`). Para mudar status, prioridade ou atribuição use as tools abaixo.

| Ação desejada | Tool / endpoint | Parâmetros |
|---|---|---|
| Resolver conversa | `toggle_status` (POST `.../toggle_status`) | `status: "resolved"` |
| Reabrir conversa | `toggle_status` | `status: "open"` |
| Marcar como pendente | `toggle_status` | `status: "pending"` |
| Adiar (snooze) | `toggle_status` | `status: "snoozed"` + `snoozed_until` (datetime futuro) |
| Mudar prioridade | `toggle_priority` (POST `.../toggle_priority`) | `priority`: `urgent`/`high`/`medium`/`low`/`nil` |
| Atribuir agente | `assignments` (POST `.../assignments`) | `assignee_id` |
| Atribuir time | `assignments` | `team_id` |
| Ativar/trocar IA Agente | `conversations_update` (PATCH) | `captain_assistant_id` |
| Desativar IA Agente | `conversations_update` (PATCH) | `captain_assistant_id: 0` (ou null) |

**IMPORTANTE:** `conversations_update` (PATCH) só aceita `priority` e `captain_assistant_id`
(ver `permitted_update_params`, conversations_controller.rb). Mandar `status` no update **não muda
o status** — é ignorado. Use sempre `toggle_status` para status.

**Snooze exige `snoozed_until`:**
```json
POST .../conversations/{id}/toggle_status
{ "status": "snoozed", "snoozed_until": "2026-06-01T09:00:00Z" }
```

### MARCAR COMO LIDA vs NÃO-LIDA

| Ação | Tool / endpoint | Efeito |
|---|---|---|
| Marcar como **lida** | `update_last_seen` (POST `.../update_last_seen`) | Atualiza `agent_last_seen_at`; em canal WAHA dispara check azul no WhatsApp |
| Marcar como **não-lida** | `conversations_unread` (POST `.../unread`) | Recua o `last_seen` pra antes da última mensagem do cliente — conversa volta a aparecer como não-lida |

Ambas são **ações de escrita** (POST). `unread` é o oposto de `update_last_seen`, não uma consulta.

### AGENDAR MENSAGEM (`scheduled_messages_create`)

Endpoint: `POST /api/v1/accounts/{account_id}/conversations/{conversation_id}/scheduled_messages`

**ATENÇÃO:** diferente do padrão "raiz" das mensagens normais, aqui o payload **EXIGE o wrapper**
`scheduled_message` (`params.require(:scheduled_message)`).

**Payload:**
```json
{
  "scheduled_message": {
    "content": "Lembrete: sua consulta é amanhã às 14h",
    "scheduled_at": "2026-06-01T14:00:00Z",
    "inbox_id": 12
  }
}
```

| Campo | Obrigatório | Detalhe |
|---|---|---|
| `content` | sim | Texto a enviar |
| `scheduled_at` | sim | Quando enviar (datetime) |
| `inbox_id` | sim | Caixa de entrada por onde sair |
| `is_recurrent` | não | `true` ativa recorrência |
| `period` | não | Período da recorrência (ex.: `daily`, `weekly`) — vira `{ type: ... }` |
| `recurrence_count` | não | Quantas vezes repetir |
| `template_params` | não | Parâmetros de template WhatsApp |

## Eventos importantes (pra automation)

| Evento | Quando dispara |
|---|---|
| `conversation_created` | Nova conversa |
| `conversation_opened` | Status volta pra open (reabertura) |
| `conversation_resolved` | Agente resolve |
| `conversation_pending` | Status muda pra pending |
| `conversation_updated` | Acao na conversa — filtrada por `action_types` (UI: "Acao na conversa") |
| `message_created` | Nova mensagem (incoming ou outgoing) |
| `first_reply_created` | Primeira resposta humana |

### Subtipos de `conversation_updated` (campo `action_types`)

Ao criar/atualizar uma `automation_rule` com `event_name: 'conversation_updated'`, envie tambem
o campo `action_types` (array de strings) pra filtrar quais mudancas disparam a regra. Vazio/nulo
mantem comportamento legado (qualquer mudanca dispara — retrocompat com regras antigas).

| Subtipo | Detectado quando muda |
|---|---|
| `label_added` | `label_list` (apos - antes nao vazio) |
| `label_removed` | `label_list` (antes - apos nao vazio) |
| `status_changed` | `status` |
| `priority_changed` | `priority` |
| `agent_assigned` | `assignee_id` |
| `team_assigned` | `team_id` |
| `custom_attribute_changed` | `custom_attributes` |
| `language_changed` | `additional_attributes.conversation_language` |
| `ai_agent_assigned` | `captain_assistant_id` |

Exemplo de criacao via API:
```json
POST /api/v1/accounts/{account_id}/automation_rules
{
  "name": "Notificar quando etiqueta VIP entra",
  "event_name": "conversation_updated",
  "action_types": ["label_added"],
  "conditions": [{"attribute_key": "labels", "filter_operator": "contains", "values": ["vip"]}],
  "actions": [{"action_name": "send_email_to_team", "action_params": {"team_ids": [1], "message": "VIP!"}}]
}
```
