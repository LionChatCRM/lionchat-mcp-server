# Formulários Públicos — Guia Profundo

Tudo sobre os Formulários Públicos do LionChat (captação estilo Typeform/Typebot): link público,
desenho dos blocos, publicação, respostas, funil e integração com fluxos.

## O que é

Um formulário público é uma página de captação hospedada pelo próprio LionChat. O visitante abre um
link, responde bloco a bloco, e o LionChat cria o contato, guarda as respostas e (opcionalmente)
dispara um fluxo do FlowBuilder no fim.

- **Link público**: `{FRONTEND_URL}/forms/<referência da conta>/<slug>` — a referência da conta é o
  `booking_public_slug` (o mesmo usado na agenda pública) e o `slug` do formulário tem 8 caracteres
  alfanuméricos minúsculos. O campo `public_url` já vem pronto na resposta das tools.
- **Dois formatos de exibição** (`display_mode`): `cards` (um bloco por tela, estilo Typeform) ou
  `chat` (bolhas de conversa, estilo Typebot).
- **Feature flag `lead_forms`, por conta, nasce desligada.** Com a flag desligada a **página pública
  responde 404** — ninguém consegue preencher. As tools de dashboard (listar, criar, editar,
  publicar, ver respostas) **funcionam mesmo assim**: não há gate de feature no backend do
  dashboard. Ou seja: dá pra montar o formulário inteiro antes de ligar a flag, mas não adianta
  divulgar o link antes.
- **Escrita é só de administrador.** `create`, `update`, `destroy`, `publish` e `duplicate` passam
  por `check_admin_authorization?`; usuário não-admin recebe **401**. Leitura (`list`, `show`,
  `stats`, `responses`) é liberada a qualquer agente da conta.

### Não confundir

| Nome parecido | O que é de verdade |
|---|---|
| **Formulário público** (este documento) | Página de captação hospedada pelo LionChat, com blocos e link próprio |
| **MetaLeadForm** | Formulário de anúncio da Meta (Facebook/Instagram Lead Ads) — outro módulo |
| **Flow / FlowBuilder** | Motor de automação de conversa. O formulário *dispara* fluxos, mas não é um fluxo |

## Ferramentas disponíveis

| Ferramenta | Endpoint | O que faz |
|---|---|---|
| `lionchat_lead_forms_list` | `GET /lead_forms` | Lista os formulários da conta (mais novos primeiro). Não traz `media_urls` |
| `lionchat_lead_forms_create` | `POST /lead_forms` | Cria. Admin-only |
| `lionchat_lead_forms_show` | `GET /lead_forms/:id` | Detalhe completo, único lugar que traz `media_urls` |
| `lionchat_lead_forms_update` | `PATCH /lead_forms/:id` | Edita. Admin-only |
| `lionchat_lead_forms_destroy` | `DELETE /lead_forms/:id` | Exclui (204 sem corpo). Admin-only |
| `lionchat_lead_forms_publish` | `POST /lead_forms/:id/publish` | Publica: tira a foto do desenho. Admin-only |
| `lionchat_lead_forms_duplicate` | `POST /lead_forms/:id/duplicate` | Cópia completa com slug novo. Admin-only |
| `lionchat_lead_forms_stats` | `GET /lead_forms/:id/stats` | Números e funil por bloco |
| `lionchat_lead_forms_responses_list` | `GET /lead_forms/:id/responses` | Lista de respostas (leve, sem as respostas em si) |
| `lionchat_lead_forms_responses_show` | `GET /lead_forms/:id/responses/:rid` | Detalhe de uma resposta, com o que a pessoa respondeu |

**Imagens não têm ferramenta MCP.** O upload de imagem de bloco (`POST /lead_forms/:id/media`,
máximo 5 MB, só `image/*`) existe no painel. Pela API dá pra referenciar um `image` que já foi
subido, nunca subir um novo.

## Campos do formulário

