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
| Distribuir aleatório entre branches | `randomizer` | - |
| Atualizar info de grupo WhatsApp (WAHA) | `update_group` | - |
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
    "triggers": [
      { "type": "message_received", "keywords": ["oi", "ola"], "match_type": "contains" }
    ]
  }
}
```

**Triggers válidos:** `message_received`, `message_sent`, `conversation_created`, `conversation_resolved`, `conversation_reopened`, `label_added`, `label_removed`, `card_created`, `card_moved`, `conversation_attribute_changed`, `card_attribute_changed`, `cron`, `webhook`.

**Trigger `message_sent` (novo 2026-06-11):** par do message_received, mas pra mensagens de SAÍDA — dispara quando atendente, celular (eco do WhatsApp) ou a própria IA/flow envia mensagem (nota privada NÃO dispara). Config: `keywords` (opcional) + `match_type` (`contains`|`exact`). Caso de uso clássico: "quando eu responder do celular, desligar a IA". ATENÇÃO: mensagem da IA também dispara — se a ação for desativar a IA, use keywords que só humanos digitam ou aceite que a primeira resposta da IA aciona o flow. Protegido por anti-loop (profundidade 5) e sessão única por conversa+flow; nunca alimenta `waiting_input`.

**Campos de filtro por trigger (IMPORTANTE — nomes exatos):**
- `message_received`: `keywords` (array, obrigatório, cada termo com mín 3 chars) + `match_type` (`'exact'` ou `'contains'`, default `contains`). NÃO use `match_mode` aqui. Dispara em QUALQUER mensagem do cliente que case (não só na primeira) — só mensagem de cliente dispara, nunca de agente.
- `conversation_created` / `conversation_reopened`: filtro opcional de keywords via `match_mode` (`'any'`, `'contains'`, `'exact'`, `'customer_initiated'`, `'agent_initiated'`) + `keywords`. Só ESTES dois triggers usam `match_mode`.
- `label_added` / `label_removed`: `label_names` (array de slugs). NÃO use `label` (singular) — é ignorado.
- `card_created` / `card_moved`: `funnel_ids` (array de STRINGS, ex.: `["37"]` — número puro `[37]` NÃO casa) + `funnel_stages` (array de `"funnel_id:chave_da_etapa"`, ex.: `"37:agendamento_pendente"`). A `chave_da_etapa` é a CHAVE INTERNA da etapa no funil (slug legível em funis de template; pode ser um UUID/`stage_<n>` em etapa criada à mão ou funil duplicado) — NÃO o nome exibido na tela. Sem `funnel_ids` → dispara em qualquer funil; com `funnel_ids` mas sem `funnel_stages` → qualquer etapa daquele(s) funil(is). O card precisa estar num funil listado em `funnel_ids` pra o filtro de etapa valer. ATENÇÃO: dois flows ATIVOS na mesma inbox com `card_created`/`card_moved` de funil/etapa sobrepostos são bloqueados na criação/ativação (ver `flow_trigger_conflict` no fim deste guia).
- `conversation_attribute_changed` / `card_attribute_changed` (novo 2026-07-08): disparam na VIRADA de um atributo (da CONVERSA ou do CARD do kanban) pro valor que casa — RE-ENTRAM toda vez que o atributo muda pro valor alvo. Config: `{ "logic": "and"|"or", "rules": [ { "attr_key": "...", "operator": "...", "value": "..." } ] }` (uma rule pode usar `values: [...]` no lugar de `value` pra multi-valor). O `attrSource` é IMPLÍCITO pela chave do gatilho (conversa vs card) — NÃO informe. Operadores (contexto REATIVO — desde 09/07 `is_empty`/`is_not_empty` NÃO valem aqui, pois "está vazio AGORA" dispararia a cada evento; use-os só no nó Condição): `equal`/`not_equal`/`contains`/`not_contains`/`starts_with`/`ends_with`/`greater_than`/`less_than`/`number_range`. Só `card_attribute_changed` aceita `funnel_id`/`card_source` opcionais dentro da rule (pra achar o card). Rule sem `attr_key` é ignorada.

**Trigger `webhook` — Webhook Universal EMBUTIDO (novo 2026-06):** o flow pode ser disparado por um webhook próprio, criado automaticamente. Receita via API:
1. Criar o flow normalmente (`flows_create`).
2. `POST /custom_webhook_integrations` com `{ "custom_webhook_integration": { "flow_id": <id do flow> } }` — o sistema cria a integração embutida (idempotente: repetir retorna a mesma; nome automático "Flow: <nome>"; auto-mapeia todos os eventos → este flow) e retorna a URL única do webhook.
3. No node `start`, adicionar item `{ "type": "webhook_received", "config": { "integration_id": <id da integração> } }`.
4. Salvar o flow (`flows_update`) — o save sincroniza a ativação do webhook embutido (remover o item desativa a integração automaticamente).
Webhooks embutidos NÃO aparecem na listagem de integrações standalone; excluir o flow destrói o webhook; duplicar o flow NÃO copia o gatilho embutido. Rate limit do endpoint público: 60/min por token.

**TRAVA DE GATILHO DUPLICADO (2026-06-16) — leia ANTES de ativar/criar flow ativo:** o sistema BLOQUEIA ter dois flows ATIVOS com o MESMO gatilho na MESMA inbox e mesmo `conversation_mode` (evita o evento disparar dois flows). Colisão = mesmo tipo de gatilho + config cruzando (mesmas keywords/funil/labels/url/etc) + inbox compartilhada + mesmo modo. EXCEÇÕES que podem coexistir: `webhook_received` e `manual_trigger`.
- Ao **ativar** (`flows_toggle` inativo→ativo) ou **criar já ativo**: qualquer conflito é barrado.
- Ao **editar** um flow já ativo: só conflito NOVO é barrado (duplicados que já existiam são preservados).
- A API responde **422** com `{ "error_code": "flow_trigger_conflict", "conflicts": [{ flow_id, flow_name, trigger_type, inbox_id, inbox_name }] }`.
- Existe `POST /flows/check_conflicts` (mesma assinatura, NÃO salva) pra checar antes.

**Como a IA deve agir:** antes de ativar um flow, confira via `flows_list` se já não há outro flow ativo no mesmo gatilho+inbox. Se receber 422 `flow_trigger_conflict`, NÃO fique reativando — EXPLIQUE o conflito ao usuário (nome do flow conflitante + caixa) e ofereça desativar o outro flow ou ajustar o gatilho/keywords.

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
      { "id": "m2", "type": "delay", "seconds": 2 },
      { "id": "m3", "type": "whatsapp_template", "templateId": 123, "params": ["valor1"] }
    ]
  }
}
```

