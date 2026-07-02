# Boas Práticas — Uso Eficiente do MCP

Como usar o MCP do LionChat sem desperdiçar tokens, sem cair em rate limits, e com respostas precisas.

## Princípio geral: liste resumido, leia detalhado quando precisar

Errado: pegar TODAS conversas + TODAS mensagens de cada uma logo de cara.

Certo:
1. `conversations_list` com filtros e `page=1` (paginado) → vê IDs + última mensagem
2. Identifica candidatas (5-10 conversas)
3. `conversations_messages_list` SÓ para as relevantes

Resultado: 10x menos tokens.

## Use filtros sempre que possível

A maioria dos endpoints aceita parâmetros pra filtrar antes de retornar:

| Endpoint | Filtros úteis |
|---|---|
| `conversations_list` | `status` (open/resolved), `assignee_type`, `inbox_id`, `team_id`, `labels`, `q` (busca) |
| `contacts_list` | `q` (nome/email/telefone), `include_contact_inboxes` |
| `messages_search` | `q`, `file_type[]`, `private_only`, `page` (busca dentro de UMA conversa) |
| `kanban_items_list` | `funnel_id`, `funnel_stage`, `assigned_agent_id` |
| `reports_list_*` | `since`, `until`, `metric`, `type` |

**Dica:** sempre filtre por período (`since`/`until`) em relatórios — sem isso pode trazer anos de histórico.

## Paginação

Endpoints listáveis paginam em geral 25 itens. Use `page` parameter:

```
page=1 → primeiros 25
page=2 → próximos 25
```

Pra contar total, use `meta.total_count` (vem no response). Não tente "paginar até zerar" se já tem o total — pode ser milhões.

## Cache local mental

Quando ler dados que provavelmente não mudam na sessão:
- Lista de inboxes
- Lista de agentes
- Lista de times
- Custom attribute definitions
- Funnels

Faça UMA chamada e use a info por toda a conversa. NÃO refaça `agents_list` 10x.

## Use endpoints específicos > endpoints genéricos

Quando existir endpoint específico, prefira:

| Errado | Certo |
|---|---|
| `reports_list` filtrando manualmente | `reports_list_2` (já é "conversations_metrics") |
| `conversations_list` + filtro de unread no cliente | `conversations_list` com `assignee_type=me&status=open` |
| `messages_list` percorrendo conversas | `conversations_messages_search` com `q=...` |

## Economia em conversas com muitas mensagens

Conversa com 200 mensagens? **Não baixe tudo**:

1. `conversations_show` (1 chamada) → metadata + última mensagem
2. Se precisa contexto: pegue só as últimas 20-30 mensagens com `conversations_messages_list` (use `page`)
3. Pra análise/resumo completo, use `conversations_messages_list` paginando — é a fonte do texto.

> **Atenção:** `conversations_transcript` NÃO retorna o texto da conversa pra você ler. Ele EXIGE o
> parâmetro `email` e apenas dispara um e-mail (via `ConversationReplyMailer`) com a transcrição —
> responde `head :ok`, sem corpo. Para LER ou RESUMIR uma conversa, use `conversations_messages_list`.

## Operações em massa

Pra atribuir labels, mover cards, etc em vários itens:
- `kanban_bulk_bulk_actions` (cards Kanban)
- `kanban_items_kanban_agents_create` em massa (passar array)
- `automation_rules_*` (criar regras em vez de fazer manualmente)

NÃO faça 50 PATCH requests individuais — bate rate limit.

## Rate limiting

LionChat tem rate limit por API token (fonte única: `api-conventions.md` → seção Rate Limiting):
- 1200 req/min para leitura (reads)
- 600 req/min para escrita (writes)
- Detecção de loop: 10 chamadas idênticas em 10 seg

Se receber `429 Too Many Requests`:
- Espere o `Retry-After` header
- Reduza concorrência
- Reavalie estratégia (provavelmente está fazendo loop ineficiente)

