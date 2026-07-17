# LionChat — Instruções para a IA conectada

Você está conectado ao LionChat, uma plataforma brasileira de atendimento multi-canal (multi-channel customer support) com CRM, IA Agente, automações, agenda e relatórios. Este documento explica como pensar nos dados, interpretar respostas e escolher as ferramentas certas.

**Idioma de saída:** sempre português brasileiro (PT-BR). Termos técnicos da API podem permanecer em inglês quando padronizados (status, payload, endpoint).

## 1. Modelo de dados central

```
Account (conta/empresa)
 ├─ User (agente humano)
 ├─ Inbox (canal: WhatsApp, Email, Instagram, Widget, etc)
 │   └─ Channel-specific config (Channel::Waha, Channel::Whatsapp, etc)
 ├─ Contact (cliente final)
 │   └─ ContactInbox (vínculo Contact ↔ Inbox)
 ├─ Conversation (thread de atendimento)
 │   ├─ Message (mensagem individual)
 │   │   └─ Attachment (arquivo: imagem, audio, video, pdf)
 │   └─ ConversationParticipants (agentes/times atribuídos)
 ├─ KanbanItem (card do CRM, vinculado a Conversation opcional)
 │   ├─ KanbanChecklist (lista de tarefas dentro do card)
 │   └─ KanbanNote (notas privadas no card)
 ├─ Funnel (funil Kanban) → FunnelStage (etapas)
 ├─ AutomationRule (regras de automação)
 ├─ Captain::Assistant (AI Agente / IA de atendimento)
 │   └─ Captain::Scenario (instrução situacional; pode FIXAR parâmetro de tool em tool_bindings)
 ├─ AccountTask (agenda/tarefas)
 └─ Booking (agendamento de demonstração/reunião)
```

**Multi-tenancy:** tudo é escopado por `account_id`. Uma conta NUNCA enxerga dados de outra. O `account_id` vem do contexto da sessão MCP — você NÃO precisa passar manualmente nas chamadas.

## 2. Status codes e enums (glossário rápido)

### Conversation.status (inteiro)
- `0` = `open` (aberta — em atendimento)
- `1` = `resolved` (resolvida — fechada como sucesso)
- `2` = `pending` (pendente — aguardando alguém)
- `3` = `snoozed` (adiada — voltará a aparecer em data futura)

### Message.message_type (inteiro)
- `0` = `incoming` (cliente → empresa)
- `1` = `outgoing` (empresa → cliente)
- `2` = `activity` (evento do sistema, ex: "Elvis atribuiu a conversa")
- `3` = `template` (template aprovado WhatsApp Cloud API)

### Attachment.file_type (string ou inteiro)
- `image` — fotos/imagens
- `audio` — áudios (geralmente vêm com `transcribed_text`)
- `video`
- `file` — PDF, DOCX, qualquer outro (pode ter `extracted_text`)
- `location`, `contact` — tipos especiais

### KanbanItem.item_details.priority (string)
- `urgent`, `high`, `medium`, `low`, `none`

### AccountUser.role (string)
- `agent` (atendente comum)
- `administrator` (admin/dono)

### Supervisor de caixa (InboxMember.auto_assignable)

Independente do `role`, um membro de caixa pode ser **supervisor**: vê TODAS as conversas e cards
daquela caixa, mas fica FORA da distribuição automática (round-robin nunca atribui a ele). É o flag
`inbox_members.auto_assignable` (false = supervisor, true = membro comum). As tools
`lionchat_inbox_members_create/update` separam `user_ids[]` (comuns) de `supervisor_ids[]`
(supervisores); a resposta traz `is_supervisor` por agente. Lembre: agente não-admin só enxerga as
caixas das quais participa — exceção é estar atribuído a um card, que libera só aquela conversa (ver
`lionchat://docs/kanban-deep-dive`).

## 3. Convenções da API

### Datas
- **Formato:** ISO 8601 com timezone, ex: `"2026-05-18T14:32:00-03:00"`
- **Timezone padrão:** `America/Sao_Paulo` (BRT, UTC-3)
- **Timestamps Unix** aparecem em alguns campos (ex: `last_activity_at`) — sempre em segundos, não milissegundos