**Tipos de item válidos:** `text`, `whatsapp_template` (ou `template`), `canned_response`, `user_input` (pausa esperando resposta livre), `delay`, `attachment`, `audio`.

**ATENÇÃO:** usa `messageItems` (NÃO `items`).

**Botões interativos:** um item `text` com `buttons_enabled: true` e `buttons: [{ title, value }, ...]` vira mensagem com botões. Ao clicar, o flow roteia pelo handle **`button_<value>`** (ex: botão com `value: "sim"` → handle `button_sim`). Se o cliente digitar texto livre em vez de clicar, cai no handle **`no_response`**. Se houver timeout configurado, cai em **`no_reply_timeout`**.

```json
{ "id": "m1", "type": "text", "content": "Confirma o agendamento?",
  "buttons_enabled": true,
  "buttons": [ { "title": "Sim", "value": "sim" }, { "title": "Não", "value": "nao" } ] }
```
→ edges: `sourceHandle: "button_sim"`, `sourceHandle: "button_nao"`, e opcionalmente `"no_response"`.

**Handles que SAEM:** `success` (sem botões); com botões → `button_<value>` (um por botão) + `no_response` + `error`.

**Timeout dos botões (opcional, no MESMO item de botões):**
- `buttons_timeout` (número) + `buttons_timeout_unit` (`"minutes"` | `"hours"` | `"days"`) → tempo de espera sem resposta. Só com `buttons_timeout > 0` existe o handle `no_reply_timeout`.
- `buttons_timeout_action`: `"advance"` (padrão) | `"remind"`.
  - `"advance"`: ao esgotar o tempo, segue o handle `no_reply_timeout` (ex: manda pro atendimento humano).
  - `"remind"`: manda UM lembrete (`buttons_reminder_text`) e CONTINUA aguardando o clique no MESMO menu; se ainda não responder, segue o `no_reply_timeout`. O clique (no menu original OU no lembrete) continua o flow normalmente.
