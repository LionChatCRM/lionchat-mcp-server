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

### A fila do TIME tem preferência sobre a da caixa (novo 2026-07-31)

Existe um TERCEIRO nível de distribuição, e ele vem ANTES dos dois de cima. A regra, por conversa:

> **conversa está num time que distribui → manda o TIME (quem entra e qual o teto).
> Senão → cai pra caixa/política, exatamente como antes.**

Decisão do dono: **time tem preferência, caixa é reserva.** O time decide QUEM e QUANTO; a
caixa/política continua decidindo a ORDEM da fila, as exclusões e a capacidade por atendente.

Campos do time (tools `lionchat_teams_create` / `_update`):

| Campo | O que faz | Padrão |
|---|---|---|
| `allow_auto_assign` | liga/desliga a distribuição do time | `true` |
| `assignment_mode` | `online_only` (só quem está online) ou `include_offline` (todo mundo do time) | `online_only` |
| `fair_distribution_limit` | teto de conversas por atendente na janela | `10` |
| `fair_distribution_window` | tamanho da janela, **em segundos** | `600` |

Quem entra no bolo do time: membros com `auto_assignable: true` (supervisor de time fica de fora)
**que também sejam membros da caixa** — quem não é da caixa nunca entra, senão a conversa cairia com
alguém que nem enxerga aquela caixa.

Antes de 31/07 o time sorteava UMA vez, no instante em que a conversa caía nele; não achando ninguém
disponível, desistia PARA SEMPRE e a conversa ficava aberta sem dono. Agora a mesma varredura que já
existia para a caixa reprocessa a fila do time. Se o cliente reclamar de "conversas com time e sem
dono" de antes dessa data, a causa é essa — e já está corrigida.

**LEIA o valor do time antes de responder** — a resposta de `lionchat_teams_list` / `_show` traz os
quatro campos. Como em toda configuração, nunca recite o padrão de fábrica como se fosse o que o
cliente configurou: cite o número que a API devolveu.

> Nota de compatibilidade: `fair_distribution_limit` e `fair_distribution_window` só passaram a sair
> na resposta em **03/08/2026**. Se vierem ausentes, a instalação é anterior a essa data — nesse caso
> não afirme o valor, mande conferir em Configurações → Times → editar o time.

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

### 10. Criar conversa por API — REGRA NOVA (2026-08-04)

**Nunca nasce conversa nova se o contato já tem uma ABERTA naquela caixa.** Vale para todo caminho
iniciado por nós: `lionchat_conversations_create`, campanha, flow, booking, integração.

| Situação do contato naquela caixa | O que `conversations_create` devolve |
|---|---|
| Tem conversa **aberta / pendente / adiada / silenciada** | A **conversa existente**, com o mesmo `id`. Não cria |
| Só tem conversa **resolvida** | Cria conversa NOVA (invariante do produto: "fechou = abre nova") |
| Caixa com `lock_to_single_conversation` LIGADO | **Sempre** a existente, mesmo resolvida — reabre |
| Caixa de **e-mail** | Sempre cria nova (o assunto da thread vem da conversa; reusar mandaria o e-mail com o assunto velho) |

**Como saber se reusou:** compare o `id` devolvido com o que você esperava. Vem HTTP 200 nos dois
casos, sem aviso. Se precisa garantir conversa nova, feche a anterior antes
(`conversations_toggle_status` para `resolved`).

**O que é DESCARTADO no reuso** (a conversa já existe; o disparo não reescreve o estado dela):
`status`, `snoozed_until`, `additional_attributes` e `assignee_id`. Se você precisa trocar o
responsável, chame `conversations_update` depois — não adianta mandar junto na criação.

**O que É aproveitado:** `custom_attributes` entram por merge, **sem sobrescrever chave que já tem
valor**. A conversa mantém a origem com que nasceu e só ganha o que ainda não tinha.

**Reuso não dispara `conversation_created`** — automação, gatilho de flow, webhook de saída,
notificação e a Agenda não rodam. Se o seu fluxo depende de um desses, ele não vai acontecer
quando houver reuso.

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

## Pesquisa de satisfação (CSAT) — vale em TODO canal (corrigido 2026-07-31)

A pesquisa de satisfação é enviada **dentro da própria conversa** (modo `in_chat`) em **todos os
canais** — WhatsApp, Telegram, Instagram, SMS, site. O backend sempre funcionou assim; era a TELA que
só mostrava a configuração quando a caixa era WhatsApp, então de 01/04 a 31/07 quem usava outro canal
via a aba quase vazia e herdava um texto padrão que não conseguia editar. Hoje a configuração aparece
igual pra todos.

Duas coisas pra não errar ao explicar:
- **A regra de etiqueta (`survey_rules`) agora é respeitada de verdade.** Ela aparecia na tela e era
  IGNORADA no envio — a pesquisa saía pra todo mundo. Se o cliente configurou "só enviar quando a
  conversa tem a etiqueta X" antes de 31/07 e reclamou que ia pra todos, a causa era essa e já está
  corrigida.
