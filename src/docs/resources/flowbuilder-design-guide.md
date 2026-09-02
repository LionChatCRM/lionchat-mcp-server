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
| Dividir na proporção entre branches (A/B) | `randomizer` | - |
| Gerir grupo WhatsApp: criar/buscar, nome/foto/descrição, participantes, admins, convite (WAHA) | `update_group` (uma operação por bloco via `groupOperation`) | - |
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
    "items": [
      { "key": "message_received", "config": { "keywords": ["oi", "ola"], "match_type": "contains" } }
    ]
  }
}
```

**ATENÇÃO — chave `items`, não `triggers` (corrigido 19/08/2026).** Os gatilhos vão em **`data.items`**, cada item no formato **`{ "key": "...", "config": { ...filtros... } }`**. O formato antigo (`data.triggers` + `type` + filtros soltos no topo) ainda é aceito pelo motor por compatibilidade, mas **NÃO deve ser usado em fluxo novo**: o editor do FlowBuilder lê apenas `data.items`, então um fluxo gravado no formato antigo **dispara normalmente mas abre com o bloco Início EM BRANCO no painel do cliente** — e um clique em "Concluir" naquele modal apagava o gatilho em silêncio. Foram 53 fluxos de 9 contas nesse estado até o conserto de 19/08. Alguns leitores do backend (`has_webhook_trigger?` do disparo por webhook, o filtro de Campanha de Fluxo, o gatilho LionTrack e o histórico de execução) também só entendem `items`.

**Triggers válidos:** `message_received`, `message_sent`, `conversation_created`, `conversation_resolved`, `conversation_reopened`, `team_changed`, `assignee_changed`, `label_added`, `label_removed`, `sla_missed`, `card_created`, `card_moved`, `card_won`, `card_lost`, `conversation_attribute_changed`, `card_attribute_changed`, `contact_attribute_changed`, `date_trigger`, `campaign_trigger`, `manual_trigger`, `webhook_received`, `page_track`, `group_participant_joined`, `group_participant_left`, `lead_form_completed`, `lead_form_milestone`, `lead_form_abandoned`, `booking_created`, `booking_cancelled`, `booking_rescheduled`, `booking_completed`.

**NÃO existem** os gatilhos `webhook` (o correto é **`webhook_received`**) nem `cron` (para disparo por data use `date_trigger`; para disparo em lote use `campaign_trigger` + Campanha de Fluxo). Até 19/08/2026 este guia listava os dois por engano — o fluxo 180 da conta 54 ficou ATIVO com `webhook` e **nunca disparou uma vez em 26 dias**, sem erro nenhum.

**Trigger `message_sent` (novo 2026-06-11):** par do message_received, mas pra mensagens de SAÍDA — dispara quando atendente, celular (eco do WhatsApp) ou a própria IA/flow envia mensagem (nota privada NÃO dispara). Config: `keywords` (opcional) + `match_type` (`contains`|`exact`). Caso de uso clássico: "quando eu responder do celular, desligar a IA". ATENÇÃO: mensagem da IA também dispara — se a ação for desativar a IA, use keywords que só humanos digitam ou aceite que a primeira resposta da IA aciona o flow. Protegido por anti-loop (profundidade 5) e sessão única por conversa+flow; nunca alimenta `waiting_input`.

**Campos de filtro por trigger (IMPORTANTE — nomes exatos):**
- `message_received`: `keywords` (array, obrigatório, cada termo com mín 3 chars) + `match_type` (`'exact'` ou `'contains'`, default `contains`). NÃO use `match_mode` aqui. Dispara em QUALQUER mensagem do cliente que case (não só na primeira) — só mensagem de cliente dispara, nunca de agente.
- `conversation_created` / `conversation_reopened`: filtro opcional de keywords via `match_mode` (`'any'`, `'contains'`, `'exact'`, `'customer_initiated'`, `'agent_initiated'`) + `keywords`. Só ESTES dois triggers usam `match_mode`.
- `label_added` / `label_removed`: `label_names` (array de slugs). NÃO use `label` (singular) — é ignorado.
- `card_created` / `card_moved`: `funnel_ids` (array de STRINGS, ex.: `["37"]` — número puro `[37]` NÃO casa) + `funnel_stages` (array de `"funnel_id:chave_da_etapa"`, ex.: `"37:agendamento_pendente"`). A `chave_da_etapa` é a CHAVE INTERNA da etapa no funil (slug legível em funis de template; pode ser um UUID/`stage_<n>` em etapa criada à mão ou funil duplicado) — NÃO o nome exibido na tela. Sem `funnel_ids` → dispara em qualquer funil; com `funnel_ids` mas sem `funnel_stages` → qualquer etapa daquele(s) funil(is). O card precisa estar num funil listado em `funnel_ids` pra o filtro de etapa valer. ATENÇÃO: dois flows ATIVOS na mesma inbox com `card_created`/`card_moved` de funil/etapa sobrepostos são bloqueados na criação/ativação (ver `flow_trigger_conflict` no fim deste guia).
- `team_changed`: `team_ids` (array de STRINGS; vazio = qualquer equipe). `assignee_changed`: `agent_ids` (array de STRINGS; vazio = qualquer atendente). `card_won` / `card_lost`: `funnel_ids` (array de STRINGS) — disparam SÓ quando o STATUS do card vira ganho/perdido, nunca por etapa com esse nome.
- `page_track` (LionTrack, só flow individual): `{ "track_type": "visited_page"|"event_fired", "urls": [...], "operator": "contains"|"exact"|"starts_with", "event_names": [...], "event_operator": "equals"|"contains", "cooldown_hours": 24 }` — `cooldown_hours` (padrão 24, mínimo 1) não re-dispara pro mesmo contato dentro da janela.
- `conversation_attribute_changed` / `card_attribute_changed` (novo 2026-07-08): disparam na VIRADA de um atributo (da CONVERSA ou do CARD do kanban) pro valor que casa — RE-ENTRAM toda vez que o atributo muda pro valor alvo. Config: `{ "logic": "and"|"or", "rules": [ { "attr_key": "...", "operator": "...", "value": "..." } ] }` (uma rule pode usar `values: [...]` no lugar de `value` pra multi-valor). O `attrSource` é IMPLÍCITO pela chave do gatilho (conversa vs card) — NÃO informe. Operadores (contexto REATIVO — desde 09/07 `is_empty`/`is_not_empty` NÃO valem aqui, pois "está vazio AGORA" dispararia a cada evento; use-os só no nó Condição): `equal`/`not_equal`/`contains`/`not_contains`/`starts_with`/`ends_with`/`greater_than`/`less_than`/`number_range`. Só `card_attribute_changed` aceita `funnel_id`/`card_source` opcionais dentro da rule (pra achar o card). Rule sem `attr_key` é ignorada.
- `contact_attribute_changed` (novo 2026-07-22 — "Atributo do contato muda"): dispara quando um atributo personalizado do **CONTATO** muda e a condição casa — mesmo com o contato fora de flow. Item: `{ "key": "contact_attribute_changed", "config": { "logic": "and"|"or", "rules": [ { "attrSource": "contact", "attr_key": "...", "operator": "...", "value": "..." } ] } }` (1 a 10 rules; `values: [...]` pra multi-valor). **DIFERENTE dos irmãos de 08/07: aqui o `attrSource` VAI na rule e é SEMPRE `"contact"`.** Operadores iguais aos do nó Condição. **VERSÃO SEGURA por decisão de produto:** dispara SÓ na conversa mais recente que JÁ EXISTE numa caixa do flow (reabre se resolvida); contato sem conversa NÃO dispara e NUNCA cria conversa. Dedup de 30s por contato + anti-loop por profundidade de cadeia (flow que muda atributo que dispara flow…). Só flows de conversa.

- `date_trigger` — **Gatilho de Data (novo 2026-07-10):** dispara quando uma DATA guardada na ficha do CONTATO chega (aniversário, data de exame, vencimento de plano). Modelo "agendamento de mensagem": a escrita da data já marca o disparo — NÃO existe varredura periódica. Só em flow `conversation` **individual** (a data é de um contato; grupo não tem). Config (item usa `config` ANINHADO, igual `webhook_received`/`attribute_changed`):
  ```json
  { "key": "date_trigger", "config": {
    "attr_key": "_date_of_birth",          // "_date_of_birth" = Aniversário nativo; OU a chave de um atributo do contato do tipo Data (ex.: "data_exame")
    "offset_direction": "on",              // "before" | "on" | "after"
    "offset_days": 0,                      // 0-365 (relevante só p/ before/after)
    "repeat_yearly": true,                 // true = ignora o ano da data (aniversário); false = data única
    "attr_source": "contact",              // "contact" (default) | "conversation" — ver bloco abaixo
    "overwrite_mode": "replace",           // "replace" (default) | "keep_both" — ver bloco abaixo
    "send_time_source": "fixed",           // "fixed" | "attribute" | "variable"
    "send_time": "09:00",                  // p/ fixed — HH:MM
    "send_time_attr_key": "",              // p/ attribute — chave de atributo (do CONTATO, ou da CONVERSA se attr_source='conversation') que contém HH:MM
    "send_time_template": "",              // p/ variable — fórmula Liquid que resulta em HH:MM (contato; e {{conversation.*}} quando attr_source='conversation')
    "inbox_mode": "contact_recent",        // "contact_recent" (conversa mais recente do contato) | "fixed" — IGNORADO/ausente quando attr_source='conversation'
    "inbox_id": null,                      // OBRIGATÓRIO p/ inbox_mode "fixed" — id de uma inbox vinculada ao flow
    "filters": { "logic": "and", "rules": [] }  // opcional; mesmo formato de attribute_changed, attrSource é sempre "contact"
  }}
  ```
  Regras: `attr_key` é **obrigatório**. `trigger_uuid` é preenchido pelo backend no save (NÃO envie; se enviar é preservado). 29/02 em ano não-bissexto colapsa p/ 28/02. Disparo vencido tem tolerância de 24h. Se `inbox_mode` for `fixed` e a caixa for desvinculada do flow depois, os envios daquele gatilho são **pulados** (visíveis em `flows_executions_list`). Caixa oficial WhatsApp exige template na 1ª mensagem se a conversa for criada nova (senão pula). Ativar o flow agenda automaticamente os contatos que já têm a data preenchida.
  - **`attr_source: 'conversation'` (novo 2026-07-18):** a data vem de um atributo de DATA da CONVERSA (não do contato). Dispara NAQUELA conversa (reabre se resolvida). `attr_key` = chave de atributo de conversa tipo Data; o horário-por-atributo lê da conversa. NÃO tem seletor de caixa (a conversa já é conhecida) — não envie `inbox_mode`/`inbox_id`. NÃO use `repeat_yearly` (conversa é evento pontual — vetado com keep_both). SEM agendamento retroativo: só agenda o que for escrito/alterado APÓS ativar (100% forward). Ausente = `'contact'` (comportamento legado).
  - **`overwrite_mode` (novo 2026-07-18):** `'replace'` (default) = trocar a data cancela o agendamento anterior (correção de data errada não dispara em dobro). `'keep_both'` = acumula (cada data seu próprio disparo) — **SÓ com `attr_source: 'conversation'`** (vetado no contato) e **incompatível com `repeat_yearly`**. Os disparos futuros pendentes ficam visíveis/canceláveis na aba "Agendados" do editor.
  - **Ver/cancelar os agendamentos (novo 2026-07-20):** `flows_scheduled_firings_list` (flow_id) lista os disparos FUTUROS pendentes do Gatilho de Data (quando vai disparar, atributo/valor que gerou, fonte contato/conversa, contato/conversa alvo). `flows_scheduled_firings_cancel` (flow_id, id) cancela um — se já disparou responde 409 `ja_disparado` e nada muda. Só flows com Gatilho de Data; ADMIN + flowbuilder_manage.

**Trigger `campaign_trigger` — Gatilho "Campanha" (novo 2026-07-28):** LIBERA o flow para ser disparado
por uma **Campanha de Fluxo** (Campanhas > Fluxo). É uma **AUTORIZAÇÃO, não um evento**: sozinho ele
nunca dispara nada — quem dispara é a campanha, pessoa por pessoa, no ritmo configurado nela.

Item (sem `config`): `{ "key": "campaign_trigger" }`

- **Sem esse item o flow NÃO aparece na lista da campanha** e `campaigns_create` com `flow_id` responde
  422. É o passo que todo mundo esquece — ao montar um flow para disparo em massa, **ligue este gatilho
  antes de criar a campanha**.
- Pode conviver com outros gatilhos no mesmo flow (ex.: um flow que responde a mensagem E também pode
  ser disparado em campanha). É **isento** da trava de gatilho duplicado.
- Só flow de conversa (`flow_type: conversation`); flow de grupo funciona, mas o público é de contatos.
- Em caixa WhatsApp **oficial**, o primeiro bloco de mensagem de **CADA CAMINHO** que sai do Início
  precisa abrir com **template aprovado** — não só o primeiro bloco que o flow encontra. Com
  randomizador (teste A/B) ou condição logo no começo, **todas** as variações são conferidas: basta
  UMA sem template pra campanha ser recusada na criação (422). O erro nomeia os blocos culpados pelo
  rótulo, teto de 5: `must start with an approved WhatsApp template on official inboxes (no template
  in: <rótulos>)`. O que vale é o **primeiro item** do `messageItems` daquele bloco, e os tipos
  aceitos são `template` (o que a tela grava) e `whatsapp_template` (legado). Flow sem nenhum bloco
  de mensagem não tem o que validar. Em QR Code não existe essa regra.
  (Corrigido em 2026-07-29: até então a checagem aceitava só `whatsapp_template` — nome que a tela
  NUNCA gravou — e olhava um caminho só; recusava 100% das caixas oficiais.)
- Como a campanha inicia o flow com o contato **sem ter mandado nada**, escreva o 1º bloco assumindo
  contato frio (apresente-se, dê contexto) — diferente de um flow de atendimento, que responde a alguém.

Receita completa: `flows_create`/`flows_update` com o item no start → `flows_list` com
`with_campaign_trigger=true&inbox_id=N` para confirmar que ficou elegível → `campaigns_create` com
`flow_id`. Acompanhar: `campaigns_flow_report`. Interromper: `campaigns_stop_flow`.

**Trigger `webhook` — Webhook Universal EMBUTIDO (novo 2026-06):** o flow pode ser disparado por um webhook próprio, criado automaticamente. Receita via API:
1. Criar o flow normalmente (`flows_create`).
2. `POST /custom_webhook_integrations` com `{ "custom_webhook_integration": { "flow_id": <id do flow> } }` — o sistema cria a integração embutida (idempotente: repetir retorna a mesma; nome automático "Flow: <nome>"; auto-mapeia todos os eventos → este flow) e retorna a URL única do webhook.
3. No node `start`, adicionar em `data.items` o item `{ "key": "webhook_received", "config": { "integration_id": <id da integração> } }`.
4. Salvar o flow (`flows_update`) — o save sincroniza a ativação do webhook embutido (remover o item desativa a integração automaticamente).
Webhooks embutidos NÃO aparecem na listagem de integrações standalone; excluir o flow destrói o webhook; duplicar o flow NÃO copia o gatilho embutido. Rate limit do endpoint público: 60/min por token.

**Gatilhos de AGENDAMENTO — Booking NATIVO do LionChat (2026-08-20):** `booking_created` (alguém marcou pelo link público, pela IA ou pelo painel), `booking_cancelled` (paciente cancelou pelo link, IA cancelou ou a equipe cancelou na Agenda), `booking_rescheduled` (a data/hora mudou — link do paciente, IA, editar/adiar na Agenda), `booking_completed` (equipe concluiu na Agenda; exige a Agenda unificada ligada na conta). **Não é e-Clínica.** Config (tudo opcional, vazio = todos): `booking_event_type_ids` (array de ids de tipo de agendamento, **STRING**), `agent_ids` (array de ids de usuário — o RESPONSÁVEL da tarefa), `create_conversation` (boolean, padrão `false`: só dispara para quem já tem conversa numa caixa do flow; `true` = cria a conversa na 1ª caixa do flow). Exemplo: `{ "key": "booking_created", "config": { "booking_event_type_ids": ["44"], "agent_ids": [], "create_conversation": true } }`. São INERTES a evento de conversa (quem dispara é o `Booking::FlowTriggerDispatcher`, por CONTA — caixa do flow só define onde a conversa é criada/reusada). Variáveis no flow: `{{booking.date}}` (DD/MM/AAAA), `{{booking.time}}`, `{{booking.weekday}}`, `{{booking.datetime}}` (ISO), `{{booking.type}}`, `{{booking.type_format}}` (presencial/videochamada), `{{booking.duration}}`, `{{booking.agent}}`, `{{booking.status}}` (confirmado/cancelado/remarcado/concluído), `{{booking.description}}`, `{{booking.cancel_url}}`, `{{booking.reschedule_url}}`, `{{booking.color}}`, `{{booking.id}}`; só no remarcado: `{{booking.previous_date}}`, `{{booking.previous_time}}`, `{{booking.previous_datetime}}`; `{{booking.meeting_url}}` NÃO vem no criado (nasce vazio). Data/hora vêm da TAREFA da Agenda (sempre atuais). Regras: o evento mais novo SUBSTITUI a rodada ativa do mesmo flow na mesma conversa (2ª consulta do mesmo paciente, ou cancelado chegando com o criado ainda esperando resposta); excluir a tarefa, reabrir cancelada ou desfazer conclusão NÃO disparam; adiar (snooze) conta como remarcado; tipo com confirmação/lembrete próprios ligados + `booking_created` = o paciente pode receber duas mensagens (a tela avisa). Colisão entre flows é por CONTA: mesmo kind + tipos se cruzando + agentes se cruzando (vazio = todos). Há também `{{booking.event}}` (`created`|`cancelled`|`rescheduled`|`completed` — bom pra condição; não aparece no seletor da tela, mas resolve); `{{trigger.type}}` = a chave do gatilho (ex.: `booking_created`), `{{trigger.kind}}` = `created`|`cancelled`|`rescheduled`|`completed` e `{{trigger.booking_id}}`. SÓ flow de conversa **individual** (a tela nem oferece em flow de grupo); **nunca dispara flow `ai_tool`**. Em caixa WhatsApp OFICIAL, conversa criada nova (ou parada há mais de 24h) está FORA da janela — texto livre no 1º bloco cai em `window_closed`/erro; comece por template.

**TRAVA DE GATILHO DUPLICADO (2026-06-16) — leia ANTES de ativar/criar flow ativo:** o sistema BLOQUEIA ter dois flows ATIVOS com o MESMO gatilho na MESMA inbox e mesmo `conversation_mode` (evita o evento disparar dois flows). Colisão = mesmo tipo de gatilho + config cruzando (mesmas keywords/funil/labels/url/etc) + inbox compartilhada + mesmo modo. EXCEÇÕES que podem coexistir: `webhook_received`, `manual_trigger` e `campaign_trigger` (este último porque não dispara por evento — é só uma autorização para a campanha).
- Ao **ativar** (`flows_toggle` inativo→ativo) ou **criar já ativo**: qualquer conflito é barrado.
- Ao **editar** um flow já ativo: só conflito NOVO é barrado (duplicados que já existiam são preservados).
- A API responde **422** com `{ "error_code": "flow_trigger_conflict", "conflicts": [{ flow_id, flow_name, trigger_type, inbox_id, inbox_name }] }`.
- Existe `POST /flows/check_conflicts` (mesma assinatura, NÃO salva) pra checar antes.

**Como a IA deve agir:** antes de ativar um flow, confira via `flows_check_conflicts` (mesma assinatura do toggle/update, NÃO salva nada e devolve exatamente quem colide) se já não há outro flow ativo no mesmo gatilho+inbox — NÃO tente deduzir isso lendo o `flow_data` de cada item da `flows_list` (a lista é pra escolher/filtrar fluxos, não pra inspecionar blocos). Se receber 422 `flow_trigger_conflict`, NÃO fique reativando — EXPLIQUE o conflito ao usuário (nome do flow conflitante + caixa) e ofereça desativar o outro flow ou ajustar o gatilho/keywords.

**O que `flows_list` devolve (leve, desde 20/08/2026):** `id`, `name`, `description`, `flow_type`,
`conversation_mode`, `active`, `inbox_ids`/`inboxes`, `tags`, `tool_name`/`tool_description` e
**`trigger_types`** (as chaves de gatilho do bloco Início — serve pra filtrar "quais flows disparam
por `message_received`" sem abrir cada um). **NÃO vem** `flow_data`, `variables` nem métricas por
bloco — pra isso use `flows_show`. Contadores de sessão (`session_stats`: `total`, `active`,
`waiting`, `completed`, `exited`, `error`) só com `with_session_stats=true`. Ignore
`executions_count`/`errors_count` (sempre 0).

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
      { "id": "m2", "type": "delay", "duration_seconds": 2 },
      { "id": "m3", "type": "whatsapp_template", "templateId": 123, "params": ["valor1"] }
    ]
  }
}
```