| Campo | Tipo | Observação |
|---|---|---|
| `name` | string | **Obrigatório** |
| `display_mode` | string | `cards` (padrão) ou `chat` |
| `active` | boolean | Formulário inativo devolve 404 na página pública |
| `form_data` | jsonb | O desenho (rascunho). Teto de 2 MB serializado |
| `settings` | jsonb | Ver abaixo |
| `slug` | string | **Gerado no create e imutável** — nunca aceita valor do cliente |
| `published_at` | timestamp | Quando a foto foi tirada. Nulo = nunca publicado |
| `public_url` | string | Montado pelo servidor |
| `counts` | objeto | `{views, responses, completed}` — contadores do banco |

### `settings`

| Chave | Valor | Padrão |
|---|---|---|
| `primary_color` | hex | `#7C3AED` |
| `theme` | `light` ou `dark` (valor fora da lista cai em `light`) | `light` |
| `abandon_minutes` | inteiro, limitado a 1..1440 | 15 |
| `button_label` | string — rótulo do botão da página pública | — |

## Ciclo de vida

1. **Criar** com `lionchat_lead_forms_create` (nome + `form_data`, mesmo que mínimo).
2. **Montar o desenho** em `form_data` (contrato na próxima seção).
3. **Publicar** com `lionchat_lead_forms_publish` — copia `form_data` para `published_data` e carimba
   `published_at`.
4. **Ativar** (`active: true`) e ligar a feature flag `lead_forms` da conta.
5. **Divulgar** o `public_url`.

**Quem preenche usa SEMPRE a foto publicada, nunca o rascunho.** Editar `form_data` não muda nada
para quem está preenchendo até um novo `publish`. Isso é de propósito: dá pra mexer no formulário
com gente respondendo sem quebrar ninguém no meio.

**O contato nasce no MEIO do preenchimento**, não no fim: assim que existem respostas mapeadas para
`contact.name` E `contact.phone`, o LionChat cria (ou reaproveita) o contato, carimba a origem do
lead e aplica os atributos personalizados já respondidos. Quem começa e abandona depois disso
**continua virando contato com as respostas que deu** — é a diferença mais valiosa em relação a um
formulário tradicional.

## O contrato do `form_data`

Esta é a parte que permite construir formulários pela API. O `form_data` é um desenho de nós e
arestas:

```json
{
  "nodes": [
    { "id": "n1", "type": "question", "position": { "x": 0, "y": 200 }, "data": { } }
  ],
  "edges": [
    { "id": "e1", "source": "n1", "target": "n2", "sourceHandle": "success" }
  ]
}
```

- `id` de nó e de aresta: qualquer string única dentro do desenho.
- `position`: `{x, y}` em pixels do canvas. Só afeta a visualização no editor; o motor ignora.
- `sourceHandle`: **qual saída do nó** a aresta usa. É o que decide o caminho (ver tabela).

### Tipos de bloco

| `type` | Chaves de `data` permitidas | Saídas (`sourceHandle`) | Aparece pro lead? |
|---|---|---|---|
| `start` | `title, description, button_label, image` | `success` | sim |
| `question` | `label, description, field_type, placeholder, required, map_to, scale, image, accept, invalid_message` | `success` | sim |
| `choice` | `label, description, options, multiple, map_to` | `option_<id da opção>` (escolha única) / `success` (múltipla) | sim |
| `message` | `title, description, button_label, image` | `success` | sim |
| `condition` | `branches` | `cond_<id do ramo>` + `else` | não |
| `action` | `action_type, labels, name, event_name` | `success` | não |
| `send_message` | `inbox_id, content, template_name, template_params` | `success`, `skipped` | não |
| `end` | `title, description, redirect_url, button_label, image` | — | sim |
| `api_request` | `label, url, headers, timeout` | `success`, `error` | não (mostra bloco de espera) |
| `ai` | `label, mode, prompt, categories, include_answers, model` | modo `generate`: `success`, `error` / modo `classify`: um `cat_<id>` por categoria + `other` | não (mostra bloco de espera) |

**Chave fora da lista não é lida pelo motor** e o editor a **remove no próximo salvamento pela
tela**. Escrever um campo inventado pela API não gera erro nenhum — ele simplesmente não faz nada e
depois some. A lista é fonte única (`LeadForm::NODE_DATA_KEYS` no servidor, espelhada em
`nodeSchema.js` no editor, com spec de contrato comparando as duas).

