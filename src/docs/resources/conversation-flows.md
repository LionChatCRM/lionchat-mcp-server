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

Roda após automation rules. Existem **DOIS caminhos vivos** (`Inbox#auto_assignment_v2_enabled?`),
não um moderno e um legado:

```
SE inbox.assignment_policy vinculada:
  → modo POLÍTICA: round-robin ou balanced, prioridade da fila, capacidade
SENÃO SE inbox.enable_auto_assignment (botão "Distribuição automática" da própria caixa):
  → modo SIMPLES: round-robin entre os membros da caixa
SENÃO:
  → assignee_id fica null (atribuição manual)
```

Os dois caminhos rodam no MESMO serviço (`AutoAssignment::AssignmentService`), usam o MESMO rodízio
(`AutoAssignment::RoundRobinSelector` — só a política pode trocá-lo pelo modo `balanced`) e passam
pelo MESMO freio de rajada
(`AutoAssignment::RateLimiter`). O que muda é de onde vem a configuração: com política vinculada, ela
manda em tudo (inclusive em "distribuir para agentes offline"); sem política, vale o que está no
`auto_assignment_config` da própria caixa.

**NUNCA escreva que o modo simples é legado, nem recomende criar Política de Atribuição para quem só
quer o botão da caixa.** Vincular uma política **esconde a seção inteira de Distribuição Automática da
tela da caixa** (`CollaboratorsPage.vue`: `showAutoDistribution = !inbox.has_assignment_policy`). O
cliente perde os controles que estava usando, não entende por que sumiram, e o que ele configurou lá
passa a ser ignorado (o valor fica gravado e só volta a valer se a política for desvinculada).

Regra prática:
- Cliente quer só "dividir os leads entre a equipe" → **botão da própria caixa**. Não crie política.
- Cliente quer regra compartilhada entre várias caixas, modo balanced, prioridade de fila ou limite de
  capacidade por atendente → aí sim Política de Atribuição.

Quem entra no rodízio: só `inbox_members` com `auto_assignable: true` (supervisor de caixa fica de
fora) e, se "distribuir para agentes offline" estiver desligado, só quem está online.

**LEIA o valor da conta antes de responder — NUNCA recite um número de cabeça.** Os valores reais
vêm na resposta da API:
- `has_assignment_policy` (resposta da caixa) diz QUAL dos dois caminhos vale ali. `true` = política
  manda; `false` = vale o botão da própria caixa.
- Com política vinculada, leia `fair_distribution_limit` (quantas conversas por atendente),
  `fair_distribution_window` (tamanho da janela, **em segundos**) e `assign_offline_agents` na
  resposta da política. O `auto_assignment_config` da caixa é **IGNORADO** nesse caso — não o cite.
- Sem política, leia as MESMAS chaves dentro do bloco `auto_assignment_config` da caixa
  (`fair_distribution_limit`, `fair_distribution_window`, `assign_offline_agents`).
- Chave ausente/vazia = vale o padrão de fábrica (hoje 10 conversas a cada 600 segundos) — cite isso
  só como "valor de fábrica, confira o da conta", nunca como se fosse a configuração do cliente.

**EXCEÇÃO SEM FREIO (não dá pra descobrir lendo a resposta):** caixa **sem** política vinculada, com
`assign_offline_agents` LIGADO e **sem número escolhido** em `fair_distribution_limit`, roda **SEM
FREIO NENHUM** (`AutoAssignment::RateLimiter#resolve_limit`: `return 0 if inbox.assign_offline_agents?`).
Racional (decisão do dono 29/07): com offline ligado todo membro está sempre na roleta, então a divisão
já é igual por construção e o freio só atrasaria a entrega. Não existe campo dizendo "sem freio" — o
bloco vazio parece "padrão", mas não é. Efeito prático: **nessas caixas, dizer ao cliente que existe um
teto por atendente é MENTIRA**. Número escolhido pelo cliente sempre vence o toggle: se
`fair_distribution_limit` tem um número MAIOR QUE ZERO, o freio existe mesmo com offline ligado.