## Quando NÃO usar IA pra escrever mensagens

- Mensagens de cobrança / financeiras → use templates aprovados
- Confirmação de venda → template + variáveis
- Comunicação legal → revisão humana obrigatória

IA é boa pra: triagem, classificação, resumo, sugestão de resposta, análise.

## Botão de pânico: pausar/retomar AI Agente (2026-05-22)

Pra parar IMEDIATAMENTE um AI Agente (todas as conversas dele) sem perder configuração:

```
lionchat_captain_assistants_update id=<id> paused=true
```

O campo `paused` é **top-level** (não vai em `config`). Quando `true`:
- Jobs de resposta automática são curto-circuitados (não chamam o LLM)
- Follow-ups agendados não disparam
- Callbacks agendados são limpos

Pra reativar: `paused=false`. Toggle é auditado (`audited only: [:paused]`).

**Janela de inconsistência:** ~5-8s. Jobs que já estão dentro do LLM no momento da pausa enviam a resposta mesmo. Use o botão pra parar **novas** respostas, não pra cancelar uma que já saiu.

## Limite do prompt e cache OpenAI (2026-05-22)

- `config.instructions` (system prompt do agente) aceita até **20.000 caracteres** (antes 10k). Acima de 15k, o frontend mostra aviso "lost in the middle" — prefira colocar instruções críticas no início ou final.
- **Cache automático** ativo em todos os 15 modelos suportados (GPT-4.1 Nano até GPT-5.2 Pro, o1, o3, o4-mini). Desconto 50-75% no input cachado, sem configuração. Reuso do prompt do agente em múltiplas conversas maximiza a economia.

## Follow-up automático multi-etapa (2026-06)

O follow-up do AI Agente agora suporta **cadência de até 3 etapas** via `config.follow_up_steps`:

```json
{ "config": { "feature_follow_up": true, "follow_up_steps": [
  { "after_minutes": 30,  "prompt": "Pergunte gentilmente se ainda tem interesse" },
  { "after_minutes": 240, "prompt": "Ofereça tirar dúvidas" },
  { "after_minutes": 1140, "prompt": "Última tentativa, despeça-se cordialmente" }
] } }
```

Regras: cada etapa ≥ 5 min; soma total ≤ 1440 min (24h); máx 3 etapas. Campos legados
`follow_up_time` + `follow_up_prompt` continuam funcionando como 1 etapa única.
Dispara quando o CLIENTE fica inativo após resposta da IA. O motor de follow-up é dedicado e
**só-leitura** (não executa ferramentas, não coleta dado — só redige a mensagem de retomada,
com saída estruturada garantida). `paused=true` no assistente corta os follow-ups também.

## Guardrails e diretrizes de resposta (2026-06)

Dois arrays no assistente (top-level, fora do config):
- `guardrails`: limites DUROS — o que a IA nunca pode fazer (ex: "Nunca ofereça desconto",
  proteção anti-pitch: "Não faça discurso de vendas se o cliente só pediu informação").
- `response_guidelines`: estilo — como responder (ex: "Respostas curtas, sem emojis").

No UPDATE, esses arrays SUBSTITUEM o valor inteiro (não fazem merge) — leia antes, reenvie completo.

## Coleta de dados pela IA — regra DITO ≠ SALVO (2026-06)

Como a coleta de dados/cenários funciona hoje (importante pra diagnosticar "IA repergunta dado"):
- A IA salva cada dado NA HORA em que o cliente informa (não acumula pro final).
- O que vale é o que está PERSISTIDO no contato/conversa — "o cliente já disse" não conta
  enquanto não salvou (DITO ≠ SALVO). Se salvou, ela NÃO repergunta.