**Tipos de item válidos:** `text`, `whatsapp_template` (ou `template`), `canned_response`, `user_input` (pausa esperando resposta livre), `delay`, `attachment`, `audio`, `url_media` (`{ "type": "url_media", "url", "caption" }` — mídia por URL; a `url` aceita `{{variável}}` e o motor baixa com proteção SSRF e detecta o tipo; `image`/`video`/`file`/`document` também são aceitos como mídia, com `attachment_url`).

**`delay` usa `duration_seconds` (0-30), NÃO `seconds`.** O motor aceita os dois, mas a tela lê/grava só `duration_seconds` — item gravado com `seconds` roda, porém abre como "undefineds" no editor e o cliente não consegue ajustar (mesma família do `percent` x `weight` do randomizador).

**ATENÇÃO:** usa `messageItems` (NÃO `items`).

**Botões interativos:** um item `text` com `buttons_enabled: true` e `buttons: [{ title, value }, ...]` vira mensagem com botões. Ao clicar, o flow roteia pelo handle **`button_<value>`** (ex: botão com `value: "sim"` → handle `button_sim`). Se o cliente digitar texto livre em vez de clicar, cai no handle **`no_response`**. Se houver timeout configurado, cai em **`no_reply_timeout`**.

```json
{ "id": "m1", "type": "text", "content": "Confirma o agendamento?",
  "buttons_enabled": true,
  "buttons": [ { "title": "Sim", "value": "sim" }, { "title": "Não", "value": "nao" } ] }
```
→ edges: `sourceHandle: "button_sim"`, `sourceHandle: "button_nao"`, e opcionalmente `"no_response"`.

**Handles que SAEM:** `success` (sem botões) + `error`; com botões → `button_<value>` (um por botão) + `no_response` + `error`. E, SÓ em caixa WhatsApp OFICIAL com item sujeito à janela de 24h (`text`/`canned_response`/`attachment`/`audio`/`url_media`), **`window_closed`**: o motor segue por ele quando a janela está fechada (ligue ali um bloco com template); sem esse fio a janela fechada cai no caminho de erro. Fora de caixa oficial o handle NÃO existe (edge nele = aresta fantasma). Com botões a janela fechada também vale.

**Timeout dos botões (opcional, no MESMO item de botões):**
- `buttons_timeout` (número) + `buttons_timeout_unit` (`"minutes"` | `"hours"` | `"days"`) → tempo de espera sem resposta. Só com `buttons_timeout > 0` existe o handle `no_reply_timeout`.
- `buttons_timeout_action`: `"advance"` (padrão) | `"remind"`.
  - `"advance"`: ao esgotar o tempo, segue o handle `no_reply_timeout` (ex: manda pro atendimento humano).
  - `"remind"`: manda UM lembrete (`buttons_reminder_text`) e CONTINUA aguardando o clique no MESMO menu; se ainda não responder, segue o `no_reply_timeout`. O clique (no menu original OU no lembrete) continua o flow normalmente.
- `buttons_reminder_text` (string) → texto do lembrete (só no modo `remind`; vazio = reenvia o conteúdo original).
- **REGRA do modo `remind`:** `buttons_timeout_unit` NÃO pode ser `"days"` e horas ≤ 23 — o lembrete precisa caber na janela de 24h do WhatsApp oficial. No modo `"advance"`, qualquer unidade/valor é permitido.

**Botões em TEMPLATE (novo 2026-07-22):** item de template com botões quick-reply também PAUSA e roteia pelo clique — mesmo motor do texto-com-botões. O item DEVE ter `type: "template"` (**NÃO** `whatsapp_template` — o canvas só expõe os handles com `"template"`) + `template_id` + `template_buttons: [ { "title": "...", "value": "..." } ]`:
- `title` = texto **EXATO** do botão quick-reply aprovado na Meta (o WhatsApp devolve o TÍTULO no clique; o match é por ele). `value` = slug do título (deduplicado se dois títulos colidem).
- Handles: `button_<value>` por botão + `no_response` (sempre — texto livre em vez de clique) + `no_reply_timeout` (só com `buttons_timeout > 0`; `buttons_timeout_unit` `minutes|hours|days`; `0` = sem timeout).
- Modo síncrono (`ai_tool`) e `dry_run` NÃO pausam/roteiam — o template só é enviado (botões decorativos). Só faz sentido em caixa WhatsApp com template de botões aprovado.
- **O item guarda uma FOTO do template** (corpo + botões) tirada quando foi configurado. Se o modelo for
  alterado na Meta depois disso, a foto envelhece: até 2026-07-30 a atualização automática ao reabrir o
  bloco comparava só o CORPO, então mudança APENAS de botão passava batido — a tela mostrava os botões
  novos (ela lê o modelo vivo) e o flow continuava roteando pelos ANTIGOS. Caso real: um botão renomeado
  fazia todo mundo cair em "outra resposta". Hoje corpo E botões são comparados. **Se você mudou os
  botões de um template na Meta, avise que é preciso reabrir o bloco e RELIGAR a saída renomeada** — a
  aresta do botão antigo é removida junto.

> ⚠️ **SAÍDAS CONDICIONAIS — NUNCA ligue edge nelas sem ativar a condição.** Estas saídas SÓ existem
> quando a config abaixo está presente. Ligar edge nelas sem isso cria uma **aresta fantasma** (linha
> que sai do nada no canvas, não roteia nada):
> - **`no_reply_timeout`** → só existe se o item de botões tiver **`buttons_timeout` > 0** (tempo de espera configurado).
> - **`window_closed`** → só existe em **flow de WhatsApp API oficial** com item sujeito à janela de 24h (texto/áudio/anexo/resposta pronta).
>
> Regra: se você NÃO configurou o timeout, **NÃO** crie edge `no_reply_timeout`. Se não é API oficial, **NÃO** crie edge `window_closed`.

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

**`validation` válidos:** `any`, `options`, `varied_options`, `regex`, `email`, `phone`, `number`, `cpf`, `cnpj`, `cpf_cnpj`, `date`, `rg`, `profession`. As validações cadastrais (`cpf`/`cnpj`/`cpf_cnpj`/`date`/`rg`/`profession`) conferem o formato e, no CPF/CNPJ, o dígito verificador — resposta inválida volta pra `invalidMessage` (respeita `maxRetries`).

**`options` normaliza a resposta (2026-06-16):** a comparação com `acceptedOptions` é feita sem acento e sem maiúscula (`I18n.transliterate` + downcase + strip nos dois lados). "São Paulo", "sao paulo" e "SAO PAULO" casam todos.

**`varied_options` — uma opção, vários jeitos de escrever (2026-06-16):** use quando a MESMA opção pode vir em sinônimos/variações (ex: "sim", "claro", "quero" → tudo é "sim"). Em vez de `acceptedOptions`, configure `optionGroups`: cada grupo tem uma lista de termos e um `matchType` PRÓPRIO (`contains` padrão, ou `equals`). Use `equals` quando o termo curto colidiria — ex: o termo "1" com `contains` casaria "12"; com `equals` não. Roteia por uma saída dedicada por grupo: `option_<group_id>` (uma por grupo, não por termo). Mesma normalização do `options` (sem acento/maiúscula). Fallback de matchType: se um grupo não tiver `matchType`, usa o `optionsMatchType` do node (modo global antigo); sem isso, `contains`.

```json
{ "validation": "varied_options",
  "optionGroups": [
    { "id": "sim", "terms": ["sim", "claro", "quero", "pode ser"], "matchType": "contains" },
    { "id": "nao", "terms": ["nao", "não", "agora nao"], "matchType": "contains" }
  ] }
```
→ edges: `sourceHandle: "option_sim"`, `sourceHandle: "option_nao"` (+ `timeout` + `retries_exhausted`).

