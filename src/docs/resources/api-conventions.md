# Convenções da API LionChat

Padrões de autenticação, paginação, filtros, formatos e tratamento de erros. Use sempre que precisar entender COMO chamar a API ou interpretar respostas genéricas.

## Autenticação

### Tipos de auth

| Tipo | Header / Param | Quando usar |
|---|---|---|
| `api_access_token` | Header `api_access_token: <token>` | API principal (você usa isto via MCP) |
| Devise Token Auth | `access-token` + `client` + `uid` | Dashboard web/mobile (não você) |
| HMAC | `X-Webhook-Signature` | Webhooks de entrada |
| OAuth Bearer | `Authorization: Bearer <token>` | MCP Remote (você usa isto) |

Pra você via MCP: tudo já tá resolvido. O servidor MCP injeta o token correto em cada chamada.

### Token escopos

Tokens são **por usuário**, não por conta. O mesmo token funciona em qualquer conta que o usuário tem acesso. O scoping por conta acontece via `account_id` no path.

## Wrapper de body — como o Rails interpreta

O projeto roda com `wrap_parameters format: [:json]` no Rails (config global). Na prática:

- Bodies JSON raiz são **auto-wrapped** pelo Rails no nome do recurso (derivado do controller).
- Mandar `{"enabled": true}` em `PUT /kanban_config` é equivalente a mandar `{"kanban_config": {"enabled": true}}`.
- Ambas as formas funcionam na maioria dos endpoints. Não existe "HTTP 500 silencioso por falta de wrapper" — esse claim era impreciso.

### Padrão recomendado

Use **body raiz** (sem wrapper). É mais curto, funciona em todos os endpoints listados abaixo, e evita a pegadinha do `/contacts`.

```http
PUT /api/v1/accounts/43/kanban_config
Content-Type: application/json

{ "win_reasons": [{"id": "wr-1", "title": "Preço competitivo"}] }
```

### Comportamento por endpoint (validado empiricamente)

| Endpoint | Raiz | Com wrapper | Observação |
|---|---|---|---|
| `POST/PUT /kanban_config` | ✅ | ✅ | qualquer um |
| `POST/PATCH /funnels` | ✅ | ✅ | qualquer um |
| `POST/PUT /kanban_items` | ✅ | ✅ | controller usa `require(:kanban_item)` mas auto-wrap resolve |
| `POST/PATCH /labels` | ✅ | ✅ | qualquer um |
| `POST/PATCH /custom_attribute_definitions` | ✅ | ✅ | qualquer um |
| `POST/PATCH /contacts` | ✅ | ⚠️ **drop silencioso** | Controller usa `params.permit(...)` na raiz sem `require(:contact)`. Com wrapper, o auto-wrap não duplica e os campos do body raiz ficam ausentes — o contato é criado com `name` vazio. **USE RAIZ.** |
| `POST/PATCH /conversations` | ✅ | varia | conversa aceita raiz |
| `POST /captain/copilot_threads` | ✅ | n/a | só raiz (`message`, `assistant_id`, `conversation_id`) |
| `POST /voip/settings/create_child_account` | ✅ | n/a | só raiz (`nome`, `login`, `senha`) |

### Quando WRAPPER é obrigatório

Praticamente nunca — exceto se você está testando legacy/curl e quer ser explícito. As tools do MCP geram params com nome `recurso.campo` (ex: `kanban_config.win_reasons`) só pra organizar a UI; no body final qualquer formato roda.

### Listas substituem, não fazem merge

`win_reasons`, `loss_reasons`, `stages`, `linked_conversations`, etc. — quando você manda a lista, ela **substitui** a anterior por inteiro. Pra preservar, leia com GET primeiro e mande a lista completa.

### Estrutura interna das listas

`win_reasons` / `loss_reasons` aceitam array de **objetos** `{id, title}`, NÃO strings:

```json
{
  "win_reasons": [
    {"id": "wr-1", "title": "Preço competitivo"},
    {"id": "wr-2", "title": "Indicação forte"}
  ]
}
```

Strings simples (`"win_reasons": ["motivo"]`) causam erro de serialização.

## Restrições de formato em campos comuns

Antes de criar/atualizar recurso, lembre dessas regras silenciosas:

### `Label.title` — kebab-case, SEM espaço