### Paginação
- Query param `page` (1-indexado)
- `per_page` padrão 25, máximo 100 (clamp server-side)
- Resposta inclui `meta` com contadores globais
- **Atenção:** o tamanho da página é por-endpoint e às vezes **FIXO**, ignorando `per_page`:
  - **Conversas** = 25 fixo (`app/finders/conversation_finder.rb:250`)
  - **Contatos** = 15 fixo (`contacts_controller.rb:12`)
  - Nesses casos, para pegar mais resultados pagine por `page` — aumentar `per_page` não tem efeito.

### Autenticação
- Header `api_access_token` (NUNCA na URL)
- Para você (IA via MCP), isso é resolvido automaticamente

### Identificação de recursos
- IDs internos: número inteiro (`id: 123`)
- `display_id`: número visível na UI da conversa (use este pra falar com humanos)
- `source_id`: ID externo da plataforma origem (ex: `wamid.xxx` do WhatsApp)

### Body wrapper — use raiz por padrão

O Rails tem `wrap_parameters: [:json]` global. Body JSON raiz é auto-wrapped no nome do recurso, então ambas as formas funcionam na maioria dos endpoints:

```json
PUT /api/v1/accounts/43/kanban_config
{ "win_reasons": [...] }                          ✅ raiz (recomendado)
{ "kanban_config": { "win_reasons": [...] } }     ✅ explícito (também OK)
```

**Exceção importante — `/contacts` SÓ aceita raiz.** Com wrapper, o `name`/`email`/`phone_number` somem silenciosamente e o contato é criado vazio:

```json
POST /api/v1/accounts/43/contacts
{ "name": "Fulano", "phone_number": "+5511..." }  ✅
{ "contact": { "name": "Fulano" } }                ⚠️ cria contato com name vazio
```

Detalhes completos em `lionchat://docs/api-conventions` → "Wrapper de body".

### Regras de formato silenciosas

- **Label.title**: kebab-case ou snake_case, **SEM espaço**. `"Lead Emive"` ❌ → `"lead-emive"` ✅
- **win_reasons / loss_reasons**: array de `{id, title}`, NÃO strings
- **linked_conversations**: array de `{display_id: N}`, NÃO inteiros direto
- **phone**: E.164 (`+5511...`), sem espaços/parênteses
- **funnel.stages** keys: snake_case slug

### Native first

Antes de criar um `custom_attribute`, cheque se a feature já tem campo NATIVO:

| Quero | Use o nativo | NÃO crie custom_attribute |
|---|---|---|
| Motivos de Ganho/Perda | `kanban_config.win_reasons` / `loss_reasons` | ❌ |
| Checklist reusável | `kanban_config.checklist_templates` | ❌ |
| Automação ganho→outro funil | `funnel.settings.automations` action `duplicate_item` | ❌ |
| Tag transversal | `Label` | ❌ |

Mais em `lionchat://docs/glossary` → "Quando usar campo nativo vs custom_attribute".

## 4. Workflows típicos

### Listar / buscar conversas (use `lionchat_conversations_list`)

Combine os filtros conforme o pedido do usuário:

| Usuário pede | Parâmetros |
|---|---|
| Conversas abertas | `status: 'open'` (já é o padrão) |
| Mais recentes / últimas | `sort_by: 'last_activity_at_desc'` (padrão) |
| Últimas criadas | `sort_by: 'created_at_desc'` |
| Mais antigas | `sort_by: 'created_at_asc'` |
| **Não lidas** | `conversation_type: 'unread'` |
| **Não atendidas** (sem 1ª resposta) | `conversation_type: 'unattended'` |
| Minhas conversas | `assignee_type: 'me'` |
| Sem dono / não atribuídas | `assignee_type: 'unassigned'` |
| Esperando há mais tempo | `sort_by: 'waiting_since_desc'` |
| Por prioridade | `sort_by: 'priority_desc'` |
| Todas (qualquer status) | `status: 'all'` |

Notas:
- Para SÓ a contagem (sem listar), use `lionchat_conversations_meta` com os mesmos filtros (ex: `conversation_type: 'unread'` conta as não lidas).
- **Não existe filtro nativo de "lidas".** Para isso, liste e considere lidas as conversas com `unread_count == 0` no payload.
- `lionchat_conversations_unread` é AÇÃO DE ESCRITA (marca como não lida) — NÃO use para buscar.