**`saveTo` válidos (nomes EXATOS — qualquer outro valor NÃO salva nada):**
- `variable` — variável temporária do flow (use `saveVariable` pra nomear; senão usa o próprio `saveTo`)
- `contact_name` — sobrescreve o nome do contato
- `contact_email` — sobrescreve o email do contato
- `contact_phone` — sobrescreve o telefone do contato
- `contact_cpf` — campo cadastral CPF (exige `validation: "cpf"`)
- `contact_cnpj` — campo cadastral CNPJ (exige `validation: "cnpj"`)
- `contact_document` — CPF ou CNPJ, decide pelo nº de dígitos (exige `validation: "cpf_cnpj"`)
- `contact_birthdate` — data de nascimento (exige `validation: "date"`; cliente digita dd/mm/aaaa, salva ISO)
- `contact_rg` — campo cadastral RG (exige `validation: "rg"`)
- `contact_profession` — campo cadastral Profissão (exige `validation: "profession"`)
- `contact_attr` — custom attribute do CONTATO (precisa de `saveAttrKey`)
- `conversation_attr` — custom attribute da CONVERSA (precisa de `saveAttrKey`)
- `""` — não salva

**Campos cadastrais (2026-06):** os destinos `contact_cpf/cnpj/document/birthdate/rg/profession` gravam pelo `CadastralAttributesService` (valida, normaliza e RESPEITA imutabilidade — campo sensível já preenchido NÃO é sobrescrito). Cada um só funciona com a validação correspondente (mesma regra do `allowedSaveTargets` da UI). No editor visual eles só aparecem quando a validação bate.

**NÃO existem** `attribute` nem `contact_attribute` — use `conversation_attr` / `contact_attr`.

**Agrupar mensagens picadas (debounce, 2026-06):** opcional `groupInputsSeconds` (Integer; `0`/ausente = desligado; ex. 10–40). Quando > 0, o flow espera esse tempo após cada mensagem do cliente, concatena os balões num texto só e só então valida; cada nova mensagem reinicia o relógio. Útil quando o cliente quebra a resposta em vários balões. Ex.: `"data": { ..., "validation": "cpf", "saveTo": "contact_cpf", "groupInputsSeconds": 15 }`.

**Salvar e-mail/telefone/nome do contato com segurança (2026-06-16):** o valor é normalizado antes de gravar (telefone → E.164 via `+55`; e-mail → strip). O cadastro do contato REVERTE silenciosamente um e-mail/telefone inválido (não dá erro, mas não muda). Por isso os destinos `contact_email`/`contact_phone`/`contact_name` SÓ devem ser usados com a validação que combina:
- `saveTo: "contact_email"` → use `validation: "email"`
- `saveTo: "contact_phone"` → use `validation: "phone"`
- `saveTo: "contact_name"` → `any` serve
No editor visual esses destinos só aparecem quando a validação bate (computed `allowedSaveTargets`). Os destinos `variable`/`contact_attr`/`conversation_attr` aceitam QUALQUER valor (sem essa restrição).

**Handles que SAEM dependem da validation:**
- `validation: 'any'` (e `regex`/`email`/`phone`/`number`) → `success`, `timeout`, `retries_exhausted`
- `validation: 'options'` → `option_<valor>` para cada valor em `acceptedOptions` (ex: `option_1`, `option_2`, `option_sim`) + `timeout` + `retries_exhausted`
- `validation: 'varied_options'` → `option_<group_id>` para cada grupo em `optionGroups` (ex: `option_sim`, `option_nao`) + `timeout` + `retries_exhausted`

**`timeout` vs `retries_exhausted` (DISTINTOS):** `timeout` = cliente ficou em silencio (estourou `waitTime`). `retries_exhausted` = cliente respondeu, mas errou a validacao mais que `maxRetries` vezes. Ligue cada um ao caminho desejado. Se `retries_exhausted` nao tiver edge, ha fallback p/ o edge de `timeout`; sem nenhum dos dois, o flow encerra ao esgotar as tentativas.

**Timeout dispara de verdade — e SEM fio ENCERRA (desde 20/08/2026):** `waitTime` + `waitUnit`
agendam o estouro. Com fio no handle `timeout`, o flow segue por ele. **Sem fio, a sessão é
ENCERRADA quando o tempo estoura** — a resposta que chegar depois não avança mais aquele fluxo
(cai na conversa como mensagem comum e pode disparar o gatilho de novo). Até 20/08 a sessão ficava
esperando pra sempre, fora do alcance de qualquer vigia e travando o re-disparo do próprio flow
naquela conversa. Decisão do dono: "se não tá ligado a nada, depois encerra". Se o cliente quer
"esperar até responder", ponha um `waitTime` longo e ligue o `timeout` num caminho explícito.
`waitTime` AUSENTE = sem timeout (espera indefinida); `waitTime` vazio (`''`) = 60 (o que a tela
exibe). `maxRetries` vazio/0 = 3. Vale também pro `no_reply_timeout` dos botões.

**Fallback de saída (regra de 20/08/2026, substitui a de 15/08):** fio COM rótulo só é seguido por
quem CASA o rótulo. O "último recurso" do avanço segue EXCLUSIVAMENTE a ligação SEM `sourceHandle`
(fluxo legado de bloco simples) — nunca mais "pega o primeiro fio que existir": resposta A num menu
com só a saída B ligada NÃO entrega no caminho do B, quem não respondeu não cai no botão ligado,
envio bem-sucedido não desce pelo fio `window_closed`. Sem fio elegível o fluxo TERMINA. Duas pontes
explícitas que continuam valendo: (a) na RESPOSTA do cliente (`wait_response`/botões),
`option_X`/`button_X`/`no_response` sem fio próprio cai no fio `success` SE ele existir (o bloco de
botões não expõe `success` na tela, então na prática isso só vale no `wait_response`); (b) a saída
`partial` do `update_group` sem fio cai no `success`. Conclusão prática: ligue TODA saída que pode
acontecer.

**REGRA:** depois de wait_response com `options` OU `varied_options`, NUNCA coloque node `condition` pra ramificar — ligue os edges direto nos handles `option_X` (em `varied_options`, `X` é o `id` do grupo).

**Node que NÃO salva também avança (corrigido 2026-08-01):** até essa data, o avanço do `wait_response`
dependia de ter uma variável configurada — com `saveTo: ""` o node RECEBIA a resposta e reentrava em si
mesmo, e quem respondia no prazo acabava saindo pelo caminho de `timeout`. Sintoma que o cliente
relatava: "mando a mensagem e o fluxo trava em aguardando resposta". Hoje o node avança sempre; salvar
o valor é opcional de novo, como o schema sempre prometeu. Se um flow antigo tiver ganhado uma variável
só pra destravar, ela pode sair.

### 2.4 `condition`

```json
{
  "id": "node-cond-1",
  "type": "condition",
  "position": { "x": 1010, "y": 300 },
  "data": {
    "label": "Tipo de cliente",
    "conditions": [
      { "id": "c1", "label": "VIP", "field": "{{contact.custom_attribute.plano}}", "operator": "equal", "value": "premium", "valueType": "variable" },
      { "id": "c2", "label": "Padrão", "field": "{{contact.custom_attribute.plano}}", "operator": "equal", "value": "standard", "valueType": "variable" }
    ]
  }
}
```

**DUAS regras críticas em condições criadas via API (descobertas 2026-07-10, flow real em produção):**

1. **`field` SEMPRE com chaves `{{...}}`.** O motor só resolve o campo se ele contém `{{` — `"field": "contact.custom_attribute.plano"` (sem chaves) compara o TEXTO LITERAL do caminho com o valor e NUNCA casa (a saída nunca dispara; tudo cai no `default`). Certo: `"field": "{{contact.custom_attribute.plano}}"`.
2. **Inclua `"valueType": "variable"` na regra.** O runtime funciona sem, mas o EDITOR VISUAL identifica o tipo da regra por esse campo — sem ele, ao abrir o nó na tela a saída aparece VAZIA (como se não tivesse condição) e, se alguém salvar o flow pela tela nesse estado, a regra é perdida. `valueType: "variable"` é o tipo genérico de expressão (aceita todos os operadores da tabela abaixo).

**Agrupar várias regras numa saída — E / OU (2026-06):** cada item de `conditions` (cada saída `cond_N`) pode, em vez de uma regra plana, agrupar VÁRIAS regras com `rules[]` + `logic`:

```json
{ "id": "c1", "label": "Cliente do Centro VIP", "logic": "and", "rules": [
    { "field": "contact.custom_attribute.bairro", "operator": "contains", "value": "centro" },
    { "field": "contact.custom_attribute.plano", "operator": "equal", "value": "premium" }
] }
```

- `logic`: `"and"` (todas têm que ser verdadeiras) ou `"or"` (basta uma). Ausente = `"and"`.
- Cada item de `rules[]` tem a MESMA forma de uma regra plana (`field`/`operator`/`value`/`values`/`attr_key`/`attrSource`/`funnel_id`/`stage`...). Limite: 10 regras por saída.
- **Retrocompat:** uma saída SEM `rules` (só `field`/`operator`/`value` direto) continua valendo = grupo de 1 regra. Pode misturar saídas planas e agrupadas no mesmo node.
- `label` é o NOME (opcional) da saída — só cosmético, aparece no rótulo do canvas. NÃO afeta roteamento (continua por ÍNDICE `cond_N`, first-match-wins). As regras de um grupo podem ser de tipos diferentes (atributo + status + etiqueta + SLA...).

**ATENÇÃO — atributo customizado é SINGULAR:** `contact.custom_attribute.X` e `conversation.custom_attribute.X` (também `account.custom_attribute.X`). Usar plural `custom_attributes` resolve VAZIO — vale tanto no `field` da condição quanto em mensagens/variáveis `{{...}}`.

**Dados cadastrais — forma curta é a canônica (2026-06):** `{{contact.cpf}}`, `{{contact.cnpj}}`, `{{contact.rg}}`, `{{contact.address.number}}`, `{{contact.address.street}}` etc. O backend traduz internamente pra `contact.cadastral.*` (flows antigos com a forma longa continuam resolvendo). NÃO use `contact.attributes.cpf` nem `contact.custom_attribute.cpf` — cadastral NÃO é custom attribute.

**Operadores válidos (lista real do runtime):**

| Operador | Uso |
|---|---|
| `equal` (ou `field_equals`) / `not_equal` | igualdade |
| `contains` / `not_contains` | substring |
| `starts_with` / `ends_with` | prefixo/sufixo |
| `is_empty` / `is_not_empty` | vazio/preenchido (NÃO existe `is_present`/`is_blank`) |
| `greater_than` / `less_than` | comparação numérica (atributo número) OU de DATA (atributo `date`, `value` ISO `YYYY-MM-DD`). O backend detecta data ISO no valor do atributo e compara como data; senão numérico |
| `number_range` | faixa; `value` no formato `"min-max"` (ex `"10-50"`) |
| `has_length` | comprimento exato (`value` = número) |
| `is_number` / `is_letter` / `is_email` / `is_phone` | validação de formato |
| `regex` | padrão regex em `value` |
| `equal_any` / `not_equal_any` / `contains_any` / `not_contains_any` | multi-valor (usa `values` array). `contains_any` = contém ALGUMA; `not_contains_any` = não contém NENHUMA (útil pra "seguir só quando a msg não tem nenhuma das palavras-chave de outros flows") |
| `starts_with_any` / `ends_with_any` (novo 2026-08-07) | multi-valor (usa `values` array), caixa-insensível. `starts_with_any` = o texto COMEÇA com ALGUMA das palavras da lista; `ends_with_any` = o texto TERMINA com alguma |
| `business_hours` / `outside_business_hours` | horário comercial (par: dentro/fora). `business_hours` aceita `start_hour`/`end_hour` (0-23), `days` (array 0=Dom..6=Sab, ausente=todos) e **`timezone`** (IANA, ex.: `America/Sao_Paulo` — default se ausente). **REGRA:** a saída `outside_business_hours` HERDA `start_hour`/`end_hour`/`days`/`timezone` da `business_hours` ANTERIOR no array — pode deixá-los ausentes na "fora" (o backend preenche). O horário é avaliado no `timezone` (não em UTC) |
| `can_reply` / `can_reply_closed` | janela 24h aberta/fechada |
| `conversation_has_agent` / `conversation_no_agent` / `conversation_not_agent` | agente atribuído (HUMANO) |
| `conversation_has_ai_agent` / `conversation_no_ai_agent` / `conversation_not_ai_agent` | agente de IA atribuído (novo 2026-08-01) — ver abaixo |
| `contact_has_label` / `contact_no_label` / `conversation_has_label` / `conversation_no_label` | labels |
| `kanban_exists` / `kanban_in_stage` / `kanban_won` / `kanban_lost` | card no funil. `funnel_id` é CHAVE SEPARADA da condição (número, ex.: `"funnel_id": 37`). A etapa vai em `value` (slug puro da etapa, ex.: `"avaliacao_aceita"`) ou em `stage` — NÃO no formato `"37:etapa"`. Ex.: `{ "operator": "kanban_in_stage", "funnel_id": 37, "value": "avaliacao_aceita" }` |
| `card_attr_equals` / `card_attr_contains` | atributo do card (`attrSource: 'card'` + `attr_key`; aceita `card_source: 'trigger'` p/ ler o card que iniciou o flow) |
| `pagetrack_visited` / `pagetrack_event` | LionTrack |
| `sla_check` | status do SLA da conversa (usa `value` = código fixo; ver abaixo) |

> **ATENÇÃO — onde o VALOR vai (defeito real de 02/09/2026, conta 137):** no nó **Condição**, uma regra de atributo
> (`valueType: "attr_config"`) com operador `equal`, `not_equal`, `contains` ou `not_contains` guarda o valor em
> **`values: ["..."]` (lista)** e deixa `value: ""`. A TELA lê SÓ a lista: regra gravada com `value: "paid_ad"` e
> sem `values` roda certa no motor mas abre com a caixa de valor **VAZIA** — o cliente conclui que não foi
> configurado. Só `greater_than`, `less_than`, `starts_with` e `ends_with` usam `value` (campo único);
> `number_range` usa `value: "min-max"`; `is_empty`/`is_not_empty` não têm valor. Grave sempre o shape completo:
> `{ "id": 1, "field": "{{last_response}}", "operator": "equal", "value": "", "values": ["paid_ad"],
> "valueType": "attr_config", "attrSource": "conversation", "attrScope": "campaign", "attr_key": "origin_kind",
> "funnel_id": "", "stage": "" }` dentro de `rules`, com o branch repetindo `value`/`values`/`valueType`.

