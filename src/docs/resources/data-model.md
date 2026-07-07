# Modelo de Dados LionChat (Detalhado)

Mapa completo de entidades, relacionamentos e foreign keys. Use quando precisar entender como dados conectam ou como navegar entre recursos.

## Multi-tenancy: Account

`Account` é a raiz. **TODA** entidade tem `account_id` direta ou indiretamente. Nunca há "vazamento" entre contas.

```
Account
├── id (PK)
├── name
├── plan_id (FK → Plan)
├── feature_flags (bigint bitfield)
├── feature_flags_2 (bigint bitfield, features 64+)
├── usage_limits (jsonb)
├── custom_attributes (jsonb)
├── domain
├── support_email
└── locale (string, ex: 'pt_BR')
```

## Usuários e Permissões

```
User                           AccountUser (junction)
├── id (PK)                    ├── id (PK)
├── name                       ├── user_id (FK → User)
├── email                      ├── account_id (FK → Account)
├── pubsub_token               ├── role (enum: 'agent' | 'administrator')
├── ui_settings (jsonb)        ├── custom_role_id (FK opcional)
├── access_token (has_one)     ├── auto_offline (bool)
└── account_users (has_many)   ├── availability (enum)
                               ├── active_at
                               └── permissions (string[])
```

**Importante:** o `role` no `AccountUser` é por conta. Mesmo `User` pode ser admin numa conta e agent em outra.

## Canal de Comunicação

```
Inbox
├── id (PK)
├── account_id (FK)
├── name
├── channel_type (string, ex: 'Channel::Waha')
├── channel_id (FK polimórfico)
├── enable_auto_assignment (bool)
├── working_hours_enabled (bool)
└── greeting_enabled (bool)

Channel::Waha / Channel::Whatsapp / Channel::WebWidget / ...
├── id (PK, table específica)
├── account_id (FK)
├── (campos específicos por canal)
└── has_one :inbox (via Channelable concern)

InboxMember (junction Inbox ↔ User)
├── inbox_id
├── user_id
└── auto_assignable (bool) — true = membro comum (entra na distribuição automática);
                              false = supervisor (vê TUDO da caixa, fora do rodízio)
```

> **Supervisor de caixa:** o flag `inbox_members.auto_assignable = false` marca o membro como
> supervisor. Ele enxerga todas as conversas/cards da caixa, mas o round-robin nunca atribui
> conversas a ele. As tools `lionchat_inbox_members_create/update` separam `user_ids[]` (membros
> comuns) de `supervisor_ids[]` (supervisores); a resposta expõe `is_supervisor` por agente.

## Conversação e Mensagens

```
Conversation
├── id (PK, global)
├── account_id (FK)
├── display_id (visível pra humanos, único por conta)
├── inbox_id (FK, optional: pode ser NULL se inbox deletada)
├── contact_id (FK → Contact)
├── contact_inbox_id (FK → ContactInbox)
├── assignee_id (FK → User, optional)
├── team_id (FK → Team, optional)
├── captain_assistant_id (FK → Captain::Assistant, optional)
├── status (int: 0/1/2/3)
├── priority (string)
├── snoozed_until (datetime, se status=3)
├── waiting_since (datetime)
├── first_reply_created_at (datetime)
├── last_activity_at (datetime)
├── custom_attributes (jsonb)
├── additional_attributes (jsonb)
└── labels (via taggings)

Message
├── id (PK)
├── account_id (FK)
├── conversation_id (FK)
├── inbox_id (FK)
├── content (text, nullable)
├── message_type (int: 0/1/2/3)
├── content_type (string)
├── content_attributes (jsonb)
├── status (enum: sent/delivered/read/failed/progress)
├── source_id (string, ID externo do canal)
├── sender_type / sender_id (polimórfico)
├── private (bool: nota privada)
├── sentiment (jsonb)
├── attachments (has_many)
└── created_at

Attachment
├── id (PK)
├── message_id (FK)
├── account_id (FK)
├── file_type (string ou int)
├── extension
├── file (ActiveStorage attached)
├── transcribed_text (string, áudio/PDF)
├── meta (jsonb, ex: image_description)
├── width / height (pixels)
└── file_size (bytes)
```

## Contatos