- Campo enviado no lugar errado é redirecionado (ex: CPF mandado como telefone vai pro cadastral).
- Cadastrais são imutáveis (primeira escrita vale) — ver data-model, seção Contatos.
- Cenários são instruções inline no prompt (sem troca de personagem); o raciocínio do cenário
  fica no "caderninho" da conversa (campo scenario_checklist, visível no card Raciocínio).
- Sem AI Agente ativo na conversa = NENHUMA resposta de IA (motor V1 aposentado em 2026-06).

## Cenários com parâmetro fixo e execução determinística (2026-06)

- O admin pode FIXAR o parâmetro de uma ferramenta no cenário (campo scenario.tool_bindings): quais mídias enviar, qual funil+etapa do card, quais agendas no agendamento. "Deixar a IA decidir" = binding vazio.
- Quando UM cenário fixa a tool, a execução vira determinística (a IA não escolhe): mídia e kanban são aplicados pós-turno pelo BindingResolver (ordem texto→ação, sem duplicar, idempotente); o agendamento força/restringe a agenda mas a IA ainda define data/hora.
- Via MCP: scenarios_create/update persiste binding de send_media_asset e create_kanban_item/move_kanban_item (re-escopados por conta). O binding de create_booking NÃO é aceito pela API — pra limitar agendas via MCP, use config.booking_event_type_ids no assistente (captain_assistants_update).
- Receita pra criar/editar cenário com binding via MCP (scenarios_create / scenarios_update): (1) o corpo vai SEMPRE embrulhado em `scenario`; (2) a instrução PRECISA mencionar a ferramenta como link markdown `[Rótulo](tool://slug)` — menção crua `(tool://slug)` NÃO conta e o binding é descartado no salvamento; (3) envie `tool_bindings` com o shape: `send_media_asset` → `{ "asset_ids": [Int] }`, `create_kanban_item`/`move_kanban_item` → `{ "funnel_id": Int, "stage": "<chave da etapa>" }`. Não precisa mandar `tools` (é auto-extraído da instrução e sobrescrito). `create_booking` NÃO entra em tool_bindings pela API.

## Variáveis {{ }} nas instruções do AI Agente (2026-06)

As instruções aceitam variáveis Liquid `{{ }}` que chegam JÁ PREENCHIDAS com os dados reais do contato/conversa do atendimento — vale pra instrução base do assistente (`config.instructions`) e pra instrução de cada cenário (`scenario.instruction`). O texto é gravado como está (sem sanitização); cap de 20.000 chars na base.

- Contato: `{{contact.name}}`, `{{contact.first_name}}`, `{{contact.last_name}}`, `{{contact.email}}`, `{{contact.phone}}`, `{{contact.cpf}}`, `{{contact.cnpj}}`, `{{contact.rg}}`, `{{contact.date_of_birth}}`, `{{contact.profession}}`, `{{contact.address.city}}` (e `.cep`/`.street`/`.number`/`.neighborhood`/`.state`...), `{{contact.custom_attribute.<chave>}}`.
- Conversa: `{{conversation.display_id}}`, `{{conversation.custom_attribute.<chave>}}`.
- Variável sem valor sai vazia (não quebra). Texto SEM `{{` sai idêntico (preserva o cache do prompt) — só use variável quando agregar.
- ATENÇÃO: variável de CONTA NÃO funciona aqui — `{{account.custom_attribute.<chave>}}` (slogan, endereço...) sai VAZIA dentro das instruções do AI Agente (o contexto só tem `contact` e `conversation`, proteção contra vazar secret). Pra um valor fixo da empresa no prompt, escreva o valor literal no texto.

## Conhecimento passivo da IA: FAQ + artigos (RAG) (2026-06)