### Detalhes por chave

**`field_type`** (do `question`): `short_text`, `long_text`, `email`, `phone`, `date`, `number`,
`rating` (usa `scale`), `url`, `file_upload` (usa `accept`).

**`accept`** (só em `file_upload`): `'any'` ou um array de categorias entre `image`, `video`,
`audio`, `pdf`, `spreadsheet`, `document`, `xml`. Arquivo executável é recusado sempre, antes de
qualquer categoria.

**`map_to`**: `''` (não guarda em lugar nenhum), `contact.name`, `contact.email`, `contact.phone`
ou `custom.<chave de atributo personalizado de contato>`.

**`options`** (do `choice`): `[{ "id": "abc123", "label": "Sim", "image": "" }]`. O `image` por
opção é o que faz a "escolha com fotos".

**`branches`** (do `condition`): lista avaliada em ordem; nenhum ramo casando cai no handle `else`.

```json
[{ "id": "b1", "source_node_id": "q_cidade", "operator": "equals", "value": "São Paulo" }]
```

Operadores: `equals`, `not_equals`, `contains`, `filled`, `not_filled`, `greater_than`,
`less_than`. Quando a fonte (`source_node_id`) é um `api_request`, o ramo **precisa** de `path` —
o caminho dentro da resposta da consulta (ex.: `"path": "localidade"`).

**`action_type`**: `add_label` (usa `labels: []`), `milestone` (usa `name` — é o marco que aparece
no funil e pode disparar fluxo), `meta_pixel_event` e `ga4_event` (usam `event_name`).

**`send_message`**: caixa WhatsApp QR Code usa `content` (texto com variáveis); caixa WhatsApp
oficial usa `template_name` + `template_params`. Um formulário com `send_message` **obriga** existir
uma pergunta com `map_to: contact.phone` — sem telefone não há para quem mandar.

**`api_request`**: **só GET**, sem corpo. A `url` precisa ter **domínio literal** (nada de variável
no host). Variáveis só entram no caminho e nos valores de query. `headers` aceita valor literal ou
`{{conta.<variável>}}` (o cofre de variáveis da conta) — variável derivada do lead em cabeçalho é
recusada na publicação. `timeout` em segundos: padrão 8, teto 15.

**`ai`**: `mode` é `generate` (devolve texto em `{{ia.<node_id>}}`) ou `classify` (roteia por
categoria). `categories` é obrigatório no modo `classify`. `include_answers` (booleano) manda as
respostas já dadas como contexto. `model` é validado contra a lista suportada
(`gpt-4.1-nano`, `gpt-4o-mini`, `gpt-4.1-mini`, `gpt-5.4-nano`, `gpt-5.4-mini`, `gpt-4o`, `gpt-4.1`,
`gpt-5-mini`, `gpt-5.4`, `o3-mini`, `o4-mini`, `gpt-5`, `gpt-5.2`, `gpt-5.5`, `o1`, `o3`);
`''` = usa o modelo padrão da conta. A IA usa a **chave da própria conta** — conta sem chave faz o
bloco sair pela saída de erro.

### Variáveis

Usáveis no texto de `send_message`, no `prompt` da IA e na `url` do `api_request`:

| Variável | O que traz | Onde vale |
|---|---|---|
| `{{answer.<node_id>}}` | O que a pessoa respondeu naquele bloco (rótulo da opção ou texto) | mensagem, prompt, caminho/query da URL |
| `{{contact.name}}` `{{contact.phone}}` `{{contact.email}}` | Dados do contato já identificado | mensagem, prompt, caminho/query da URL |
| `{{api.<node_id>.<caminho>}}` | Um pedaço da resposta de uma consulta | mensagem, prompt, caminho/query da URL |
| `{{ia.<node_id>}}` | O texto que a IA gerou naquele bloco | mensagem, prompt, caminho/query da URL |
| `{{conta.<variável>}}` | Variável da conta (cofre, aceita segredo) | **só em cabeçalho de `api_request`** |

