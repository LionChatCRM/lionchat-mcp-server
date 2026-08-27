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
│       cada uma >= 5 min, soma <= 1380 min = 23h (2026-07-29 — NAO 1440: a janela de 24h do WhatsApp
│       conta da MENSAGEM DO CLIENTE, nao do 1o follow-up, entao 1440 disparava com a janela ja fechada.
│       Somar 1440 = 422. GOTCHA: no campo legado follow_up_time a mensagem de erro do servidor ainda
│       diz "must be between 5 and 1440 minutes" por engano — o teto que ele aplica e 1380);
│       legado follow_up_time+follow_up_prompt = 1 etapa),
│     follow_up_skip_conditions (array — condicoes pra NAO fazer follow-up, logica OU, ate 3; tipos:
│       label {operator present|absent, labels[]}; contact_attr/conversation_attr {attribute, operator
│       equal|not_equal|contains|present|blank|gt|lt, value}; time_window {start, end — horas inteiras
│       0-23; NAO envia follow-up nesse periodo, janela circular ex 22->7; a IA SEGUE respondendo o
│       cliente normal — o silencio e so do follow-up}),
│     feature_pause_on_human_reply (bool, nasce DESLIGADO — quando ligado, a IA se DESLIGA sozinha na
│       conversa quando um HUMANO assume: atendente responde pelo painel (ao vivo) OU mensagem enviada
│       do celular. NAO conta: nota privada, msg da propria IA, automacao, campanha, confirmacao de
│       agendamento. MENSAGEM AGENDADA DEPENDE DE QUEM AGENDOU (2026-07-29): agendada pela IA (a tool
│       carimba source_type='Captain::Assistant' e o disparo assina como o assistente) NAO desliga;
│       agendada por ATENDENTE assina como User com Current.user setado no disparo = conta como
│       atendente ao vivo e DESLIGA a IA da conversa),
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
├── tool_bindings (jsonb — parâmetro FIXADO pelo admin por tool; "IA decide" = ausente/vazio)
│     send_media_asset → { asset_ids: [Int] } | create_kanban_item / move_kanban_item →
│       { funnel_id: Int, stage: "<key>" } | create_booking → { event_type_ids: [Int] }
│     Obs: via API/MCP, scenarios_update SÓ persiste send_media_asset/create_kanban_item/
│       move_kanban_item. O binding create_booking é só de UI/runtime — NÃO round-trippa pela API.
│       Use config.booking_event_type_ids no assistente pra restringir agendas via MCP.
└── document_ids (jsonb, default [] — DERIVADO das menções [@Nome](document://ID) escritas na
      instruction; NUNCA aceito como param na API/MCP (é ignorado se enviado); re-escopado por
      assistente+conta; teto de 3 documentos. Serve pra IA PRIORIZAR a busca RAG naquelas páginas —
      NÃO é exclusividade: o resto da base continua pesquisável)

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

BookingEventType (template de agendamento — tools `booking_event_types_*`; colunas de
db/schema.rb, tabela booking_event_types)
├── id (PK) / account_id (FK) / user_id (FK → agente padrão)
├── title (ex: "Demo 30min") / description / slug (endereço público próprio)
├── duration_minutes / slot_granularity_minutes / buffer_minutes
├── min_notice_hours / max_advance_days / max_per_day / available_from / available_until
├── task_type (meeting/video_call — `video_call` gera Meet)
├── timezone (IANA — o fuso dos horários é SEMPRE o do tipo, nunca o do navegador)
├── color (hex `#RRGGBB`, opcional — cor dos compromissos desse tipo no calendário; vazio = cor do
│   agente; 2026-08-19)
├── active / ask_email / ask_description
├── confirmation_* (mensagem de confirmação própria: enabled, inbox_id, channel_type,
│   template_name, blocks). Variáveis nos textos de confirmação E de lembrete (interpolador único):
│   {{nome}} {{email}} {{telefone}} {{data}} {{horario}} {{dia_semana}} (NOVO 24/08 — dia por
│   extenso em pt: "terça-feira"; irmã do {{booking.weekday}} do FlowBuilder, mesma grafia)
│   {{tipo_evento}} {{titulo}} {{duracao}} {{agente}} {{descricao}} {{meet_link}}
│   {{link_cancelar}} {{link_remarcar}} {{horas_ate_evento}} {{horas_desde_evento}}
└── booking_availabilities (has_many — dias/horários; `booking_availabilities_attributes` no create)

Booking (agendamento confirmado — tabela bookings)
├── id (PK)
├── account_id (FK) / booking_event_type_id (FK) / account_task_id (FK 1:1 → AccountTask)
├── contact_id (FK) / guest_name / guest_email / guest_phone / guest_description
├── scheduled_at / duration_minutes
├── status (confirmed/cancelled/completed) — **NÃO acompanha a Agenda**: concluir ou cancelar pela
│   tela da Agenda (o caminho normal da equipe) deixa o booking em `confirmed`. A situação real é
│   `account_tasks.status` (pending/completed/cancelled/snoozed) da tarefa vinculada — é ela que o
│   relatório de Agendamentos e os gatilhos `booking_*` do FlowBuilder leem
├── cancelled_at / cancellation_reason / confirmation_sent_at / utm_params
└── (o agente responsável e o `meeting_url` moram na TAREFA: `account_tasks.user_id` e
    `account_tasks.meeting_url`)
```

**Duração sob medida (2026-08-19):** ao marcar pelo painel/API (`lionchat_tasks_create` com
`booking_event_type_id`) pode-se mandar `duration_minutes` diferente do tipo (5 a 1440; fora da
faixa o sistema usa a do tipo). A lista de horários livres aceita o mesmo parâmetro
(`lionchat_booking_event_types_slots?date=AAAA-MM-DD&duration_minutes=60`) e **os horários mudam**
— 60 min num tipo de 30 some com os encaixes que não cabem. Sempre peça os slots com a MESMA duração
que vai gravar. A página pública e a IA não têm essa opção (duração do tipo, sempre).

**Cor por tipo (2026-08-19):** `booking_event_types.color` (hex `#RRGGBB`) pinta os compromissos
daquele tipo no calendário; vazio = cor do agente. A tarefa devolve `booking_color` já resolvido.

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

15 eventos de webhook, cada um mapeável a automação OU flow na tela Integrações > e-Clínica
(o mapeamento é SÓ pela tela — não há ferramenta MCP que escreva `event_mapping`):
`cliente_novo`, `agendamento_novo`, `falta`, `pagamento` (os 4 da doc oficial) +
`agendamento_atendido`, `agendamento_alterado`, `agendamento_desmarcado`,
`agendamento_transferido`, `cliente_baixa_pagamento`, `cliente_alteracao`,
`cliente_inclusao_pagamento`, `controle_laboratorio_novo`, `controle_laboratorio_alterado`,
`agendamento_aguardando`, `odontograma_aprovado`
(capturados ao vivo, não documentados pelo e-Clínica).

Os 2 últimos são do perfil ODONTOLÓGICO (2026-08-20): `agendamento_aguardando` = a recepção marcou a
chegada do paciente na clínica (grava a hora da chegada e `eclinica_status_agendamento = aguardando`);
`odontograma_aprovado` = plano de tratamento aprovado (grava o cabeçalho do odontograma).

Atributos de sistema no CONTATO (prefixo `eclinica_`, protegidos, usáveis como variável):

| Chave | Tipo | Conteúdo |
|---|---|---|
| `eclinica_cliente_id` | text | ID do paciente no e-Clínica (chave de matching) |
| `eclinica_unit_id` / `eclinica_unit_name` | text | Unidade/filial que originou o evento |
| `eclinica_idagenda` | text | ID do último agendamento |
| `eclinica_data_consulta` | date | Data da consulta, ISO |
| `eclinica_hora_consulta` | **time** | Hora da consulta 24h `"HH:MM"` (novo 2026-07-06) |
| `eclinica_hora_final` | **time** | Hora final da consulta (novo 2026-07-27) |
| `eclinica_status_agendamento` | text | `agendado` / `aguardando` (paciente chegou) / `no_show` / `atendido` / `desmarcado`. Vem do TIPO do evento, nunca da letra da situação. **Estado terminal do MESMO agendamento não volta pra `agendado`** (2026-08-20): a e-Clínica manda `agendamento_alterado` a cada edição da consulta, inclusive depois da chegada/atendimento, e isso NÃO reabre o status. Consulta com `eclinica_idagenda` DIFERENTE nasce `agendado` |
| `eclinica_situacao` | text | Situação do agendamento no painel, **POR EXTENSO** (2026-08-21, legenda oficial da e-Clínica): AGUARDANDO, NA CADEIRA, PASSAR FINANCEIRO, AGENDAR RETORNO, ATENDIDO, CONFIRMADO, CONFIRMADO PELO LINK, CONFIRMADO PELA API, FALTA, DESMARCADO, CANCELADO PELO LINK, CANCELADO PELA API. Antes guardava a letra crua (`A`, `C`…). Código nunca visto aparece como veio |
| `eclinica_compromisso` | text | Tipo da consulta — TEXTO LIVRE da recepção (ex: Consulta, Retorno) |
| `eclinica_agendatipo` | text | Tipo de Agendamento — NOME da lista fixa do painel, resolvido por unidade (novo 2026-07-28). **Filtrar sempre pelo NOME, nunca pelo número: os números colidem entre filiais** |
| `eclinica_agendatipo_id` | text | Tipo de Agendamento — número cru (não comparável entre filiais) |
| `eclinica_cor` | text | Cor do agendamento na agenda (hex, ex `#556B2F`) — novo 2026-08-18. Campo ESPARSO: evento sem cor APAGA a chave (nunca herda a da consulta anterior). No filtro, escrever com o `#`. Nos lembretes, a variável de sessão `{{cor}}` traz a cor da consulta daquele lembrete |
| `eclinica_profissional` | text | NOME do profissional, resolvido por unidade (novo 2026-07-10) |
| `eclinica_profissional_id` | text | Número do profissional (não comparável entre filiais) |
| `eclinica_convenio_id` | text | Convênio (número) |
| `eclinica_ultimo_evento` | text | Tipo do último webhook recebido (ex: falta, agendamento_novo) |
| `eclinica_ultimo_pagamento` | text | Valor do último pagamento |
| `eclinica_ultimo_pagamento_data` | date | Data do último pagamento/baixa (novo 2026-07-06) |
| `eclinica_ultimo_pagamento_descricao` | text | Descrição da baixa (ex: CONSULTA INICIAL) |
| `eclinica_ultima_chegada_idagenda` | text | Agendamento em que o paciente chegou pela última vez (2026-08-20) |
| `eclinica_ultima_chegada_data` | date | Data da última chegada do paciente na clínica |
| `eclinica_ultima_chegada_hora` | **time** | Hora em que a recepção marcou a chegada (`age_horaguardando`, ex `15:06`) |
| `eclinica_odontograma_id` | text | ID do último odontograma/plano de tratamento aprovado (2026-08-20) |
| `eclinica_odontograma_aprovado_em` | date | Dia da aprovação, já no fuso da conta (o webhook manda em UTC) |
| `eclinica_odontograma_inicio` | date | Data de início do tratamento (`odo_datainicio`) |
| `eclinica_odontograma_situacao` | text | Código de situação como vem da e-Clínica (ex: `T`) |
| `eclinica_odontograma_valor` | text | Valor do plano — **pode vir `0.00`** quando a clínica não preenche |
| `eclinica_odontograma_profissional` | text | NOME do profissional do odontograma |
| `eclinica_odontograma_convenio_id` | text | Convênio do odontograma (número) |
| `eclinica_marcador_nome` | text | Marca que a clínica digita no fim do nome do paciente no e-Clínica (ex: `*`, `***`) — retirada do nome e guardada aqui (2026-08-20). Significado é da clínica |
| `eclinica_laboratorio_data_prevista` | date | Previsão de entrega da medicação (novo 2026-07-23) |
| `eclinica_laboratorio_data_moldagem` | date | Data do pedido da medicação |
| `eclinica_laboratorio_data_entrega` | date | Data em que a medicação CHEGOU na unidade — é a data que dispara o aviso de retirada do flow |
| `eclinica_laboratorio_data_retirada` | date | Data em que o paciente RETIROU a medicação (coa_datainstalacao; novo 2026-08-03). NÃO confundir com a entrega. Vazia = peça atual não retirada |
| `eclinica_laboratorio_trabalho_id` | text | Trabalho/tipo da medicação — número cru (aparelho_id; novo 2026-08-03). Lista própria de cada unidade (COMPRIMIDO/POMADA/SPRAY...); número não comparável entre filiais |
| `eclinica_laboratorio_trabalho` | text | Trabalho/tipo da medicação — NOME resolvido na lista da própria unidade ("SPRAY", "POMADA"...; novo 2026-08-03). Best-effort: pode ficar vazio se a API da unidade estiver fora do ar. Para filtrar/personalizar flows, use SEMPRE este NOME, nunca o número |
| `eclinica_laboratorio_situacao` | text | Situação do pedido no laboratório |
| `eclinica_ultima_cobranca_valor` | text | Valor da última cobrança/carnê gerado |
| `eclinica_ultima_cobranca_vencimento` | date | Vencimento da última cobrança |
| `eclinica_ultima_cobranca_descricao` | text | Descrição da última cobrança |

**Regras de atualização que enganam na leitura (2026-08-20/21):**

- `eclinica_situacao` e `eclinica_cor` são **esparsas**: evento de agenda que vem SEM o campo
  **apaga a chave** (vazio = "a recepção ainda não marcou", não "sem dado"). `agendamento_novo`
  nunca traz situação — logo depois de marcar, a situação fica vazia de propósito.
  `agendamento_atendido` e `agendamento_desmarcado` **atualizam** a situação (ATENDIDO, DESMARCADO);
  antes de 21/08 a ficha ficava "NA CADEIRA" depois do atendimento (conserto de 21/08/2026 — entra
  com o próximo deploy do app depois de 21/08/2026).
- Códigos com mais de uma letra pro mesmo estado: `O`/`OK` = CONFIRMADO, `D`/`W` = DESMARCADO.
  Código fora da legenda fica gravado como veio (nunca vazio, nunca palpite).
- `agendamento_aguardando` (paciente chegou) grava a chegada por cima do agendamento, mas **não
  agenda nem cancela lembrete** (chegada não é consulta nova) e **não apaga** cor/situação quando
  vem sem elas.
- `eclinica_ultima_chegada_*`, `eclinica_ultimo_pagamento*` e `eclinica_odontograma_*` guardam o
  ÚLTIMO evento; paciente com 3 consultas tem sempre a última na ficha (não há histórico no contato —
  use `lionchat_eclinica_reminder_history_list` e o log de eventos da tela).

**Lembretes automáticos (Integrações > e-Clínica > Lembretes).** Cada linha tem um **tipo de
evento** que decide de qual data a contagem parte: `agendamento` (data da consulta, padrão),
`controle_laboratorio_novo` (previsão de entrega da medicação) e `cliente_inclusao_pagamento`
(vencimento da cobrança). Desde 2026-07-25 cada linha exige também uma **hora do disparo** —
`HH:MM` fixo ou fórmula com variável de conta/contato (ex.: horário por unidade, ou a própria hora
da consulta) — em vez de herdar sempre o horário da consulta. Há ainda um filtro opcional
("Só quando") por atributo `eclinica_*` do contato. Nada disso é editável pelo MCP: só pelo painel.
Pra auditar o que foi/será disparado, use `lionchat_eclinica_reminder_history_list`.

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

LeadForm (Formulário público de captação — feature flag lead_forms, por conta)
├── account_id (FK)
├── name / slug (8 chars, gerado na criação e imutável) / display_mode (cards|chat) / active
├── form_data (jsonb: o desenho do construtor) — published_data (a FOTO publicada, que a página usa)
├── settings (jsonb: primary_color, theme, abandon_minutes, button_label, resume, chat_avatar,
│   public_title — título que o LEAD vê, 2026-08-21) / published_at
└── counts: views / responses / completed (contadores) + lead_form_responses (has_many)

LeadFormResponse (um preenchimento do formulário)
├── lead_form_id (FK) / account_id (FK)
├── contact_id (FK opcional — o contato nasce assim que nome+telefone entram, mesmo sem concluir)
├── status (in_progress / completed / abandoned)
└── answers (respostas) / milestones (marcos atingidos) / utm_params / started_at / completed_at /
    abandoned_at

CustomWebhookIntegration (Webhook Universal — entrada)
├── account_id (FK)
├── name / token (URL única) / active
├── field_mapping (jsonb — caminho do payload → destino: campo nativo, `contact_attr_<k>`,
│   `conversation_attr_<k>` (2026-08-21 — entra com o próximo deploy do app depois de 21/08/2026),
│   `cadastral_<k>`, `social_<k>`; aceita índice de array: messages.0.content)
├── event_automation_mapping (jsonb)
└── flow_id (FK opcional → Flow; presente = webhook EMBUTIDO de flow, oculto da listagem standalone)

Gateways de pagamento (GuruWebhook, HotmartWebhook, KiwifyWebhook, EduzzWebhook, TictoWebhook,
MonetizzeWebhook, GreennWebhook, ContaAzulIntegration, OmieIntegration — tools
`lionchat_ecommerce_webhooks_*`, `conta_azul_integrations_*`, `omie_integrations_*`)
├── event_automation_mapping (jsonb) — uma entrada por evento do gateway:
│   { "<evento>": { automation_id, flow_id, first_purchase_only } }
│   (Conta Azul/Omie usam `event_mapping`, por categoria).
│   ATENÇÃO (26/08/2026): `conversation_attribute_keys` foi REMOVIDA dos gateways de pagamento
│   (existiu de 21 a 26/08) — o backend IGNORA a chave se gravada. Atributo de conversa mapeado
│   continua existindo SÓ no Meta Lead e no Webhook Universal.
└── Leia o mapeamento atual antes de gravar: o `update` SUBSTITUI o jsonb INTEIRO (não mescla) —
    mande todos os eventos de volta, senão os outros somem.

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

WavoipSetting — TABELA REMOVIDA em 13/08/2026 (integração Wavoip encerrada; último uso 30/07)
└── Não existe mais modelo, tabela, tela nem rota. Ligações ANTIGAS do Wavoip continuam no
    histórico (CallLog com provider "wavoip"), com quem ligou, quando e quanto durou; as gravações
    ficavam no servidor da Wavoip e vão sumir. Para voz em caixa QR Code hoje: LionCalls.

ContactDocument (aba Documentos do contato, 2026-06-11)
├── 3 fontes agregadas: upload direto + espelho dos cards Kanban + espelho das conversas (só image/file)
├── dedup por checksum (arquivo repetido conta 1x no storage)
└── ações: preview, download, renomear, favoritar, excluir (conversas são só-leitura)
```

**Histórico de preenchimentos por CONTATO (2026-08-21 — entra com o próximo deploy do app depois
de 21/08/2026):** `GET /contacts/{id}/form_entries` (aba "Preenchimentos" da ficha; tools
`lionchat_contacts_form_entries_list` / `_show`) junta, em ordem de data, o que a pessoa preencheu
em nosso formulário, no formulário nativo do Meta, no Webhook Universal e no webhook de flow (origem
`flow`, com o nome do fluxo) — cada item `{source, id, title, status, at, count, conversation}` e
`/form_entries/{source}/{id}` abre o detalhe. Como cada preenchimento SOBRESCREVE os atributos do
contato, a ficha só mostra o último — esta lista guarda todos. Origens de fora exibem SÓ os campos
vinculados a atributos daqui e realmente gravados (nada do payload cru). Ao mesclar contatos, as
origens vão pro contato vencedor. Os eventos do Meta Lead **não são mais expurgados após 90 dias**
(decisão do dono, 21/08).

### Google Contatos (integração nativa)

Salva contatos do LionChat no **Google Contatos** da conta Google conectada pelo admin (etiqueta "LionChat"), fazendo o celular/WhatsApp exibirem o nome do cliente. Conexão é **uma por conta**, feita **somente pela interface** (Configurações → Integrações → Google Contatos → "Conectar conta Google" — é OAuth no navegador, **não há tool MCP** para conectar). Comportamento: contato novo com telefone sobe automático (~1 min); botão "Enviar contatos existentes" manda a base antiga (vira "Ressincronizar contatos" depois — idempotente, nunca duplica); rename aqui propaga pro Google só em contatos criados pelo sistema; nunca apaga nem altera a agenda pessoal do cliente. Quando o usuário perguntar "dá pra salvar os contatos no celular/Google?", oriente esse caminho de tela.

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


## Limites da conta (18/08)

Os limites que a API devolve (`resource_limits.*` da conta, `email_usage.limit`,
`ai_agent_usage.limit`) são a SOMA de: limite do plano + ajustes manuais do Super Admin +
**adicionais contratados na tela de Cobrança** (recurso liberado na hora da contratação). Ou seja:
duas contas no MESMO plano podem ter limites diferentes — não é defeito. Limite `0` significa
ILIMITADO em toda a plataforma. A contratação/remoção de adicionais é feita SÓ pela tela de
Cobrança do painel (não há ferramenta MCP para isso, por decisão do dono).