- **Caixa que nunca teve a aba salva** pode continuar sem `csat_mode` gravado e cair no caminho antigo.
  Se duas caixas iguais se comportarem diferente, mande abrir a aba de Pesquisa de Satisfação e salvar
  uma vez.

## Migrar conversas entre caixas de WhatsApp (2026-08-01)

Serve pra quem está saindo do WhatsApp por QR Code e indo pro Oficial (ou trocando de número): leva as
conversas e os contatos da caixa antiga pra nova. Tools: `lionchat_inboxes_inbox_migration_list`
(prévia), `_execute` (executa) e o acompanhamento de status. **Admin-only e irreversível** — mostre os
números da prévia e confirme antes.

O que a prévia devolve (e o que ela conta): a contagem é de **CONVERSAS**, dividida em migráveis,
conflitantes e não-migráveis; contato sem conversa é ignorado, e os baldes fecham com o total.

**Regras que mudam o resultado — diga ao cliente ANTES de executar:**
- **Grupos não vão pro canal Oficial.** A Meta não tem grupos: conversa de grupo (`@g.us`), lista de
  transmissão e canal ficam na caixa de ORIGEM e aparecem contados como pulados. Não é falha.
- QR Code → Oficial passou a funcionar de verdade em 01/08. Antes a migração falhava — em uma conta
  gravou "0 migradas" por causa de um grupo, e na prática teria falhado em 100% dos contatos, porque o
  formato de identificador do QR Code não estava sendo convertido. Se o cliente tentou migrar antes
  dessa data e não deu certo, mande tentar de novo.

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

### Disparo de flow por FORMULÁRIO público de captação (2026-08)

Um flow pode ser disparado pelo que o lead faz num **Formulário público** (resource
`lionchat://docs/formularios-publicos`). São **três gatilhos**, todos no node `start`:

| Gatilho | Quando dispara |
|---|---|
| `lead_form_completed` | O lead **concluiu** o formulário |
| `lead_form_milestone` | O lead **atingiu um marco** dentro do formulário (sem precisar concluir) |
| `lead_form_abandoned` | O lead **parou no meio** e a janela de abandono do formulário venceu |

Como montar o item do gatilho:
- **`lead_form_id` é obrigatório** — o gatilho só casa com o formulário apontado; sem ele o flow
  fica MUDO (nenhum erro, nenhum disparo).
- Pelo caminho **API/MCP**, `lead_form_id` (e `milestone_node_id`) vão no **topo do item**; a
  **tela** grava os mesmos campos dentro de `config`. O motor lê os dois formatos — não precisa
  duplicar.
- `milestone_node_id` é **opcional** e só existe no `lead_form_milestone`: preenchido, o flow
  dispara só naquele marco; **vazio = qualquer marco** daquele formulário.
- Só vale em **flow individual** (`conversation_mode: 'individual'`). Flow de grupo e ferramenta
  de IA (`ai_tool`) nunca são disparados por formulário.

Comportamento no disparo:
- Cada gatilho dispara **uma vez por resposta** (`completed`, `milestone:<node_id>` e `abandoned`
  são chaves independentes) — retentativa não dobra o flow.
- Exige **contato** na resposta: lead que não deixou nome+telefone não dispara nada. Em caixa
  WhatsApp (oficial ou QR Code), contato sem telefone também é pulado.
- O disparo **cria ou reabre uma conversa** na primeira caixa vinculada ao flow — ou seja, acorda
  os ouvintes de `conversation_created` (automação, outros flows, webhook de saída, Kanban, SLA,
  notificação). Conte com isso ao desenhar a cadeia.

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

### Gatilhos de Agendamento (Booking nativo) — 2026-08-20

O Booking do LionChat (Agenda → aba Booking, link público, IA) também dispara flow pelo node
`start`: `booking_created`, `booking_cancelled`, `booking_rescheduled`, `booking_completed`.
Config opcional `{ booking_event_type_ids: ["44"], agent_ids: [], create_conversation: false }`
(vazio = todos; `create_conversation: true` cria a conversa na 1ª caixa do flow para quem nunca
conversou). Variáveis `{{booking.*}}` (data, hora, tipo, agente, links de remarcar/cancelar,
horário anterior no remarcado). Detalhe completo e regras no `lionchat://docs/flowbuilder-design-guide`
(seção "Gatilhos de AGENDAMENTO"). **Não confundir com os lembretes da e-Clínica** (integração
separada). Também NÃO são eventos de `automation_rule`.

**Os gatilhos de Formulário público (`lead_form_completed`, `lead_form_milestone`,
`lead_form_abandoned`) NÃO entram nessa tabela** — são gatilhos de **flow**, não eventos de
automação. Não adianta criar `automation_rule` com esses nomes em `event_name`; o caminho é o node
`start` de um flow (ver a seção acima).

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

## Condicoes de automacao — e a REGRA DO CONECTOR

```json
"conditions": [
  {"attribute_key": "status",  "filter_operator": "equal_to", "values": ["resolved"], "query_operator": "AND"},
  {"attribute_key": "labels",  "filter_operator": "equal_to", "values": ["vip"],      "query_operator": null}
]
```

### O conector (`query_operator`) — leia isto antes de gravar