Variável desconhecida vira string vazia, em silêncio. `{{conta.*}}` fora do cabeçalho sai vazia
mesmo que a variável exista — é proteção, não defeito.

## Regras de publicação

`lionchat_lead_forms_publish` devolve **422 com `{errors: [chaves]}`** quando o desenho não passa.
Cada chave e o que ela quer dizer:

| Chave | Significado |
|---|---|
| `no_start` | Não existe bloco `start` no desenho |
| `start_without_exit` | O `start` não tem aresta saindo dele |
| `no_reachable_end` | Nenhum bloco `end` é alcançável a partir do `start` |
| `question_without_label` | Uma pergunta está sem o texto da pergunta |
| `question_without_exit` | Uma pergunta não tem para onde ir depois |
| `choice_without_options` | Um bloco de escolha está sem nenhuma opção |
| `choice_without_exit` | Um bloco de escolha não tem nenhuma saída ligada |
| `choice_option_without_edge` | Uma opção específica da escolha não leva a lugar nenhum |
| `condition_without_branches` | Uma condição está sem nenhum ramo configurado |
| `condition_without_else` | Uma condição não tem a saída "senão" ligada |
| `action_without_config` | Um bloco de ação está sem a configuração que o tipo dele exige |
| `send_message_without_inbox` | Um bloco de mensagem está sem caixa de entrada escolhida |
| `send_message_requires_phone_question` | Há mensagem no formulário mas nenhuma pergunta guarda o telefone |
| `api_without_url` | Uma consulta está sem endereço |
| `api_without_error_exit` | Uma consulta está sem a saída de erro ligada |
| `api_url_host_not_literal` | O domínio da consulta tem variável (só caminho e valores aceitam) |
| `unknown_variable_in_url` | A URL usa uma variável de família desconhecida |
| `account_variable_in_url` | A URL usa `{{conta.*}}` (variável da conta só vale em cabeçalho) |
| `lead_variable_in_header` | Um cabeçalho usa variável vinda do lead (`answer`, `contact`, `api`, `ia`) |
| `ai_without_prompt` | Um bloco de IA está sem instrução |
| `ai_without_categories` | Um bloco de IA em modo classificar está sem categorias |
| `ai_without_error_exit` | Um bloco de IA (modo gerar) está sem a saída de erro ligada |
| `ai_without_other_exit` | Um bloco de IA (modo classificar) está sem a saída "outros" ligada |

## Tetos e limites

| O quê | Limite |
|---|---|
| `form_data` serializado | 2 MB |
| Valor de uma resposta | 4 KB |
| Passos por requisição (anti-loop) | 50 |
| `days` em `stats` e `responses` | máximo 90 (valor ≤ 0 vira 30) |
| Página de `responses` | 25 por página, fixo; `page` até 10.000 |
| Chamadas de IA | 300 por formulário/dia, 1.000 por conta/dia, 10 por resposta |
| Consultas (`api_request`) | 2.000 por formulário/dia, 10.000 por conta/dia |
| Arquivo enviado pelo lead | 10 MB por arquivo, 10 arquivos por resposta |
| Imagem de bloco (só pelo painel) | 5 MB, apenas `image/*` |
| Funil em `stats` | 50.000 respostas (acima disso o funil sai parcial) |

## Respostas e funil

**`lionchat_lead_forms_stats`** (`days` opcional) devolve:

```json
{ "views": 320, "starts": 180, "completed": 96, "abandoned": 40, "completion_rate": 53,
  "funnel": [{ "node_id": "q_nome", "type": "question", "label": "Qual é o seu nome?",
               "reached": 175, "percent": 97 }],
  "milestones": [{ "node_id": "n7", "name": "Qualificado", "reached": 62 }] }
```

O funil só lista os blocos que a pessoa vê (`start`, `question`, `choice`, `message`, `end`), na
ordem do desenho **publicado**.

**`lionchat_lead_forms_responses_list`** aceita `status` (`in_progress`, `completed` ou `abandoned`;
valor fora da lista é ignorado), `days` e `page`. A lista **nunca** traz as respostas em si — só
`{id, status, contact, current_node_label, answered_count, created_at, completed_at}`.

**`lionchat_lead_forms_responses_show`** traz o conteúdo:

- `answers`: `[{label, value_label, at, download_url?}]` — o `download_url` só existe em resposta de
  envio de arquivo (e vem nulo se o arquivo já foi apagado).
- `milestones`: os marcos que a pessoa atingiu.
- `effects`: o resultado dos blocos de consulta e de IA — `{node_id, label, state, error, status,
  url_short, at}`. `state` é `pending`, `done` ou `error`. **`url_short` é esquema + host + caminho,
  sem a query**; o valor enviado, os cabeçalhos e o prompt **nunca** saem pela API.
- `utm_params`: de onde o lead veio.

Motivos de erro que aparecem em `effects`: `http_<código>`, `timeout`, `ssrf_blocked`,
`invalid_url`, `result_too_large`, `stale`, `busy`, `budget_exceeded`, `no_ai_key`, `ai_error`,
`unresolved_variable`.

## Receitas

### 1. Formulário simples que já publica

Desenho mínimo que passa na publicação: início, nome, telefone, fim.

```json
{
  "nodes": [
    { "id": "start", "type": "start", "position": { "x": 0, "y": 0 },
      "data": { "title": "Fale com a gente", "description": "Leva 30 segundos.",
                "button_label": "Começar" } },
    { "id": "q_nome", "type": "question", "position": { "x": 0, "y": 200 },
      "data": { "label": "Qual é o seu nome?", "field_type": "short_text",
                "required": true, "map_to": "contact.name" } },
    { "id": "q_fone", "type": "question", "position": { "x": 0, "y": 400 },
      "data": { "label": "Qual é o seu WhatsApp?", "field_type": "phone",
                "required": true, "map_to": "contact.phone" } },
    { "id": "fim", "type": "end", "position": { "x": 0, "y": 600 },
      "data": { "title": "Obrigado!", "description": "Já falamos com você." } }
  ],
  "edges": [
    { "id": "e1", "source": "start", "target": "q_nome", "sourceHandle": "success" },
    { "id": "e2", "source": "q_nome", "target": "q_fone", "sourceHandle": "success" },
    { "id": "e3", "source": "q_fone", "target": "fim", "sourceHandle": "success" }
  ]
}
```

Mande isso em `lionchat_lead_forms_create` junto com `name`, depois
`lionchat_lead_forms_publish` e `lionchat_lead_forms_update` com `active: true`.

### 2. Consultar o CEP e ramificar pela cidade

Pergunta o CEP, consulta o ViaCEP e manda quem é de São Paulo para um caminho diferente.
Fragmento — os blocos `start`, `msg_sp`, `msg_outros`, `fim_erro` e os fins ficam de fora por
brevidade; no envio real todos precisam existir e alcançar um bloco de fim.

```json
{
  "nodes": [
    { "id": "q_cep", "type": "question", "position": { "x": 0, "y": 200 },
      "data": { "label": "Qual é o seu CEP?", "field_type": "short_text", "required": true } },
    { "id": "api_cep", "type": "api_request", "position": { "x": 0, "y": 400 },
      "data": { "label": "Consulta de CEP",
                "url": "https://viacep.com.br/ws/{{answer.q_cep}}/json/",
                "headers": [], "timeout": 8 } },
    { "id": "cond_sp", "type": "condition", "position": { "x": 0, "y": 600 },
      "data": { "branches": [ { "id": "b1", "source_node_id": "api_cep",
                                "path": "localidade", "operator": "equals",
                                "value": "São Paulo" } ] } }
  ],
  "edges": [
    { "id": "e1", "source": "q_cep", "target": "api_cep", "sourceHandle": "success" },
    { "id": "e2", "source": "api_cep", "target": "cond_sp", "sourceHandle": "success" },
    { "id": "e3", "source": "api_cep", "target": "fim_erro", "sourceHandle": "error" },
    { "id": "e4", "source": "cond_sp", "target": "msg_sp", "sourceHandle": "cond_b1" },
    { "id": "e5", "source": "cond_sp", "target": "msg_outros", "sourceHandle": "else" }
  ]
}
```