Validação: regex `\A[\p{L}\p{N}\-_]+\z` (letras Unicode, números, hífen, underscore). **Espaço quebra**.

```
✅ "lead-emive"
✅ "cliente_premium"
✅ "vip"
❌ "Lead Emive"        → 422 "Title nao e valido"
❌ "Lead/Indicação"    → 422
```

Recomendação: usar kebab-case (`lead-emive`). Na UI o usuário vê o título como digitado.

### `CustomAttributeDefinition.attribute_key` — snake_case (slug)

Aceita: letras, números, underscore, hífen e ponto. Sem espaço. Convenção: snake_case (`motivo_de_ganho`, `data_de_nascimento`).

### Phone numbers — formato E.164

`+<código país><DDD><número>`. Brasil: `+5511999999999` (13 dígitos com 9). Sem espaços, sem parênteses, sem hífen.

WAHA tem endpoint `/integrations/waha/check_phone?phone=+55...` que retorna o número CORRIGIDO (especialmente útil pra fixar o 9º dígito BR).

### `funnel.stages` — keys snake_case

```json
{
  "novo_lead": {"name": "Novo Lead", "color": "#3b82f6", "position": 1}
}
```

A KEY é o slug interno (`novo_lead`). O `name` é o que aparece na UI ("Novo Lead"). Slug não pode ter espaço — use underscore.

### `KanbanItem.linked_conversations` — array de objetos

```
✅ [{"display_id": 123}, {"display_id": 456}]
❌ [123, 456]   → TypeError no as_json (já causou bug em produção)
```

## Paginação

### Query params padrão

- `page` (int, 1-indexado, default 1) — **sempre respeitado**
- `per_page` (int, máximo 100 clamp server-side) — **page-size é por-endpoint e às vezes FIXO**

> **Atenção: vários endpoints IGNORAM `per_page` e usam um tamanho fixo.** Exemplos confirmados:
> - **Conversas** (`conversations_list`): 25 fixo (`CONVERSATION_RESULTS_PER_PAGE`, default 25) — `per_page` é ignorado.
> - **Contatos** (`contacts_list`): 15 fixo (`RESULTS_PER_PAGE = 15`) — `per_page` é ignorado.
> - **Busca de mensagens** (`messages_search`): 20 fixo.
>
> Nesses casos, NÃO confie em `per_page` pra trazer 100 de uma vez — pagine via `page`
> (`page=1`, `page=2`, ...) e use `meta.total_count` pra saber quando parar.

### Resposta típica

```json
{
  "data": [ ... ],
  "meta": {
    "current_page": 1,
    "total_pages": 5,
    "total_count": 142,
    "has_more": true
  }
}
```

Ou para listas grandes (cursors):

```json
{
  "data": [ ... ],
  "meta": {
    "before": "...",
    "after": "...",
    "has_more": true
  }
}
```

### Estratégia recomendada

- Para listar tudo: **NÃO** itere infinitamente. Quando o endpoint respeita `per_page`, `per_page=100` + 1 página é geralmente suficiente. Quando o page-size é FIXO (conversas=25, contatos=15, busca de msg=20), pagine por `page` e pare ao bater `meta.total_count`.
- Para "quantos X tem": prefira endpoints `meta` ou `count`.
- Para encontrar X específico: prefira `search` ou `filter` (server-side).

## Filtros

### Por query string (simples)

```
?status=open&priority=high&assignee_type=me
```

### Por POST body (complexo, multiplos campos)

`POST /api/v1/accounts/X/conversations/filter`
```json
{
  "payload": [
    { "attribute_key": "status", "filter_operator": "equal_to", "values": ["open"] },
    { "attribute_key": "labels", "filter_operator": "includes", "values": ["urgente"] }
  ]
}
```

### Operadores aceitos

- `equal_to` / `not_equal_to`
- `contains` / `does_not_contain`
- `is_present` / `is_not_present`
- `is_greater_than` / `is_less_than`
- `is_in` / `is_not_in` (arrays)
- `includes` / `excludes` (relacionamentos)
- `before` / `after` (datas)

### Atributos personalizados — operadores por TIPO (2026-08-07)

Vale pra automações, filtro avançado de conversas/contatos e busca "+ Filtro" (motor compartilhado):