**Restrição por TIPO de atributo (a UI só oferece um subconjunto, e é o que faz sentido):**
- **Texto/string:** `equal`, `not_equal`, `contains`, `not_contains`, `starts_with`, `ends_with`, `is_empty`, `is_not_empty`
- **Número:** `equal`, `not_equal`, `greater_than`, `less_than`, `number_range`, `is_empty`, `is_not_empty`
- **Lista:** `equal`, `not_equal`, `contains`, `not_contains`
- **Data (`date`):** `equal`, `not_equal`, **`greater_than`, `less_than`** (novo 2026-07-21). Em `greater_than`/`less_than` o `value` é data ISO `YYYY-MM-DD` (UI = calendário). Backend compara como DATA (dia).
- **Hora (`time`):** `equal`, `not_equal`, **`greater_than`, `less_than`** (novo 2026-07-21), `is_empty`, `is_not_empty`. `value` canônico `"HH:MM"` 24h (UI = seletor de hora). Backend compara por minutos-do-dia. (Também alimenta o campo Horário do node `wait`.)
- **Data e Hora (`datetime`):** `equal`, `not_equal`, **`greater_than`, `less_than`** (novo 2026-07-21). Em `greater_than`/`less_than` o `value` é ISO `YYYY-MM-DDTHH:MM` (UI = calendário + hora). Backend compara HORÁRIO DE PAREDE (dia+hora até o minuto, IGNORA o fuso — o valor gravado tem offset `-03:00` mas a comparação é feita no relógio local, não no instante UTC).

`greater_than`/`less_than` valem em atributo número (valor numérico) E temporais `date`/`time`/`datetime` (o backend detecta o formato do valor: instante > dia > minutos > número). `number_range` SÓ em número. Nunca use maior/menor em texto/lista.