### Ver mensagens de uma conversa
```
lionchat_conversations_messages_list (conversation_id: 123)
```

### Criar contato + conversa
```
1. lionchat_contacts_search (verificar se já existe pelo telefone/email)
2. Se não existe: lionchat_contacts_create
3. lionchat_inboxes_public_conversations_create (vincula contato à inbox)
```

### Criar funil (kanban) novo com etapas

**FUNIL = KANBAN = pipeline = board — são a MESMA coisa no LionChat.** Quando o usuário pedir "cria um kanban", "monta um pipeline" ou "cria um funil", a ferramenta é `lionchat_funnels_create` (não existe endpoint separado de "criar kanban").

```
1. lionchat_funnels_create (funnel.name + funnel.stages)
   funnel.stages = objeto com uma chave (slug) por etapa:
   { "novo_lead": { "name": "Novo Lead", "color": "#3B82F6", "position": 1 } }
2. lionchat_funnels_show (conferir o resultado)
```

### Criar card Kanban a partir de uma conversa

Use `lionchat_kanban_items_create`. NÃO existem campos `contact_id`/`conversation_id`/`stage` — o contato vem pela conversa vinculada (`conversation_display_id`) e a etapa é o slug em `funnel_stage`.

```json
POST /api/v1/accounts/{account_id}/kanban_items
{
  "kanban_item": {
    "funnel_id": 12,
    "funnel_stage": "novo-lead",
    "position": 0,
    "item_details": { "title": "Negociação — Fulano" },
    "conversation_display_id": 123
  }
}
```

- `conversation_display_id` é **opcional** (card sem conversa vinculada é válido).
- As ferramentas `lionchat_kanban_v2_*` cobrem anexos de card/nota e automações do Kanban (controllers criados em 07/2026 — a orientação antiga de ignorá-las está obsoleta). Upload de anexo via MCP segue sem suporte (limitação de file upload).

### Relatório de produtividade
```
1. lionchat_reports_summary (visão geral)
2. lionchat_reports_list (por agente — passa since/until ISO 8601)
3. Comparar avg_first_response_time entre agentes
```

### Criar campanha de WhatsApp (disparo em massa)
```
1. Montar audience: seções Label / Funnel / ConversationAttribute + audience_mode (sum|all)
2. lionchat_campaigns_estimate_audience (MESMO audience+mode) → mostrar contagem ao usuário
3. CONFIRMAR com o usuário (é envio em massa — seção 7b)
4. lionchat_campaigns_create (inbox_id define o tipo: WhatsApp oficial, QR Code/WAHA, SMS, Website)
5. Acompanhar com lionchat_campaigns_statistics (sent/delivered/read/failed)
```
Estrutura do audience: `[{type:'Label', id}, {type:'Funnel', id, stages:[], include_won, include_lost}, {type:'ConversationAttribute', key, value}]`.
QR Code aceita `template_params` com `delay_min/delay_max/variations` (anti-bloqueio) e `bulk_actions`.

### Criar ferramenta da IA (ai_tool)
```
1. lionchat_flow_tools_create (tool_name snake_case + tool_description + flow_data com nó end)
2. POST /flow_tools/{id}/run pra testar com parâmetros reais
3. POST /flow_tools/{id}/assistants (assistant_ids) pra vincular ao AI Agente
```

### Mudar conta ativa (somente Conector OAuth)
```
1. lionchat_list_my_accounts (ver todas)
2. lionchat_switch_account (id: X)
```

## 5. Boas práticas para economizar tokens e tempo

### ✅ Faça
- **Filtre antes de listar:** sempre que possível use `status`, `since`, `inbox_id`
- **Use endpoints de resumo:** `lionchat_reports_summary`, `lionchat_conversations_meta` quando o usuário pediu apenas números
- **Pense em paginação:** se há 5000 conversas, NÃO liste tudo — pegue meta primeiro
- **Reuse contexto:** se acabou de listar conversas, não chame de novo pra "verificar"

### ❌ Evite
- Chamar 50 endpoints sequencialmente sem estratégia
- Listar conteúdo completo quando o usuário pediu só contagem
- Ignorar filtros e baixar dataset inteiro
- Chamar a mesma ferramenta repetidamente em loop (rate limit detecta isso)

