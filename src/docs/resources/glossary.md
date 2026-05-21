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

## Inbox (Caixa de Entrada / Canal)

### `channel_type`
- `Channel::Waha` — WhatsApp via WAHA (não-oficial, QR code)
- `Channel::Whatsapp` — WhatsApp Cloud API (oficial)
- `Channel::WebWidget` — chat ao vivo no site
- `Channel::Email` — email
- `Channel::FacebookPage` — Messenger
- `Channel::Instagram` — Instagram DM
- `Channel::Telegram` — Telegram
- `Channel::Api` — webhook custom
- `Channel::Voice` — VoIP / chamadas

### Campos importantes
- `id`: ID interno
- `name`: nome configurado pelo admin
- `channel_id`: FK pro canal polimórfico
- `enable_auto_assignment`: se está atribuindo automaticamente
- `working_hours_enabled`: se respeita horário de atendimento
- `greeting_enabled` / `greeting_message`: mensagem de boas-vindas

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

- `name`: nome do funil
- `stages`: array de etapas — cada uma com `name`, `color`, `position`
- `archived`: `true` = não aparece na UI principal

## Captain::Assistant (AI Agente / IA de atendimento)

- `id`: ID interno
- `name`: nome do agente (ex: "Luna", "Diogo")
- `config.feature_memory`: gera notas no contato ao resolver conversas
- `config.feature_faq`: gera FAQs sugeridas ao resolver conversas
- `config.model`: modelo OpenAI usado (gpt-4o, gpt-4o-mini)
- `config.temperature`: 0.0-1.0
- `config.instructions`: prompt sistema (Liquid template)

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

## AutomationRule (Regra de automação)

- `event_name`: `conversation_created`, `conversation_resolved`, `message_created`, etc
- `conditions`: jsonb array de condições
- `actions`: jsonb array de ações
- `active`: `true` = rodando

## Booking (Agendamento)

- `event_type_id`: FK pro tipo de evento (ex: "Demo 30min")
- `attendee_email`, `attendee_name`, `attendee_phone`
- `start_time`, `end_time`: ISO 8601
- `status`: `scheduled`, `cancelled`, `completed`

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
| CPF, CNPJ, endereço do cliente | `custom_attribute_definitions` model=contact_attribute | ✅ SIM (não tem nativo) |
| Tag pro contato (residencial, empresarial) | `labels` | ✅ SIM via Label |
| Etapa do funil | `funnel.stages` | ❌ NÃO |
| Tarefa interna do card | `kanban_item.checklist` ou `kanban_config.checklist_templates` | ❌ NÃO |
| Telefone validado WhatsApp do contato | atributos nativos WhatsApp Chat ID/JID/LID | já criados pelo WAHA automaticamente |
| Origem do lead (Google Ads, Meta) | `kanban_config.global_custom_attributes` (tipo list) | bom uso de custom_attribute |