```
Contact
├── id (PK)
├── account_id (FK)
├── name
├── email
├── phone_number (E.164, ex: +5511999999999)
├── identifier (ID externo opcional)
├── additional_attributes (jsonb)
├── custom_attributes (jsonb)
├── pubsub_token
├── blocked (bool)
├── last_activity_at
└── company_id (FK → Company, optional)

ContactInbox (junction Contact ↔ Inbox)
├── id (PK)
├── contact_id (FK)
├── inbox_id (FK)
├── source_id (string, ID do contato no canal)
└── additional_attributes (jsonb, ex: not_on_whatsapp)

Company
├── id (PK)
├── account_id (FK)
├── name
└── domain
```

**`additional_attributes` vs `custom_attributes` no Contato:**
- `additional_attributes` (jsonb): campos do sistema porém **EDITÁVEIS via API** (`permitted_params` permite `additional_attributes: {}`). Guarda chaves padrão como `city`, `company`, `country_code` — que são as chaves filtráveis em `lib/filters/filter_keys.yml` (tipo `additional_attributes`). NÃO é não-editável.
- `custom_attributes` (jsonb): dado de negócio livre, definido pelo cliente via Atributos Customizados.

**Dados cadastrais (`additional_attributes.cadastral`):** CPF, CNPJ, RG, passaporte, nascimento,
gênero, estado civil, profissão e endereço completo moram em `additional_attributes->cadastral`.
São **IMUTÁVEIS por padrão** (primeira escrita vale) — alterar exige `force_update: true`, que SÓ
o painel humano usa. IA e integrações NUNCA passam force_update. Endpoint dedicado:
`PATCH /contacts/{id}/cadastral` (tool `contacts_update_cadastral`). NÃO grave cadastral como
custom_attribute. Regra absoluta relacionada: NUNCA sobrescrever `phone_number` já preenchido.

**Lead só com CPF (2026-06):** um lead só com CPF (sem telefone/email) agora vira contato real
pesquisável — o CPF fica em `identifier` (único) com fallback em `additional_attributes.cadastral.cpf`.
A identificação por CPF acontece na ingestão de webhooks (pagamento, Meta Lead Ads, webhook
universal); a superfície REST de contatos não mudou.

**Padrões de `source_id` por canal:**
- Waha: `5511999999999@c.us` (1-on-1) ou `120363xxx@g.us` (grupo) ou `XXXX@lid` (LID)
- WhatsApp Cloud: `5511999999999` (E.164 sem prefixo)
- Email: o email mesmo
- WebWidget: UUID gerado

## Kanban / CRM

```
KanbanConfig (1:1 com Account — config global do Kanban)
├── id (PK)
├── account_id (FK, unique)
├── enabled (bool, default true)
├── webhook_url / webhook_secret / webhook_events (jsonb array)
├── win_reasons (jsonb array de {id, title})        ← Motivos de Ganho — NATIVO
├── loss_reasons (jsonb array de {id, title})       ← Motivos de Perda — NATIVO
├── global_custom_attributes (jsonb array de {name, type, is_list, list_values})
├── checklist_templates (jsonb array de {id, name, items: [{id, text}]})
├── config (jsonb: title, default_view, auto_assignment, support_email, dragbar_enabled, ...)
└── created_at

Funnel
├── id (PK)
├── account_id (FK)
├── name
├── stages (jsonb: hash com slug_etapa => { name, color, position, description, checklist_templates })
├── settings (jsonb: { agents: [], goals: [], automations: [{trigger_type, action, action_config, enabled}] })
├── global_custom_attributes (jsonb array)
├── meta_events_config (jsonb: won/lost/stages → Meta Pixel/CAPI events)
├── archived (bool)
├── active (bool)
├── position (int, ordem entre funis)
└── created_at

KanbanItem
├── id (PK)
├── account_id (FK)
├── funnel_id (FK)
├── funnel_stage (string, nome da etapa atual)
├── stage_entered_at (datetime)
├── position (int, ordem dentro da etapa)
├── conversation_display_id (FK opcional → Conversation.display_id)
├── item_details (jsonb)
├── custom_attributes (jsonb)
├── assigned_agents (jsonb array)
├── linked_conversations (jsonb array de { display_id })
├── checklist (jsonb array de itens — NAO e tabela separada; ver abaixo)
├── activities (jsonb)
├── timer_started_at / timer_duration
└── created_at

Item do checklist (elemento do array jsonb `checklist`)
├── id (uuid string)
├── text
├── completed (bool)
├── position
├── group_id (opcional — itens com o mesmo group_id formam um grupo; ausente = avulso)
└── group_name (opcional — nome do grupo, snapshot do modelo aplicado)

KanbanNote
├── kanban_item_id (FK)
├── content (text)
└── created_at
```