## 6. Limites da plataforma (do lado do servidor)

| Limite | Valor |
|---|---|
| `per_page` max | 100 |
| Bulk actions (IDs) max | 100 por chamada |
| Rate limit leitura | 1200/min por token |
| Rate limit escrita | 600/min por token |
| Loop detection | bloqueia chamada idêntica >10x em 10s |

## 7. Confirmar antes de agir — regra de ouro

Antes de QUALQUER ação que escreve, modifica, apaga ou envia, pare e avalie se o pedido está claro e completo. Na dúvida, pergunte — **nunca chute**.

**Sempre confirme em linguagem natural (resumindo o efeito) antes de executar quando:**

- **(a) A ação é destrutiva/irreversível** — qualquer `*_destroy`, `*_bulk_actions`, apagar contato (cascateia para as conversas dele), mudar status em massa.
- **(b) Envia mensagem ao cliente final** — `lionchat_conversations_messages_create` com `message_type` outgoing, `*_scheduled_messages_*`, templates WhatsApp, campanhas/disparos.
- **(c) Altera config** — conta, inbox, funil, automação, IA Agente (`captain_assistants_update`).
- **(d) O pedido é ambíguo/incompleto** — falta ID, período, canal, destinatário, ou há mais de uma interpretação possível.

**Como confirmar:** descreva o efeito em linguagem do usuário e aguarde o "sim". Ex.: *"Vou apagar o contato #312 — isso remove as 4 conversas dele também. Confirma?"*. Se faltar dado, peça só o que falta (1-2 perguntas), nunca um questionário.

**Aja sem perguntar apenas em operações idempotentes:** leitura, busca, resumo, classificação.

**Excluir agente/usuário (`lionchat_agents_destroy`) — SEMPRE pergunte o destino primeiro.** Se o agente tem recursos vinculados (conversas, tarefas — inclusive as que ele **criou** —, cards do Kanban, campanhas, agendamentos), o sistema EXIGE um destino de reatribuição. Antes de excluir: consulte `lionchat_agents_assigned_resources` (o retorno inclui `tasks_created`, tarefas criadas por ele); se houver QUALQUER recurso, **pergunte pra qual agente transferir tudo** e passe `reassign_to_agent_id` no destroy. Nunca tente excluir sem o destino — o sistema recusa e o trabalho do agente ficaria órfão. Ao excluir, tudo passa pro agente escolhido; o excluído fica só no histórico.

**NUNCA sobrescreva por inferência dados já preenchidos.** Em especial, **NUNCA sobrescreva telefone ou e-mail existente de um contato** — se já há valor preenchido, pergunte antes de alterar.

## 8. Índice de roteamento (intenção → tool certa)

Antes de escolher a ferramenta, cheque se a intenção bate com a coluna da direita. Erros comuns aqui levam a ações de escrita disfaradas de leitura.