- `buttons_reminder_text` (string) → texto do lembrete (só no modo `remind`; vazio = reenvia o conteúdo original).
- **REGRA do modo `remind`:** `buttons_timeout_unit` NÃO pode ser `"days"` e horas ≤ 23 — o lembrete precisa caber na janela de 24h do WhatsApp oficial. No modo `"advance"`, qualquer unidade/valor é permitido.

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

**Timeout AGORA dispara de verdade (corrigido 2026-06-09):** `waitTime` + `waitUnit` agendam o estouro — se o cliente não responder no prazo, o flow segue pelo handle `timeout`. Antes dessa data o backend ignorava o waitTime (flows antigos que dependiam do timeout passaram a funcionar). Sempre ligue um edge no handle `timeout` quando definir waitTime; sem edge, o flow simplesmente para ali no estouro.

**REGRA:** depois de wait_response com `options` OU `varied_options`, NUNCA coloque node `condition` pra ramificar — ligue os edges direto nos handles `option_X` (em `varied_options`, `X` é o `id` do grupo).

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
| `greater_than` / `less_than` | comparação numérica |
| `number_range` | faixa; `value` no formato `"min-max"` (ex `"10-50"`) |
| `has_length` | comprimento exato (`value` = número) |
| `is_number` / `is_letter` / `is_email` / `is_phone` | validação de formato |
| `regex` | padrão regex em `value` |
| `equal_any` / `not_equal_any` / `contains_any` | multi-valor (usa `values` array) |
| `business_hours` / `outside_business_hours` | horário comercial (par: dentro/fora). `business_hours` aceita `start_hour`/`end_hour` (0-23), `days` (array 0=Dom..6=Sab, ausente=todos) e **`timezone`** (IANA, ex.: `America/Sao_Paulo` — default se ausente). **REGRA:** a saída `outside_business_hours` HERDA `start_hour`/`end_hour`/`days`/`timezone` da `business_hours` ANTERIOR no array — pode deixá-los ausentes na "fora" (o backend preenche). O horário é avaliado no `timezone` (não em UTC) |
| `can_reply` / `can_reply_closed` | janela 24h aberta/fechada |
| `conversation_has_agent` / `conversation_no_agent` / `conversation_not_agent` | agente atribuído |
| `contact_has_label` / `contact_no_label` / `conversation_has_label` / `conversation_no_label` | labels |
| `kanban_exists` / `kanban_in_stage` / `kanban_won` / `kanban_lost` | card no funil. `funnel_id` é CHAVE SEPARADA da condição (número, ex.: `"funnel_id": 37`). A etapa vai em `value` (slug puro da etapa, ex.: `"avaliacao_aceita"`) ou em `stage` — NÃO no formato `"37:etapa"`. Ex.: `{ "operator": "kanban_in_stage", "funnel_id": 37, "value": "avaliacao_aceita" }` |
| `card_attr_equals` / `card_attr_contains` | atributo do card (`attrSource: 'card'` + `attr_key`; aceita `card_source: 'trigger'` p/ ler o card que iniciou o flow) |
| `pagetrack_visited` / `pagetrack_event` | LionTrack |
| `sla_check` | status do SLA da conversa (usa `value` = código fixo; ver abaixo) |

**Restrição por TIPO de atributo (a UI só oferece um subconjunto, e é o que faz sentido):**
- **Texto/string:** `equal`, `not_equal`, `contains`, `not_contains`, `starts_with`, `ends_with`, `is_empty`, `is_not_empty`
- **Número:** `equal`, `not_equal`, `greater_than`, `less_than`, `number_range`, `is_empty`, `is_not_empty`
- **Lista/Data:** `equal`, `not_equal`, `contains`, `not_contains`
- **Hora (`time`, novo 2026-07-06):** tratado como texto nas condições (`equal`, `not_equal`, `is_empty`, `is_not_empty`); valor canônico `"HH:MM"` 24h. Comparação maior/menor NÃO é suportada pra Hora — o uso principal desse tipo é alimentar o campo Horário do node `wait` (modo date, `waitTimeMode: "variable"`).