**Zero também é "sem freio":** na caixa (não na política), `fair_distribution_limit: 0` é a saída
explícita de quem não quer teto nenhum — o freio fica desligado (`RateLimiter#enabled?` exige limite
positivo). Ou seja, existem DUAS formas de a caixa ficar sem freio: campo vazio com offline ligado, ou
zero escrito de propósito. Na Política de Atribuição o zero nem é aceito (o cadastro exige maior que
zero), então política vinculada SEMPRE tem freio.

### 5. Captain (IA Agente)

Se `captain_assistant_id` foi setado (manual ou via automação):
- Mensagem incoming dispara `Captain::ResponseBuilderJob`
- Job tem **debounce** (~10s) — agrupa mensagens em rajada
- Chama LLM com prompt do assistant + histórico
- LLM pode invocar tools (FAQ, update_contact, create_booking, etc)
- Resposta vira `Message` outgoing com `sender_type: Captain::Assistant`
- Conhecimento passivo: a IA recebe FAQ + artigos relevantes no prompt sem chamar ferramenta (só se houver conteúdo).
- Cenário pode FIXAR o parâmetro de uma tool (mídia/funil-etapa/agenda) → execução determinística (mídia/kanban pós-turno via BindingResolver).
- Tool que falha aciona o anti-loop (aviso escalonado + tetos 5/tool e 25/turno).
- Comentários do Instagram: chegam como mensagens (content_attributes.image_type='ig_comment' + in_reply_to_comment_id). Pra responder um comentário via API, mande a mensagem na conversa com content_attributes { reply_mode: 'private'|'public', in_reply_to_comment_id }. O AI Agente responde só DM (não comenta em post).

**Quando IA é desativada manualmente:**
- Agente clica em "Desativar AI" → `captain_assistant_id` vira null
- `custom_attributes.captain_manually_disabled = true`
- IA não responde mais nessa conversa (mesmo se nova msg)

### 6. Estado "pending" (status 2)

Conversa em "pending" significa "aguardando algo" — status HUMANO reativado (2026-07-20,
handoff consultor→gestor). Pendente só acontece por ação explícita:
- Botão "Deixar pendente" no painel
- Ação de automação `pending_conversation`
- Node `change_status` do FlowBuilder com `status: pending`
- Ferramenta nativa da IA (deixar conversa pendente)

Comportamentos importantes:
- Mensagem nova do CLIENTE REABRE conversa pendente (volta pra Aberta, com pílula de aviso na
  conversa). Só a do cliente: resposta do ATENDENTE não reabre. Vale desde 30/07/2026 e REVOGA a
  regra anterior de 20/07 ("pendente não reabre") — decisão do dono depois de a conta 19 acumular
  258 clientes esperando sem o time ver. NUNCA responda que a conversa fica parada em Pendente
- Pendente ATRIBUÍDA notifica o responsável (o gestor recebe o aviso)

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

1. A distribuição está ligada em ALGUM dos dois caminhos? `inbox.assignment_policy` vinculada **ou**
   `inbox.enable_auto_assignment` true. Não existe campo `enable_auto_assignment_v2` — não peça por ele.
   Política vinculada **não é requisito**: caixa sem política e com o botão ligado distribui normalmente.
2. Se há política: ela está com `enabled: true`? Política desligada = ninguém é atribuído.
3. Tem `InboxMember` com `auto_assignable: true`? Supervisor de caixa é membro mas **não entra** no rodízio.
4. Se "distribuir para agentes offline" está desligado, tem alguém **online** agora? Sem ninguém online
   a fila fica parada até alguém logar.