- A IA já recebe no prompt a FAQ e os artigos da Central de Ajuda relevantes para a mensagem atual — automaticamente, sem chamar ferramenta. Só acontece quando há conteúdo cadastrado (FAQ/documento aprovado ou artigo publicado); sem conteúdo não gasta token nem embedding.
- As ferramentas "Buscar FAQ" e "Buscar Artigos" são auto-gerenciadas: ligam sozinhas conforme o conteúdo e somem da tela de ferramentas (não são desligáveis por disabled_tools). Diagnóstico "IA não usa a base": confira se há FAQ APROVADA/documento, ou artigo PUBLICADO na Central de Ajuda.
- A IA pode oferecer ao cliente o link do artigo (precisa de Portal com slug e domínio/FRONTEND_URL).

## Anti-loop de ferramentas (custo) (2026-06)

- Ferramentas (webhooks/custom tools e flows) que falham agora param sozinhas: a IA recebe aviso escalonado (1ª falha = no máximo 1 retry; 2ª+ da mesma tool = pare e siga sem ela ou transfira). Tetos por turno: 5 chamadas por ferramenta e 25 no total; ao estourar, a IA dá halt e cria nota mencionando um humano (sem desligar a IA).

## Copilot age na conversa (2026-06)

- O Copiloto do atendente tem motor próprio (modelo/temperatura da conta, padrão 0.3; prompt base em copilot_instructions), configurável em captain/copilot_settings (admin).
- Ele EXECUTA ações na conversa aberta, dentro da permissão do atendente: ações reversíveis (kanban, etiqueta, nota, prioridade, atribuir, resolver, contato) na hora; ações que falam com o cliente (mídia, agendar mensagem, agendamento) viram proposta que o atendente confirma/cancela. Histórico é por conversa.

## Automações: atributo de Conversa vs de Contato (2026-06)

Atributos customizados podem existir com o MESMO nome nos dois escopos (ex: utm_source).
Nas condições de automação, desambigue com `custom_attribute_type`:

```json
{ "attribute_key": "utm_source", "custom_attribute_type": "conversation_attribute",
  "filter_operator": "equal_to", "values": ["google"] }
```

Sem o tipo, o filtro pode bater no escopo errado. A UI mostra sufixo "(Conversa)/(Contato)".

## Meta Lead e CAPI (2026-06)

- Conexão Meta Lead agora é **por página selecionada** (a BM virou só rótulo — antes puxava todas
  as páginas da BM). O GET da integração traz `enrichment_active` e `pending_businesses` (BMs com
  pendência de permissão).
- Meta CAPI: o evento `InitiateCheckout` foi RENOMEADO para `begin_checkout`.

### Meta CAPI — moeda do valor (2026-06)

O disparo da conversão aceita `currency` (código ISO, ex: `BRL`, `USD`); default `BRL`. Dá pra
escolher a moeda no próprio disparo e também na config do funil (valor padrão herdado pelos cards
daquele funil). Sempre confirme a moeda com o usuário se o valor não for em reais.

### Meta Lead — resiliência da ativação e backfill (2026-06)

A ativação ficou tolerante a falhas — não trava mais por causa de um lead de exemplo (sample) com
formato estranho: o erro de sample é tolerado e a ativação segue. Outros ganhos de robustez:

- **Auto-retry de limite:** quando bate o rate limit da Meta, tenta de novo sozinho com espera, em
  vez de falhar de cara.
- **Botão "7 dias" (backfill):** puxa leads recentes que ficaram pra trás. Parâmetro `days` (default
  7, máximo 30). A resposta traz `mode`: `bulk` (puxa em lote pela API) ou `replay` (reprocessa
  eventos já recebidos). Recupera inclusive leads que tinham sido ignorados antes.
- **Sem `pages_manage_ads`:** funciona mesmo sem essa permissão específica da Meta.
- **Log legível** dos eventos (em vez de dump cru) e suporte a **múltiplas BMs**.

**Pro MCP:** ao acionar o backfill, informe ao usuário o `mode` retornado e quantos dias foram
puxados. Se a ativação reclamar de sample, NÃO é bloqueio — a integração ainda fica ativa.

## Campanhas: audiência acumulativa (2026-06)

