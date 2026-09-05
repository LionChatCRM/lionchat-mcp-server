# Glossário LionChat

Glossário completo de termos, status codes, enums e conceitos da plataforma. Use como referência sempre que encontrar um campo numérico ou enum desconhecido na resposta de qualquer endpoint.

## Conversation (Conversa)

### `status` — Estado da conversa
| Valor | Nome | Significado |
|---|---|---|
| `0` | `open` | Aberta — em atendimento ativo |
| `1` | `resolved` | Resolvida — encerrada como sucesso |
| `2` | `pending` | Pendente — aguardando alguém (cliente ou agente) |
| `3` | `snoozed` | Adiada — voltará a aparecer em data futura (`snoozed_until`) |

### `priority` — Prioridade
| Valor | Significado |
|---|---|
| `urgent` | Urgente — atender o quanto antes |
| `high` | Alta |
| `medium` | Média |
| `low` | Baixa |
| `null` | Sem prioridade definida |

### `assignee_type` (parâmetro de listagem)
| Valor | Filtro aplicado |
|---|---|
| `me` | Conversas atribuídas ao usuário autenticado |
| `assigned` | Conversas com qualquer agente atribuído |
| `unassigned` | Conversas sem agente |
| `all` | Todas (sem filtro) |

### Campos importantes
- `display_id`: número visível na UI (use ao falar com humanos: "conversa #245")
- `id`: ID interno (use em parâmetros de outras chamadas)
- `last_activity_at`: Unix timestamp (segundos) da última atividade
- `waiting_since`: Unix timestamp (segundos) — desde quando aguarda resposta
- `first_reply_created_at`: Unix timestamp da primeira resposta humana (`null` se nunca respondida)
- `captain_assistant_id`: FK pro AI Agente (`null` = atendimento humano)
- `custom_attributes.captain_manually_disabled`: `true` se admin desativou a IA explicitamente

## Message (Mensagem)

### `message_type`
| Valor | Nome | Significado |
|---|---|---|
| `0` | `incoming` | Cliente → empresa (recebida) |
| `1` | `outgoing` | Empresa → cliente (enviada) |
| `2` | `activity` | Evento de sistema (atribuições, ativações IA, mudanças de status) |
| `3` | `template` | Template aprovado WhatsApp Cloud API |

### `status` (mensagens outgoing)
| Valor | Significado |
|---|---|
| `sent` | Enviada com sucesso |
| `delivered` | Entregue ao destinatário |
| `read` | Lida pelo destinatário |
| `failed` | Falha no envio |
| `progress` | Em processamento |

### `content_type`
- `text`: texto puro
- `input_select`: pergunta com opções (formulários do widget)
- `cards`: cards interativos
- `form`: formulário
- `article`: artigo da central de ajuda

### Campos importantes
- `content`: texto da mensagem (pode ser `null` se for só anexo)
- `attachments[]`: array de anexos (image, audio, video, file, location, contact)
- `private`: `true` = nota privada (só visível pra equipe, não pro cliente)
- `sender_type`: `User`, `Contact`, `Captain::Assistant`, `AgentBot`
- `processed_message_content`: texto após processamento (com markdown removido, links resolvidos)
- `content_attributes.forwarded`: `true` = a mensagem foi ENCAMINHADA pelo cliente (nos dois canais
  de WhatsApp — oficial e QR Code). A bolha mostra o selo "Encaminhada"