| Tipo do atributo | Operadores aceitos |
|---|---|
| texto / link | equal_to, not_equal_to, contains, does_not_contain, is_present, is_not_present |
| lista | equal_to, not_equal_to, is_present, is_not_present |
| número / data | equal_to, not_equal_to, is_present, is_not_present, is_greater_than, is_less_than |
| moeda / porcentagem / hora / data+hora | equal_to, not_equal_to, is_present, is_not_present, is_greater_than, is_less_than |
| sim/não (checkbox) | equal_to, not_equal_to, is_present, is_not_present |

- Em atributo de LISTA, `equal_to` com vários `values[]` casa QUALQUER um deles (multi-seleção).
- NUNCA use `contains` em número/data/checkbox — o backend rejeita (cast inválido).
- Moeda e porcentagem são castados como número, hora como hora e data+hora como data —
  por isso desde 30/07 (filtros) e 07/08 (automações) esses quatro tipos também aceitam
  `is_greater_than` / `is_less_than`. Base técnica: `FilterService::ATTRIBUTE_TYPES` casta
  currency/percent como `numeric`, time como `time` e datetime como `date`; `coerce_lt_gt_value`
  aceita numeric/date/time. Tipo NOVO de atributo sem entrada em `ATTRIBUTE_TYPES` quebra o
  filtro com erro de sintaxe SQL (não "não acha nada") — a entrada é obrigatória no mesmo commit.

> **Contatos — busca parcial por nome/ID externo:** no `POST /contacts/filter`, os campos `name` e
> `identifier` aceitam `contains` / `does_not_contain` (match parcial, case-insensitive). Use isso
> pra "contatos cujo nome contém X" sem precisar do valor exato.

## Formatos de Data

### Quando enviar (input)

- **Preferir ISO 8601 com timezone:** `"2026-05-18T14:32:00-03:00"`
- **Unix timestamp em segundos** funciona em endpoints de reports
- Datas sem timezone → assumido `America/Sao_Paulo`

### Quando receber (output)

- Campos `*_at` (created_at, updated_at): ISO 8601 com timezone
- Campos `last_activity_at`, `waiting_since`: **Unix timestamp em SEGUNDOS** (não milissegundos)
- Sempre confira: se número, é Unix; se string, é ISO

### Timezone

- Default: `America/Sao_Paulo` (UTC-3, sem DST atualmente)
- A CONTA tem fuso próprio (2026-07-21): Configurações > Conta, gravado em
  `custom_attributes.timezone` (IANA, ex. `America/Manaus`) via atualização da conta —
  vem no topo do payload da conta (`timezone`). Caixas novas e o FlowBuilder herdam.
  Valor inválido é DESCARTADO em silêncio — confirme com um GET depois de gravar.
- Pra evitar bugs, sempre passe timezone explícito

### Custom attributes de data/hora — formato canônico (2026-07-06)

- Atributo tipo `date`: valor canônico é **data pura ISO** `"YYYY-MM-DD"` (sem hora/fuso).
  Os atributos de integrações (`lt_first_visit_at`/`lt_last_visit_at`, `ca_invoice_created_at`/
  `ca_invoice_updated_at`, os 6 `omie_*` de data, `booking_date`, `eclinica_*_data`) passaram a
  gravar nesse formato — comparações `greater_than`/`less_than` em filtro/condição funcionam.
  Registros gravados ANTES de 06/07/2026 podem estar no formato antigo (timestamp completo ou
  `DD/MM/AAAA`) até os rakes de backfill rodarem.
- Atributo tipo `time` (**Hora, novo**): valor canônico é `"HH:MM"` **24h** (ex: `"14:30"`),
  SEM data e SEM fuso embutido — o fuso mora na definição do atributo (`attribute_timezone`,
  escolhido na criação, default `America/Sao_Paulo`).
- Atributo tipo `datetime` (**Data e Hora, novo 2026-07-18**): valor canônico é **ISO 8601 com
  offset do fuso do atributo**, ex. `"2026-07-18T14:55:00-03:00"`. O fuso mora na definição
  (`attribute_timezone`, default `America/Sao_Paulo`) e define o offset gravado. Um "porteiro" no
  backend NORMALIZA qualquer entrada na escrita (UTC `Z`, outro offset, `DD/MM/AAAA HH:MM` BR,
  AM/PM, unix timestamp) pro fuso do atributo — você pode gravar em vários formatos que ele
  converte. Exibição humana (mensagens, painel): `"DD/MM/AAAA - HH:MM"`. Em condições/filtros o
  valor comparado é o ISO cru (não formatado). Diferença dos 3: `date`(5)=`"YYYY-MM-DD"` dia
  literal sem fuso; `time`(9)=`"HH:MM"` só hora; `datetime`(10)=data+hora ISO com offset.