5. O atendente pode estar no **teto da janela** do freio de rajada (o robô só entrega N conversas por
   atendente/caixa dentro de uma janela deslizante). A vaga volta quando a conversa é resolvida, adiada
   ou vira pendente — e a fila anda sozinha em até 1 minuto. Antes de culpar o freio, confira os
   valores reais da conta e a exceção SEM FREIO (seção 4) — pode não haver teto nenhum ali.
6. Se a caixa tem **uma única** conversa esperando, o freio **nem se aplica** (`should_apply_rate_limit?`
   exige mais de 1 não atribuída). Nesse caso a causa é outra — não culpe o freio.
7. Tem `automation_rule` que poderia ter atribuído antes?

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

## Flows e cadeias de automação

### Disparo de flow por webhook (Webhook Universal embutido, 2026-06)

Além dos triggers de evento (mensagem recebida, conversa criada, etiqueta, card, cron), um flow
pode ser disparado por **webhook externo próprio**: cria-se a integração embutida via
`POST /custom_webhook_integrations` com `flow_id`, e o node `start` ganha um item
`webhook_received` com o `integration_id`. O sistema gera URL única; qualquer evento postado nela
resolve contato/conversa (mesmas regras do Webhook Universal) e dispara o flow.
Receita completa no resource **FlowBuilder — Guia de Design** (seção do trigger `webhook`).

### Proteção anti-loop entre motores (2026-06)