O conector **liga a condicao com a SEGUINTE**. Logo:

- A **ULTIMA** condicao **TEM** que ter `query_operator: null`.
- Condicao **UNICA** = `query_operator: null` (nao ha proxima pra ligar).
- Valores aceitos nas demais: `"AND"` ou `"OR"`.

> **A API valida o VALOR do conector, mas NAO a POSICAO.** Conector na ultima condicao **salva com
> sucesso**, aparece certo na tela — e a regra nunca dispara.
>
> Incidente real: **8 regras criadas pelo conector de IA entre 26 e 30/07/2026, em 3 contas
> diferentes, todas com conector na ultima condicao. Todas nasceram mortas.** A pergunta ao banco
> saia pela metade (`... IN ($1) and`), o erro era engolido e a regra respondia "nada casou". A conta
> 62 ficou com as **6** regras de etiquetagem automatica paradas. Medido em producao em 03/08:
> **732 erros por hora**.
>
> O motor foi corrigido em 03/08 (a limpeza acontece ao montar a consulta), entao regra torta nao
> quebra mais. **Mas continue gravando certo:** a tela de edicao le o dado cru e formato errado
> aparece estranho ali — mesmo efeito do campo de template que sumia da tela.

### Campos da condicao

| Campo | Obrigatorio | O que e |
|---|---|---|
| `attribute_key` | SIM | Campo padrao (ver abaixo) ou a chave de um atributo personalizado que **exista na conta** |
| `filter_operator` | SIM | Como comparar |
| `values` | SIM (menos em `is_present`/`is_not_present`) | Array, sempre |
| `query_operator` | SIM em todas | `"AND"`/`"OR"`; **`null` na ultima** |
| `custom_attribute_type` | so p/ atributo personalizado | `conversation_attribute` ou `contact_attribute` |

### Operadores de filtro

`equal_to`, `not_equal_to`, `contains`, `does_not_contain`, `is_present`, `is_not_present`,
`is_greater_than`, `is_less_than`, `starts_with`, `days_before`, `days_ago`, `last_days`, `today`,
`yesterday`.

**Cada campo aceita so um subconjunto.** Operador que o campo nao aceita faz a regra inteira falhar
na validacao. Na duvida, leia uma regra que ja funciona com `lionchat_automation_rules_show` e copie.

### Chave que a conta nao conhece

Se `attribute_key` nao for um campo padrao **nem** um atributo personalizado existente na conta, a
regra **inteira** falha na validacao e nunca dispara — erro
`Automation conditions <chave> not supported`. Aconteceu de verdade na conta 62 (`tipo_interesse`).
Antes de usar atributo personalizado numa condicao, confirme que ele existe com
`lionchat_custom_attributes_list`.

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
| `wait` | `[30]` — segundos. Ver "Acao Aguardar" abaixo |

**Acoes de Kanban:** todas precisam que a conversa ja tenha um card no funil informado. Sem card,
a acao e pulada (fica so no log do servidor). Use `create_kanban_item` antes, na mesma regra.

### Acao `wait` (Aguardar) — novo 2026-08-04

Pausa a regra: as acoes **seguintes** so rodam depois do tempo passar. As anteriores ja rodaram.

```json
{ "action_name": "wait", "action_params": [30] }
```

| Regra | Detalhe |
|---|---|
| Unidade | **segundos** |
| Teto | **300** (5 minutos). Valor maior e limitado a 300 em silencio, sem erro |
| Formatos aceitos | `[30]`, `30`, `"30"` e `{"seconds": 30}` — todos funcionam |
| Tempo invalido | `[]`, `[0]`, `[""]` ou ausente = **nao pausa**, a regra segue direto. Nao da erro |
| Ultima acao da regra | Nao agenda nada (nao ha o que retomar depois) |
| Pilula "Automacao X disparou" | So aparece na 1a rodada, nao se repete na volta |

**Para que serve.** O caso que originou: a regra mandava a mensagem **antes** da politica de
atribuicao carimbar o responsavel, entao a variavel com o nome do atendente saia vazia. Meio
segundo de espera resolve. Use quando a acao seguinte depende de algo que outro processo ainda
esta gravando (atribuicao, card recem-criado, atributo que outra regra vai escrever).

**Precisa de mais de 5 minutos?** O lugar certo e o FlowBuilder, que tem espera em horas e sessao
propria pra sustentar o estado. A automacao nao foi feita pra isso.

**A regra nao "dorme":** ao encontrar a espera ela encerra a rodada e agenda a retomada. Varias
conversas esperam ao mesmo tempo sem travar o atendimento. Na volta, o sistema confere se a regra
ainda existe e esta ligada, se a conversa ainda existe e se a caixa nao foi excluida — se algo
disso mudou, ele simplesmente nao retoma.

Lista autoritativa de nomes validos: `AutomationRule#actions_attributes` no backend. Nome de acao
fora dessa lista e recusado com 422 ao salvar — isso a API valida. O que ela **nao** valida e o
conteudo do `action_params`. `apply_kanban_checklist_template` existe no motor mas **nao** e uma
acao de automacao valida (e so do FlowBuilder) — usar aqui devolve 422.