## Códigos HTTP

### Sucesso

| Código | Significado |
|---|---|
| `200` OK | Sucesso, body com dados |
| `201` Created | Recurso criado, body com o novo recurso |
| `202` Accepted | Aceito pra processamento async (Sidekiq) |
| `204` No Content | Sucesso sem body (ex: DELETE) |

### Erros do cliente

| Código | Significado | O que fazer |
|---|---|---|
| `400` Bad Request | Parâmetros mal formados | Confira sintaxe |
| `401` Unauthorized | Token inválido ou expirado | Reporte ao usuário (não retente) |
| `403` Forbidden | Sem permissão (papel insuficiente) | Reporte (não retente) |
| `404` Not Found | Recurso não existe (ou de outra conta) | Confira ID |
| `422` Unprocessable Entity | Validação falhou | Leia mensagem, corrija |
| `429` Too Many Requests | Rate limit | Espere 60s antes de retentar |

### Erros do servidor

| Código | Significado | O que fazer |
|---|---|---|
| `500` Internal Server Error | Erro inesperado | Retente 1x com backoff |
| `502/503/504` | Servidor indisponível | Retente com backoff exponencial |

## Tratamento de erros padrão

Body de erro típico:

```json
{
  "error": "Validation failed",
  "errors": {
    "name": ["can't be blank"]
  }
}
```

Ou simples:

```json
{
  "error": "Conversation not found"
}
```

Ou com código:

```json
{
  "error_code": "agent_no_funnel_access",
  "message": "Agente sem acesso ao funil"
}
```

## Idempotência

| Método | Idempotente? | Significado |
|---|---|---|
| `GET` | ✅ Sim | Pode retentar livremente |
| `HEAD` | ✅ Sim | Idem |
| `PUT`, `PATCH` | ✅ Sim | Atualizar 2x dá mesmo resultado |
| `DELETE` | ✅ Sim | Apagar 2x → primeiro OK, segundo 404 (ainda idempotente em efeito final) |
| `POST` | ❌ Geralmente NÃO | Criar 2x cria 2 registros |

**Estratégia:** GET pode retentar. POST que falha → confirmar via GET se foi criado antes de retentar.

## Rate Limiting

| Limite | Padrão | Janela |
|---|---|---|
| Por IP global | 3000 reqs | 1 min |
| Por token API (writes) | 600 reqs | 1 min |
| Por token API (reads) | 1200 reqs | 1 min |
| Loop detection | 10 reqs idênticas | 10 seg |

Quando rate-limited:
- Status `429 Too Many Requests`
- Header `Retry-After` indica em quantos segundos voltar

**NÃO entre em loop de retry.** Espere o tempo, retente 1x. Se falhar de novo, reporte.

## Endpoints especiais

### Bulk actions

`POST /bulk_actions` aceita arrays de IDs. **Máximo 300 IDs por chamada** (`MAX_BULK_IDS`, desde
2026-05-15). Acima disso o servidor recusa com `422` + `code: "bulk_ids_limit_exceeded"` — quebre em
chamadas de 300.

**Exceção:** contato com `select_all: true` (agir sobre TODOS os contatos do filtro) **não tem teto** —
o servidor resolve pelo próprio filtro (`query` / `labels_filter`), em lotes no fundo, e não usa `ids`.

```json
{
  "type": "Conversation",
  "ids": [1, 2, 3, ...],          // max 300
  "fields": { "assignee_id": 6 }  // conversa: status, assignee_id, team_id, inbox_id, captain_assistant_id
}
```

**⚠️ `action_attributes` NÃO EXISTE.** O servidor não lê esse campo em lugar nenhum (só aparece em
comentário de TODO no código). Mandar a mudança por ali devolve **200 OK e não faz absolutamente nada** —
falha silenciosa, sem erro na tela. Conversa se altera por `fields` (+ `labels: {add:[], remove:[]}` e
`snoozed_until`). Em conversa o `action_name` é **ignorado**; ele só tem efeito em **contato**, onde
`"delete"` apaga os contatos (sem ele, o que vale é `labels: {add: []}`).