## IA / Captain

```
Captain::Assistant
├── id (PK)
├── account_id (FK)
├── name
├── description
├── paused (boolean, default false) — botao de panico (2026-05-22). true = pausa respostas, follow-up e callbacks. Auditado. Top-level, NAO mora em config.
├── config (jsonb) — chaves principais:
│     model, temperature, instructions (max 20.000 chars), feature_memory, feature_faq,
│     feature_follow_up (bool), follow_up_steps (array de {after_minutes, prompt} — ATE 3 etapas,
│       cada uma >= 5 min, soma <= 1440 min/24h; legado follow_up_time+follow_up_prompt = 1 etapa),
│     activation_label (etiqueta que ativa o agente — unica por conta),
│     min_response_time / max_response_time (delay humanizado, 1-60s),
│     disabled_tools (array de IDs de tools desativadas pro assistente),
│     (faq_lookup/search_articles NÃO são desligáveis — auto-gerenciadas: carregam só quando há
│       FAQ/documento ou artigo publicado, e são escondidas do endpoint captain_assistants_tools)
│     offer_ids / media_asset_ids / booking_event_type_ids (arrays de IDs vinculados),
│     products (array legado de produtos)
├── guardrails (jsonb array de strings — limites duros injetados no prompt, ex: anti-pitch)
├── response_guidelines (jsonb array de strings — diretrizes de estilo de resposta)
└── active_conversations_count

⚠️ UPDATE de assistant: `config` faz MERGE PARCIAL (chaves não enviadas são preservadas);
`guardrails`/`response_guidelines` SUBSTITUEM o array inteiro.

Captain::Scenario (cenários do assistente — instruções inline, sem handoff)
├── assistant_id (FK)
├── title / description
├── instruction (text — tools referenciadas como links markdown [Titulo](tool://id))
├── tools (jsonb — auto-extraído da instruction)
├── enabled (bool)
├── trigger_type (llm_interpreted [default] | on_assistant_activation | on_first_customer_message)
│     ⚠️ trigger_type NAO é editável via API hoje — todo cenário criado por API fica em
│     llm_interpreted (a IA decide aplicar lendo a conversa). Os modos programáticos só
│     via banco/console por enquanto.
└── tool_bindings (jsonb — parâmetro FIXADO pelo admin por tool; "IA decide" = ausente/vazio)
      send_media_asset → { asset_ids: [Int] } | create_kanban_item / move_kanban_item →
        { funnel_id: Int, stage: "<key>" } | create_booking → { event_type_ids: [Int] }
      Obs: via API/MCP, scenarios_update SÓ persiste send_media_asset/create_kanban_item/
        move_kanban_item. O binding create_booking é só de UI/runtime — NÃO round-trippa pela API.
        Use config.booking_event_type_ids no assistente pra restringir agendas via MCP.

Captain::AssistantResponse (FAQ)
├── assistant_id (FK)
├── question
├── answer
├── status (pending/approved/rejected)
├── embedding (vector, pgvector)
└── documentable (polymorphic: Conversation que gerou)

Captain::Document (Base de conhecimento)
├── assistant_id (FK)
├── content (text)
└── name

Captain::CopilotPrompt (Prompts salvos)
├── account_id (FK)
├── title
└── prompt (text)
```

## Automações

```
AutomationRule
├── id (PK)
├── account_id (FK)
├── name
├── event_name (conversation_created, conversation_resolved, message_created, conversation_opened, conversation_updated)
├── action_types (jsonb array) — subtipos de conversation_updated:
│     label_added, label_removed, status_changed, priority_changed,
│     agent_assigned, team_assigned, custom_attribute_changed,
│     language_changed, ai_agent_assigned. Vazio/nulo = retrocompat (dispara em qualquer)
├── conditions (jsonb array)
├── actions (jsonb array)
├── inbox_id (FK, opcional — usado em event_name=webhook)
└── active (bool)

Macro
├── id (PK)
├── account_id (FK)
├── name
├── actions (jsonb array)
└── visibility (personal/global)
```

## Agenda / Tarefas / Booking