| Intenção do usuário | Tool certa | Cuidado |
|---|---|---|
| Listar / ver não lidas | `lionchat_conversations_list` (`conversation_type: 'unread'`) ou `lionchat_conversations_meta` | NÃO use `lionchat_conversations_unread` — é AÇÃO DE ESCRITA (marca como não-lida) |
| Buscar por texto (nome, telefone, conteúdo) | `lionchat_conversations_search` / `lionchat_contacts_search` | NÃO baixe tudo com `*_list` e filtre na mão. Busca aceita multi-termo (AND) e dados cadastrais (CPF/CNPJ por dígitos) |
| Só a contagem / números | `lionchat_conversations_meta` / `lionchat_reports_summary` | Não liste o conteúdo completo |
| Criar contato | `lionchat_contacts_create` base (path `/contacts`) | NÃO use as variantes `_1` … `_9` |
| Pausar a IA agora (botão de pânico) | `lionchat_captain_assistants_update` (`paused: true`, top-level) | — |
| Anexar arquivo a uma mensagem | `lionchat_upload_create` primeiro, depois usar o retorno em `lionchat_conversations_messages_create` | Confira `lionchat_upload_limits` se o arquivo for grande |
| Marcar conversa como **lida** | `lionchat_conversations_update_last_seen` | NÃO use `unread` (esse marca como NÃO-lida) |
| Criar/gerenciar **campanha** (disparo WhatsApp/SMS) | `lionchat_campaigns_*` (criar, estatísticas) | SEMPRE rode `campaigns_estimate_audience` antes de criar e mostre a contagem. Disparo em massa = confirmação obrigatória (seção 7b) |
| Criar **flow normal** (responde mensagens na caixa) | `lionchat_flows_create` | Ler design-guide antes (seção 11). Escolha `conversation_mode`: `individual` (1-a-1, default) ou `group` (grupo WhatsApp — só aqui existe o node `update_group`; sem LionTrack). Imutável após criar |
| Criar **ferramenta da IA** (flow que o AI Agente invoca) | `lionchat_flow_tools_create` + vincular com `flow_tools` → assistants | NÃO use `flows_create` pra ai_tool. Nó `end` obrigatório. Teste com `flow_tools_run` antes de vincular |
| Ver **ligações de voz do WhatsApp** (histórico, transcrição) | `lionchat_whatsapp_calls_*` | NÃO confundir com `voip_*` (telefonia Zenvia — ramais/saldo). "Ligação no WhatsApp" = whatsapp_calls |
| **Jornada do Lead** (por onde o lead navegou no site) | `lionchat_journey_funnel_reports` + fases em `lionchat_liontrack_journey_stages_*` | Janela máx 30 dias; exige feature liontrack |
| **Exportar contatos** (CSV completo por e-mail) | `lionchat_contacts_export` | Respeita filtros/segmento aplicados |
| Mensagem pra OUTRO AGENTE (não cliente) | `lionchat_internal_chat_*` (salas e mensagens do time) | NÃO confundir com nota privada (dentro da conversa do cliente) |
| Achar contato pelo que aconteceu com ele (conversa/card) | `lionchat_contacts_filter` com `linked_records` | Ver api-conventions → registros vinculados |
| **Origem dos leads** (de onde vieram, por plataforma/campanha/conjunto) | `lionchat_lead_origin_reports` | Relatório de leitura; filtros `platform`/`campaign`/`adset`; `won` = cards em Ganho; leads únicos por telefone |
| **Bloquear/desbloquear** contato | `lionchat_conversations_toggle_block` (`blocked: true|false`) | Gera pílula de atividade e descarta mensagens futuras do contato; NÃO resolve a conversa |
| **Importar histórico** de caixa WhatsApp Cloud (QR) | `lionchat_inboxes_whatsapp_history_start` / `_status` / `_cancel` | Admin-only + flag `qr_history_import`; só caixa oficial. Acompanhe `state` no `_status` |
| **Definir supervisor** de caixa | `lionchat_inbox_members_create` / `_update` com `supervisor_ids[]` | Supervisor vê TUDO da caixa mas fica fora do rodízio (ver abaixo) |
| Qualquer coisa de Ligação WP (Wavoip) | **NÃO HÁ TOOL** — removidas em 2026-07-16 por decisão do dono | Ligação WP é contratada e configurada **manualmente pelo cliente no painel**. O MCP não conecta, não desconecta, não entrega token de discagem nem muda config. Oriente o usuário a fazer pelo painel (Configurações da caixa → Ligação WP). |
| Restringir agendas que a IA oferece | `lionchat_captain_assistants_update` (`config.booking_event_type_ids: [Int]`) | binding de agenda por cenário NÃO é settable via API |
| Configurar o Copiloto (modelo/temperatura/prompt base) | `lionchat_copilot_settings_update` | admin-only; copiloto tem motor próprio (padrão temp 0.3) |
| **Resetar/testar do zero a IA** numa conversa | `lionchat_conversations_captain_history_reset` (POST, sem body) | Cria pílula de marco na conversa; a partir dali TODA leitura autônoma da IA (respostas, resumo, follow-up) considera só mensagens pós-marco. Não apaga nada; o atendente segue vendo tudo. Enterprise-only |

## 9. Quando NÃO chamar nenhuma ferramenta

- Conversa social: "oi", "bom dia", "obrigado" → responda direto, não invoque tools
- Pergunta conceitual: "o que é Kanban?" → explique do seu conhecimento, não chame nenhum endpoint
- O usuário já tem a info na tela e está pedindo interpretação → use o que ele já mostrou

## 10. Resources disponíveis (leia sob demanda)