`audience` aceita 3 tipos de seção combináveis: `Label`, `Funnel` (com stages/include_won/include_lost)
e `ConversationAttribute` ({key, value}). O campo `audience_mode` define a combinação ENTRE seções:
- `"sum"` (default): união — contato em QUALQUER seção entra
- `"all"`: interseção — contato precisa atender TODAS as seções preenchidas

SEMPRE rode `campaigns_estimate_audience` com o MESMO audience+audience_mode antes de criar a
campanha e mostre a contagem ao usuário — estimativa e disparo usam o mesmo motor (não divergem).

## Agendamento (booking): idempotência e limites (2026-06)

- Reservar o MESMO contato+evento+horário de novo retorna a reserva existente (não duplica) —
  retry de rede é seguro.
- Rate limit da reserva pública: 10/5min por IP + 20/min por conta (429 ao estourar).
- Todo agendamento aparece vinculado a uma conversa (cria/reusa a conversa do contato).

## Variáveis de conta (account_variables)

Pra dados fixos que se repetem (slogans, endereços, horários):
- `account_variables_create` UMA vez — campos: `attribute_display_name` (rótulo), `attribute_key` (a chave usada no `{{ }}`), `attribute_display_type` (`text`; use `secret` pra token/senha), `value`. Admin-only.
- Use em templates com a sintaxe COMPLETA `{{ account.custom_attribute.<attribute_key> }}` (ex: `{{ account.custom_attribute.slogan }}`). NÃO existe atalho `{{slogan}}` solto — sem o prefixo `account.custom_attribute.` não resolve.
- Resolve em: mensagens, respostas prontas, campanhas e automações. NÃO resolve nas instruções do AI Agente (base/cenário) — ali só `contact.*` e `conversation.*`.
- `secret` nunca aparece em template (sai vazio); só resolve em nós API Request do FlowBuilder.
- Atualiza UMA vez, propaga pra todo lugar.

Nunca hard-code esses dados em respostas geradas.

## Variável dinâmica: atributo do contato escolhe a variável da conta (2026-07)

Receita pra quando a mensagem precisa puxar um valor que DEPENDE de um campo do contato.
Exemplo clássico: contato tem `unidade_de_atendimento` (Sorocaba) e a mensagem deve trazer
o endereço DAQUELA unidade sem o atendente escolher nada.

A técnica é busca indireta (indirect lookup) em Liquid: montar o NOME da variável da conta
usando o VALOR do atributo do contato e buscar por colchete `account.custom_attribute[chave]`.

### Peças a criar (todas têm tool no MCP)

1. Atributo de contato tipo lista (`custom_attributes_create`): ex. `unidade_de_atendimento`
   com valores `sorocaba`, `tatuape`... (slugs limpos: sem acento, sem espaço).
2. Uma variável da conta por opção (`account_variables_create`), nomeada `prefixo_` + valor:
   `endereco_sorocaba`, `endereco_tatuape`...
3. Resposta pronta (`canned_responses_create`) usando a sintaxe abaixo.

### Sintaxe que funciona

```text
Seu atendimento será na unidade {{contact.custom_attribute.unidade_de_atendimento}}.
Endereço: {% assign chave = "endereco_" | append: contact.custom_attribute.unidade_de_atendimento | downcase %}{% echo account.custom_attribute[chave] %}
```

### Regras críticas (confirmadas no código)

- A parte dinâmica DEVE usar `{% assign %}` + `{% echo %}` (tags `{% %}`), NUNCA `{{ }}`:
  a caixa de mensagem substitui/apaga `{{ }}` desconhecido antes de enviar; tags `{% %}`
  passam intactas e o backend (Liquid 5) resolve na criação da mensagem.
- Variáveis simples conhecidas (ex. `{{contact.custom_attribute.unidade_de_atendimento}}`)
  podem ficar em `{{ }}` normalmente.