Use operador numérico (`greater_than`, `less_than`, `number_range`) SÓ em atributo de tipo número.

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
| `assign_agent` | `{ agent_id }` | Atribui agente humano à conversa. `agent_id` aceita id fixo OU variável Liquid — ver nota abaixo |
| `distribute_agents` | `{ agents: [{ agent_id }], dist_id }` | RODÍZIO (round-robin) de agentes: cada lead vai pro PRÓXIMO da lista na vez (1,2,3,1,2,3). `dist_id` = id fixo da ação (chave do cursor no Redis; gere um único por ação, ex. `"d_ab12cd"`). Ordem da lista = ordem do rodízio; sem porcentagem. DIFERENTE do randomizer mode `distribute_agents` (que é sorteio ponderado) |
| `assign_team` | `{ team_id }` | Atribui time. `team_id` aceita id fixo OU variável Liquid — ver nota abaixo |
| `change_status` | `{ status: 'open' \| 'resolved' \| 'pending' \| 'snoozed' }` | Muda status da conversa |
| `change_priority` | `{ priority: 'urgent' \| 'high' \| 'medium' \| 'low' }` | Muda prioridade |
| `add_label` | `{ labels: ['slug1', 'slug2'] }` | Adiciona labels ao CONTATO |
| `remove_label` | `{ labels: ['slug'] }` | Remove labels do CONTATO |
| `add_conversation_label` | `{ labels: ['slug'] }` | Adiciona labels à CONVERSA (não ao contato) |
| `remove_conversation_label` | `{ labels: ['slug'] }` | Remove labels da CONVERSA |
| `mute_conversation` | `{}` | Silencia notificações |
| `add_private_note` | `{ content: 'texto' }` | Adiciona nota interna |
| `create_kanban_item` | `{ funnel_id, funnel_stage, title?, description? }` | Cria card no Kanban — `funnel_id` e `funnel_stage` OBRIGATÓRIOS; `title`/`description` aceitam variáveis `{{ }}` |
| `move_kanban_item_to_stage` | `{ funnel_stage }` | Move card (precisa ter card vinculado) |
| `move_kanban_stage` | `{ funnel_id, funnel_stage }` | Idem |
| `set_kanban_item_status` | `{ status: 'won' \| 'lost' \| 'active' }` | Marca status do card |
| `set_won` | `{}` | Atalho pra ganho |
| `set_lost` | `{ reason? }` | Atalho pra perdido |
| `assign_agent_card` | `{ agent_id }` | Atribui agente ao card |
| `add_card_note` | `{ content }` | Nota no card |
| `add_card_checklist` | `{ template_id, funnel_id?, card_source? }` | Aplica um MODELO de checklist ao card (vira um grupo). `template_id` de `kanban_config.checklist_templates`. Um modelo por bloco (repita o bloco pra mais de um) |
| `add_card_offer` | `{ offer_id, use_custom_value?, custom_value?, funnel_id?, card_source? }` | Adiciona uma OFERTA (produto/serviço) ao card. `offer_id` de `offers_list`. `use_custom_value: true` + `custom_value` grava um valor personalizado na oferta; senão usa o valor cadastrado. O total do card recalcula sozinho (soma das ofertas). Respeita `card_source` (funnel só localiza o card) |
| `send_webhook` | `{ url, headers?, body? }` | Dispara webhook externo |
| `start_flow` | `{ flow_id }` | Inicia outro fluxo |
| `deactivate_flow` ou `disable_flow` | `{}` | Encerra fluxo atual |
| `update_attribute` | `{ attr_source: 'contact'\|'conversation'\|'card', attr_key, attr_value }` | Seta custom_attribute (ver abaixo) |
| `assign_captain` (ou `assign_captain_assistant`) | `{ assistant_id }` | Atribui IA Captain |
| `deactivate_captain` | `{}` | Tira a IA da conversa |

**Handles que SAEM:** `success`. Não tem handle `error` — falhas viram warning silencioso e o flow continua.