Três coisas obrigatórias aqui: a saída `error` ligada, o `else` ligado, e o `path` no ramo (porque a
fonte é uma consulta). Faltando qualquer uma, a publicação recusa.

### 3. Triagem por IA

Classifica o que a pessoa escreveu e manda cada caso para um lugar.

```json
{
  "nodes": [
    { "id": "q_motivo", "type": "question", "position": { "x": 0, "y": 200 },
      "data": { "label": "Conte rapidinho o que você precisa",
                "field_type": "long_text", "required": true } },
    { "id": "ia_triagem", "type": "ai", "position": { "x": 0, "y": 400 },
      "data": { "label": "Triagem", "mode": "classify",
                "prompt": "Classifique o pedido do cliente em uma das categorias.",
                "categories": [ { "id": "c1", "label": "Orçamento" },
                                { "id": "c2", "label": "Suporte" } ],
                "include_answers": true, "model": "" } }
  ],
  "edges": [
    { "id": "e1", "source": "q_motivo", "target": "ia_triagem", "sourceHandle": "success" },
    { "id": "e2", "source": "ia_triagem", "target": "fim_orcamento", "sourceHandle": "cat_c1" },
    { "id": "e3", "source": "ia_triagem", "target": "fim_suporte", "sourceHandle": "cat_c2" },
    { "id": "e4", "source": "ia_triagem", "target": "fim_geral", "sourceHandle": "other" }
  ]
}
```

Enquanto a consulta ou a IA roda, o lead vê um bloco de espera — o formulário não trava nem perde a
sessão.

### 4. Disparar um fluxo quando o formulário for concluído

O gatilho mora no **fluxo**, não no formulário. Use `lionchat_flows_create` ou
`lionchat_flows_update` e coloque o item no bloco de início:

```json
{ "key": "lead_form_completed", "lead_form_id": 12 }
```

Três gatilhos existem:

| `key` | Quando dispara |
|---|---|
| `lead_form_completed` | A pessoa chegou ao bloco de fim |
| `lead_form_milestone` | A pessoa passou por um bloco de ação do tipo `milestone` |
| `lead_form_abandoned` | A pessoa parou de responder e passou o tempo de `abandon_minutes` |

No `lead_form_milestone` dá pra acrescentar `milestone_node_id` para mirar um marco específico; sem
ele, qualquer marco daquele formulário dispara. O `lead_form_id` (e o `milestone_node_id`) podem ir
no topo do item ou dentro de `config` — o motor lê os dois.

**O gatilho só dispara se a resposta já tiver contato**, ou seja, se nome e telefone foram
respondidos. E dispara uma vez só por resposta e por tipo. O fluxo recebe as respostas como
variáveis: `form_name`, `form_kind`, `form_milestone` e uma variável `form_<pergunta>` por resposta
dada.

## Armadilhas

- **O `slug` é gerado e imutável.** Mandar `slug` no create ou no update não faz nada. Link
  publicado nunca muda de endereço.
- **`published_data` nunca sai pela API.** Para saber o que está no ar, olhe `published_at` e
  compare mentalmente com o `form_data` — não existe endpoint que devolva a foto.
- **`form_data` no update SUBSTITUI o desenho inteiro.** Não há merge. Leia com
  `lionchat_lead_forms_show`, altere o que precisa e mande o desenho completo de volta. Mandar só os
  nós novos apaga todo o resto.
- **A cópia nasce desligada e não publicada.** `duplicate` cria com `active: false`, sem
  `published_at`, com `" (cópia)"` no nome e slug novo. As imagens são duplicadas de verdade (blobs
  novos), então mexer nelas na cópia não afeta o original.
- **Publicar não ativa.** São dois passos: `publish` (tira a foto) e `update` com `active: true`.
- **Flag desligada = página 404.** Se o cliente diz que o link não abre e as tools funcionam
  normalmente, o suspeito número um é a feature `lead_forms` da conta.
- **`media_urls` só existe no `show`.** A listagem não traz, de propósito (payload).
- **Nunca escreva segredo em cabeçalho literal** de `api_request` — use `{{conta.<variável>}}`, que
  resolve só no servidor e nunca aparece na tela nem no log.