```
AccountTask (agenda interna)
├── id (PK)
├── account_id (FK)
├── user_id (FK → User, optional)
├── created_by (FK → User)
├── title
├── description
├── task_type (string: task/follow_up/call/meeting/video_call/deadline/custom)
├── priority (string: none/low/medium/high/urgent)
├── status (enum: pending=0 (default) / completed=1 / cancelled=2 / snoozed=3)
├── scheduled_at (datetime) — data/hora da tarefa
├── duration_minutes (int, default por task_type: task/follow_up=15, call=30, meeting/video_call=60)
├── snoozed_until (datetime, se status=snoozed)
├── recurrence_type (string nullable: daily/weekly/biweekly/monthly/yearly; nil = tarefa única)
├── recurrence_count (int nullable, 1-365)
├── meeting_url (string, sala de reunião call/meeting)
├── guest_emails (jsonb array, convidados extras — máx 20)
├── conversation_id / contact_id / linked_kanban_item_id (FK opcionais)
└── assignees (has_many → User, via account_task_assignments)

BookingEventType (template de agendamento)
├── id (PK)
├── account_id (FK)
├── name (ex: "Demo 30min")
├── duration_minutes
├── availability_rules (jsonb)
└── description

Booking (agendamento confirmado)
├── id (PK)
├── account_id (FK)
├── booking_event_type_id (FK)
├── user_id (FK, agente que vai atender)
├── attendee_name / attendee_email / attendee_phone
├── start_time / end_time (ISO 8601)
├── status (scheduled/cancelled/completed)
└── meeting_url (Google Calendar / Zoom / etc)
```

**Atributos de sistema do Booking no CONTATO (novo 2026-07-06):** ao confirmar um agendamento,
8 custom attributes protegidos são gravados no contato — usáveis como variável
(`{{contact.custom_attribute.booking_date}}` etc.) em mensagem/flow/automação:

| Chave | Tipo | Conteúdo |
|---|---|---|
| `booking_title` | text | Título do tipo de evento (ex: "Consultoria 45min") |
| `booking_date` | date | Data do agendamento, ISO `YYYY-MM-DD` |
| `booking_time` | **time** | Hora 24h `"HH:MM"` (tipo novo — encaixa direto no campo Horário do node `wait`) |
| `booking_datetime` | text | ISO 8601 completo com fuso (referência; prefira date/time como variável) |
| `booking_duration` | text | Ex: "45 min" |
| `booking_type` | text | "Call / Meet" ou "Agendamento" |
| `booking_agent` | text | Nome do agente responsável |
| `booking_description` | text | Observação do cliente ao agendar |

## e-Clínicas (Efficient) — integração de clínicas

9 eventos de webhook, cada um mapeável a automação OU flow na tela Integrações > e-Clínica:
`cliente_novo`, `agendamento_novo`, `falta`, `pagamento` (os 4 da doc oficial) +
`agendamento_atendido`, `agendamento_alterado`, `agendamento_desmarcado`,
`agendamento_transferido`, `cliente_baixa_pagamento` (capturados ao vivo, não documentados
pelo e-Clínica).

Atributos de sistema no CONTATO (prefixo `eclinica_`, protegidos, usáveis como variável):

| Chave | Tipo | Conteúdo |
|---|---|---|
| `eclinica_cliente_id` | text | ID do paciente no e-Clínica (chave de matching) |
| `eclinica_unit_id` / `eclinica_unit_name` | text | Unidade/filial que originou o evento |
| `eclinica_idagenda` | text | ID do último agendamento |
| `eclinica_data_consulta` | date | Data da consulta, ISO |
| `eclinica_hora_consulta` | **time** | Hora da consulta 24h `"HH:MM"` (novo 2026-07-06) |
| `eclinica_status_agendamento` | text | agendado / no_show / atendido / desmarcado |
| `eclinica_compromisso` | text | Tipo da consulta (ex: Consulta, Retorno, Exame) |
| `eclinica_ultimo_pagamento` | text | Valor do último pagamento |
| `eclinica_ultimo_pagamento_data` | date | Data do último pagamento/baixa (novo 2026-07-06) |
| `eclinica_ultimo_pagamento_descricao` | text | Descrição da baixa (ex: CONSULTA INICIAL) |

## Relatórios e Métricas

```
ReportingEvent
├── account_id (FK)
├── name (conversation_created, conversation_resolved, csat_score, ...)
├── value (numeric)
├── value_in_business_hours (numeric)
├── conversation_id (FK opcional)
├── user_id (FK opcional)
├── inbox_id (FK opcional)
└── created_at

CsatSurveyResponse
├── conversation_id (FK)
├── contact_id (FK)
├── score (1-5)
├── feedback_message
└── created_at

SLA::Policy (políticas de SLA)
├── account_id (FK)
├── first_response_time_threshold (int, seconds)
├── next_response_time_threshold
├── resolution_time_threshold
└── conditions (jsonb)
```