**Condição por ORIGEM / CAMPANHA — preset "Atributo de campanha" (novo 2026-09-01):** o filtro
"só lead que veio de anúncio" (ou de uma campanha/UTM/origem específica) é uma regra de atributo da
CONVERSA no formato `attr_config`. Forma canônica (é o que a tela grava; reabre no card "Atributo de
campanha"):

```json
{ "id": "c1", "valueType": "attr_config", "attrSource": "conversation", "attrScope": "campaign",
  "attr_key": "origin_kind", "operator": "equal", "value": "paid_ad" }
```

- `attrSource: "conversation"` + `attr_key` é o que o MOTOR lê (`conversation.custom_attributes[attr_key]`);
  `valueType: "attr_config"` e `attrScope: "campaign"` são marcadores de TELA (sem `attrScope` a regra reabre
  no card genérico "Atributo da conversa" — funciona igual).
- Chaves da família de campanha (todas em `conversation.custom_attributes`): `origin_kind`, `origin_platform`,
  `origin_first_kind`/`origin_first_platform`, `origin_last_kind`/`origin_last_platform`, `origin_*` em geral
  (origem unificada), `ctwa_*` (anúncio click-to-WhatsApp: `ctwa_ad_id`, `ctwa_ad_title`, `ctwa_campaign_name`,
  `ctwa_adset_name`...), `meta_lead_*` (formulário Meta Lead Ads), `lt_*` (LionTrack: UTMs, página, dispositivo).
  Veja a lista real com `lionchat_custom_attributes_list` (`attribute_model: conversation`, `include_system: true` — as chaves de campanha são atributos de sistema).
- **Valores fechados** de `origin_kind` (e `origin_first_kind`/`origin_last_kind`): `paid_ad` (Anúncio),
  `lead_form` (Formulário), `organic` (Orgânico), `direct` (Direto), `referral` (Indicação), `manual` (Origem
  cadastrada). O painel mostra o rótulo em português, mas a comparação é pelo VALOR — `"Anúncio"` nunca casa.
- `origin_platform` (e first/last): `facebook`, `instagram`, `google`, `tiktok`, `linkedin`, `youtube`,
  `whatsapp`, `direct` — e, para origem cadastrada pelo cliente em Configurações > Origens de Lead,
  `custom:<slug>` (slug = nome parametrizado, ex.: "Indicação de amigo" → `custom:indicacao-de-amigo`;
  liste com `lionchat_lead_origins_list`). Para filtrar por uma origem cadastrada use `origin_platform`
  com `contains` + uma palavra do slug, ou `equal` + o `custom:<slug>` completo.
- Alternativa equivalente pro motor, em texto livre: `{ "field": "{{conversation.custom_attribute.origin_kind}}",
  "operator": "equal", "value": "paid_ad", "valueType": "variable" }` — reabre no card "Variável", não no de
  campanha. Prefira o formato `attr_config` acima quando o cliente vai editar pela tela.
- Caso real (Cast, 01/09): flow "Ativar IA" só para lead de anúncio = condição `origin_kind equal paid_ad`
  na saída `cond_0` + ação `assign_captain` nessa saída; `default` sem nada.

- **`attrScope: "lead_origin"` (02/09/2026):** preset "Origem do lead" da aba Conversas — mesmo shape do `campaign_attr`, ja nasce com `attr_key: "origin_platform"`. Valores: plataformas fixas (`facebook`, `google`...) ou origem cadastrada como `custom:<slug>`. O motor ignora `attrScope`; sem ele a regra reabre como "Atributo de campanha" (falha macia).

**Agente de IA — `conversation_has_ai_agent` e irmãos (novo 2026-08-01):** o flow sempre soube LIGAR e
DESLIGAR a IA (ações `assign_captain` / `deactivate_captain`), mas não sabia PERGUNTAR se ela estava
ligada. Agora sabe. É o espelho exato do trio do agente humano:

| Forma | Verdadeiro quando |
|---|---|
| `{ "operator": "conversation_has_ai_agent" }` (sem valor) | tem QUALQUER IA atribuída |
| `{ "operator": "conversation_has_ai_agent", "values": [12, 15] }` | a IA atribuída é uma dessas |
| `{ "operator": "conversation_has_ai_agent", "value": 12 }` | a IA atribuída é exatamente essa |
| `{ "operator": "conversation_no_ai_agent" }` | não tem IA nenhuma |
| `{ "operator": "conversation_not_ai_agent", "values": [12] }` | tem IA, mas não é nenhuma dessas |

**Semântica (decisão do dono 01/08): reflete ATRIBUIÇÃO, não "vai responder agora".** Assistente
pausado no botão de pânico global continua contando como atribuído. Se o cliente perguntar "a IA está
respondendo?", essa condição NÃO responde isso — ela responde "a IA está ligada nesta conversa?".

**SLA — operador `sla_check` (2026-06):** verifica se a conversa está dentro/fora do prazo de SLA. A regra NÃO usa `field`, só `value` (código fixo):

| `value` | Verdadeiro quando |
|---|---|
| `frt_breached` / `frt_ok` | primeira resposta estourou / dentro do prazo |
| `nrt_breached` / `nrt_ok` | próxima resposta estourou / dentro do prazo |
| `rt_breached` / `rt_ok` | resolução estourou / dentro do prazo |
| `has_sla` / `no_sla` | tem / não tem política de SLA aplicada |

Ex.: `{ "operator": "sla_check", "value": "frt_breached" }`. "Estourado" = o monitor de SLA registrou o furo (job periódico, não em tempo real). As opções `_ok` exigem que a conversa TENHA uma política de SLA aplicada (sem política, só `has_sla`/`no_sla` dão resultado). Combina com E/OU (ex.: `sla_check frt_breached` **E** status aberto).

**Horário comercial — `business_hours` / `outside_business_hours` (campos próprios):** além do operador, a regra aceita `days` (array de dias da semana, 0=domingo..6=sábado; ausente = todos os dias), `start_hour` e `end_hour` (0-23; padrão 9 e 18). Ex.: `{ "operator": "business_hours", "days": [1,2,3,4,5], "start_hour": 9, "end_hour": 18 }` = seg–sex, 9h–18h.

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

**Id dinâmico em `assign_team`/`assign_agent` (novo 2026-07-09):** `team_id`/`agent_id` aceitam
variável Liquid além do id fixo — ex.: `{ "key": "assign_team", "config": { "team_id": "{{target_team}}" } }`
com `target_team` calculado num `set_variable` anterior (padrão: mapa em variável da conta
`teams_<unidade>` + `split`). Substitui o padrão antigo de node `api` chamando
`POST /conversations/{id}/assignments` na própria plataforma. Regras: variável mal escrita é
RECUSADA na gravação (422, parse Liquid strict); em runtime, se não resolver pra um número, o
erro fica visível no histórico do node (e equipe/agente precisa pertencer à conta). No editor,
o botão "Usar variável" ao lado do campo alterna lista fixa ↔ variável.

**Keys de action válidas:**

| Key | config esperado | Efeito |
|---|---|---|
| `assign_agent` | `{ agent_id }` | Atribui agente humano à conversa. `agent_id` aceita id fixo, variável Liquid (ver nota abaixo) OU a string `'nil'` — que REMOVE o responsável da conversa (opção "Nenhum" da UI) |
| `distribute_agents` | `{ agents: [{ agent_id }], dist_id }` | RODÍZIO (round-robin) de agentes: cada lead vai pro PRÓXIMO da lista na vez (1,2,3,1,2,3). `dist_id` = id fixo da ação (chave do cursor no Redis; gere um único por ação, ex. `"d_ab12cd"`). Ordem da lista = ordem do rodízio; sem porcentagem. DIFERENTE do randomizer mode `distribute_agents` (que é sorteio ponderado) |
| `assign_team` | `{ team_id }` | Atribui time. `team_id` aceita id fixo OU variável Liquid — ver nota abaixo |
| `change_status` | `{ status: 'open' \| 'resolved' \| 'pending' \| 'snoozed' }` | Muda status da conversa |
| `change_priority` | `{ priority: 'urgent' \| 'high' \| 'medium' \| 'low' }` | Muda prioridade |
| `add_label` | `{ labels: ['slug1', 'slug2'] }` | Adiciona labels ao CONTATO |
| `remove_label` | `{ labels: ['slug'] }` | Remove labels do CONTATO |
| `add_conversation_label` | `{ labels: ['slug'] }` | Adiciona labels à CONVERSA (não ao contato) |
| `remove_conversation_label` | `{ labels: ['slug'] }` | Remove labels da CONVERSA |
| `mute_conversation` | `{}` | Silencia notificações |
| `mark_unread` | `{}` | Marca a conversa como NÃO LIDA pro time (espelho do `mute_conversation`; típico logo após `assign_agent`/`assign_team` numa transferência) |
| `add_private_note` | `{ content: 'texto' }` | Adiciona nota interna |
| `create_kanban_item` | `{ funnel_id, funnel_stage, title?, description? }` | Cria card no Kanban — `funnel_id` e `funnel_stage` OBRIGATÓRIOS; `title`/`description` aceitam variáveis `{{ }}` |
| `move_kanban_item_to_stage` | `{ funnel_stage }` | Move card (precisa ter card vinculado) |
| `move_kanban_stage` | `{ funnel_id, funnel_stage }` | Idem |
| `set_kanban_item_status` | `{ status: 'won' \| 'lost' \| 'active' }` | Marca status do card |
| `set_won` | `{}` | Atalho pra ganho |
| `set_lost` | `{ reason? }` | Atalho pra perdido |
| `assign_agent_card` | `{ agent_id, mode? }` | Responsável do card. `mode`: `'add'` (default — SOMA na lista), `'replace'` (só o escolhido fica; atribui antes de remover os demais) ou `'remove_all'` (tira TODOS os responsáveis; `agent_id` dispensado) |
| `add_card_note` | `{ content }` | Nota no card |
| `add_card_checklist` | `{ template_id, funnel_id?, card_source? }` | Aplica um MODELO de checklist ao card (vira um grupo). `template_id` de `kanban_config.checklist_templates`. Um modelo por bloco (repita o bloco pra mais de um) |
| `add_card_offer` | `{ offer_id, use_custom_value?, custom_value?, funnel_id?, card_source? }` | Adiciona uma OFERTA (produto/serviço) ao card. `offer_id` de `offers_list`. `use_custom_value: true` + `custom_value` grava um valor personalizado na oferta; senão usa o valor cadastrado. O total do card recalcula sozinho (soma das ofertas). Respeita `card_source` (funnel só localiza o card) |
| `send_webhook` | `{ url, headers?, body? }` | Dispara webhook externo |
| `start_flow` | `{ flow_id }` | Inicia outro fluxo. **NÃO encerra o fluxo de origem** (desde 31/08): se houver bloco ligado depois dele, o fluxo SEGUE normalmente. Sendo o último do desenho, o fluxo termina ali como sempre. |
| `send_conversion` (novo 2026-09-01; `event_names` 2026-09-02) | `{ destinations: ['meta'\|'ga4'\|'google_ads'], event_names: { meta?, google_ads?, ga4? }, event_name (reserva), value? }` | Manda o evento de conversão pro Meta (CAPI), Google Ads e/ou GA4 — o mesmo caminho do Funil, de dentro do fluxo. Aba Sistema (só flow `conversation`). Ver bloco próprio abaixo |
| `deactivate_flow` ou `disable_flow` | `{}` | Encerra fluxo atual |
| `update_attribute` | `{ attr_source: 'contact'\|'conversation'\|'card', attr_key, attr_value }` | Seta custom_attribute (ver abaixo) |
| `assign_captain` (ou `assign_captain_assistant`) | `{ assistant_id }` | Atribui IA Captain |
| `deactivate_captain` | `{}` | Tira a IA da conversa |

**Handles que SAEM:** `success`. Não tem handle `error` — falhas viram warning silencioso e o flow continua.

**`card_source` (blocos de card) — opcional:** as ações de card aceitam `card_source`: `'funnel'` (default — procura o card pelo `funnel_id`) ou `'trigger'` (usa o card que DISPAROU o flow, em flows iniciados por `card_created`/`card_moved`/`card_won`/`card_lost`). Com `'trigger'`, `funnel_id` deixa de ser obrigatório — EXCETO em `move_kanban_stage`/`create_kanban_item`, cujo funil/etapa são o DESTINO. Sem card-gatilho disponível, a ação é pulada (não cai no fallback de funil). Aplica-se a `move_kanban_stage`, `set_won`/`set_lost`/`set_open`, `assign_agent_card`, `add_card_note`, `add_card_checklist`, `add_card_offer`, `update_attribute` (com `attr_source: 'card'`) e às condições `card_attr_equals`/`card_attr_contains` (gravando `card_source` na própria regra).

**`send_conversion` — Enviar conversão (2026-09-01):**

```json
{ "key": "send_conversion", "config": { "destinations": ["meta", "google_ads"], "event_names": { "meta": "Lead", "google_ads": "Contact" }, "event_name": "Lead", "value": "1500,50" } }
```

- `destinations`: array com `meta`, `ga4` e/ou `google_ads` — **OBRIGATÓRIO e não vazio** (vazio = a ação
  sai calada e o passo fica sem registro). Só marque destino que a conta já conectou em Configurações >
  Integrações (Meta Pixel/CAPI, Google Ads, GA4): destino sem integração é PULADO em silêncio pelo serviço
  (o histórico do fluxo mostra "GA4: pulado (integração não configurada, evento não mapeado ou pausado)").
  Confira antes com `lionchat_meta_pixel_integrations_list`, `lionchat_google_ads_integrations_list`,
  `lionchat_ga4_integrations_list`.
- `event_names` (**desde 2026-09-02**): um evento POR destino marcado — `{ "meta": "Lead", "google_ads": "Contact", "ga4": "generate_lead" }`.
  Chave presente e em branco = aquele destino é PULADO ("sem nome de evento"); chave ausente cai em `event_name`.
  Google Ads só envia evento que tenha ação mapeada na integração; a tela lista Meta (padrão + personalizados
  da conta) e Google Ads (mapeados), GA4 é livre. Grave sempre `event_names` E `event_name` (= primeiro nome).
- `event_name`: reserva/compatibilidade (fluxos de antes de 02/09), só letras/números/sublinhado (até 40; ex.: `Lead`, `Schedule`,
  `Purchase`); aceita variável `{{ }}`. No **Google Ads** o nome precisa estar mapeado no
  `conversion_action_map` da integração, senão é pulado.
- `value` (opcional): número (vírgula BR aceita, `1500,50`) ou variável. **Vazio = valor do CARD** (ver
  abaixo); sem card, o evento sai sem valor (nunca zero).
- **Card do evento:** o card que INICIOU o fluxo (gatilho `card_created`/`card_moved`/...) ou, sem ele, o
  card mais recente da conversa (mesma busca das ações de card). Com card, o evento aparece na aba
  Atividades do card e na tela de eventos do Funil (`funnels_meta_capi_events_list` e irmãs); **sem card o
  registro só existe no histórico do fluxo** (as telas de eventos são por funil).
- **Identidade/dedup:** uma conversão por (sessão do fluxo, bloco) — `event_id` `lc_flow_<sessão>_<bloco>_evt_<evento>`.
  O mesmo lead passando duas vezes pelo mesmo bloco NÃO gera duas conversões; dois leads diferentes sim.
- **Histórico:** o passo mostra uma linha por destino — `Meta: enfileirado (registro #161)` / `GA4: pulado (...)`
  / `Meta: erro (...)`. O registro (`MetaCapiEvent`/`Ga4Event`/`GoogleAdsConversion`) guarda a resposta HTTP
  e o motivo de falha; `trigger_type` = `flow`.
- Falha de um destino nunca derruba o fluxo (rescue por destino). Dry-run (Testar) não dispara.
- Cuidado com laço + `start_flow`: outra sessão = outra identidade = outra conversão.

**`update_attribute` — campos EXATOS:** `attr_source` (`'contact'`, `'conversation'` ou `'card'`), `attr_key` (nome do atributo), `attr_value` (valor). NÃO existem `entity`/`key`/`value` — esses são ignorados e não salvam nada.

**Coerção por TIPO (2026-07-29):** em `attr_source: 'contact'|'conversation'`, o `attr_value` de atributo personalizado é coagido pelo tipo da definição antes de gravar: número/moeda/porcentagem viram numérico ("1.234,56" → 1234.56; inteiro fica inteiro), checkbox aceita sim/não/true/false e grava BOOLEANO, lista casa caixa-insensível e grava a opção canônica, data aceita DD/MM/AAAA ou ISO, hora aceita "14:30"/"14h30". Valor irreconhecível grava como veio e o passo mostra nota âmbar no histórico. Card NÃO coage (atributo de card não tem definição tipada no backend).

**Campos NATIVOS do contato (2026-07-29):** com `attr_source: 'contact'`, `attr_key` também aceita os paths canônicos `contact.name`, `contact.email`, `contact.cpf`, `contact.cnpj`, `contact.rg`, `contact.passport`, `contact.date_of_birth`, `contact.gender`, `contact.marital_status`, `contact.profession` e `contact.address.{cep,street,number,complement,neighborhood,city,state,country}` — gravam na ficha nativa do contato (não em custom_attributes). Regras: telefone/identifier/etiquetas NÃO são aceitos (mapa fechado — chave fora dele vira atributo personalizado comum); documentos, nascimento, gênero e **e-mail** só preenchem campo VAZIO; nome/profissão/estado civil/endereço sobrescrevem; valor em branco nunca grava; gênero aceita `m|f|o|na` e estado civil `solteiro|casado|uniao_estavel|divorciado|separado|viuvo`; data de nascimento em `dd/mm/aaaa` ou `aaaa-mm-dd`. Recusas aparecem no histórico de execução (passo 'skipped'/'error' com mensagem).

**Campos NATIVOS do contato em CONDIÇÃO (2026-08-13):** o bloco de Condições e o filtro do gatilho de data passaram a LER os mesmos paths nativos (`contact.name`, `contact.cpf`, `contact.marital_status`, `contact.address.city`, ...) na fonte `contact` — antes só liam atributo personalizado e o campo da ficha voltava vazio, jogando tudo na saída padrão em silêncio. Use com `is_empty`/`is_not_empty` para montar "o CPF está preenchido?". Aceita a forma curta (`contact.cpf`) e a longa (`contact.cadastral.cpf`). **`contact.label` NÃO é aceito** em condição (consulta cara em caminho reativo). **Gênero e estado civil são listas fechadas**: compare com o valor canônico (`m|f|o|na`, `solteiro|casado|uniao_estavel|divorciado|separado|viuvo`) — comparar com "Masculino" nunca casa.

**NÃO use campo nativo na CONDIÇÃO DE SAÍDA nem no gatilho "quando o atributo do contato mudar"** — o sistema só emite o evento de mudança para atributo PERSONALIZADO, então a regra nunca dispararia. Nesses dois lugares o seletor continua oferecendo apenas atributos personalizados, de propósito.

**Parâmetro `always_ask` no node inicial de `ai_tool` (2026-08-13):** `true` faz a IA perguntar o dado ao cliente mesmo que o campo já tenha valor salvo, e regravar com a resposta. Use quando o valor guardado não for confiável (o nome do WhatsApp costuma ser só o primeiro nome). O campo volta a contar como resolvido depois que a IA salvar naquela conversa. Omitir = comportamento de sempre (campo preenchido é pulado).

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

Os campos do nó DEVEM ser prefixados com `api` (`apiMethod`, `apiUrl`, `apiHeaders`, `apiBody`).
O motor NÃO lê `method`/`url`/`headers`/`body` crus — se usar esses nomes, o nó manda um GET sem
headers e sem body (ou erra "URL not configured" se faltar `apiUrl`).

```json
{
  "id": "node-api-1",
  "type": "api",
  "position": { "x": 1330, "y": 480 },
  "data": {
    "label": "Consulta CRM externo",
    "apiMethod": "POST",
    "apiUrl": "https://api.example.com/leads",
    "apiHeaders": [
      { "key": "Authorization", "value": "Bearer {{account.custom_attribute.CRM_TOKEN}}" },
      { "key": "Content-Type", "value": "application/json" }
    ],
    "apiBody": "{\"name\":\"{{contact.name}}\",\"email\":\"{{contact.email}}\"}",
    "apiResponseVar": "crm_response"
  }
}
```

**Nomes de campo (exatos):** `apiMethod` (default `GET`), `apiUrl` (obrigatório), `apiHeaders`
(array de `{key,value}`), `apiBody` (string; ou `apiBodyMode:"fields"` + `apiBodyFields:[{key,value}]`),
`apiQueryParams`, `apiAuthType`/`apiAuthToken`, `apiTimeout`, `apiResponseVar` (nome da variável de saída;
desde 20/08/2026 nome iniciado por `_` cai no padrão `api_response` — `_` é o prefixo reservado das
chaves internas da sessão).

**Variáveis de conta / segredos:** use `{{account.custom_attribute.NOME}}` — NÃO existe `{{env.X}}`
(resolve vazio → 401). Variáveis do tipo *secret* SÓ resolvem dentro do nó `api` (nos campos de
mensagem elas são bloqueadas por segurança); aqui resolvem no `apiUrl`, `apiHeaders` e `apiBody`.

**Ler a resposta nos nós seguintes (Liquid):** o corpo é gravado na variável `apiResponseVar`
(default `api_response`) e navega por ponto — `{{api_response.campo}}`, `{{api_response.user.name}}`.
NÃO existe `.payload`/`.response` (`{{api_response.payload.x}}` resolve vazio). O status fica em
`{{api_response_status}}`. Se a resposta não for JSON, só `{{api_response}}` inteiro funciona.

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

**`aiMode` válidos:** `generate`, `custom` (entrada + instruções), `intent`, `sentiment`, `extract`.

**Modelo por ação — `aiModel` + `aiModelExplicit` (2026-07-13):** TODO modo aceita escolher o modelo
LLM no próprio nó, com ou sem assistente, em qualquer tipo de flow. Enviar o par:
`"aiModel": "gpt-4.1-mini"` JUNTO de `"aiModelExplicit": true`. SEM a flag o backend ignora o
aiModel nos modos novos (proteção de nós antigos que carregam aiModel de default nunca honrado).
`aiModel` vazio/ausente = modelo padrão da conta. Com assistente selecionado, o override também vale
(sobrepõe o modelo que o caminho do assistente usaria). Modelo fora da whitelist = ignorado (cai no
padrão da conta).
Exemplo: `{"aiMode":"sentiment","aiAssistantId":"12","aiModel":"gpt-4.1-mini","aiModelExplicit":true}`.

**A whitelist (`FlowBuilder::RawLlmService::SUPPORTED_MODELS`) é uma lista FECHADA de 16 nomes, SEM
curinga** — não existe "a família gpt-5 inteira":
`gpt-4o-mini`, `gpt-4o`, `gpt-4.1-nano`, `gpt-4.1-mini`, `gpt-4.1`, `gpt-5-mini`, `gpt-5`,
`gpt-5.2`, `gpt-5.4-nano`, `gpt-5.4-mini`, `gpt-5.4`, `gpt-5.5`, `o1`, `o3`, `o3-mini`, `o4-mini`.
A família **`gpt-5.6` (luna/terra/sol) foi REMOVIDA em 2026-07-29**: ela recusa function tools
(erro 400 na OpenAI), o que deixava o Agente de IA **mudo em 100% das chamadas** — saiu também daqui
pra não ser oferecida numa tela e faltar na outra. Também não existem `o1-mini`, `gpt-4.5-preview`,
`gpt-5.2-pro` nem `gpt-5.5-pro` (a OpenAI recusa).

**OBRIGATÓRIO via API — `aiAssistantId`:** os modos `generate`/`intent`/`sentiment`/`extract`
EXIGEM um `aiAssistantId` válido (id de um assistente Captain da conta). **Sem ele o nó sai pela
saída `error` desde 20/08/2026** (`AI Assistant not configured`), igual a assistente inexistente na
conta — antes ficava VERDE e seguia como se a IA tivesse respondido, com a variável de saída
(`aiResponseVar`/`ai_intent`/`ai_sentiment`) vazia. A tela do Flow Builder preenche esse id pelo
dropdown; um nó criado via API/MCP SEM `aiAssistantId` "não funciona" por isso. Só rodam sem
assistente: `aiMode: 'custom'` (motor cru com a chave da conta + `aiModel`) e flow `ai_tool` em
`generate`/`custom`. A saída fica em `aiResponseVar` (default `ai_response`); `intent` também em
`ai_intent`, `sentiment` em `ai_sentiment`. Nome de variável iniciado por `_` é IGNORADO e cai no
padrão (prefixo reservado das chaves internas da sessão) — vale pro `apiResponseVar` também.

**Contexto da conversa:** a chave é **`aiContextMessages`** — quantas mensagens da conversa a IA enxerga: `0`, `1`, `3`, `5`, `10`, `25`, `50`, `75` ou `100` (default `5`; acima de 100 é cortado; ignorado em `custom`). **`contextMessages` (sem o prefixo) é DESCARTADA em silêncio** (fica 5). Os modos `intent`/`sentiment`/`extract` rodam no motor contido (texto puro, sem persona nem ferramentas — mais barato e sem risco de vazamento); `generate` usa o assistente Captain.

**Intent — campo EXATO:** `aiIntents` é um ARRAY DE OBJETOS `{ "name": "..." }`. NÃO use `aiIntentOptions` (array de strings) — é ignorado. A intenção classificada também fica disponível na variável de sessão **`ai_intent`** (use como `{{ai_intent}}` adiante).

**Handles que SAEM dependem do mode:**
- `generate` → `success`, `error`
- `intent` → uma saída por intenção (`intent_<name>`, ex: `intent_compra`, `intent_suporte`) **+ `no_intent`** (quando nenhuma bate) + `error`
- `sentiment` → `positive`, `negative`, `neutral` + `error`
- `extract` → `success`, `error` (resultado salvo em `aiResponseVar`)

### 2.8 `wait`

O campo raiz é **`waitMode`**: `"duration"` (default), `"date"` ou `"weekday"`.

**Modo `duration` (esperar um tempo):**

```json
{
  "id": "node-wait-time-1",
  "type": "wait",
  "position": { "x": 690, "y": 300 },
  "data": {
    "label": "Espera 10 min",
    "waitMode": "duration",
    "waitDuration": 10,
    "waitUnit": "minutes"
  }
}
```

`waitUnit` válidos: `seconds`, `minutes`, `hours`, `days`. (NÃO existe `waitUnit: "weekday"` — dia da semana é um `waitMode` próprio, ver abaixo.)

**Modo `date` (esperar até uma data e hora):**

```json
{
  "id": "node-wait-date-1",
  "type": "wait",
  "position": { "x": 690, "y": 300 },
  "data": {
    "label": "Espera ate a consulta",
    "waitMode": "date",
    "waitDate": "2026-12-31",
    "waitTime": "09:00",
    "waitTimezone": "America/Sao_Paulo",
    "waitDateMode": "fixed",
    "waitTimeMode": "fixed"
  }
}
```

- `waitDate` = `"YYYY-MM-DD"` · `waitTime` = `"HH:MM"` 24h · `waitTimezone` = fuso IANA (default `America/Sao_Paulo` se ausente).
- **Variável nos campos (novo 2026-07-06):** `waitDateMode`/`waitTimeMode` aceitam `"fixed"` (default) ou `"variable"`. Em `"variable"`, o campo correspondente contém uma variável `{{ }}` em vez do valor fixo — ex.: `"waitDate": "{{contact.custom_attribute.data_consulta}}"`. O campo Data SÓ aceita variável de atributo tipo `date`; o campo Horário SÓ tipo `time` (Hora 24h). A variável é resolvida UMA única vez, na entrada do node (quem já está esperando mantém o valor capturado). Variável que não resolve pra data/hora válida → o flow sai pela saída `error` (payload `invalid_variable_datetime`). Data válida no PASSADO → espera 0 e segue por `success` (não é erro).
  - **Tipo `datetime` (Data e Hora, tipo 10) NÃO entra aqui:** o campo Data só aceita `date`(5) e o Horário só `time`(9). Um atributo `datetime` no campo Horário é rejeitado (o valor ISO cai como "atributo Data no campo errado" → saída `error`). Para agendar por data+hora vindas do cadastro, use DOIS atributos separados (um `date` + um `time`), não um `datetime`. Mesma regra no **Gatilho de Data** (`date_trigger` do start node): a fonte de data lista atributos `date` (do contato + aniversário, ou da conversa quando `attr_source='conversation'`) e o horário-por-atributo exige `time` — `datetime` não é oferecido em nenhum dos dois.

**Modo `weekday` (esperar até um dia da semana):**

```json
{
  "id": "node-wait-weekday-1",
  "type": "wait",
  "position": { "x": 690, "y": 300 },
  "data": {
    "label": "Espera ate segunda 09h",
    "waitMode": "weekday",
    "waitWeekday": 1,
    "waitWeekdayTime": "09:00",
    "waitWeekdayTimeMode": "fixed",
    "waitTimezone": "America/Sao_Paulo"
  }
}
```

- `waitWeekday`: 0=domingo, 1=segunda... 6=sábado. `waitWeekdayTime` = `"HH:MM"` 24h. `waitTimezone` = mesmo campo do modo date.
- **Variável no Horário (novo 2026-07-29 — reverte a proibição de 06/07):** o campo `waitWeekdayTime` ACEITA variável `{{ }}`, com o mesmo contrato dos campos do modo `date`. O modo mora em **`waitWeekdayTimeMode`**: `"fixed"` (default, e o que vale quando a chave está ausente) ou `"variable"` — espelho exato do `waitTimeMode`.
  - **Mandar a variável SEM `"waitWeekdayTimeMode": "variable"` não funciona e não avisa:** o motor trata o campo como texto fixo, a chave `{{ }}` nunca é resolvida e o horário calculado não é o pretendido. Não há erro de validação, nem na API nem na tela. Como o MCP escreve o JSON do fluxo direto, sem passar pela tela, esse par é obrigatório.
  - Exemplo: `{"waitMode":"weekday","waitWeekday":1,"waitWeekdayTime":"{{contact.custom_attribute.horario_retorno}}","waitWeekdayTimeMode":"variable","waitTimezone":"America/Sao_Paulo"}`.
  - Resolve UMA única vez, na entrada do node (quem já está esperando mantém o valor capturado). Aceita `"14:30"`, `"9:30"`, `"14h30"`, `"14h"`, `"14:30:00"` — ou seja, atributo tipo `time` (Hora 24h). Valor ISO de atributo `date`/`datetime` é rejeitado (mesma regra do campo Horário do modo `date`).
  - Variável que não resolve pra horário válido → saída `error` (payload `invalid_variable_datetime`, `field: waitWeekdayTime`).
  - Modo `fixed` NUNCA emite erro: horário em branco cai no default `09:00` — flow antigo intacto.
- (Os nomes `targetWeekday`/`targetHour` NÃO existem — eram um erro de documentação antiga.)

**Handles que SAEM:** `success` (+ `error`, emitido quando um campo em modo `variable` resolve pra valor inválido — vale nos DOIS modos, `date` e `weekday`; em modo `fixed` o `error` nunca é emitido).

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

**Nome da variável (desde 20/08/2026):** `name` vazio ou iniciado por `_` é IGNORADO — `_` é o prefixo
reservado das chaves internas da sessão. A mesma regra vale pro `saveVariable` do `wait_response`
(não grava) e pro `apiResponseVar`/`aiResponseVar` (caem no padrão). `value` aceita `{{ }}`.

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
      { "id": "A", "label": "Variante A", "percent": 50 },
      { "id": "B", "label": "Variante B", "percent": 50 }
    ]
  }
}
```

**O campo é `percent`, NÃO `weight` (2026-07-30):** a tela sempre gravou `percent` (`randomizerBranches`
do FlowNodeConfigModal) e o motor lia só `weight` — nenhum node configurado pela tela funcionava.
Corrigido em 30/07: o motor lê `percent` e aceita `weight` só como dado antigo. **Escreva sempre
`percent`** — randomizador criado com `weight` até roda, mas abre com as porcentagens EM BRANCO na
tela do cliente (a tela lê só `percent`).

**Divisão EXATA, não sorteio (desde 20/08/2026):** nos DOIS modos o bloco divide o que passa por ele na proporção configurada — 50/50 alterna A,B,A,B; 70/30 dá 7 de cada 10 intercalados. Contador por fluxo+bloco; mexer em agente/porcentagem zera a contagem. (Até 20/08 era cara-ou-coroa — 5 leads seguidos pra mesma pessoa num "50/50" era normal.)

**Modo `distribute_agents` (divisão PONDERADA):** `data.mode: 'distribute_agents'` + `data.agents: [{ agent_id, percent }]` — escolhe o agente da vez (percentuais somando 100) e atribui automaticamente. Diferença pra AÇÃO `distribute_agents` do node `action` (seção 2.5): a ação é rodízio SIMPLES (1,2,3 sem porcentagem); este modo aceita pesos diferentes (70/30). Com pesos iguais os dois dão o mesmo resultado.

**Handles que SAEM:** o `id` de cada branch (`A`, `B`, ...). Em `mode: 'distribute_agents'` é `success`.

### 2.11 `update_group` — Gestão de Grupos (WAHA apenas)

Bloco "Gestão de Grupos". Faz **UMA operação por bloco** (não mais um formulário-só com nome/foto/descrição
juntos) — a operação vai em `data.groupOperation`. São **17 operações**, agrupadas por tema:

- **Grupo:** `create` (criar), `find_by_id` (buscar por id), `find_by_name` (buscar por nome), `update_subject`
  (mudar nome), `update_description` (mudar descrição), `update_picture` (mudar foto), `settings` (3
  permissões: quem edita infos, quem manda mensagem, quem adiciona membro), `leave` (sair do grupo).
- **Participantes:** `list_participants` (listar), `add_participants` (adicionar), `remove_participants` (remover).
- **Admins:** `promote_admin` (promover a admin), `demote_admin` (rebaixar).
- **Convite:** `get_invite` (pegar link/código de convite), `revoke_invite` (revogar), `send_invite` (mandar
  o convite por mensagem a um telefone).
- **Mensagem:** `send_message` (a 17ª, 08/08) — manda `messageItems` (MESMO contrato do bloco de mensagem:
  text/delay/attachment/audio/url_media; botões/template não fazem sentido em grupo) NA CONVERSA DO GRUPO
  (`groupTargetId` ou, vazio, o grupo da conversa atual; grupo inexistente = `error`). NÃO grava
  `{{grupo.*}}` — é a única sem variável de resposta. Serve pra "dei ganho no lead → aviso o grupo da
  equipe" em fluxo de qualquer canal.

**Disponível em fluxo de QUALQUER canal**, desde que a conta tenha uma caixa **WhatsApp QR Code
(`Channel::Waha`)** — informe a caixa em `data.groupInboxId`. Esse campo é **OBRIGATÓRIO em fluxo não-grupo**
(individual/qualquer canal; o save recusa caixa de outro tipo) e **opcional em fluxo de grupo** (ali o padrão
é o grupo da própria conversa). `groupOperation` ausente/vazio = `legacy` (comportamento antigo — NÃO usar em
node novo). `groupTargetId` aceita `"1203...@g.us"`, só dígitos ou `{{var}}`; é ignorado nas operações sem
alvo (`create`, `find_by_name`).

Cada operação guarda o resultado na variável `data.groupResponseVar` (padrão `"grupo"`) — leia depois com
`{{grupo.CAMPO}}` (ex.: `{{grupo.id}}`, `{{grupo.participants_count}}`, `{{grupo.invite_link}}`). Toda
operação (menos `send_message`) também devolve `{{grupo.ok}}` (bool) e `{{grupo.error.message}}`.

**Campos que cada operação devolve em `{{grupo.*}}`:**
- `create` → `id`, `name`, `description`, `picture`, `participants`, `participants_count`, `conversation_id`
  (número da conversa do grupo aberta no painel, 08/08), `added`, `added_count`, `not_added`,
  `not_added_count`, `no_whatsapp`, `invited`, `invite_status`, `extras_failed` (só quando descrição/foto/
  admin/conversa falharam — o grupo JÁ existe e isso NUNCA vira erro). Aceita `groupAttributes` (08/08:
  linhas `{attr_source, attr_key, attr_value}` — grava atributos personalizados no contato-grupo
  recém-criado; `{{grupo.id}}`/`{{grupo.conversation_id}}` já valem em `attr_value`; campos nativos
  `name`/`email`/`card` são recusados).
- `find_by_id` → `id`, `name`, `description`, `picture`, `participants`, `participants_count`.
  `find_by_name` (`groupSearchName` obrig + `groupSearchMode`: `contains` padrão | `does_not_contain` |
  `equal_to` | `not_equal_to` | `starts_with` | `ends_with`) → `results`, `results_count`.
- `update_subject` (`updateSubject`) → `id`, `name`; `update_description` (`updateDescription`) → `id`,
  `description`; `update_picture` (`updatePicture`, url) → `id`; `leave` → `id` (IRREVERSÍVEL).
- `list_participants` → `id`, `participants` (até 100; `participants_truncated: true` se cortou),
  `participants_count`.
- `add_participants` (`groupParticipants` obrig — array de telefones/JIDs ou lista por vírgula; aceita
  `{{var}}`) → `id`, `added` (quem está no grupo agora, inclui quem já estava), `not_added`, `added_count`,
  `not_added_count`, `no_whatsapp`, `invited`, `invite_status`. Ninguém entrou = `error` (`nobody_changed`);
  parte entrou = `partial`.
- `remove_participants` → `id`, `removed`, `not_removed`, `removed_count`, `not_removed_count` (ninguém saiu
  = `error`; parte = `partial`). `promote_admin` / `demote_admin` → `id`, `participants`.
- `get_invite` → `id`, `invite_link`; `revoke_invite` → `id`, `invite_link` (IRREVERSÍVEL — invalida o link
  antigo); `send_invite` (`groupInviteTo` obrig, `groupInviteMessage` opcional — `{{link}}` marca onde o
  link entra, sem o marcador vai no fim) → `id`, `invite_link`, `invite_sent_to`.
- `settings` (pelo menos UMA de `infoAdminOnly`, `messagesAdminOnly`, `membersCanAddNewMember`) → `id`,
  `settings_updated`, `settings_failed`, `settings_unsupported`. **Desde 20/08 cada permissão é aplicada
  SOZINHA:** `settings_updated[]` sempre vem; `settings_failed[{setting, reason}]` = falhou de verdade;
  `settings_unsupported[]` = o servidor WAHA não tem o recurso (ex.: quem-pode-adicionar em servidor
  antigo). Sucesso SÓ se aplicou ao menos uma E nenhuma falhou; senão sai por `error` (código
  `settings_failed` ou `settings_unsupported`) com o que aplicou visível na variável. ATENÇÃO:
  `membersCanAddNewMember` tem semântica INVERTIDA (`true` = TODOS podem adicionar);
  `infoAdminOnly`/`messagesAdminOnly` seguem o padrão (`true` = SÓ admin).

Teto de **20 participantes por execução** (`create`/`add`/`remove`/`promote`/`demote` — trava anti-banimento:
adicionar em lote é o que mais rápido derruba número no WhatsApp não-oficial). Detalhe das chaves de `data`
por operação: ver o pattern "Gestão de Grupos WhatsApp por fluxo" no `flowbuilder-patterns`.

**`create` confere quem foi COLOCADO (2026-08-21 — entra com o próximo deploy do app depois de
21/08/2026):** o bloco relê o grupo e compara com o pedido (por equivalência brasileira, com e sem o 9;
duas leituras concordantes). Quem o WhatsApp não colocou (privacidade "quem pode me adicionar" restrita,
número inexistente) vai pra `{{grupo.not_added}}` / `{{grupo.not_added_count}}` e a saída vira `partial`;
`{{grupo.no_whatsapp}}` lista os números que o WhatsApp disse não existir (seguem no pedido — é aviso, não
erro). Número de celular BR escrito sem o 9 é corrigido pelo WhatsApp antes de adicionar (check-exists na
sessão do canal, orçamento 8 s). Antes de 21/08 o passo dava SUCESSO mesmo com o lead fora do grupo. A
mesma correção do 9º dígito vale no `add_participants`.

**Convite no privado de quem ficou de fora (opcional, nasce desligado; só `create`/`add_participants`;
2026-08-21 — entra com o próximo deploy do app depois de 21/08/2026):** `groupInviteOnFailure: true` +
`groupInviteMessage` (texto OBRIGATÓRIO nesse modo — sem texto = `invite_status: 'sem_mensagem'` e nada
sai; link nu de número desconhecido é o formato que mais gera denúncia e derruba número; `{{link}}` marca
onde o link do grupo entra — sem o marcador, o link vai no fim). Tetos anti-bloqueio: 5 convites por
execução, 1 por telefone por caixa por dia, 50 por dia por caixa, 20 s entre convites; quem está em
`no_whatsapp` não recebe; antes de mandar o job reconfere se a pessoa já entrou. `{{grupo.invited}}` lista
quem recebeu e `{{grupo.invite_status}}` diz `convite_enviado` ou `sem_mensagem`. **Cada convite entregue
cria contato + conversa no painel** (e dispara os ouvintes de `conversation_created`: automação, outros
flows, webhook do cliente, Kanban) — avise o cliente antes de ligar.

**Handles que SAEM:** `success`, `error` — e **`partial`** nas operações de participante
(`create`, `add_participants`, `remove_participants`): a operação rodou, mas nem todo mundo
entrou/saiu (as listas `not_added`/`not_removed` dizem quem). Ligue `partial` num caminho próprio (ex.:
avisar a equipe) — sem fio, `partial` segue pelo fio `success` (única saída com esse fallback no motor) e
quem ficou de fora passa em silêncio.

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

Node terminal, sem handles de saída. **EXCLUSIVO de flow `ai_tool`** — NUNCA use em flow
`conversation` (a paleta do editor nem oferece; desde 2026-07-09 o backend REJEITA na gravação:
"contains node types not allowed in conversation flow"). Em conversation o ramo termina sozinho
no último node, sem node de fim. Em `ai_tool` é OBRIGATÓRIO: o `data` do `end` define o que
volta pro LLM (modo de saída + template do resultado).

Campos do `data`:

| Campo | Valores | Default | O que faz |
|---|---|---|---|
| `mode` | `template`, `auto`, `silent` | `template` | como o resultado volta pro LLM |
| `template` | texto Liquid (`{{ params.x }}`, `{{ contact.x }}`) | vazio | SÓ no modo `template` |
| `include_log` | `true`/`false` | `false` | SÓ no modo `auto` — anexa o log da execução ao JSON |

- **`template`** — devolve o texto Liquid renderizado, precedido de um cabeçalho que MANDA a IA
  cumprir aquilo neste turno. É o modo do "diga isso ao cliente".
- **`auto`** — devolve JSON com `params`, `variables` e `status`. Dado, não ordem.
- **`silent`** (desde 02/09/2026) — **encerra o turno sem resposta da IA**. Use quando o próprio
  fluxo já enviou a mensagem final pelo bloco de mensagem: sem isso a IA fala de novo por cima e
  duplica a informação. A IA continua ATIVA e responde normalmente a próxima mensagem do cliente.

```json
{ "id": "node-end", "type": "end", "position": { "x": 1330, "y": 300 }, "data": { "label": "Retorno", "mode": "template", "template": "Orçamento enviado. Confirme o recebimento com o cliente." } }
```

```json
{ "id": "node-fim-mudo", "type": "end", "position": { "x": 1330, "y": 520 }, "data": { "label": "Fim sem resposta", "mode": "silent" } }
```

**ATENÇÃO:** `mode` aceita SÓ os três valores acima. Até 02/09/2026 esta página ensinava
`mode: "structured"`, que NENHUMA tela produz e NENHUM leitor entende — o motor trata valor
desconhecido como `template`, e sem `template` a IA recebe **string vazia**. Se você criou algum
`end` com `structured` (ou qualquer outro valor), troque por um dos três. Mesma família do gatilho
do bloco Início que a documentação do MCP ensinou errado (19/08).

### 2.14 `note` (anotação visual / sticky note colorido)

Sticky note no canvas (aquele bloco colorido riscado na tela pra rotular/agrupar). Puramente visual: sem handles, NUNCA executado (não ligue edges nele). Disponível nos DOIS tipos de flow (`conversation` e `ai_tool`).

Campos do `data`:

| Campo | Valores | Default |
|---|---|---|
| `title` | texto do cabeçalho da nota | vazio |
| `body` | texto do corpo | vazio |
| `color` | `yellow`, `teal`, `blue`, `violet`, `pink`, `orange`, `slate` | `yellow` |
| `width` | largura em px (mín. 200) | 320 |
| `height` | altura em px (mín. 80) | 200 |

**ATENÇÃO:** o texto vai em `title` + `body`, NÃO em `content`. Usar `content` num node `note` grava
uma nota VAZIA na tela (a interface ignora a chave). `content` só é chave de OUTRAS coisas (item `text`
do `send_message`, ação `add_private_note`, ação `add_card_note`) — nunca do sticky note.

`position` é o canto superior esquerdo da nota; como ela é maior que um node comum, posicione-a ATRÁS
do grupo de nodes que ela rotula (ex.: um pouco acima e à esquerda do primeiro node do trecho).

**REGRA DE LAYOUT (espaçamento — vale pra TODO node, novo 24/07):** nodes colados escondem as linhas
de conexão e viram bola de neve visual. Ao gerar `position`:
- Colunas no eixo x com passo de **≥320px** (padrão dos exemplos deste guia: 50, 370, 690, 1010, 1330…).
- Irmãos/ramificações no eixo y com **≥180px** entre si.
- Sticky notes ficam **AO LADO ou ACIMA** do trecho comentado (ex.: `y` do node − 240), **nunca em cima**
  de nodes nem sobre as linhas — nota grande (320×200 default) cobre tudo que estiver embaixo.
- Nunca repita o mesmo `(x, y)` em dois nodes.

```json
{ "id": "note-1", "type": "note", "position": { "x": 40, "y": 40 },
  "data": { "title": "Qualificação", "body": "Revisar mensagens antes de publicar", "color": "violet", "width": 360, "height": 180 } }
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
`start_flow` / `send_conversion`) — elas só valem em flow `conversation`. No `action` de um `ai_tool` use apenas keys
das abas Conversas / Contatos / Kanban (ex: `add_label`, `change_status`, `update_attribute`,
`create_kanban_item`). Para gravar atributo no `ai_tool`, use `action` com `update_attribute`
(o antigo node `save_attribute` foi removido — não existe mais em nenhum tipo de flow).