Automações e flows podem se encadear (automação dispara flow, flow dispara automação...).
Cada hand-off entre motores incrementa uma profundidade interna; no **5º hand-off** a cadeia é
cortada silenciosamente (`MAX_CHAIN_DEPTH = 5`). Sintoma: "o flow X não disparou" no fim de uma
cadeia longa. É proteção contra loop infinito — redesenhe a cadeia pra ficar mais curta em vez
de contornar. Além disso, a IA que trava no anti-loop **avisa um humano** (notificação) em vez de
ficar muda (2026-06-05).

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
  "actions": [{"action_name": "send_email_to_team", "action_params": [{"team_ids": [1], "message": "VIP!"}]}]
}
```

---

## Acoes de automacao — formato do `action_params`

> **REGRA DE OURO:** `action_params` e SEMPRE um **array**, mesmo quando so tem um item.
> O backend le `params[0]`. Passar um objeto solto (`{...}` em vez de `[{...}]`) quebra a acao.

> **PERIGO — falha silenciosa:** o `action_params` e um campo livre (JSONB). A API **aceita e grava
> qualquer formato**, sem validar. Se as chaves estiverem erradas, a regra e salva com sucesso, o
> painel mostra a acao na tela, e na hora de disparar ela **nao faz nada e nao registra erro nenhum**
> — sem log, sem mensagem falhada, sem aviso. Por isso: **nunca invente nome de chave**. Se a acao
> nao estiver documentada abaixo, leia uma regra existente com `lionchat_automation_rules_show` e
> copie o formato exato dela.
>
> Incidente real (conta 39, 02-03/08/2026): uma IA gravou `template_name`/`template_id` em vez de
> `name`/`id`. A regra ficou 14 horas sem enviar nada, 9 leads pagos entraram e ninguem foi avisado.

### `send_whatsapp_template` — ATENCAO ESPECIAL

Envia um modelo aprovado da Meta. **So funciona em caixa WhatsApp API Oficial (Cloud).**

```json
{
  "action_name": "send_whatsapp_template",
  "action_params": [{
    "name": "confirmacao_pedido",
    "id": "1071396275361941",
    "language": "pt_BR",
    "category": "UTILITY",
    "processed_params": {"body": {"1": "{{contact.first_name}}"}}
  }]
}
```

| Chave | Obrigatoria | O que e |
|---|---|---|
| `name` | **SIM** | Nome EXATO do modelo aprovado na Meta. E por ele que o envio acontece |
| `id` | nao | ID do modelo na Meta. Serve so de reserva se `name` faltar |
| `language` | nao (padrao `pt_BR`) | Precisa bater com o idioma do modelo aprovado |
| `category` | nao | `UTILITY`, `MARKETING` ou `AUTHENTICATION` |
| `processed_params` | nao | Valores das variaveis: `{"body": {"1": "...", "2": "..."}}`. Aceita Liquid (`{{contact.first_name}}`) |

**NUNCA use `template_name`, `template_id`, `template_category` nem `template_language` aqui.**
Esse e o formato dos **nos do FlowBuilder**, que e outra coisa. Na automacao, essas chaves sao
ignoradas e a acao vira um nada silencioso.

Antes de gravar, confirme que o modelo existe e esta aprovado com
`lionchat_inboxes_whatsapp_templates_list` — o envio so acha o modelo se `name` + `language`
casarem e o status for `approved`.

### Demais acoes

Todos os formatos abaixo foram conferidos linha a linha em `app/services/action_service.rb` e
`app/services/automation_rules/action_service.rb`.

| `action_name` | `action_params` |
|---|---|
| `send_message` | `["texto da mensagem"]` |
| `add_private_note` | `["nota interna"]` |
| `send_canned_response` | `[12]` — id da resposta pronta |
| `add_label` / `remove_label` | `["etiqueta1", "etiqueta2"]` |
| `assign_agent` | `[70]` — o agente precisa ser membro da caixa. `["nil"]` desatribui |
| `assign_team` | `[3]`. `["nil"]` desatribui |
| `assign_captain_assistant` | `[17]` ou `[{"assistant_id": 17, "proactive": true}]` — `proactive` false = a IA assume mas nao fala na hora |
| `send_email_to_team` | `[{"team_ids": [1], "message": "texto"}]` |
| `send_webhook_event` | `["https://..."]` |
| `send_attachment` | `[blob_ids]` — so funciona se a regra ja tiver arquivo anexado; nao da pra montar so por API |
| `change_status` | `["resolved"]`, `["open"]`, `["pending"]` ou `["snoozed"]` |
| `change_priority` | `["urgent"]`, `["high"]`, `["medium"]`, `["low"]`. `["nil"]` limpa |
| `send_email_transcript` | `["a@b.com,c@d.com"]` — UMA string, varios e-mails separados por virgula |
| `mute_conversation` | `[]` |
| `snooze_conversation` | `[]` |
| `resolve_conversation` / `open_conversation` / `pending_conversation` | `[]` |
| `update_contact_attribute` / `update_conversation_attribute` | `[{"attribute_key": "chave", "value": "texto ou {{contact.phone_number}}"}]` |
| `create_kanban_item` | `[{"funnel_id": 31, "funnel_stage": "prospeccao", "allow_duplicates": false}]` |
| `move_kanban_item_to_stage` | `[{"funnel_id": 31, "funnel_stage": "qualificacao"}]` |
| `assign_agent_to_kanban_item` | `[{"funnel_id": 31, "agent_id": 70, "mode": "add"}]` — `mode` aceita `add` (padrao) ou `remove_all` |
| `add_note_to_kanban_item` | `[{"funnel_id": 31, "text": "texto da nota"}]` — a chave e **`text`**, nao `note` |
| `set_kanban_item_status` | `[{"funnel_id": 31, "status": "won"}]` — `won`, `lost` ou `open`. Status fora disso e ignorado |
| `start_kanban_item_timer` / `stop_kanban_item_timer` | `[{"funnel_id": 31}]` |

**Acoes de Kanban:** todas precisam que a conversa ja tenha um card no funil informado. Sem card,
a acao e pulada (fica so no log do servidor). Use `create_kanban_item` antes, na mesma regra.

Lista autoritativa de nomes validos: `AutomationRule#actions_attributes` no backend. Nome de acao
fora dessa lista e recusado com 422 ao salvar — isso a API valida. O que ela **nao** valida e o
conteudo do `action_params`. `apply_kanban_checklist_template` existe no motor mas **nao** e uma
acao de automacao valida (e so do FlowBuilder) — usar aqui devolve 422.