- Casamento da chave: o valor do atributo, em minúsculo, precisa bater EXATAMENTE com o
  final do nome da variável da conta (`sorocaba` -> `endereco_sorocaba`). Por isso os
  valores da lista devem ser slugs sem acento/espaço. O `| downcase` cobre maiúsculas,
  mas NÃO remove acento nem espaço.
- NÃO envolva o trecho Liquid em crase/backticks: código entre crases vira `{% raw %}`
  (não processa) — a mensagem sairia com o código literal.
- Variável da conta tipo `secret` sai VAZIA em mensagem (bloqueio de segurança; só resolve
  em nó API Request do FlowBuilder).
- Onde resolve: mensagens outgoing, respostas prontas, campanhas e automações. NÃO resolve
  nas instruções do AI Agente.
- Se a chave montada não existir, o `{% echo %}` sai vazio (sem erro). Teste com um contato
  de cada valor da lista antes de entregar.

### Padrão geral (serve pra qualquer caso)

- Atributo do contato = o seletor (unidade, plano, cidade...).
- Variáveis da conta = a tabela de valores (`endereco_X`, `preco_X`, `link_X`...).
- Mensagem monta a chave: `"prefixo_" | append: valor_do_contato | downcase` e busca com
  `account.custom_attribute[chave]`.

## Templates WhatsApp com variáveis do sistema (auto-preenchimento) (2026-06)

Ao criar/editar um template WhatsApp (`inboxes_whatsapp_templates_create` / `_create_2`), o corpo usa
variáveis posicionais `{{1}}`, `{{2}}`. Por padrão elas são **manuais** (o atendente digita o valor no
envio). Pra deixar uma variável **auto-preenchida** com um campo do contato/conversa, mande o parâmetro
opcional `variable_mapping` junto.

- Formato: objeto com chave = posição da variável (`"1"`, `"2"`...) e valor = `{ source, field, label }`.
- Só entram no mapping as que devem auto-preencher; as demais `{{N}}` continuam manuais.
- O `variable_mapping` é salvo localmente (NÃO vai pra Meta) e usado no momento do envio.

Exemplo — `{{1}}` vira o primeiro nome do contato:

```json
{
  "components": [
    { "type": "BODY", "text": "Olá {{1}}! Sua oferta de {{2}} está ativa.",
      "example": { "body_text": [["Maria", "20%"]] } }
  ],
  "variable_mapping": {
    "1": { "source": "contact", "field": "name.split.first", "label": "Primeiro nome" }
  }
}
```

Fontes/campos disponíveis (`source` / `field`):

| Variável | source | field |
|---|---|---|
| Nome completo | contact | name |
| Primeiro nome | contact | name.split.first |
| Sobrenome | contact | name.split[1..] |
| Telefone | contact | phone_number |
| E-mail | contact | email |
| Atendente | conversation | assignee.name |
| Equipe | conversation | team.name |
| Nome da conta | account | name |
| Campo personalizado | contact | custom_attributes.CHAVE |

Lembrete: todo template recém-criado pelo MCP só mostra o texto na tela depois de **sincronizar**
(o MCP cria na Meta, mas o "puxar de volta" o conteúdo é o que a tela faz com o botão Sincronizar).

## Status codes a respeitar

| Code | O que fazer |
|---|---|
| 200/201 | OK, processar resposta |
| 204 | OK, sem corpo (típico de DELETE) |
| 400 | Erro de input — leia mensagem e ajuste |
| 401 | Token inválido/expirado — NÃO retry |
| 403 | Sem permissão — não tente bypass |
| 404 | Recurso não existe — talvez foi deletado |
| 422 | Validação falhou — leia errors[] |
| 429 | Rate limited — espere e retry |
| 500/502/503 | Servidor — retry 1-2x com backoff |

## Ordem de operações típicas