**Proteção anti-loop por profundidade (2026-06):** quando um flow dispara automação que dispara
outro flow (cadeia entre motores), cada hand-off incrementa um contador interno (`_activation_depth`).
No 5º hand-off (`MAX_CHAIN_DEPTH = 5`) a cadeia é cortada silenciosamente. Se um flow "não disparou"
no fim de uma cadeia automação→flow→automação, suspeite desse limite — é proteção, não bug.

## 2-C. Flow `conversation`: individual vs grupo (`conversation_mode`)

Todo flow `conversation` tem um `conversation_mode`: `individual` (default — conversa 1-a-1) ou `group`
(grupo de WhatsApp). Definido na CRIAÇÃO e **IMUTÁVEL depois** (não dá pra converter um no outro; pra trocar,
crie outro flow). Não confundir com `flow_type` — um flow `ai_tool` não tem `conversation_mode`.

Na tela o usuário vê isso como TRÊS opções ao criar: "Mensagem" (= `conversation` + `individual`),
"Grupo" (= `conversation` + `group`) e "IA Agente" (= `ai_tool`).

**A diferença entre individual e grupo é quais nodes/abas ficam disponíveis:**

| | individual (Mensagem) | group (Grupo) |
|---|---|---|
| Node `update_group` (Gestão de Grupos — WAHA) | disponível se a conta tem caixa QR Code — exige `groupInboxId` | disponível; `groupInboxId` opcional (padrão = grupo da conversa) |
| Gatilhos e condições de **LionTrack** (visita de página / evento do site) | disponíveis | **NÃO** (grupo não tem um contato único navegando) |
| Gatilho `date_trigger` (data do contato) | disponível | **NÃO** (grupo não tem um contato único) |
| Todos os outros nodes (`send_message`, `wait_response`, `condition`, `action`, `api`, `ai`, `set_variable`, `wait`, `randomizer`, `note`, `end`) | iguais | iguais |