### Search (overhaul 2026-06-10)

`GET /search?q=texto` — busca cross-entidade (conversations, contacts, messages, articles, kanban_items)

`GET /search/contacts?q=texto` — só contatos (idem `/search/conversations`, `/search/messages`, `/search/articles`, `/search/kanban_items`)

**Multi-termo com E:** `q` aceita String (espaços = AND implícito) ou Array (`q[]=joao&q[]=silva`),
cap de 5 termos — cada termo precisa bater (cada um mantém seu OR entre campos).

**PISO DE 3 LETRAS (novo 2026-08-04) — leia antes de concluir "não existe".**

Termo com LETRA precisa de **3 caracteres ou mais**. Termo **só de dígitos** é isento (é assim
que se busca pelo número da conversa ou do card, e conta nova tem todos com 1-2 dígitos).

| Busca | O que acontece |
|---|---|
| `q=Bo` | Devolve **vazio**. Não é erro, não é 422 — vem `payload: []` |
| `q=Bor` | Busca normal |
| `q=42` | Busca normal (só dígitos, isento) |
| `q=jo silva` | Vale: basta **um** termo utilizável na frase |
| `q=zq` + `contact_filters=[...]` | Vazio. O termo curto **invalida a busca inteira**, mesmo com filtro junto |

Vale nas CINCO buscas (contato, conversa, mensagem, card e artigo).

**Consequência prática:** resultado vazio com termo de 1-2 letras **não significa que o registro
não existe** — significa que a busca não rodou. Nunca responda "não encontrei esse contato" nessa
situação. Ou complete o termo, ou pergunte o nome inteiro, ou use `/contacts/filter` com
`filter_operator: "contains"`, que não tem esse piso.

Sem `q` e só com filtros estruturados continua funcionando normalmente (contrato antigo, busca só
por condições) — o piso só descarta termo de texto curto, não o pedido inteiro.

**Busca cadastral:** CPF/CNPJ/RG/endereço/profissão entram na busca de contatos e conversas, com
match por dígitos que ignora pontuação (`31.104.475/0001-51` == `31104475000151`; mín 3 dígitos).
Telefone idem. Cards do Kanban são achados pelo contato/conversa vinculados.

**Filtros estruturados:** params `conversation_filters`, `contact_filters`, `kanban_filters`
(JSON-string na query) aplicam condições no mesmo formato dos endpoints `/filter` — mesma
validação (allowlist de chaves, operadores por tipo, cap 10 condições). Payload inválido = 422.

```
GET /search/conversations?q=pix&conversation_filters=[{"attribute_key":"status","filter_operator":"equal_to","values":["open"]}]
```

### Filtro de contatos por registros vinculados (2026-06-10)

`POST /contacts/filter` ganhou 3 chaves novas que acham o CONTATO pelo que aconteceu com ele:
- `conversation_search` — por conversa vinculada (status/etiquetas/caixa)
- atributos da conversa — condição com `custom_attribute_type: "conversation_attribute"`
- `kanban_card` — por card vinculado (funil/etapa/prioridade/status)
Combináveis com E/OU e salváveis como segmento (custom_filters).

### Exportação de contatos (2026-06-10)

`POST /contacts/export` (chega por e-mail) agora sai COMPLETO: cadastral achatado (16 colunas),
etiquetas, empresa/cidade/país, atributos do contato e da conversa (prefixos contato_/conversa_),
última conversa (nº/status/caixa/responsável/etiquetas/data) e card Kanban (funil/etapa/prioridade/
status/valor). Filtros/segmento aplicados valem na exportação. Passar `column_names` explícito
mantém o comportamento antigo (só as colunas pedidas).

### Limites de upload

`GET /upload_limits` retorna o teto em MB por tipo (`image`, `video`, `audio`, `document`,
`fallback`). Consulte 1x antes de subir anexo grande — evita 422 no meio do fluxo.

