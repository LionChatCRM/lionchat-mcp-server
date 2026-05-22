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
