# Changelog

## 0.4.3 — 2026-05-20

### Corrigido

- **Doc do wrapper de body** (`api-conventions.md`, `troubleshooting.md`, `instructions.md`): auditoria empirica derrubou o claim falso de "HTTP 500 silencioso sem wrapper". O Rails do projeto roda com `wrap_parameters: [:json]` global, entao body raiz e auto-wrappado na maioria dos endpoints. Doc reescrita com base em testes curl reais contra os controllers (`kanban_config`, `funnels`, `labels`, `custom_attribute_definitions`, `kanban_items` aceitam ambos os formatos).
- **Pegadinha do `/contacts`**: documentada nova armadilha real — `POST /contacts` com wrapper `{"contact": {...}}` retorna 200 mas cria contato com campos vazios. Causa: `ContactsController` usa `params.permit(:name, ...)` direto, sem `require(:contact)`. **Sempre enviar body raiz pro `/contacts`**.
- **`findDocsPath` em `src/resources.ts`**: agora cobre 3 layouts (`dist/docs/resources/` publicado, monorepo legado, `src/docs/` dev) pra evitar `null` quando rodado via `npx`.

### Mudado

- `scripts/extract-endpoints.ts` migrado de `require()` pra `import` (ESM). Adicionadas sub-categorias `Validacao WhatsApp` e `Chat Interno` no mapeamento de slugs.

## 0.4.0 / 0.4.1 / 0.4.2 — 2026-05-19

### Adicionado

- **Completion API** — sugestoes de auto-complete pros parametros das tools (ex: lista `account_id`/`inbox_id` disponiveis). Reduz erro de id inexistente.
- **Progress notifications** — operacoes longas reportam progresso em tempo real (import de contatos, exports, etc), em vez de ficar em silencio ate terminar.
- **User-Agent customizado** — requests do MCP agora marcam origem MCP no `audit_log` do LionChat, separando do trafego normal.

## 0.3.2 — 2026-05-19

### Adicionado

- **FlowBuilder enrichment** — Resource `flowbuilder-design-guide` com schema completo de nodes, handles por tipo, layout/positioning e erros comuns + `flowbuilder-patterns` com 10 templates prontos (saudacao, captura, qualificacao, CSAT, IA, etc) + Prompt `create_flow_brainstorm` pra estruturar fluxos antes de criar. LLMs agora tem material concreto pra montar `flow_data` sem chutar.

## 0.3.1 — 2026-05-18

### Adicionado

- **Sprint 3 do MCP Knowledge Enrichment** — +4 Resources (`conversation-flows`, `kanban-deep-dive`, `best-practices`, `troubleshooting`) e +4 Prompts (`inactive_contacts`, `team_load_balance`, `quality_audit`, `whatsapp_template_usage`). Total: 10 Resources + 9 Prompts no servidor.

## 0.3.0 — 2026-05-18

### Adicionado

- **MCP Instructions** carregadas no boot do servidor (~3K tokens) explicando data model, status codes, convenções de API e workflows tipicos pra qualquer LLM que conectar entender o contexto antes de chamar tools.
- **4 Resources iniciais**: `glossary`, `data-model`, `reports-guide`, `api-conventions`.
- **4 Prompts iniciais**: `productivity_report`, `stuck_leads`, `weekly_recap`, `customer_health`.
- **Enriquecimento de 547 descriptions** das tools (48 → 183 chars em media), com `returns`, `common_use_cases` e `related_tools` em cada uma.

## 0.2.1 — 2026-05-13

### Adicionado

- Nova meta-tool `lionchat_flows_schema_reference`: retorna referencia completa do schema do FlowBuilder (tipos de nodes, keys de action, source handles, formato de edges, erros comuns e um exemplo minimo funcional). LLMs devem chamar antes de montar `flow_data` em `lionchat_flows_create` / `lionchat_flows_update`.

### Mudado

- Description dos tools `lionchat_flows_create` e `lionchat_flows_update` enriquecida com cheatsheet inline do schema dos nodes e dos erros comuns (action.items[].config nao params; send_message.messageItems nao items; wait_response validation='options' dispensa condition node; sourceHandle deve casar com handle real do node source).

### Corrigido

- `lionchat_custom_attributes_create` agora aceita `attribute_key`, `attribute_description`, `attribute_values`, `regex_pattern`, `regex_cue` e `default_value`. Antes so passava 3 params (`display_name`, `display_type`, `model`), o que fazia a API rejeitar com "Attribute key nao pode ficar vazio". Pra criar atributos via MCP agora e obrigatorio passar `attribute_key` (slug snake_case, ex: `cpf`, `data_nascimento`).

### Nota

- 0.1.2 e 0.1.3 foram publicadas como branches de fix sem as features de 0.2.0; 0.2.1 unifica tudo (features 0.2.0 + fixes 0.1.2/0.1.3).

## 0.2.0 — 2026-05-05

### Adicionado
- Multi-conta: parametro `account_id` opcional em todas as tools sobrepoe `LIONCHAT_ACCOUNT_ID`
- Captain Assistants: 18 campos novos no create/update (temperature, instructions, follow_up_*, disabled_tools, offer_ids, media_asset_ids, booking_event_type_ids, etc)
- Captain Scenarios: campos `description` (obrigatorio) e `enabled`
- Captain FAQs: campo `assistant_id` (obrigatorio) e `status`
- Reports: parametros `type`, `id`, `business_hours`, `timezone_offset` documentados
- 2 endpoints novos: `captain/assistants/tools` (GET) e `captain/assistants/{id}/playground` (POST)

### Corrigido
- separateParams agora suporta nested params via dot-notation (config.temperature, config.feature_faq, etc) — antes campos eram silenciosamente descartados pelo strong_params do Rails
- Typo: `instructions` (plural) → `instruction` (singular) nos schemas de scenarios

### Notas
- Funciona contra LionChat backend a partir de 2026-05-05 (depende de fix backend pra reports/summary 500 e captain/assistants/create 500)

## 0.1.1

Versão inicial publicada.