### "Buscar todas conversas de um cliente específico"
1. `contacts_search` com `q=email` → pega contact_id
2. `contacts_show` com `include=conversations` OU
3. Filter conversations: `conversations_list` com `q=email`

### "Criar um card Kanban a partir de uma conversa"
1. `funnels_list` → pegar funnel_id certo
2. `kanban_items_create` com `funnel_id`, `funnel_stage` (geralmente primeira etapa), `conversation_display_id`
3. Opcional: `item_details.value`, `assigned_agents`

### "Resumir performance da equipe na semana"
1. `agents_list` → IDs dos agentes
2. `reports_list_*` (agent_overview) com `since=7d_ago`, `until=now`
3. Sintetize: agente X com Y resoluções, tempo médio Z

### "Enviar mensagem com anexo (imagem/arquivo)"
1. `upload_create` (a partir de arquivo OU de uma URL) → resposta traz `file_url` e `blob_id`
2. `conversations_messages_create` passando o `blob_id` (signed_id) dentro do array `attachments`:
   ```json
   { "content": "Segue o documento", "message_type": "outgoing", "attachments": ["<blob_id>"] }
   ```
   Cada item de `attachments` é o `blob_id` retornado pelo upload. Pode mandar vários.
3. O mesmo padrão vale pra anexar mídia num card do Kanban (use o `blob_id` no campo de anexo do card).

## Cuidados com tools de criação

Endpoints `create_*` modificam dados reais. Antes de chamar:
- Confirme com usuário (se inicialmente pediu "ver", não "fazer")
- Verifique se o recurso já existe (evite duplicatas)
- Use `dry_run` quando disponível

### Wrappers de body obrigatórios (exceções à regra "use raiz")

A regra geral é mandar o body na raiz (ver `api-conventions.md`). Mas três endpoints usam
`params.require(...)` no controller e **exigem o wrapper nomeado** — sem ele dá `400`/`422`:

| Tool | Wrapper obrigatório | Controller |
|---|---|---|
| `companies_create` / `companies_update` | `{ "company": { ... } }` | `params.require(:company)` |
| `canned_responses_create` | `{ "canned_response": { ... } }` | `params.require(:canned_response)` |
| `scheduled_messages_create` (dentro de conversa) | `{ "scheduled_message": { ... } }` | `params.require(:scheduled_message)` |

Exemplo:

```json
{ "company": { "name": "Acme", "domain": "acme.com" } }
```

> Observação: o endpoint `scheduled_messages` de nível raiz (fora de conversa) usa `params.permit`
> sem wrapper. A exigência de wrapper vale para o criar-dentro-da-conversa.

## Erros comuns a evitar

| Erro | Como evitar |
|---|---|
| Loop infinito de `page+1` | Sempre cheque `meta.total_count` e pare |
| Re-listar inboxes 20x | Cache mental |
| Mandar `conversations_messages_create` sem `message_type` | Sempre setar `incoming`/`outgoing` |
| Listar TODAS contas de um agente direto | Use filter `q=nome` primeiro |
| Esquecer de filtrar por `account_id` | Multi-tenant — sempre escopar |

## Quando agir vs quando perguntar

Aja sem perguntar:
- Listagem, filtro, busca, leitura
- Sumarização, classificação
- Sugestão de próximos passos

Pergunte primeiro:
- Criar / atualizar / deletar dados
- Enviar mensagem pra cliente
- Mudar status de várias conversas em massa
- Alterar configuração de conta/inbox

## Como achar a tool certa quando o nome colide

Os IDs das tools são gerados automaticamente a partir do path e da categoria. Quando dois paths mapeiam pro mesmo nome base, o segundo ganha sufixo `_1`, terceiro `_2`, etc. Isso gera muita colisão — exemplos reais:

- `lionchat_ecommerce_webhooks_list` tem **19 variantes** (Eduzz, Kiwify, Ticto, Custom, etc. + sub-recursos events/retry_preflight)
- `lionchat_captain_assistants_create` tem **10 variantes** (assistants, scenarios, assistant_responses, tasks/follow_up, copilot_threads...)
- `lionchat_contacts_create` tem 9 variantes (contato, notas, contact_inboxes, labels...)

### Como decidir qual usar

1. **Leia a `description`** de cada tool — ela explica o que faz, não importa o nome
2. **Olhe o `path`** — diferencia o que o nome não diferencia (ex: `/contacts/{id}/notes` vs `/contacts`)
3. **Olhe `category` / `sub`** — agrupa por funcionalidade
4. Se não souber o path, faça uma busca: liste todas as tools que começam com `lionchat_<base>_` e leia as descriptions
5. Em caso de dúvida REAL: pergunte ao usuário em vez de chutar

### Padrão de naming convention

| Sufixo | O que sinaliza |
|---|---|
| `_list` | Lista paginada do recurso |
| `_show` | Detalhe de UM recurso por ID |
| `_create` | Cria recurso (geralmente POST) |
| `_update` | Atualiza (PUT/PATCH) |
| `_destroy` | Deleta |
| `_search` | Busca textual |
| `_filter` | Filtro complexo via POST body |
| `<recurso>_<sub>_<acao>` | Acao em sub-recurso (ex: `contacts_labels_create`) |
| `_1`, `_2`, `_3`... | Colisão — leia descriptions pra desambiguar |

## Native first — antes de criar custom_attribute, cheque se existe campo nativo

LionChat tem vários conceitos com modelos próprios na plataforma. Custom attribute é **último recurso** — útil quando não tem modelo dedicado. Antes de criar um custom_attribute, pergunte:

1. **Esse conceito tem UI dedicada?** Se sim, provavelmente tem campo nativo.
2. **Outros funis/contas usam isso de forma similar?** Se sim, provavelmente é uma feature nativa.
3. **A doc menciona o nome desse conceito?** (Ver `glossary.md` → tabela "Quando usar campo nativo vs custom_attribute")

### Tabela rápida de decisão

| Quero | NÃO faça | Faça |
|---|---|---|
| Motivo de Ganho/Perda do card | criar custom_attribute "Motivo de Ganho" | popular `kanban_config.win_reasons` |
| Checklist reusável em vários cards | criar custom_attribute lista | popular `kanban_config.checklist_templates` + automação `apply_checklist_template` |
| Automação "ao Ganhar → criar card noutro funil" | regra AutomationRule complexa | popular `funnel.settings.automations` com `action: duplicate_to_funnel` |
| Atributo em todo card | criar 1 custom_attribute pra cada funil | popular `kanban_config.global_custom_attributes` (vale pra todos) |
| Cadastrar CPF do contato | usar campo do funil | criar `custom_attribute_definitions` model=contact_attribute |
| Tag "cliente residencial" | criar custom_attribute | criar `Label` |
| Etapa do funil | criar custom_attribute "Status" | usar `funnel.stages` |

### Por que isso importa

Quando você usa o campo nativo:
- A UI já tem suporte (dropdown, filtros, relatórios automáticos)
- Métricas oficiais aparecem nos relatórios
- Webhooks emitem eventos específicos (`status_changed`, `stage_changed`)
- Permissões e validações funcionam fora da caixa

Custom attribute em lugar errado vira:
- Campo perdido na lateral da conversa que ninguém preenche
- Dado solto que não conecta com automação nem relatório
- Duplicação com a feature nativa (vendedor confuso entre 2 lugares pra mesma coisa)

### Como descobrir se existe campo nativo

1. Procure no `kanban-deep-dive.md` (Kanban) ou na doc da feature relevante
2. Liste o config global do recurso (`kanban_config_list`, `voip_settings_list`, etc) — campos `nil`/vazios mas presentes na response = espera input
3. Olhe `data-model.md` pra colunas jsonb no model — costumam guardar feature nativa