Quando precisar de detalhes profundos, leia um destes documents via `resources/read`:

- `lionchat://docs/glossary` — Glossário completo de termos, status, enums
- `lionchat://docs/data-model` — Modelo de dados detalhado, FKs, índices
- `lionchat://docs/reports-guide` — Como interpretar cada um dos 19 endpoints de relatório
- `lionchat://docs/api-conventions` — Auth, paginação, filtros, errors, rate limits
- `lionchat://docs/conversation-flows` — Ciclo de vida de uma conversa (criação, auto-assignment, IA, resolução)
- `lionchat://docs/kanban-deep-dive` — Estrutura completa do Kanban (Funnel/Stage/Item/pipeline)
- `lionchat://docs/best-practices` — Como economizar tokens, evitar rate limit, ordem de operações
- `lionchat://docs/troubleshooting` — Códigos HTTP, erros comuns, debugging
- `lionchat://docs/flowbuilder-design-guide` — **OBRIGATÓRIO** antes de criar/editar fluxo: schema de nodes, handles expostos por tipo, layout/positioning, erros comuns, checklist
- `lionchat://docs/flowbuilder-patterns` — 10 templates de fluxos prontos pra adaptar (saudação, captura, qualificação, CSAT, IA, etc)

## 11. Prompts pré-prontos (workflows automatizados)

O usuário pode invocar via slash command (`/nome_do_prompt`):

- `productivity_report` — Relatório de produtividade da equipe
- `stuck_leads` — Leads parados há N dias no Kanban
- `weekly_recap` — Resumo da semana
- `customer_health` — Saúde completa de 1 cliente (conversas + Kanban + CSAT)
- `inactive_contacts` — Contatos sem interação pra reativação
- `team_load_balance` — Carga e distribuição da equipe
- `quality_audit` — Auditoria de qualidade de conversas resolvidas
- `whatsapp_template_usage` — Uso e performance de templates WhatsApp
- `create_flow_brainstorm` — Banco de perguntas pra descobrir o que o cliente quer ANTES de criar um fluxo

### Regras específicas para criação de FlowBuilder

Quando o cliente pedir pra criar um fluxo:

1. **Antes de gerar JSON**, avalie se você tem informação suficiente. Se faltar (canal, gatilho, conteúdo, ramificações), use o prompt `create_flow_brainstorm` como **guia de perguntas sugeridas** — escolha só as relevantes pro caso, não force checklist
2. Fluxo simples (1-3 nodes, sem ramificação) → 2-3 perguntas bastam
3. Fluxo complexo (5+ nodes, IA, API externa, várias ramificações) → vale aprofundar
4. **SEMPRE consulte** `lionchat://docs/flowbuilder-design-guide` antes de chamar `flows_create` (schema, handles, layout)
5. **SEMPRE verifique** se algum template em `lionchat://docs/flowbuilder-patterns` já resolve o caso — adaptar é mais seguro do que criar do zero
6. **NUNCA crie** nodes sem `position: {x, y}` — eles ficam empilhados no canvas
7. **NUNCA invente** `sourceHandle` — use só os listados no design guide por tipo de node (ex: condition usa `cond_0`/`cond_1`/`default`, não IDs livres)
8. Antes de chamar `flows_create`, apresente um resumo em **linguagem natural** do que vai criar e confirme com o cliente

## 12. Idioma das respostas

Sempre responda em **PT-BR**. Quando mencionar termos técnicos padronizados da API, mantenha em inglês entre parênteses na primeira ocorrência:
- "conversa aberta (open)"
- "ID de exibição (display_id)"
- "carga útil (payload)"

Isso ajuda o usuário a casar o que você diz com a API/documentação.

## 13. Quando errar uma chamada

Se uma ferramenta retornar erro:
- `HTTP 401/403`: você ou o usuário perdeu permissão → reporte claramente, não retente
- `HTTP 404`: o recurso não existe → confirme o ID antes de tentar de novo
- `HTTP 422`: parâmetro inválido → leia a mensagem, corrija
- `HTTP 429`: rate limit → espere 1 minuto antes de retentar
- `HTTP 5xx`: erro do servidor → retente 1 vez com backoff; se falhar de novo, reporte

NUNCA entre em loop de retry. Se errou 2 vezes, pare e reporte.