Regras práticas ao montar via API:
- O node `update_group` (Gestão de Grupos) funciona em fluxo de QUALQUER canal, desde que a conta tenha
  caixa WhatsApp QR Code (`Channel::Waha`): informe a caixa em `data.groupInboxId` (OBRIGATÓRIO em fluxo
  não-grupo; opcional em fluxo de grupo, onde o padrão é o grupo da própria conversa).
- Não use gatilho/condição de LionTrack (pagetrack) em flow de grupo.
- Na dúvida entre os dois, é `individual` (o default).
Não tente contornar criando flows intermediários.

---

## 2-C. Variáveis — de onde vêm e onde aparecem

Variáveis de sessão (`{{nome}}`) são CRIADAS por alguns nodes e ficam disponíveis pros nodes seguintes. O autocomplete `{{` no editor é **ciente do grafo (graph-aware)**: num node, ele só lista variáveis definidas por nodes UPSTREAM (no caminho de execução até ali) — não sugere variável que ainda não existe no ponto da execução. Use isso como regra: só referencie `{{var}}` se algum node ANTES dele (no caminho) a tiver criado.

Fontes de variável (quem cria o quê):

| Node | Variável(is) criada(s) |
|---|---|
| `set_variable` | cada item de `data.variables[].name` |
| `wait_response` com `saveTo: 'variable'` | o nome em `data.saveVariable` |
| `ai` mode `generate` / `custom` | `aiResponseVar` (default `ai_response`) |
| `ai` mode `intent` | `ai_intent` |
| `ai` mode `sentiment` | `ai_sentiment` |
| `ai` mode `extract` | cada `aiExtractParams[].name` (uma variável por parâmetro) |
| `api` | `apiResponseVar` (+ `apiResponseVar`_status) e campos do JSON de resposta |

Variáveis salvas em atributo (`saveTo: 'contact_attr'`/`'conversation_attr'`, ou node `action` `update_attribute`) NÃO viram variável de sessão `{{var}}` — leia-as via `{{contact.custom_attribute.X}}` / `{{conversation.custom_attribute.X}}` (singular).

**Variáveis do webhook `{{webhook.*}}` (2026-07-18):** quando o flow dispara pelo gatilho de
Webhook (embutido ou Integração Universal com `flow_id` mapeado), o payload INTEIRO recebido fica
disponível sob o envelope `webhook` — navegação por ponto e índice de lista:
`{{webhook.cliente.nome}}`, `{{webhook.pedido.itens.0}}`, filtros Liquid funcionam
(`{{webhook.origem | upcase}}`). Não precisa mapear campo por campo pra atributo (o mapeamento
continua servindo pra GRAVAR no contato). Teto: payload acima de 256KB não vira variável. Flow
disparado por OUTRO gatilho (mensagem, card, data): `{{webhook.*}}` resolve vazio. O autocomplete
do editor mostra o grupo WEBHOOK com os campos do último payload recebido.

**Variáveis do gatilho `{{trigger.*}}` (novo 2026-08-01):** todo flow — não importa o gatilho — passa
a saber O QUE o disparou. Antes só existia o tipo, e um flow com VÁRIOS gatilhos não tinha como se
ramificar por qual deles disparou. Agora dá: `{{trigger.type}}` num node `condition`.

Sempre presente:

| Variável | Conteúdo |
|---|---|
| `{{trigger.type}}` | código do **EVENTO** que disparou — **NÃO é a chave do item do Início**. Valores reais: `message_created` (gatilho `message_received`), `message_sent`, `conversation_created`, `conversation_opened` (gatilho `conversation_reopened`), `conversation_resolved`, `label_added`, `label_removed`, `team_changed`, `assignee_changed`, `sla_missed`, `kanban_item_created`/`card_created`, `kanban_item_stage_changed`/`card_moved`, `card_status_changed` (`card_won` e `card_lost` — olhe `trigger.kind` ou o status do card), `conversation_attributes_changed`, `card_attributes_changed`, `contact_attribute_changed`, `group_participant_joined`/`_left`, `webhook_received`, `date_trigger`, `manual` (sidebar), `kanban_manual` (botão do card), `campaign` (Campanha de Fluxo), `page_track`, `activated_by_flow` (fluxo chamou fluxo), `lead_form` (os 3 gatilhos de formulário — `trigger.kind` diz `completed`/`milestone`/`abandoned`), `booking_created`/`booking_cancelled`/`booking_rescheduled`/`booking_completed`. Compare SEMPRE com esses códigos numa condição |
| `{{trigger.name}}` | rótulo legível do MESMO evento ("Mensagem recebida", "Card mudou de etapa") — use este pra ESCREVER pro cliente, e o `type` pra COMPARAR em condição |
| `{{trigger.activated_at}}` | quando disparou (ISO 8601). Desde 20/08/2026 `name` e `activated_at` são preenchidos em TODOS os caminhos de disparo (antes só no de evento de conversa) |
| `{{trigger.kanban_item_id}}` / `{{trigger.funnel_id}}` | só quando veio do Kanban |

Presentes conforme o evento (ausente = resolve vazio, sem erro):

| Bloco | Campos |
|---|---|
| `{{trigger.message.*}}` | `id`, `content` (texto da mensagem, cortado em 2.000 caracteres), `type`, `created_at` |
| `{{trigger.conversation.*}}` | `id` (o display_id), `status`, `channel` (nome amigável: `Waha`, `Whatsapp`, `Instagram`), `inbox_id`, `inbox_name`, `created_at` |
| `{{trigger.contact.*}}` | `id`, `name`, `phone`, `email` — desde 22/08/2026 resolvem em TODO gatilho (lidos do contato da sessão quando o evento não os trouxe) |
| `{{trigger.ad.*}}` (anúncio/CTWA) | `id`, `name`, `creative_id`, `creative_name`, `adset_id`, `adset_name`, `campaign_id`, `campaign_name`, `source`, `headline`, `description`, `cta`, `url` |
| `{{trigger.attribute.*}}` | `name`, `previous_value`, `current_value`, `changed_at` — o valor ANTES e DEPOIS do atributo que disparou (só nos gatilhos de mudança de atributo) |
| `{{trigger.user_name}}` | nome do usuário/atendente que disparou (gatilho manual ou botão do card) |
| `{{trigger.campaign_id}}` / `{{trigger.campaign_title}}` | id e título da campanha (quando disparado por Campanha de Fluxo) |
| `{{trigger.event_name}}` | nome do evento do site que disparou (LionTrack / visita de página) |
| `{{trigger.page_url}}` | URL da página (LionTrack / visita de página) |
| `{{trigger.source_flow_id}}` / `{{trigger.source_flow_name}}` | id e nome do flow de origem (quando outro flow iniciou este, ex.: action `start_flow`) |
| `{{trigger.lead_form_id}}` / `{{trigger.response_id}}` / `{{trigger.kind}}` | formulário público: qual formulário, qual preenchimento e o tipo (`completed`/`milestone`/`abandoned`) |
| `{{trigger.kind}}` / `{{trigger.booking_id}}` / `{{trigger.event_type_id}}` | agendamento (Booking nativo): `created`/`cancelled`/`rescheduled`/`completed`, id da reserva e id do tipo |
| `{{trigger.kind}}` em `webhook_received` | origem da integração: `meta_lead`, `payment`, `eclinica`, `eclinica_reminder`, `topsend` (22/08/2026). O `type` continua `webhook_received` |
| `{{trigger.meta_lead_event_id}}` | id do evento do Meta Lead (só `kind=meta_lead`) |

Os cinco últimos são **novos 2026-08-07** e passam a aparecer no autocomplete de TODO bloco (ausente para
o gatilho que não os fornece = resolve vazio, sem erro).