- `content_attributes.frequently_forwarded`: `true` = encaminhada MUITAS vezes (o "encaminhada com
  frequência" do WhatsApp). Útil pra responder "essa mensagem foi encaminhada?" sem chutar
- `content_attributes.edited`: `true` = o CLIENTE editou a mensagem no WhatsApp (`edited_at` traz
  quando). O `content` já é o texto novo; a versão anterior não fica guardada. Vale nos dois canais
  de WhatsApp (QR Code desde 18/07/2026; oficial desde 21/08/2026 — entra com o próximo deploy do
  app depois de 21/08/2026; antes a edição virava um balão VAZIO novo, contado como mensagem nova).
- `content_attributes.deleted`: `true` = mensagem APAGADA ("apagar para todos"), pelo cliente ou
  pela empresa no celular (convivência). O `content` vira `"⛔ Esta mensagem foi excluída"` seguido
  do texto original (a equipe continua vendo o que foi dito); os anexos são removidos. Ao resumir
  uma conversa, trate como apagada — não cite o texto como se ainda estivesse de pé. (No canal
  oficial, desde 21/08/2026 — entra com o próximo deploy do app depois de 21/08/2026.)

## Attachment (Anexo)

### `file_type`
| Valor | Conteúdo |
|---|---|
| `image` | Foto / imagem (JPG, PNG, etc) |
| `audio` | Áudio (geralmente vem com `transcribed_text` preenchido) |
| `video` | Vídeo |
| `file` | PDF, DOCX, qualquer outro (pode vir com `extracted_text` se for processado) |
| `location` | Coordenadas GPS |
| `contact` | vCard |
| `share` | Link compartilhado |
| `story_mention` | Menção em story (Instagram) |
| `fallback` | Fallback de tipo não-reconhecido |

### Campos importantes
- `data_url`: URL pra baixar o arquivo (válida por tempo limitado)
- `transcribed_text`: transcrição (áudio) ou texto extraído (PDF/imagem com OCR)
- `meta.image_description`: descrição gerada pela IA (cache, se disponível)
- `file_size`: bytes
- `width`/`height`: pixels (imagens/vídeos)

### Tipo de arquivo não reprova mais (15/08/2026)

No anexo de **mensagem**, QUALQUER extensão é aceita — a validação é só de TAMANHO. Tipo sem teto
próprio cai no teto de "documento" (o maior). O `file_type` `file` cobre tudo que não é
imagem/áudio/vídeo. **Dois caminhos continuam com lista fechada de tipos permitidos**: o upload por
URL (o teste de mídia do FlowBuilder) e o chat interno da equipe — não confunda os três.

## Contact (Contato)

### Campos importantes
- `id`: ID interno
- `identifier`: ID externo configurado pelo cliente (ex: ID interno do CRM dele)
- `phone_number`: E.164 obrigatoriamente (`+5511999999999`)
- `email`: opcional
- `name`: nome completo
- `additional_attributes`: hash de campos do sistema (não-editáveis)
- `custom_attributes`: hash de campos custom (editáveis, definidos pela conta)

### ContactInbox (vínculo Contato ↔ Inbox)
- `source_id`: ID do contato no canal (ex: `5511999999999@c.us` no WhatsApp WAHA)
- Um contato pode ter vários ContactInboxes (um por canal)

### Bloqueio de contato (`blocked`)

**Termo:** "bloquear contato" / "contato bloqueado".

**O que é:** marca o contato como bloqueado. Quando bloqueado, mensagens recebidas dele são
DESCARTADAS na entrada (não criam conversa nem notificam). Bloquear NÃO resolve a conversa atual.

**Como aplicar via tools:**
- Forma dedicada: `lionchat_conversations_toggle_block` — `POST .../conversations/:id/toggle_block`
  com body `{blocked: true|false}`. Bloqueia/desbloqueia o contato DAQUELA conversa e gera uma
  pílula de atividade ("contato bloqueado") na timeline.
- Forma alternativa: o atributo `blocked` no update de contato (`lionchat_contacts_update`) também
  liga/desliga o bloqueio — mas SEM a pílula de atividade. Prefira `toggle_block` quando estiver
  no contexto de uma conversa.

## Inbox (Caixa de Entrada / Canal)

### `channel_type`
- `Channel::Waha` — WhatsApp via WAHA (não-oficial, QR code)
- `Channel::Whatsapp` — WhatsApp Cloud API (oficial)
- `Channel::WebWidget` — chat ao vivo no site
- `Channel::Email` — email
- `Channel::FacebookPage` — Messenger; com `medium: "instagram"` é uma caixa **só de Instagram** conectada pela Página do Facebook (trate como Instagram)
- `Channel::Instagram` — Instagram DM (login pelo Instagram)
- `Channel::Telegram` — Telegram
- `Channel::Api` — webhook custom
- `Channel::Voice` — VoIP / chamadas
- `Channel::Sms` — SMS (Bandwidth)
- `Channel::TwilioSms` — SMS / WhatsApp via Twilio
- `Channel::Line` — LINE
- `Channel::Tiktok` — TikTok
- `Channel::TwitterProfile` — Twitter / X

> **WAHA — status de conexão:** para inbox `Channel::Waha`, o estado da sessão fica em `additional_attributes.session_status` (`WORKING`, `SCAN_QR_CODE`, `STARTING`, `STOPPED`, `FAILED`). `WORKING` = WhatsApp conectado. Exposto no serializer da inbox (`_inbox.json.jbuilder`).

### Campos importantes
- `id`: ID interno
- `name`: nome configurado pelo admin
- `channel_id`: FK pro canal polimórfico
- `enable_auto_assignment`: se está atribuindo automaticamente
- `working_hours_enabled`: se respeita horário de atendimento
- `greeting_enabled` / `greeting_message`: mensagem de boas-vindas

### Supervisor de caixa (InboxMember.auto_assignable = false)

**Termo:** "Supervisor de caixa" / "supervisor da caixa de entrada".

**O que é:** um membro da caixa marcado como supervisor. Ele VÊ TODAS as conversas e cards
daquela caixa (visão completa), mas fica FORA da distribuição automática (round-robin) — ou seja,
o sistema nunca atribui conversas novas a ele automaticamente. Serve pra gestor/líder que precisa
acompanhar tudo sem entrar na fila de atendimento.

**Onde fica armazenado:** flag `inbox_members.auto_assignable` (boolean). Membro comum =
`auto_assignable: true` (entra no rodízio); supervisor = `auto_assignable: false` (vê tudo, fora
do rodízio).

**Como definir/ler via tools:** `lionchat_inbox_members_create` e `lionchat_inbox_members_update`
aceitam `supervisor_ids[]` além de `user_ids[]` — os IDs em `supervisor_ids` viram supervisores;
os de `user_ids` viram membros comuns. A resposta traz `is_supervisor` (boolean) por agente.

### Supervisor de TIME (novo 2026-07-30) — é outra marca, independente da de caixa

O time ganhou os mesmos dois papéis. Supervisor de time continua membro pra tudo (menção, e-mail de
automação, acesso a funil do Kanban, relatório, contagem, atribuição MANUAL) e fica fora da
distribuição automática do time — tanto de conversa quanto do rodízio de card do funil.

**Onde fica armazenado:** flag `team_members.auto_assignable` (espelho da de caixa).

**Como definir/ler via tools:** `lionchat_team_members_create` / `_update` com `supervisor_ids[]`.
**Diferença importante do contrato da caixa:** aqui `user_ids[]` é sempre a lista COMPLETA de membros
e `supervisor_ids[]` é um SUBCONJUNTO dela; omitir `supervisor_ids` não mexe em papel nenhum.
`lionchat_team_members_list` traz `is_supervisor`.

**As duas marcas NÃO se comunicam:** a da caixa protege da distribuição da caixa, a do time da
distribuição do time. Supervisor de caixa que é agente num time continua recebendo por aquele time —
comportamento intencional.

## KanbanItem (Card do CRM)

### Estrutura
- `id`: ID interno
- `conversation_display_id`: vinculação opcional com Conversa
- `funnel_id`: FK pro Funnel (funil)
- `funnel_stage`: nome da etapa atual (string)
- `position`: ordem dentro da etapa (inteiro)
- `stage_entered_at`: timestamp de quando entrou na etapa atual

### `item_details` (jsonb)
```json
{
  "title": "Negociação Empresa X",
  "value": 5000.0,
  "priority": "high",
  "description": "...",
  "notes": [{ "text": "..." }],
  "offers": [{ "offer_id": 3 }],
  "custom_attributes": { ... }
}
```

### `assigned_agents` (jsonb array)
```json
[{ "id": 6, "name": "Elvis", "email": "...", "assigned_at": "..." }]
```

## Funnel (Funil do Kanban)

**Funil, Kanban, pipeline e board são sinônimos no LionChat** — o usuário pode usar qualquer um desses nomes; a entidade é sempre o Funnel (`lionchat_funnels_*`).

- `name`: nome do funil
- `stages`: objeto de etapas — uma chave (slug) por etapa, cada uma com `name`, `color`, `position`
- `archived`: `true` = não aparece na UI principal

## Captain::Assistant (AI Agente / IA de atendimento)

- `id`: ID interno
- `name`: nome do agente (ex: "Luna", "Diogo")
- `paused`: botão de pânico — `true` corta respostas/follow-ups/callbacks na hora (top-level, auditado)
- `guardrails`: array de limites duros injetados no prompt (ex: anti-pitch)
- `response_guidelines`: array de diretrizes de estilo de resposta
- `config.feature_memory`: gera notas no contato ao resolver conversas
- `config.feature_faq`: gera FAQs sugeridas ao resolver conversas
- `config.feature_follow_up` + `config.follow_up_steps`: follow-up automático em cadência de até
  3 etapas (cada ≥5 min, **soma ≤1380 min = 23h**, não 24h) quando o cliente some — motor dedicado
  só-leitura. O teto é 1380 porque a janela de 24h do WhatsApp conta da **mensagem do cliente**, não do
  primeiro follow-up; somar 1440 é recusado com 422 (e no campo legado `follow_up_time` a mensagem de
  erro ainda diz "1440" por engano — o teto aplicado é 1380)
- `config.follow_up_skip_conditions`: array (até 3, lógica OU) de condições pra NÃO fazer follow-up.
  Tipos: `label`, `contact_attr`/`conversation_attr`, e `time_window` (horário de silêncio: `start`/`end`
  horas 0-23, janela circular — no período não envia follow-up, mas a IA segue respondendo o cliente)
- Via MCP (2026-07-13): `follow_up_steps` e `follow_up_skip_conditions` podem ser enviados como
  array OU como string JSON do array — o servidor tolera os dois (antes, string era rejeitada
  com 422 "step 1 must be at least 5 minutes"). `feature_pause_on_human_reply`,
  `feature_follow_up` e demais booleans de config aceitam update direto via
  `captain_assistants_update` (merge parcial de config).
- `config.feature_pause_on_human_reply`: bool (nasce desligado) — a IA se desliga sozinha na conversa
  quando um humano assume (atendente responde pelo painel OU mensagem do celular); nota
  privada/automação/campanha não contam. **Mensagem agendada depende de quem agendou (2026-07-29):**
  agendada **pela IA** não desliga (o disparo assina como o assistente); agendada **por um atendente**
  conta como atendente ao vivo e **DESLIGA** a IA da conversa — na prática, programar uma mensagem em
  nome do atendente numa conversa com IA ativa tira a IA dali quando ela for enviada
- `config.model`: modelo OpenAI usado (gpt-4o, gpt-4o-mini)
- `config.temperature`: 0.0-1.0
- `config.instructions`: prompt sistema (Liquid template, até 20.000 chars)
- `config.activation_label`: etiqueta que ativa o agente na conversa (única por conta)
- **Cenário (Captain::Scenario)**: instrução situacional inline do assistente; o raciocínio de
  aplicação fica no "caderninho do cenário" da conversa (scenario_checklist, card Raciocínio).
  Pode apontar páginas da base de conhecimento escrevendo `[@Nome](document://ID)` na instrução
  (campo derivado `document_ids`, teto de 3) para a IA PRIORIZAR a busca RAG naquelas páginas —
  prioridade, não exclusividade
- **Regra DITO ≠ SALVO**: a IA só considera coletado o dado que foi PERSISTIDO — salva cada dado
  na hora e não repergunta o que já salvou
- **Cenário com parâmetro fixo (tool_bindings)**: o admin pode fixar o parâmetro de uma ferramenta do cenário — quais mídias enviar, qual funil+etapa criar/mover o card, quais agendas usar no agendamento. Com 1 cenário fixando a tool, a execução é DETERMINÍSTICA (a IA não escolhe): mídia/kanban rodam pós-turno (BindingResolver); o agendamento força/restringe a agenda mas a IA ainda escolhe a data/hora.
- **Conhecimento passivo (RAG)**: a IA recebe automaticamente no prompt a FAQ e os artigos da Central de Ajuda relevantes para a mensagem — só quando a conta tem esse conteúdo (sem conteúdo = zero custo). Pode oferecer o link do artigo ao cliente. As ferramentas "Buscar FAQ"/"Buscar Artigos" são automáticas (não aparecem nem se ligam na tela de ferramentas).
- **Anti-loop de ferramentas**: se uma ferramenta (webhook/custom tool ou flow) falha, a IA recebe aviso escalonado (1ª falha = tente 1x; 2ª = pare e siga/transfira) e para sozinha; tetos de 5 chamadas/ferramenta e 25/turno por mensagem.

## Copilot (Copiloto do atendente)

- Motor PRÓPRIO: usa account.custom_attributes['copilot_model'] e ['copilot_temperature'] (padrão 0.3), independente do agente conversacional. O agente selecionado dá só a base de conhecimento. Prompt base em copilot_instructions (admin, até 5000 chars). Config via endpoint captain/copilot_settings.
- AGE na conversa aberta no painel (sem opt-in), dentro da permissão do atendente. Tools reversíveis (kanban, etiqueta, nota, prioridade, atribuir, resolver, contato/atributos) executam na hora; tools que falam com o cliente (enviar mídia, agendar mensagem, criar/reagendar agendamento) viram PROPOSTA e só executam quando o atendente confirma. Transferência/handoff/flows ficam de fora.
- Histórico POR CONVERSA (copilot_threads.conversation_display_id): cada conversa mantém o seu Copiloto, não mistura.

## Account (Conta)

- `id`: ID interno (NÃO é o ID da empresa cliente — é o ID interno do LionChat)
- `name`: nome da empresa
- `plan_id`: FK pro Plan (qual plano assinou)
- `feature_flags`: bigint bitfield com features ativas
- `usage_limits`: hash de limites do plano + uso atual
- `custom_attributes`: dados livres da conta

## AccountUser (User dentro de uma Account)

- `user_id` + `account_id`: chave composta
- `role`: `agent` (atendente) ou `administrator` (admin/dono)
- `availability`: `online`, `busy`, `offline`
- `permissions`: array de strings com permissões granulares
- `replacing`: `true` em `lionchat_agents_list` por até 30 min enquanto uma substituição
  (`lionchat_agents_replace`) transfere a carteira desse agente pro novo — ele está SAINDO; não
  atribua nada a ele

### Agente de SUPORTE (SupportAccessGrant) — não é agente da conta

Quem entra na conta por **acesso de suporte** (operador da plataforma) aparece como administrador,
mas **não é membro da equipe**: `lionchat_agents_list` não o lista (escopo `regular_users`), ele
não ocupa vaga do plano, não pode ser substituído (`agents_replace` recusa) e, desde 17/08/2026,
a IA também o ignora — não atribui conversa a ele, não agenda mensagem no nome dele, não o menciona
em alerta nem o conta como "disponível". Exceção deliberada: se alguém o atribuir à mão como
responsável, ele segue valendo como responsável.

## AutomationRule (Regra de automação)

- `event_name`: `conversation_created`, `conversation_resolved`, `message_created`, etc
- `conditions`: jsonb array de condições
- `actions`: jsonb array de ações
- `active`: `true` = rodando

## Booking (Agendamento)

- `booking_event_type_id`: FK pro tipo de evento (ex: "Demo 30min")
- `attendee_email`, `attendee_name`, `attendee_phone`
- `start_time`, `end_time`: ISO 8601
- `status`: `confirmed`, `cancelled`, `completed` — mas **só muda quando o cancelamento/conclusão
  vem pelo link do paciente ou pela IA**. Quem conclui/cancela pela Agenda mexe na TAREFA
  (`account_tasks.status`: `pending`/`completed`/`cancelled`/`snoozed`), e o booking fica
  `confirmed`. Pra saber se um agendamento aconteceu, leia a tarefa (`lionchat_tasks_show`), não o
  booking.

**A IA agenda EXCLUSIVAMENTE por agenda de Booking (15/08/2026).** Não existe mais agendamento
avulso/direto pela IA — ela consulta as agendas liberadas, respeita os dias em que a agenda não
abre e só então cria a reserva. Depois de agendar, ela mesma entrega o link do Google Meet quando o
tipo de agendamento gera Meet (o link nasce alguns segundos depois; o sistema espera e volta pra
mandar). Detalhes em `lionchat://docs/best-practices`.

## Métricas (Reports)

### Endpoints `lionchat_reports_*` retornam métricas em SEGUNDOS por padrão

- `avg_first_response_time`: tempo médio em segundos até primeira resposta humana
- `avg_resolution_time`: tempo médio em segundos até resolução
- `conversations_count`: contagem absoluta
- `incoming_messages_count`: contagem absoluta
- `outgoing_messages_count`: contagem absoluta
- `resolutions_count`: contagem absoluta

### CSAT
- `score`: 1 a 5 (estrelas) ou `csat_survey_response_at` (Unix ts)
- `feedback_message`: texto opcional

### SLA
- `breach_count`: quantas SLAs estouraram
- `hit_count`: quantas foram cumpridas
- `due_at`: timestamp da SLA aplicada

## Resumo de unidades

| Métrica | Unidade |
|---|---|
| Tempo (avg_*_time) | **segundos** (converta pra min/h ao exibir) |
| Datas | ISO 8601 ou Unix timestamp (segundos) |
| Valores (KanbanItem.value) | Reais (BRL) por padrão, mas `value` é só numeric |
| Coordenadas (location) | latitude/longitude decimais |
| File size | bytes |
| Pixels | inteiros |

## Diferença entre `id` e `display_id`

- `id`: **sempre use** ao passar pra outras chamadas API
- `display_id`: **sempre use** ao falar com humanos ("conversa #245", "card #12")
- Pra Conversation: `id` global, `display_id` por conta (mais amigável)
- Pra Contact, Inbox, etc: só `id` (não tem display_id separado)

## Kanban — Motivos de Ganho e Perda

**Termo:** "Motivo de Ganho" / "Motivo de Perda" / "Win Reason" / "Loss Reason".

**O que é:** lista de razões pré-definidas que o vendedor seleciona ao marcar um card como Ganho ou Descartado/Perdido. Aparece como dropdown na UI no momento da transição. **Compartilhado entre TODOS os funis da conta.**

**Onde fica armazenado:** `kanban_config.win_reasons` e `kanban_config.loss_reasons` (jsonb arrays na tabela `kanban_configs`).

**Formato:** array de objetos `{id, title}`:
```json
"win_reasons": [
  {"id": "wr-1", "title": "Preço competitivo"},
  {"id": "wr-2", "title": "Indicação forte"}
]
```

**Endpoint:** `PUT /api/v1/accounts/{id}/kanban_config` com body wrapped:
```json
{"kanban_config": {"win_reasons": [...]}}
```

**⚠️ NÃO confundir com:**
- `custom_attribute_definitions` (não use pra motivo — vira campo lateral da conversa, fora do fluxo nativo)
- Labels (não use — labels são tags transversais, não motivos)
- `funnel.stages` (não use — etapas são posições no funil, não razões de saída)

## Quando usar campo nativo vs custom_attribute

**Regra geral:** se a feature TEM um campo nativo na plataforma, use o nativo. Custom attribute é último recurso pra coisas que não têm modelo dedicado.

| Caso | Campo nativo | Custom attribute? |
|---|---|---|
| Motivo de Ganho/Perda do card | `kanban_config.win_reasons` / `loss_reasons` | ❌ NÃO |
| Atributo em TODO card | `kanban_config.global_custom_attributes` | só se não couber acima |
| Atributo de UM card específico | `kanban_item.custom_attributes` (jsonb direto) | já é nativo, não precisa definition |
| CPF, RG, CNPJ, endereço, data nasc., gênero do cliente | mecanismo NATIVO cadastral: `PATCH /contacts/{id}/cadastral` (`update_cadastral`) | ❌ NÃO (tem nativo) |
| Tag pro contato (residencial, empresarial) | `labels` | ✅ SIM via Label |
| Etapa do funil | `funnel.stages` | ❌ NÃO |
| Tarefa interna do card | `kanban_item.checklist` ou `kanban_config.checklist_templates` | ❌ NÃO |
| Telefone validado WhatsApp do contato | atributos nativos WhatsApp Chat ID/JID/LID | já criados pelo WAHA automaticamente |
| Origem do lead (Google Ads, Meta) | `kanban_config.global_custom_attributes` (tipo list) | bom uso de custom_attribute |

## Dados cadastrais do contato (CPF/RG/CNPJ/endereço/etc.)

**IMPORTANTE:** dados cadastrais brasileiros têm mecanismo NATIVO dedicado — NÃO use `custom_attribute_definitions` (model=`contact_attribute`) pra isso.

**Endpoint nativo:** `PATCH /api/v1/accounts/{id}/contacts/{contact_id}/cadastral` (action `update_cadastral`), servido por `Contacts::CadastralAttributesService`.

**Body:**
```json
{ "cpf": "...", "rg": "...", "cnpj": "...", "passport": "...", "date_of_birth": "1990-05-15", "gender": "m",
  "marital_status": "casado", "profession": "...", "address": { "cep": "...", "street": "...", "number": "...", "complement": "...", "neighborhood": "...", "city": "...", "state": "...", "country": "..." } }
```

**Onde fica armazenado:** dentro de `contact.additional_attributes` — `gender` e `date_of_birth` na raiz (lidos por Meta CAPI/Google Ads); o resto em `additional_attributes.cadastral` (`cpf, rg, cnpj, passport, profession, marital_status, address`).

**⚠️ Imutabilidade (REGRA ABSOLUTA):** os campos `cpf, rg, cnpj, passport, date_of_birth, gender` são IMUTÁVEIS — só a PRIMEIRA escrita conta. Sobrescrever com valor diferente exige `force_update: true`, que **a IA e integrações NUNCA setam**. Ao receber valor diferente sem `force_update`, o serviço registra `pending_confirmations` (a IA deve perguntar ao cliente e só então chamar de novo com `force_update: true`). Valor igual ao já gravado é ignorado silenciosamente. Apenas o agente humano (via UI) passa `force_update: true` direto do form.

Campos MUTÁVEIS (atualizáveis livremente por IA/integração): `marital_status`, `profession` e todos os campos de `address`.

`custom_attribute_definitions` (model=`contact_attribute`) fica reservado a dado de NEGÓCIO genérico que não tem modelo dedicado (ex: "plano contratado", "nicho do cliente").

## Ligações — CINCO sistemas distintos (não confundir!)

| Sistema | O que é | Tools | Canal |
|---|---|---|---|
| **LionCalls** | Voz pelo WhatsApp em caixa **QR Code**, mas pelo **motor próprio do LionChat** (credencial global, 1 sessão por caixa; flag `lioncalls_calling`, nasce desligada e é ligada conta a conta) | **NENHUMA — sem tool no MCP** | WhatsApp QR Code |
| **WhatsApp Calling (Cloud)** | Voz pelo WhatsApp na **API oficial** (enterprise) | `whatsapp_calls_*` + enable/disable_whatsapp_calling | WhatsApp oficial |
| **VoIP (Zenvia)** | Telefonia COMUM com softphone no navegador (ramais, ligações) | `voip_*` | Telefone |
| **VTCall** | Telefonia por **PABX click-to-call**, config por conta + ramal por atendente; **sem softphone no navegador** — o atendente fala pelo app/ramal do VTCall | `vtcall_settings_*` (show/update/test_connection), `vtcall_ramals_*` (list/create/destroy) | Telefone (PABX do cliente) |

Quando o usuário falar "ligação", descubra o canal ANTES de responder: caixa QR Code → **LionCalls**;
caixa oficial → `whatsapp_calls`; telefone/ramal → Zenvia (softphone) ou VTCall (PABX).

**Histórico é compartilhado.** LionCalls, Zenvia e VTCall gravam na MESMA tabela de ligações, então
`voip_calls_list` (`/voip/calls`) devolve as três juntas — mesmo as que não têm tool própria. Só o
WhatsApp Calling (Cloud) fica fora, em `whatsapp_calls_*`. Ligações antigas do **Wavoip** (integração
encerrada em 30/07/2026) continuam aparecendo nesse histórico, com `provider: "wavoip"`.

**Wavoip — INTEGRAÇÃO REMOVIDA (12/08/2026).** O vínculo com a Wavoip acabou; o último uso real foi
em 30/07/2026. Saíram do produto: a aba "Ligação WP" da caixa, o discador, o Super Admin, as rotas,
os webhooks, as tarefas automáticas e a tabela. As 8 tools `wavoip_*` já haviam sido removidas do MCP
em 16/07 — **não re-adicionar**, não há mais o que chamar.

Se o usuário perguntar por "Ligação WP" ou "Wavoip": a integração **não existe mais**; para voz em
caixa QR Code hoje o caminho é o **LionCalls**. Nunca orientar o usuário a "Configurações da caixa →
Ligação WP" — essa aba não existe.

**O que SOBRA e continua funcionando:** as **2.927 ligações antigas** seguem no histórico com
`provider: "wavoip"`, com quem ligou, quando e quanto durou. As **gravações** ficavam no servidor da
Wavoip e vão sumir — ao tentar ouvir, o painel mostra "Esta gravação não está mais disponível" em vez
de um botão que não funciona. Isso é esperado, não é defeito.

WhatsappCall (Cloud, esse SIM tem tool): `status`, `custom_name`, `favorited`,
`transcript`/`transcript_status`.

## Chat interno da equipe (InternalChat)

Mensagens ENTRE agentes da conta (não envolve cliente). Salas `direct` (1:1) ou `multi_user`
(grupo), com reações, fixadas, anexos e não-lidas. Tools `internal_chat_*`. Não confundir com
nota privada (que mora DENTRO de uma conversa com cliente).

## LionTrack / Jornada do Lead

Rastreamento de navegação do site (tracking_events, pageviews) + painel "Jornada do Lead" em
Relatórios: mapa visual de por onde os leads andam (nós = páginas, setas = transições), agrupado
por FASES configuráveis (LiontrackJourneyStage: padrão de URL → fase, match literal).
Feature flag `liontrack` (404 sem ela). Relatório: `journey_funnel_reports` (v2), janela máx 30
dias, URLs sem querystring (LGPD).

## Meta CAPI — moeda do evento de conversão (2026-06)

Ao disparar uma conversão pro Meta (Conversions API), o valor agora carrega uma moeda. Parâmetro
`currency` (código ISO, ex: `BRL`, `USD`); default `BRL` quando omitido. A moeda pode ser escolhida
tanto no disparo individual da conversão quanto na configuração do funil (valor padrão herdado pelos
cards daquele funil).

## Idiomas da plataforma (2026-06)

A plataforma opera com 6 idiomas: `en`, `es`, `fr`, `it`, `pt`, `pt_BR` (default das contas
brasileiras: pt_BR). Conta com idioma antigo/descontinuado cai em inglês. Notas internas geradas
pela IA saem no idioma da conta.

## LeadForm (Formulário público de captação)

Formulário de captura próprio da conta, com página pública (link `/forms/<conta>/<slug>`), montado
num construtor de blocos. Feature liberada conta a conta.

### `LeadFormResponse.status`
| Valor | Significado |
|---|---|
| `in_progress` | O lead começou e ainda está preenchendo |
| `completed` | Chegou ao fim do formulário |
| `abandoned` | Parou no meio e a janela de abandono do formulário venceu |

O contato nasce em TRÊS momentos (mudou em 16/08): conclusão, fechamento do abandono, ou logo
antes de um bloco de Enviar WhatsApp. Resposta `abandoned` ganha o contato no fechamento do
abandono — com as respostas que a pessoa deu. Enquanto preenche, a lista de respostas mostra
`contact: {id: null, ..., pending: true}`.

Termos do formulário (18/08):
- **Caixa vinculada** — a caixa de WhatsApp do formulário (`inbox_id`); obrigatória pra publicar.
- **Link identificado** — link de formulário enviado numa conversa sai carimbado (`lt_form`) e o
  formulário pula nome/telefone/e-mail já conhecidos, sem nunca exibir o dado.
- **Simulador** — `lead_forms_test_run`: roda o rascunho no motor real sem deixar rastro.
- **Página externa (`embed`)** — bloco que exibe um site de fora dentro do formulário (checkout,
  simulador, agenda), com conferência prévia de "aceita iframe?" (`check_embed`).
- **Definir variável (`set_variable`)** — bloco invisível que cria `{{var.<nome>}}`.
- **Agendamento (`booking`)** — calendário dentro do formulário, ligado a um tipo de evento.

Detalhes completos (construtor, página pública, blocos, gatilhos de flow, tetos e limites) no
resource `lionchat://docs/formularios-publicos`.

## Histórico importado virou A conversa (02/09/2026)

Antes, a conversa trazida do celular (importação) e a conversa viva do mesmo contato eram DUAS. A
atendente escrevia da conversa de arquivo, o cliente respondia e a resposta abria uma terceira. Agora:

- **Um contato, uma conversa por caixa.** A mensagem que chega ADOTA a conversa que já existe —
  importada ou não — e a reabre. Os importadores escrevem na conversa do contato.
- **A conversa é lida por DATA, não por número** (paginação e as leituras da IA mudaram juntas).
- **`live_since`** marca quando a conversa passou a ter atendimento de verdade. Relatório de
  resolução e SLA contam desse marco, nunca da data importada.
- **Janela de 24h, reativação e seletor de modelo olham a última fala VIVA do cliente.** Conversa só
  de arquivo, sem resposta, segue com a janela FECHADA — mandar texto livre nela falha.
- **Adoção NÃO dispara "conversa criada".** Fluxo/automação/IA presos nesse gatilho não rodam na
  adoção; o gatilho equivalente é **"Conversa reaberta"**.
- Histórico importado continua fora do contexto da IA e não infla o contador do resumo pago.

### Chaves reservadas do sistema — API e MCP não gravam mais

`ConversationBuilder` passou a RECUSAR as chaves de `Conversation::RESERVED_ADDITIONAL_KEYS` vindas de
fora ao criar conversa: `imported_from`, `import_digits`, `mail_subject`, `type`, `in_reply_to`,
`initiated_by`, `auto_reply`, `original_channel_type`, `conversation_language`,
`agent_reply_time_window`, `conference_sid`, `call_status`, `tiktok_capabilities`,
`captain_media_asset_id`, `live_since`, `has_imported_history`.

Não tente mandá-las em `additional_attributes` ao criar conversa — são ignoradas. Gravar `live_since`
com data futura ou `has_imported_history` fecharia a janela de 24h daquela conversa para sempre.

## Campos novos na resposta da API (02/09/2026)

| Campo | Onde | Para que serve |
|---|---|---|
| `medium` | caixa (`inboxes_list`/`_show`) | sub-tipo do canal. Numa caixa de Página do Facebook diz se ela é Messenger ou **só Instagram** — é o que separa os dois |
| `content` | mensagem | já vem no formato de exibição (mensagem apagada mostra o aviso, não o texto cru) |
| `last_incoming_message_at` | conversa | data da última mensagem VIVA do cliente (unix). Use para saber se a janela de 24h está aberta — não confie na data da conversa, que pode vir de histórico importado |

## Formulário público: código para incorporar no site (02/09/2026)

Além do link público, o formulário passou a ter um **código para embutir no site do cliente** (iframe
gerado na tela do formulário) e um **interruptor para desligar o reconhecimento do link repassado** —
quando ligado, um link identificado enviado numa conversa pula os campos já conhecidos; desligado, o
formulário sempre pergunta tudo. Use quando o cliente reclamar que o formulário "já vem preenchido"
para a pessoa errada (link repassado a terceiros).

## Gravação de ligação do VTCall (02-03/09/2026)

A gravação permanente só nasce cerca de 24h depois da ligação. O card agora entra com a gravação
**conferida** (o arquivo é sondado antes de virar link) e é reconferido por até 36h; ligação
**recebida** passou a ter gravação, e o card é atualizado em silêncio (sem sino, sem reabrir a
conversa). Quem atendeu voltou a aparecer nas recebidas. Se o cliente diz que o botão de ouvir não
funciona numa ligação de hoje, o mais provável é que o arquivo permanente ainda não exista — a
reconferência resolve sozinha dentro de 36h.

## Assinatura eletrônica de contratos (04/09)

### `status` do contrato (`signature_envelopes`)
| Valor | Balde de filtro | Significado |
|---|---|---|
| `draft` | aguardando | criado sem nenhuma entrega (falhou) — use `resend` |
| `sent` | aguardando | link entregue, ninguém abriu ainda |
| `viewed` | visualizado | alguém abriu o link |
| `partially_signed` | visualizado | parte das pessoas assinou |
| `signed_pending_seal` | assinado | todos assinaram; o documento final está sendo gerado |
| `signed` | assinado | documento final pronto (`sealed_sha256`) |
| `refused` / `cancelled` / `expired` | encerrado | recusado / cancelado pela equipe / prazo venceu |

### `role` do participante: `signer` (titular), `witness` (testemunha), `sender` (remetente — assina no painel).
### `status` do participante: `pending` → `viewed` → `verified` → `signed` | `refused`.
### Erros do envio (`signature_envelopes_create`): `variaveis_sem_valor` (+ `missing[]`), `escolher_caixa` (+ `inboxes[]`),
`entrega_falhou`, `sem_caixa_whatsapp`, `telefone_invalido`, `limite_do_mes`, `cpf_invalido`, `funcionalidade_desligada`.