**`card_source` (blocos de card) — opcional:** as ações de card aceitam `card_source`: `'funnel'` (default — procura o card pelo `funnel_id`) ou `'trigger'` (usa o card que DISPAROU o flow, em flows iniciados por `card_created`/`card_moved`/`card_won`/`card_lost`). Com `'trigger'`, `funnel_id` deixa de ser obrigatório — EXCETO em `move_kanban_stage`/`create_kanban_item`, cujo funil/etapa são o DESTINO. Sem card-gatilho disponível, a ação é pulada (não cai no fallback de funil). Aplica-se a `move_kanban_stage`, `set_won`/`set_lost`/`set_open`, `assign_agent_card`, `add_card_note`, `add_card_checklist`, `add_card_offer`, `update_attribute` (com `attr_source: 'card'`) e às condições `card_attr_equals`/`card_attr_contains` (gravando `card_source` na própria regra).

**`update_attribute` — campos EXATOS:** `attr_source` (`'contact'`, `'conversation'` ou `'card'`), `attr_key` (nome do atributo), `attr_value` (valor). NÃO existem `entity`/`key`/`value` — esses são ignorados e não salvam nada.

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
`apiQueryParams`, `apiAuthType`/`apiAuthToken`, `apiTimeout`, `apiResponseVar` (nome da variável de saída).

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

**`aiMode` válidos:** `generate`, `intent`, `sentiment`, `extract`.

**OBRIGATÓRIO via API — `aiAssistantId`:** os modos `generate`/`intent`/`sentiment`/`extract`
EXIGEM um `aiAssistantId` válido (id de um assistente Captain da conta). Sem ele o nó SAI cedo
(`action: continue`) sem gravar nada — a variável de saída (`aiResponseVar`/`ai_intent`/`ai_sentiment`)
fica vazia e `{{ai_response}}` resolve vazio no nó seguinte. A tela do Flow Builder preenche esse id
pelo dropdown; um nó criado via API/MCP SEM `aiAssistantId` "não funciona" por isso. (Exceção: um modo
`generate` sem assistente cai no LLM cru da conta — mas o caminho recomendado é sempre informar
`aiAssistantId`.) A saída fica em `aiResponseVar` (default `ai_response`); `intent` também em
`ai_intent`, `sentiment` em `ai_sentiment`.

**Contexto da conversa:** campo `contextMessages` define quantas mensagens recentes a IA enxerga — valores válidos `25`, `50`, `75`, `100` (ampliado em 2026-06; antes o teto era ~20). Os modos `intent`/`sentiment`/`extract` rodam no motor contido (texto puro, sem persona nem ferramentas — mais barato e sem risco de vazamento); `generate` usa o assistente Captain.

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
    "waitTimezone": "America/Sao_Paulo"
  }
}
```

- `waitWeekday`: 0=domingo, 1=segunda... 6=sábado. `waitWeekdayTime` = `"HH:MM"` 24h, **SEMPRE fixo** (este campo NÃO aceita variável — decisão de produto). `waitTimezone` = mesmo campo do modo date.
- (Os nomes `targetWeekday`/`targetHour` NÃO existem — eram um erro de documentação antiga.)

**Handles que SAEM:** `success` (+ `error`, emitido apenas quando um campo em modo `variable` resolve pra valor inválido no modo `date`).

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
      { "id": "A", "label": "Variante A", "weight": 50 },
      { "id": "B", "label": "Variante B", "weight": 50 }
    ]
  }
}
```

**Modo `distribute_agents` (sorteio PONDERADO):** `data.mode: 'distribute_agents'` + `data.agents: [{ agent_id, percent }]` — sorteia UM agente por probabilidade (percentuais somando 100) e atribui automaticamente. Isso é SORTEIO, não rodízio: no curto prazo pode cair no mesmo agente várias vezes seguidas. Pra RODÍZIO EXATO (cada um na vez), use a AÇÃO `distribute_agents` no node `action` (ver seção 2.5) — não este modo.

**Handles que SAEM:** o `id` de cada branch (`A`, `B`, ...). Em `mode: 'distribute_agents'` é `success`.

### 2.11 `update_group` (WAHA apenas)

Atualiza nome/descrição/foto de grupo WhatsApp. Use só quando flow roda em inbox WAHA e a conversa for de grupo.

**Handles que SAEM:** `success`, `error`.

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