## Webhooks / Integrações

```
Webhook (saída)
├── account_id (FK)
├── url
├── subscriptions (string[]: eventos a notificar)
└── inbox_id (FK opcional, scope)

Integrations::Hook (integrações: OpenAI, Groq, Slack, etc)
├── account_id (FK)
├── app_id (string: 'openai', 'groq', 'slack', 'dialogflow', ...)
├── settings (jsonb: api_key, model, ...)
├── status (boolean: ligado/desligado)
└── reference_id (string opcional)

MetaLeadIntegration (Facebook Lead Ads)
├── account_id (FK)
├── page_id
├── page_name
├── business_id / business_name (BM dona da página — rótulo, desde 2026-06 a conexão é POR PÁGINA)
├── facebook_page_id (FK polimórfico)
├── status (active/token_expired/paused)
└── meta_lead_forms (has_many)

CustomWebhookIntegration (Webhook Universal — entrada)
├── account_id (FK)
├── name / token (URL única) / active
├── field_mapping (jsonb — suporta caminhos com índice de array: messages.0.content)
├── event_automation_mapping (jsonb)
└── flow_id (FK opcional → Flow; presente = webhook EMBUTIDO de flow, oculto da listagem standalone)

LiontrackJourneyStage (regras de fase da Jornada do Lead — feature flag liontrack)
├── account_id (FK)
├── stage (nome da fase, ex: Topo/Meio/Fundo/Compra)
├── url_pattern (match literal de substring, <= 255 chars — SEM regex)
└── position (int, ordem)

WhatsappCall (Ligação WhatsApp — enterprise, voz via Cloud API)
├── account_id / conversation_id / contact_id (FKs)
├── status (ringing/accepted/completed/failed) / direction
├── duration_seconds / accepted_by_agent_id
├── custom_name (observação) / favorited (bool)
└── transcript / transcript_status (pending/processing/completed/failed — IA da conta)

WavoipSetting (Ligação WP em caixa QR Code — 1 por inbox, 2026-06-11)
├── inbox_id (FK) / device_id / device_token (cripto) / status / due_date
├── record_all_calls (bool) / auto_transcribe (bool) / transcription_provider (groq|openai)
└── feature flag wavoip_calling; limite de plano wavoip_voice_inboxes; R$70/device/mês

ContactDocument (aba Documentos do contato, 2026-06-11)
├── 3 fontes agregadas: upload direto + espelho dos cards Kanban + espelho das conversas (só image/file)
├── dedup por checksum (arquivo repetido conta 1x no storage)
└── ações: preview, download, renomear, favoritar, excluir (conversas são só-leitura)
```

## Cardinalidades importantes

- `Account` 1—N `User` (via AccountUser)
- `Account` 1—N `Inbox`
- `Account` 1—N `Contact`
- `Account` 1—N `Conversation`
- `Conversation` 1—N `Message`
- `Message` 1—N `Attachment`
- `Contact` 1—N `ContactInbox` (um por canal)
- `Funnel` 1—N `KanbanItem`
- `Conversation` 0..1—1 `KanbanItem` (opcional)
- `Conversation` 0..1—1 `Captain::Assistant` (opcional, via captain_assistant_id)

## Como navegar (queries comuns)

### Conversa → Cliente
```
Conversation → contact_id → Contact
```

### Cliente → Todas as conversas
```
Contact → has_many :conversations
```

### Mensagem → Conta
```
Message → account_id (direto) OU Message → conversation → account_id
```

### Card Kanban → Conversa vinculada
```
KanbanItem → conversation_display_id → Conversation (where display_id = X)
```

### Conta → Plano e features
```
Account → plan_id → Plan
Account.feature_enabled?('captain_v2')  # checa bitfield
```

## Soft-delete e statuses

- Conversation NUNCA é deletada — só muda `status` (snoozed, resolved)
- Inbox quando deletada → conversations ficam com `inbox_id = NULL` (dependent: :nullify)
- Contact pode ser deletado (raro) — destroi conversations em cascata (cuidado)
- KanbanItem pode ser deletado livremente
- Funnel `archived = true` → não aparece na UI mas dados permanecem