**Desde 15/08/2026 o TIPO não rejeita mais anexo de mensagem** — a validação passou a ser só de
tamanho. Tipo sem balde próprio (nem imagem, nem vídeo, nem áudio) cai no balde de **documento**,
que é o maior. Ou seja: `upload_limits` continua sendo a única fonte dos tetos, mas a resposta
"esse formato não é aceito" deixou de existir nesse caminho. Os caminhos que **continuam** com
lista fechada de tipos são o upload por URL (`/upload` com `#validate`, usado no teste de mídia do
FlowBuilder) e o chat interno da equipe.

### Webhooks de saída — evento novo (2026-06)

`inbox_updated` entrou na lista de eventos assináveis (`webhooks_create/update`): dispara quando
uma caixa de entrada é autorizada/reautorizada. Entrega só pra quem assinou o evento.

### Webhook Universal (entrada) — arrays no mapeamento (2026-06)

O `field_mapping` do webhook personalizado aceita caminhos com índice de array:
`messages.0.content`, `itens.1.sku`. Limites do achatamento: profundidade 5, 10 itens por array,
500 chaves no total. O mapeamento é POSICIONAL — se a ordem do array variar entre eventos, o
mesmo caminho captura valores diferentes. Campo `flow_id` na criação liga o webhook a um flow
(webhook embutido — ver resource de fluxos).

### Import de histórico do WhatsApp Cloud (2026-06)

Caixas WhatsApp Cloud API podem importar o histórico de conversas via QR Code. Tools sob
`/inboxes/:inbox_id/whatsapp_history`:

- `lionchat_inboxes_whatsapp_history_start` — `POST` com param `days` (quantos dias de histórico
  puxar). Inicia o processo.
- `lionchat_inboxes_whatsapp_history_status` — `GET`, retorna `{state, qr, days, progress, stats,
  error}`. Estados na ordem: `idle` → `scan_qr` → `importing` → `migrating` → `cleaning` →
  `done` (ou `failed`). Quando `state = scan_qr`, o campo `qr` traz o código pra escanear.
- `lionchat_inboxes_whatsapp_history_cancel` — `POST`, aborta o import em andamento.

**Gates:** admin-only + feature flag `qr_history_import`. SÓ funciona em caixa WhatsApp Cloud API
(`Channel::Whatsapp`) — não confundir com a importação de histórico do WAHA (QR Code não-oficial),
que é outro mecanismo.

### Ver histórico anterior do contato (2026-06)

Dentro de uma conversa há um botão que mostra as CONVERSAS ANTERIORES do mesmo contato NA MESMA
caixa. Não há endpoint novo pra isso — pra reproduzir via API, liste as conversas do contato
filtrando pelo `inbox_id` (`conversations_list` / `conversations_filter` por contato + caixa).

## Headers úteis pra mandar

- `Accept: application/json` (sempre)
- `Content-Type: application/json` (ao mandar body)
- `User-Agent: nome-da-IA` (ajuda no debug do nosso lado)

## Headers úteis pra ler na resposta

- `X-Total-Count`: total de itens (em listagens)
- `Link`: paginação cursors (RFC 5988)
- `X-RateLimit-Remaining`: quantas chamadas restam no minuto
- `X-RateLimit-Reset`: timestamp Unix de reset

## Endpoints públicos vs autenticados

### Públicos (sem token)
- `/api/v1/widget/*` — widget de chat ao vivo (auth via `website_token` query)
- `/api/v1/inboxes/:inbox_identifier/contacts/*` — API pública pra criar contatos (Client API)
- `/api/v1/booking/:public_id` — agendamentos públicos

### Privados (token obrigatório)
- Todo o resto em `/api/v1/accounts/:account_id/*`

Pra você via MCP: você sempre tem token. Os endpoints públicos raramente são úteis no seu fluxo.

## Versionamento

- `/api/v1/*` — estável, breaking changes em V2 hipotético
- `/api/v2/*` — funcionalidades novas / breaking changes (poucas hoje: reports principalmente)

## Lições importantes

1. **Sempre escopa por account_id** — esse é o filtro mais importante. Não pule.
2. **Use endpoints específicos sobre genéricos** — `lionchat_conversations_search` é melhor que listar tudo e filtrar.
3. **Trate erros gracefully** — não retente 401/403/422 (são erros permanentes). Retente só 5xx e 429 com backoff.
4. **Cache não existe na API** — toda chamada hit no banco. Se chamar 100x a mesma coisa, pesa.
5. **`per_page` MAX é 100** — independente do que você pedir. Server-side clamp.