Dois atalhos: `{{trigger}}` devolve o contexto INTEIRO em JSON e `{{trigger.data}}` devolve o mesmo
sem os metadados — úteis pra jogar tudo dentro de um node `ai` ou `api`. Bloco (Hash/Array) inteiro
sai em JSON; valor simples sai cru.

**O que o histórico mostra e NÃO é variável (22/08/2026).** O passo Início do histórico de execução
passou a exibir, em todo gatilho, o contato (nome, telefone, e-mail), a conversa (número, canal, caixa)
e os fatos do que disparou: etiqueta, responsável/equipe (ou "removido"), card (título, funil, etapa
anterior → etapa), política de SLA, grupo, nome do formulário e do marco, anúncio/formulário/campanha
do Meta Lead (+ as respostas, em bloco próprio), produto/oferta/meio de pagamento do gateway, evento/
unidade/data/hora/compromisso da e-Clínica, tecla do TopSend, e os dados do agendamento. Esses fatos
ficam numa área só-de-log (`_trigger_facts`) — **não existem como `{{trigger.*}}`** e não entram em
`{{trigger.data}}`. Se o cliente precisar de um deles no fluxo, use a variável de origem quando
existir (`{{booking.*}}`, `{{form_*}}`, `{{contact.*}}`, atributos do contato gravados pela integração).

**NÃO duplique o que já tem variável própria.** `{{contact.name}}`, `{{conversation.status}}`,
`{{inbox.name}}` e os atributos `ctwa_*` continuam existindo e são a forma canônica. O `{{trigger.*}}`
serve pra perguntar "o que veio COM o gatilho", não pra ser um segundo nome do mesmo dado.

**Variáveis do agente de IA `{{ai_agent.*}}` (novo 2026-08-01):** `{{ai_agent.name}}` e
`{{ai_agent.id}}` trazem o AI Agente atribuído à conversa (vazio se não houver) — refletem a
ATRIBUIÇÃO, não "vai responder agora"; desde 20/08/2026 resolvem também no Liquid. Prefixo `ai_agent` de
propósito — `agent` sozinho é o atendente HUMANO, e confundir os dois seria pior que não ter.

**Outras variáveis padrão que resolvem no caminho direto:** `{{contact.id}}`, `{{contact.identifier}}`,
`{{contact.first_name}}`, `{{contact.last_name}}`, `{{contact.label}}` (etiquetas do contato, separadas por
vírgula), `{{conversation.team.name}}` (nome da equipe; `{{conversation.team}}` é apelido).
`{{last_response}}` = última resposta do cliente; `{{last_agent_response}}` = última mensagem PÚBLICA nossa
(nota interna NÃO conta, desde 20/08/2026).

**Filtro Liquid (desde 20/08/2026):** `{{conversation.id}}`, `{{conversation.status}}` e
`{{conversation.team_id}}` respondem o MESMO com e sem filtro (`|`) — antes um filtro em qualquer variável do
texto trocava o protocolo pelo id interno do banco.

---

## 2-D. Exit conditions (saída automática do flow)

`flow_data.exit_conditions` é um array no NÍVEL DO FLOW (irmão de `nodes`/`edges`, NÃO é um node). Se QUALQUER condição bater, o lead sai do flow NA HORA. Cada item tem `type`:

**Por evento:**
- `label_added` / `label_removed` — `{ "type": "label_added", "value": "<slug-da-label>" }`
- `conversation_resolved` — `{ "type": "conversation_resolved" }`
- `agent_assigned` / `team_assigned` — `{ "type": "agent_assigned", "value": "<id opcional>" }` (vazio = qualquer)
- `kanban_won` / `kanban_lost` — `{ "type": "kanban_won", "value": "<funnel_id opcional>" }`
- `agent_replied` — `{ "type": "agent_replied" }` (sem `value`; vale pra QUALQUER atendente). Sai no instante em que um humano assume: mensagem do painel, do celular da empresa (eco do app nativo) ou agendada por um atendente. NÃO conta nota interna, mensagem do próprio flow, da IA, de follow-up, de automação nem de campanha. É estritamente por EVENTO — conversa que já tinha mensagem de atendente ANTES do flow começar não derruba o flow.

**Rico por atributo** (novo 2026-07-08; REATIVO desde 2026-07-09) — sai assim que o atributo VIRA pro valor que bate:
```json
{ "type": "attribute_condition", "logic": "and",
  "rules": [
    { "attr_key": "status", "attrSource": "conversation", "operator": "equal", "value": "cancelado" }
  ] }
```
- `attrSource` (`'contact'`|`'conversation'`|`'card'`) VAI na rule (ao contrário do gatilho de entrada por atributo, onde é implícito).
- `operator` (contexto REATIVO — desde 09/07 SEM `is_empty`/`is_not_empty`, que dispararia a cada evento; use-os só no nó Condição): `equal`/`not_equal`/`contains`/`not_contains`/`starts_with`/`ends_with`/`greater_than`/`less_than`/`number_range`. Multi-valor via `values: [...]` no lugar de `value`.
- Reativa (09/07): só é reavaliada quando o atributo VIGIADO daquela rule realmente muda — não a cada mensagem. Cada rule exige `attr_key` + (`value` ou `values`); rule sem isso é ignorada.
- `card` aceita `funnel_id`/`card_source` opcionais na rule.
- `logic`: `and` (todas as rules) | `or` (qualquer rule).

---

## 2.9 Validação `flow_trigger_conflict` (criar/ativar flow)

Ao criar, atualizar ou ativar um flow, o backend BLOQUEIA se outro flow **ATIVO** na MESMA inbox
tiver um gatilho do MESMO tipo que colide. Resposta: **HTTP 422** `{ "error_code": "flow_trigger_conflict",
"conflicts": [{ flow_id, flow_name, trigger_type, inbox_id, inbox_name }] }`.

- Só conta flow **ATIVO** — flows inativos não geram conflito.
- Colisão por tipo de gatilho: `card_created`/`card_moved` colidem quando os funis/etapas se sobrepõem;
  `message_received`/`message_sent` por interseção de keywords (vazio = "pega tudo" = colide);
  `label_added`/`label_removed` por interseção de labels; `conversation_resolved` sempre colide.
- Estratégia recomendada quando dois cenários dividiriam o mesmo gatilho: um flow único com gatilho
  amplo + nó `condition` (ou `exit_conditions`) roteando/descartando, em vez de dois flows concorrentes.

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

**Handles CONDICIONAIS — só existem sob a config certa. Não ligue edge sem ativar a condição:**
- `no_reply_timeout` → só com `buttons_timeout > 0` no item de botões.
- `window_closed` → só em flow WhatsApp API oficial com item de janela.
- `button_<value>` → um por botão que EXISTE; se remover o botão, remova o edge.
- `option_<x>` → um por opção em `acceptedOptions`; idem.
- `cond_0..N` → um por condição no array; se tirar uma condição, o `cond_N` do fim some.
- `intent_<name>` → um por intent no `ai` mode intent.
- `partial` → só em `update_group` com operação `create`/`add_participants`/`remove_participants`.
Ligar edge num handle condicional inexistente = **aresta fantasma** (sai do nada no canvas, não roteia).

**Fio com rótulo só é seguido por quem casa com o rótulo (desde 20/08/2026).** Não existe mais
"pega o primeiro fio que existir": `option_A` não entrega quem respondeu B, `window_closed` não
pega envio bem-sucedido, `timeout` não pega resposta válida. O único último recurso é a ligação
SEM `sourceHandle` (fluxo legado). Sem fio elegível, o flow TERMINA ali — nunca segue o ramo errado.
Consequência prática: ligue TODAS as saídas que o cliente espera que aconteçam; saída sem fio é
fim de fluxo, não "cai no próximo". (Duas pontes explícitas continuam: `option_X`/`button_X`/
`no_response` sem fio próprio caem no `success` do `wait_response` se ele existir; `partial` do
`update_group` sem fio cai no `success`.)

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
| Edge `sourceHandle: "no_reply_timeout"` sem `buttons_timeout > 0` | Handle não existe sem timeout → aresta fantasma (linha saindo do nada no canvas) | Só crie esse edge se configurar o timeout no item de botões |
| Edge `sourceHandle: "window_closed"` fora de flow WhatsApp API oficial | Handle só existe na API oficial → aresta fantasma | Só crie em flow oficial com item de janela |
| `channel_type: "WhatsApp"` | Precisa do nome de classe Rails | `"Channel::Whatsapp"`, `"Channel::Waha"`, `"Channel::WebWidget"` |
| `validation: "option"` (singular) | Não existe | `"options"` (plural) |
| `varied_options` com `acceptedOptions` | Modo errado de config | `optionGroups: [{ id, terms, matchType }]` |
| `saveTo: "contact_phone"`/`"contact_email"` com `validation: "any"` | Cadastro reverte valor inválido em silêncio | Combine com `validation: "phone"`/`"email"` |
| Ativar 2 flows no mesmo gatilho+inbox+modo | 422 `flow_trigger_conflict` (exceto webhook/manual) | Desative o outro flow ou mude o gatilho |
| `custom_attributes` (plural) em `{{...}}` ou `field` | Resolve vazio | `custom_attribute` (singular) |
| `update_attribute` com `{entity, key, value}` | Campos errados, não salva | `{attr_source, attr_key, attr_value}` |
| `saveTo: "attribute"` ou `"contact_attribute"` | Não existem, não salva | `"conversation_attr"` / `"contact_attr"` |
| `is_present` / `is_blank` na condition | Não existem | `is_not_empty` / `is_empty` |
| `aiIntentOptions` (array de strings) no node ai | Ignorado | `aiIntents: [{name}]` |
| `match_mode` no `message_received` | Ignorado | `match_type` (`exact`/`contains`) |
| `label` (singular) em `label_added`/`label_removed` | Ignorado | `label_names: [...]` |
| `greater_than`/`less_than` em atributo texto/lista | UI não oferece; semântica errada | usar só em atributo número ou `date` (data ISO) |
| inboxes em flow `ai_tool` | Validação rejeita | ai_tool não tem inboxes |
| `waitTime: "60"` (string) | Espera Integer | `waitTime: 60` |
| `inbox_ids` aninhado em `{flow:{...}}` | No MCP, achata-se sozinho | Passa `inbox_ids: [1, 2]` no nível raiz |
| Mais de 1 node `start` | Flow precisa ter exatamente 1 ponto de entrada | Só 1 |
| Node sem edge entrando (exceto start) | Node nunca executa | Confira que todo node não-start tem ao menos 1 edge target apontando pra ele |
| `flow_data` sem `nodes` ou sem `edges` | Estrutura inválida | Inclua sempre, mesmo que `edges: []` |
| `method`/`url`/`headers`/`body` no node api | Runtime NÃO lê → GET vazio (ou erro "URL not configured") | `apiMethod`/`apiUrl`/`apiHeaders`/`apiBody` |
| `{{env.X}}` no node api | Não existe → resolve vazio → 401 | `{{account.custom_attribute.X}}` (secret resolve só no node api) |
| `{{api_response.payload.campo}}` | `.payload` não existe → vazio | `{{api_response.campo}}` (o corpo fica direto sob a var); status em `{{api_response_status}}` |
| node `ai` via API sem `aiAssistantId` | Sai pela saída `error` (desde 20/08; antes ficava verde com a variável vazia) | Informe `aiAssistantId` (obrigatório em generate/intent/sentiment/extract) |
| `contextMessages` no node `ai` | Chave errada → descartada em silêncio (fica 5) | `aiContextMessages` (0, 1, 3, 5, 10, 25, 50, 75, 100) |
| Nome de variável começando com `_` (`set_variable`, `saveVariable`, `apiResponseVar`, `aiResponseVar`) | Prefixo reservado → ignorado / cai no padrão | Nome sem `_` na frente |
| `{ type: "delay", seconds: 2 }` no send_message | A tela não lê `seconds` → abre como "undefineds" | `duration_seconds` (0-30) |
| Caixa oficial sem fio em `window_closed` | Janela de 24h fechada vira erro | Ligue `window_closed` num bloco com template |
| Saída com rótulo sem fio (`button_X`, `option_X`, `cond_N`, `timeout`, `partial`) | Desde 20/08 não "cai no próximo": o flow TERMINA ali; espera com timeout sem fio ENCERRA ao estourar | Ligue TODA saída possível |
| `update_group` `create`/`add_participants` sem fio em `partial` | Quem ficou de fora passa em silêncio (cai no `success`) | Ligue `partial` e leia `{{grupo.not_added}}`; convite automático exige `groupInviteMessage` |
| `funnel_stages: ["37:Nome Exibido"]` | Usa o NOME da etapa, não a chave interna → gatilho nunca dispara | `"37:chave_interna"` (slug/UUID da etapa) |
| `funnel_ids: [37]` (número) no gatilho card | String esperada → `[37].include?("37")` falso → não dispara | `funnel_ids: ["37"]` |
| `kanban_in_stage` com `value: "37:etapa"` | Formato errado → cai no default silenciosamente | `funnel_id` separado + `value: "etapa"` (slug puro) |
| `is_empty`/`is_not_empty` em gatilho ou exit por atributo | Removidos do contexto reativo (09/07) | Use só no node `condition` (avaliação pontual) |

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
- [ ] Todo `edge.sourceHandle` é um handle que o node source EXPÕE NAQUELA config (sem handle condicional inexistente: `no_reply_timeout` só com timeout, `window_closed` só API oficial, `button_<value>`/`option_<x>`/`cond_N`/`intent_<name>` só se o botão/opção/condição/intent existir, `partial` só em `update_group` de participantes)
- [ ] TODA saída que pode acontecer tem fio (desde 20/08 saída sem fio é fim de fluxo, não "cai no próximo"): cada `button_X`/`option_X`/`cond_N`, `default`, `timeout` de toda espera com `waitTime` (sem fio, a sessão ENCERRA ao estourar), `window_closed` em caixa oficial, `partial` no `update_group`
- [ ] Todo edge tem `source`, `target` e `sourceHandle`
- [ ] Todo `sourceHandle` é um handle real exposto pelo node source (seção 2)
- [ ] `channel_type` é classe Rails (`Channel::Waha` etc)
- [ ] `inbox_ids` (se enviado) tem inboxes do mesmo `channel_type`
- [ ] Não tem `condition` redundante depois de `wait_response` com `options`/`varied_options`
- [ ] `wait_response` que salva e-mail/telefone do contato usa a validação correspondente (`email`/`phone`)
- [ ] Antes de ATIVAR: nenhum outro flow ativo no mesmo gatilho+inbox+modo (senão vem 422 `flow_trigger_conflict`)
- [ ] Layout: nodes em ordem visual da esquerda pra direita, sem sobreposição