```json
{ "id": "node-end", "type": "end", "position": { "x": 1330, "y": 300 }, "data": { "label": "Retorno", "mode": "structured" } }
```

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
`start_flow`) — elas só valem em flow `conversation`. No `action` de um `ai_tool` use apenas keys
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
| Node `update_group` (Configurar Grupo: nome, foto, permissões — WAHA) | NÃO existe | **SÓ aqui** |
| Gatilhos e condições de **LionTrack** (visita de página / evento do site) | disponíveis | **NÃO** (grupo não tem um contato único navegando) |
| Todos os outros nodes (`send_message`, `wait_response`, `condition`, `action`, `api`, `ai`, `set_variable`, `wait`, `randomizer`, `note`, `end`) | iguais | iguais |

Regras práticas ao montar via API:
- Só use o node `update_group` se o flow foi criado com `conversation_mode: "group"`. Colocá-lo num flow
  individual é rejeitado pela validação.
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

---

## 2-D. Exit conditions (saída automática do flow)

`flow_data.exit_conditions` é um array no NÍVEL DO FLOW (irmão de `nodes`/`edges`, NÃO é um node). Se QUALQUER condição bater, o lead sai do flow NA HORA. Cada item tem `type`:

**Por evento:**
- `label_added` / `label_removed` — `{ "type": "label_added", "value": "<slug-da-label>" }`
- `conversation_resolved` — `{ "type": "conversation_resolved" }`
- `agent_assigned` / `team_assigned` — `{ "type": "agent_assigned", "value": "<id opcional>" }` (vazio = qualquer)
- `kanban_won` / `kanban_lost` — `{ "type": "kanban_won", "value": "<funnel_id opcional>" }`

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
Ligar edge num handle condicional inexistente = **aresta fantasma** (sai do nada no canvas, não roteia).

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
| operador numérico (`greater_than` etc) em atributo texto | UI não oferece; semântica errada | usar só em atributo número |
| inboxes em flow `ai_tool` | Validação rejeita | ai_tool não tem inboxes |
| `waitTime: "60"` (string) | Espera Integer | `waitTime: 60` |
| `inbox_ids` aninhado em `{flow:{...}}` | No MCP, achata-se sozinho | Passa `inbox_ids: [1, 2]` no nível raiz |
| Mais de 1 node `start` | Flow precisa ter exatamente 1 ponto de entrada | Só 1 |
| Node sem edge entrando (exceto start) | Node nunca executa | Confira que todo node não-start tem ao menos 1 edge target apontando pra ele |
| `flow_data` sem `nodes` ou sem `edges` | Estrutura inválida | Inclua sempre, mesmo que `edges: []` |
| `method`/`url`/`headers`/`body` no node api | Runtime NÃO lê → GET vazio (ou erro "URL not configured") | `apiMethod`/`apiUrl`/`apiHeaders`/`apiBody` |
| `{{env.X}}` no node api | Não existe → resolve vazio → 401 | `{{account.custom_attribute.X}}` (secret resolve só no node api) |
| `{{api_response.payload.campo}}` | `.payload` não existe → vazio | `{{api_response.campo}}` (o corpo fica direto sob a var); status em `{{api_response_status}}` |
| node `ai` via API sem `aiAssistantId` | Sai cedo, variável de saída vazia | Informe `aiAssistantId` (obrigatório em generate/intent/sentiment/extract) |
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
- [ ] Todo `edge.sourceHandle` é um handle que o node source EXPÕE NAQUELA config (sem handle condicional inexistente: `no_reply_timeout` só com timeout, `window_closed` só API oficial, `button_<value>`/`option_<x>`/`cond_N`/`intent_<name>` só se o botão/opção/condição/intent existir)
- [ ] Todo edge tem `source`, `target` e `sourceHandle`
- [ ] Todo `sourceHandle` é um handle real exposto pelo node source (seção 2)
- [ ] `channel_type` é classe Rails (`Channel::Waha` etc)
- [ ] `inbox_ids` (se enviado) tem inboxes do mesmo `channel_type`
- [ ] Não tem `condition` redundante depois de `wait_response` com `options`/`varied_options`
- [ ] `wait_response` que salva e-mail/telefone do contato usa a validação correspondente (`email`/`phone`)
- [ ] Antes de ATIVAR: nenhum outro flow ativo no mesmo gatilho+inbox+modo (senão vem 422 `flow_trigger_conflict`)
- [ ] Layout: nodes em ordem visual da esquerda pra direita, sem sobreposição
