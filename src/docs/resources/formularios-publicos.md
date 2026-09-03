# Formulários Públicos — Guia Profundo

Tudo sobre os Formulários Públicos do LionChat (captação estilo Typeform/Typebot): link público,
caixa de WhatsApp vinculada, desenho dos blocos, publicação, respostas, funil, simulador e
integração com fluxos. Atualizado em 21/08/2026 (v4.10.228 + commits de 21/08 na elvislion: título
público, aba Preenchimentos — entram com o próximo deploy do app depois de 21/08/2026).

## O que é

Um formulário público é uma página de captação hospedada pelo próprio LionChat. O visitante abre um
link, responde bloco a bloco, e o LionChat cria o contato, guarda as respostas, abre a conversa na
caixa de WhatsApp vinculada e (opcionalmente) dispara um fluxo do FlowBuilder no fim.

- **Link público**: `{FRONTEND_URL}/forms/<referência da conta>/<slug>` — a referência da conta é o
  `booking_public_slug` (o mesmo da agenda pública). O `slug` do formulário nasce sorteado (8
  caracteres) e **pode ser trocado** (ver Campos). O campo `public_url` já vem pronto na resposta.
- **Caixa de WhatsApp vinculada é OBRIGATÓRIA para publicar** (`inbox_id`). Só canais
  `Channel::Whatsapp` (oficial) e `Channel::Waha` (QR Code). É por ela que o bloco Enviar mensagem
  dispara e que a conversa do lead nasce.
- **Dois formatos de exibição** (`display_mode`): `cards` (um bloco por tela, estilo Typeform) ou
  `chat` (bolhas de conversa, estilo Typebot).
- **Feature flag `lead_forms`, por conta, nasce desligada.** Com a flag desligada a **página pública
  responde 404** — ninguém consegue preencher. As tools de dashboard (listar, criar, editar,
  publicar, ver respostas, simular) **funcionam mesmo assim**. Dá pra montar tudo antes de ligar a
  flag; não adianta divulgar o link antes.
- **Escrita é só de administrador.** `create`, `update`, `destroy`, `publish`, `duplicate` e
  `check_embed` passam por `check_admin_authorization?`; usuário não-admin recebe **401**. Leitura
  (`list`, `show`, `stats`, `responses`) e o **simulador** (`test_run`) são liberados a qualquer
  agente da conta.

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
| `lionchat_lead_forms_update` | `PATCH /lead_forms/:id` | Edita (inclusive `inbox_id` e `slug`). Admin-only |
| `lionchat_lead_forms_destroy` | `DELETE /lead_forms/:id` | Exclui (204 sem corpo). Admin-only |
| `lionchat_lead_forms_publish` | `POST /lead_forms/:id/publish` | Publica: tira a foto do desenho (com a caixa dentro). Admin-only |
| `lionchat_lead_forms_duplicate` | `POST /lead_forms/:id/duplicate` | Cópia completa com slug novo (copia o `inbox_id`). Admin-only |
| `lionchat_lead_forms_stats` | `GET /lead_forms/:id/stats` | Números e funil por bloco |
| `lionchat_lead_forms_responses_list` | `GET /lead_forms/:id/responses` | Lista de respostas (leve, sem as respostas em si) |
| `lionchat_lead_forms_responses_show` | `GET /lead_forms/:id/responses/:rid` | Detalhe de uma resposta, com o que a pessoa respondeu |
| `lionchat_lead_forms_test_run` | `POST /lead_forms/:lead_form_id/test_runs` | Simulador: roda o RASCUNHO no motor real, sem deixar rastro. Qualquer agente da conta |
| `lionchat_lead_forms_check_embed` | `POST /lead_forms/check_embed` | Confere se um site aceita ser exibido em iframe (bloco Página externa). Admin-only |
| `lionchat_contacts_form_entries_list` | `GET /contacts/:contact_id/form_entries` | Tudo que UMA PESSOA preencheu, das 4 origens (nosso formulário, Meta, Webhook Universal, Fluxo). Qualquer agente |
| `lionchat_contacts_form_entries_show` | `GET /contacts/:contact_id/form_entries/:source/:id` | Detalhe de um preenchimento a partir do contato. Qualquer agente |

**Imagens não sobem pelo conector.** A rota `POST /lead_forms/:id/media` (admin, multipart `file`,
só `image/*`, máximo 5 MB, devolve `{blob_id, url}`) existe, mas upload de arquivo não passa pelo MCP
— chamada pelo conector ela volta 422 `invalid_file_type`. Suba a imagem no editor do painel e
referencie o `blob_id` (o `show` traz `media_urls` com todos os ids do acervo: imagem de bloco,
imagem de opção e a foto do chat). **Imagem subida e não referenciada em até 1 hora é apagada** na
próxima varredura (todo `update`/`publish` roda a varredura).

## Campos do formulário

| Campo | Tipo | Observação |
|---|---|---|
| `name` | string | **Obrigatório.** Nome INTERNO (lista do painel). O que o lead vê na aba do navegador e no link compartilhado é `settings.public_title`; vazio, cai no `name` |
| `display_mode` | string | `cards` (padrão) ou `chat` |
| `active` | boolean | Formulário inativo devolve 404 na página pública |
| `inbox_id` | integer | Caixa de WhatsApp vinculada. Obrigatória para publicar. Ver regras abaixo |
| `form_data` | jsonb | O desenho (rascunho). Teto de 2 MB serializado |
| `settings` | jsonb | Ver abaixo |
| `slug` | string | **Editável** em create e update. Normalizado no servidor (acento vira letra, resto vira hífen), 3 a 60 caracteres, minúsculas + números + hífen, único dentro da conta. Vazio/só espaços = mantém o atual (não é erro). Duplicado = 422. Ausente no create = sorteia 8 caracteres |
| `published_at` | timestamp | Quando a foto foi tirada. Nulo = nunca publicado |
| `public_url` | string | Montado pelo servidor |
| `counts` | objeto | `{views, responses, completed}` — contadores do banco |

**A resposta de `show`/`list`/`create`/`update` traz também:** `inbox` (`{id, name, channel_type}`
ou `null` — a caixa resolvida), e `published_inbox_id` (a caixa que está NA FOTO publicada).

### Regras do `inbox_id`

- Caixa que não é da conta → 422 `{errors: {inbox_id: ["not found in this account"]}}`.
- Canal fora de `Channel::Whatsapp`/`Channel::Waha` → `["channel not supported"]`.
- **Trocar de caixa pode; trocar de TIPO de canal não** → `["channel type cannot change"]`.
  Os blocos foram montados pro canal atual (oficial exige modelo aprovado; QR aceita texto livre e
  mídia). Formulário que ainda não tinha caixa escolhe livremente.
- **A troca só vale depois de republicar**: `publish` grava o `inbox_id` DENTRO da foto
  (`published_data`), e o motor lê sempre a foto.

### `settings`

| Chave | Valor | Padrão |
|---|---|---|
| `primary_color` | hex | `#7C3AED` |
| `theme` | `light` ou `dark` (valor fora da lista cai em `light`) | `light` |
| `abandon_minutes` | inteiro, limitado a 1..15 (minutos) | 15 |
| `button_label` | string — rótulo do botão da página pública | — |
| `resume` | booleano — continuar de onde parou entre visitas | `true` |
| `chat_avatar` | id numérico de blob já subido (`media`) — foto redonda ao lado dos balões, só no formato `chat`. O público recebe `chat_avatar_url` resolvida (nunca o id) | — |
| `public_title` | string, até 100 caracteres — título que o LEAD vê (aba do navegador, link compartilhado). Vazio = usa o `name`. O endpoint público devolve `display_title` (nunca o `name` cru) | — (21/08 — entra com o próximo deploy do app depois de 21/08/2026) |

**No `update`, `settings` SUBSTITUI o objeto inteiro** (assim como `form_data`): não há merge. Mande
todas as chaves que quer manter — um `settings: {theme: "dark"}` apaga cor, avatar, título público,
`resume` e `abandon_minutes`. E apagar `chat_avatar` custa o arquivo: a varredura de imagens roda
logo após o salvamento e purga o que não está mais referenciado em `form_data`, na foto publicada ou
em `settings.chat_avatar` (só upload com menos de 1 hora escapa). O mesmo vale pra `image` de bloco
ou de opção que sair do `form_data`.

## Ciclo de vida

1. **Criar** com `lionchat_lead_forms_create` (nome + `form_data`, mesmo que mínimo).
2. **Vincular a caixa de WhatsApp** (`inbox_id`) — sem ela a publicação recusa (`form_without_inbox`).
3. **Montar o desenho** em `form_data` (contrato na próxima seção). Todo formulário precisa de uma
   pergunta com `map_to: contact.phone` (`form_requires_phone_question`).
4. **Testar** com `lionchat_lead_forms_test_run` — roda o rascunho de verdade, sem sujar nada.
5. **Publicar** com `lionchat_lead_forms_publish` — copia `form_data` (+ `inbox_id`) para
   `published_data` e carimba `published_at`.
6. **Ativar** (`active: true`) e ligar a feature flag `lead_forms` da conta.
7. **Divulgar** o `public_url`.

**Quem preenche usa SEMPRE a foto publicada, nunca o rascunho.** Editar `form_data` não muda nada
para quem está preenchendo até um novo `publish`.

**O contato nasce em TRÊS momentos**: quando a pessoa conclui, quando a resposta é marcada como
abandonada (padrão e teto de 15 minutos sem atividade), ou logo antes de um bloco de Enviar
WhatsApp. Enquanto isso nada é criado — nem contato, nem conversa, nem card. Efeitos que dependem de
contato (evento de pixel, gatilho de marco) ficam guardados e disparam no nascimento, com a hora
original de cada etapa. Quando o contato nasce ali, a conversa começa com uma pílula dizendo qual
formulário o originou. Contato apagado no painel solta o vínculo — a resposta pode renascer no
próximo momento. Os textos `{{contact.name}}`/`{{contact.phone}}`/`{{contact.email}}` saem do que a
pessoa RESPONDEU, não da ficha.

### Link identificado (pula perguntas já conhecidas)

Toda mensagem de TEXTO enviada numa conversa que contenha um link `/forms/` sai **carimbada
automaticamente** com `?lt_form=<código>` (sem depender de LionTrack; vale pra mensagem de flow e
de IA também; nunca em grupo). Quem abre o link carimbado tem a resposta ligada ao contato desde o
início, e o formulário **PULA as perguntas de identidade que já têm valor** — só as três nativas:
nome, telefone e e-mail. A resposta pulada é gravada com o valor da ficha e o selo `prefilled`.

Seguranças: o valor pulado **nunca aparece na tela nem no payload público**, e o botão Voltar **não
alcança** a pergunta pulada. Código de outra conta, contato apagado ou qualquer pane = o formulário
roda anônimo normal. Link copiado do editor e colado fora de uma conversa NÃO tem carimbo.

**Toggle "Reconhecer quem recebeu o link"** (`settings.identify_by_link`, default `true` — inclusive
para formulário antigo, que não tem a chave). Desligado, o formulário **ignora o carimbo por
completo**: a resposta nasce anônima e cada pessoa preenche do zero.

Existe para o formulário **repassado**: o carimbo identifica o contato PARA QUEM o link foi enviado,
então, se essa pessoa encaminha o link (caso real: formulário que o cliente manda para os
familiares), todos abrem como se fossem ela — e o `ContactLinker` grava atributo personalizado, dado
cadastral e etiqueta de **todos na mesma ficha** (`apply_to_linked_contact`). O sintoma visível é só
o pulo das perguntas; o estrago real é no cadastro.

O corte acontece no **nascimento da resposta** (`identified_contact_id`, no controller público), não
no `WalkService`. Desligar apenas o pulo das perguntas seria conserto pela metade: a resposta
continuaria nascendo com o `contact_id` errado. A chave **não vai** para o payload público (a
whitelist do `metadata` segue sem ela) — a decisão é do servidor.

## O contrato do `form_data`

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
| `start` | `title, description, button_label, image, video_url` | `success` | sim |
| `question` | `label, description, field_type, placeholder, required, map_to, scale, image, video_url, accept, invalid_message` | `success` | sim |
| `choice` | `label, description, options, multiple, map_to` | `option_<id da opção>` (escolha única) / `success` (múltipla) | sim |
| `message` | `title, description, button_label, image, video_url` | `success` | sim |
| `condition` | `branches` | `cond_<id do ramo>` + `else` | não |
| `action` | `items, label` (+ formato antigo `action_type, labels, name, event_name`) | `success` | não |
| `send_message` | `messageItems` (+ formato antigo `content, template_name, template_params`) | `success`, `skipped` | não |
| `booking` | `label, description, event_type_id, required` | `success` (agendou) + `no_booking` (seguiu sem agendar; some quando `required`) | sim |
| `set_variable` | `label, assignments` | `success` | não |
| `embed` | `title, description, url, height, button_label, embed_allowed, show_open_external` | `success` | sim |
| `end` | `title, description, redirect_url, button_label, image, video_url` | — | sim |
| `api_request` | `label, method, url, headers, body, timeout` | `success`, `error` | não (mostra bloco de espera) |
| `ai` | `label, mode, prompt, categories, include_answers, model` | modo `generate`: `success`, `error` / modo `classify`: um `cat_<id>` por categoria + `other` | não (mostra bloco de espera) |

**Chave fora da lista não é lida pelo motor** e o editor a **remove no próximo salvamento pela
tela**. Escrever um campo inventado pela API não gera erro nenhum — ele simplesmente não faz nada e
depois some. A lista é fonte única (`LeadForm::NODE_DATA_KEYS` no servidor, espelhada em
`nodeSchema.js` no editor, com spec de contrato comparando as duas).

### Detalhes por chave

**`field_type`** (do `question`): `short_text`, `long_text`, `email`, `phone`, `date`, `time`,
`datetime`, `number`, `rating` (usa `scale`), `url`, `file_upload` (usa `accept`), e os documentos
com validação de verdade: `cpf`, `cnpj`, `cep` (dígito verificador/8 dígitos; gravam só números;
erros `invalid_cpf`/`invalid_cnpj`/`invalid_cep`).
- `time` grava `HH:MM` (24h; erro `invalid_time`).
- `datetime` grava `AAAA-MM-DDTHH:MM` — hora local de quem preencheu, SEM fuso; o fuso de leitura é
  o da definição do atributo de destino (erro `invalid_datetime`).

**`video_url`** (em `start`, `question`, `message`, `end`): link de YouTube, Vimeo ou arquivo de
vídeo direto. Com vídeo válido, ele ocupa o lugar da imagem. Link fora do formato conhecido não
renderiza e não dá erro.

**`accept`** (só em `file_upload`): `'any'` ou um array de categorias entre `image`, `video`,
`audio`, `pdf`, `spreadsheet`, `document`, `xml`. Arquivo executável é recusado sempre.

**`map_to`** — para onde vai a resposta:
- `''` — não guarda em lugar nenhum (só em `answers`).
- `contact.name`, `contact.email`, `contact.phone` — os três nativos.
- `contact.cadastral.<campo>` — `cpf`, `rg`, `cnpj`, `passport`, `profession`, `marital_status`,
  `gender`, `date_of_birth` (os dois últimos sem tela; funcionam por API e são normalizados:
  "solteira" vira `solteiro`, "masculino" vira `m`).
- `contact.address.<campo>` — `cep`, `street`, `number`, `complement`, `neighborhood`, `city`,
  `state`, `country`.
- `custom.<chave>` — atributo personalizado de CONTATO.
- `conversation_custom.<chave>` — atributo personalizado da CONVERSA (só chave definida na conta;
  coerção de tipo; teto 1500 caracteres).
- **Lista de recusa no servidor** (o valor é pulado de forma visível, sem erro): `name`, `email`,
  `phone_number`, `identifier`, `card` e chaves começando com `captain_`, `eclinica_`, `origin_`,
  `lt_`, `booking_`, `waha_`, `whatsapp_`, `ctwa_`, `meta_lead_`.
- Contato pré-existente recebe valor **só em campo vazio** — exceto o que ESTA resposta gravou e
  ninguém mudou depois (correção via Voltar).

**`options`** (do `choice`): `[{ "id": "abc123", "label": "Sim", "image": "" }]`.

**`branches`** (do `condition`): lista avaliada em ordem; nenhum ramo casando cai no handle `else`.
Cada ramo: `{ "id": "b1", "label": "Sim", "source_node_id": "<id da pergunta/escolha/consulta/IA>",
"operator": "equals", "value": "...", "path": "" }`. `id` é estável (a aresta `cond_<id>` aponta
pra ele); `label` é o rótulo do fio no desenho (vazio = número). Operadores: `equals`, `not_equals`,
`contains`, `filled`, `not_filled`, `greater_than`, `less_than` (os dois últimos só numéricos;
`filled`/`not_filled` ignoram `value`). Fonte Escolha compara pelo **id da opção**, não pelo texto;
resposta múltipla: `equals` exige exatamente aquela opção, `contains` = inclui. Fonte `api_request`
exige `path` (caminho dentro da resposta, ex.: `localidade`); fonte `ai` compara o texto/categoria
direto. **Ramificar por variável** (`{{var.*}}`): o motor aceita `source_variable: "<nome>"` no
ramo (tem precedência sobre `source_node_id`), mas o dialog de Condição do editor **não conhece a
chave e a descarta ao salvar o bloco pela tela** — use só em formulário mantido pela API.

**`items`** (do `action`) — o formato novo, uma LISTA de ações `[{key, config}]`:

| `key` | `config` mínimo para publicar | O que faz |
|---|---|---|
| `update_contact_attribute` | `attr_key` | Grava atributo personalizado do CONTATO |
| `update_conversation_attribute` | `attr_key` | Grava atributo personalizado da CONVERSA |
| `add_label` | `labels` com ≥1 título | Etiqueta o contato |
| `milestone` | `name` | Marco do funil (pode disparar fluxo) |
| `meta_pixel_event` | `event_name` | Evento Meta CAPI (`[a-zA-Z0-9_]`, até 40) |
| `ga4_event` | `event_name` | Evento GA4 |

O `config` das ações de atributo aceita também `attr_value` (texto com variáveis) e `attr_op`:
`set` (sobrescrever, padrão), `plus`, `minus`, `times`, `divided_by`. **A conta é feita no
servidor** sobre o valor atual, com trava de repetição (roda UMA vez por preenchimento); valor que
não vira número não grava; divisão por zero não grava. A operação aritmética é a única que passa
por cima do "só grava em campo vazio". Identidade (nome/telefone/e-mail) NÃO se grava por aqui.
Formato antigo (`action_type` + campos soltos) continua sendo lido.

**`messageItems`** (do `send_message`) — LISTA de mensagens, enviadas na ordem:
- `{type: "text", content: "..."}` — texto com variáveis (caixa QR).
- `{type: "whatsapp_template" | "template", template_params: {name, category, language, namespace,
  processed_params}}` — modelo aprovado (caixa oficial; `language` padrão `pt_BR`).
- `{type: "image" | "video" | "audio" | "file" | "document" | "attachment" | "url_media",
  url | file_url | blob_signed_id, caption}` — mídia.
Item que falha **não derruba os outros** — vira `skipped_item {index, reason}` em `answers`.
A caixa é a DO FORMULÁRIO (`inbox_id`) — o bloco não tem caixa própria. Formato antigo
(`content`/`template_name`/`template_params` soltos) continua sendo lido.

**`booking`** — calendário DENTRO do formulário:
- `event_type_id` = id de um tipo de evento de Agendamento da conta (ativo).
- `required: true` = só avança depois de agendar (a saída `no_booking` some do desenho).
- O payload público leva `booking` (slug público, título, duração, `task_type`, `ask_email`,
  `ask_description`), `prefill` (nome/telefone/e-mail já respondidos) e `missing` (o que o tipo
  exige e o formulário não perguntou — e-mail só quando `task_type` é `video_call`). O id interno
  do tipo NUNCA sai. Tipo apagado/desativado depois de publicado: a tela mostra "indisponível" com
  botão de continuar (o `required` é liberado — ninguém fica preso).
- O valor gravado na resposta é o id do agendamento criado (validado contra a conta).

**`set_variable`** — cria variáveis temporárias da resposta (invisível pro lead):
- `assignments: [{key, value}]` — até 20 linhas, 1000 caracteres por valor; `key` vira
  `{{var.<key>}}` nos blocos seguintes. Linha com `key` vazia é ignorada.
- SÓ variável. Gravar em contato/conversa é papel do bloco de Ações (um `target` em um item é
  ignorado pelo motor e descartado pela tela).

**`embed`** — "Página externa", um site de fora exibido DENTRO do formulário (checkout, simulador,
agenda externa):
- `url` precisa começar com `https://` LITERAL (variável só do meio pra frente). Na montagem, as
  variáveis resolvem por posição, com codificação de URL, e o https é reconferido — URL que não
  for https sai VAZIA do payload (proteção contra script via variável).
- `embed_allowed` NÃO é configuração sua: é o veredito de `lionchat_lead_forms_check_embed`
  gravado no desenho (`true`/`false`/`null`). Com `false`, a página mostra o aviso educado + botão
  "Abrir em nova página" em vez de um quadrado vazio. Escrever `true` na mão mente pro renderizador.
- `height` em pixels (padrão 480, limitado 240..1200). `show_open_external` (padrão `true`) mostra
  o botão de abrir fora; com o site recusando o iframe, o botão aparece mesmo desligado — é a
  única saída da pessoa.
- O bloco avança por botão (a página embutida é caixa fechada — não dá pra saber quando um
  pagamento terminou lá dentro). Checkout é justamente o tipo de página que MAIS recusa iframe.

**`api_request`**: `method` aceita `GET`, `POST`, `PUT`, `PATCH`, `DELETE` (padrão `GET`). `body`
(até 64 KB) aceita variáveis — inclusive `{{conta.<variável>}}`; valor do lead entra escapado em
corpo JSON. A `url` precisa ter **domínio literal** (variáveis só no caminho e nos valores de
query; `{{conta.*}}` NÃO vale na URL). `headers` aceita literal ou `{{conta.<variável>}}` —
variável do lead em cabeçalho é recusada na publicação. `timeout` em segundos: padrão 8, teto 15.

**`ai`**: `mode` é `generate` (devolve texto em `{{ia.<node_id>}}`) ou `classify` (roteia por
categoria). `categories` é obrigatório no modo `classify`. `include_answers` (booleano) manda as
respostas já dadas como contexto. `model` é validado contra a lista suportada; `''` = modelo padrão
da conta. A IA usa a **chave da própria conta** — conta sem chave faz o bloco sair pela saída de
erro.

### Variáveis

| Variável | O que traz | Onde vale |
|---|---|---|
| `{{answer.<node_id>}}` | O que a pessoa respondeu naquele bloco (rótulo da opção ou texto) | mensagem, prompt, valores do bloco, URL/corpo de consulta |
| `{{contact.name}}` `{{contact.phone}}` `{{contact.email}}` | O que a pessoa respondeu (a ficha é reserva) | idem |
| `{{api.<node_id>.<caminho>}}` | Um pedaço da resposta de uma consulta | idem |
| `{{ia.<node_id>}}` | O texto que a IA gerou naquele bloco | idem |
| `{{var.<nome>}}` | Variável criada pelo bloco Definir variável | idem |
| `{{conta.<variável>}}` | Variável da conta (cofre) | cabeçalho e CORPO de `api_request` (com segredo); em `set_variable` e no valor das Ações só as NÃO-secretas |

Variável desconhecida vira string vazia, em silêncio. `{{conta.*}}` em texto público sai vazia
mesmo que exista — é proteção, não defeito.

## Regras de publicação

`lionchat_lead_forms_publish` devolve **422 com `{errors: [chaves]}`**. As 34 chaves atuais:

| Chave | Significado |
|---|---|
| `no_start` | Não existe bloco `start` |
| `start_without_exit` | O `start` não tem aresta saindo |
| `no_reachable_end` | Nenhum `end` alcançável a partir do `start` |
| `form_without_inbox` | O formulário não tem caixa de WhatsApp válida vinculada |
| `form_requires_phone_question` | Nenhuma pergunta guarda o telefone (`map_to: contact.phone`) — obrigatória em TODO formulário |
| `question_without_label` | Pergunta sem o texto |
| `question_without_exit` | Pergunta sem saída |
| `choice_without_options` | Escolha sem opções |
| `choice_without_exit` | Escolha sem nenhuma saída ligada |
| `choice_option_without_edge` | Uma opção específica não leva a lugar nenhum |
| `condition_without_branches` | Condição sem ramos |
| `condition_without_else` | Condição sem o "senão" ligado |
| `action_without_config` | Bloco de ação sem nenhum item completo |
| `send_message_official_without_template` | Caixa OFICIAL vinculada e o bloco de mensagem sem nenhum modelo |
| `send_message_qr_without_content` | Caixa QR vinculada e o bloco de mensagem sem nenhum item que entregue algo |
| `api_without_url` | Consulta sem endereço |
| `api_without_error_exit` | Consulta sem a saída de erro ligada |
| `api_url_host_not_literal` | O domínio da consulta tem variável |
| `api_method_invalid` | `method` fora de GET/POST/PUT/PATCH/DELETE |
| `unknown_variable_in_url` | A URL usa variável de família desconhecida |
| `unknown_variable_in_body` | O corpo usa variável de família desconhecida (ou `{{` malformado) |
| `account_variable_in_url` | A URL usa `{{conta.*}}` (só cabeçalho e corpo aceitam) |
| `lead_variable_in_header` | Cabeçalho usa variável vinda do lead |
| `ai_without_prompt` | IA sem instrução |
| `ai_without_categories` | IA em modo classificar sem categorias |
| `ai_without_error_exit` | IA (gerar) sem a saída de erro |
| `ai_without_other_exit` | IA (classificar) sem a saída "outros" |
| `booking_without_event_type` | Agendamento sem tipo de evento escolhido |
| `booking_event_type_invalid` | O tipo não é da conta ou está desativado |
| `booking_without_exit` | Agendamento sem a saída "agendou" ligada |
| `set_variable_without_assignments` | Definir variável sem nenhuma linha com nome |
| `set_variable_without_exit` | Definir variável sem saída |
| `embed_without_url` | Página externa sem endereço |
| `embed_url_not_https` | O endereço da Página externa não começa com `https://` literal |

**Não existem mais** (renomeadas em 16/08): `send_message_without_inbox` →
`form_without_inbox`; `send_message_requires_phone_question` → `form_requires_phone_question`.

## Tetos e limites

| O quê | Limite |
|---|---|
| `form_data` serializado | 2 MB |
| Valor de uma resposta | 4 KB |
| Passos por requisição (anti-loop) | 50 |
| `days` em `stats` e `responses` | máximo 90 (valor ≤ 0 vira 30) |
| Página de `responses` | 25 por página, fixo; `page` até 10.000 |
| Chamadas de IA | 300 por formulário/dia, 1.000 por conta/dia, 10 por resposta |
| Consultas (`api_request`) | 2.000 por formulário/dia, 10.000 por conta/dia; corpo até 64 KB |
| Arquivo enviado pelo lead | 10 MB por arquivo, 10 arquivos por resposta |
| Imagem de bloco (só pelo painel) | 5 MB, apenas `image/*` |
| Funil em `stats` | 50.000 respostas (acima disso o funil sai parcial) |
| Itens do bloco de Ações / linhas do Definir variável | 20 cada; 1000 caracteres por valor |
| Respostas por chamada do simulador | 60 |
| Altura da Página externa | 240..1200 px |
| Conferência de embed | 5 s por salto, até 3 redirecionamentos |
| Lista de preenchimentos do contato | 250 por origem (lead_form / meta_lead / webhook), sem paginação; `meta.truncated` avisa |

## Simulador (`lionchat_lead_forms_test_run`)

Roda o **rascunho** (`form_data`, não a foto) no motor de verdade e desfaz tudo no fim — nada fica
no banco: sem contato, sem conversa, sem WhatsApp, sem pixel, sem resposta nos relatórios. Não
exige admin. O estado do teste vive em quem chama: cada chamada reproduz o teste inteiro a partir
da lista de respostas.

- Body: `{answers: [{node_id, value}]}` — até 60 itens; vazio = começa do início. Item cujo
  `node_id` não é o bloco atual PARA a reprodução ali (devolve o bloco onde parou). `value: null`
  avança bloco sem resposta (`start`, `message`, `embed`).
- Resposta 200: `{block, log, answers, variables, form}` — `block` é o mesmo envelope da página
  pública; `log` é o caminho percorrido (`[{node_id, type, label, answer?, detail?}]` — `detail`
  mostra variável criada, ações executadas e o rumo das condições; `answer`/`detail` só aparecem
  quando existem); `form.name` é o nome interno.
- 422: `{error: "invalid_value", reason}` (uma resposta reprovada — `reason` é o código:
  `required`, `invalid_email`, `invalid_phone`, `invalid_cpf`, `invalid_option`, `value_too_long`…)
  ou `{error: "test_run_failed", reason}`.

**O que o simulador NÃO faz (e como isso aparece):**

| Bloco | No simulador |
|---|---|
| Consulta externa (`api_request`) e IA (`ai`) | **Não executam** (o job de efeito é desligado no modo de teste). Ao chegar neles a resposta volta `block: {node_id, type: "wait"}` e a reprodução para ali — itens seguintes são ignorados e `detail` desses blocos fica vazio. Pra testar o que vem depois, use a página pública (link identificado/aba anônima). |
| Agendamento (`booking`) | `value: ""` segue por `no_booking` (só se o bloco não for obrigatório). Pra simular "agendou", mande o id de um agendamento **já existente** da conta — o simulador pela API não cria reserva. (No painel, o simulador embute a página real: uma reserva feita ali é de verdade e fica no banco.) |
| Envio de arquivo (`file_upload`) obrigatório | Não tem como passar (o valor precisa ser um arquivo anexado à resposta de teste, que não existe): 422 `invalid_value`. Só com `required: false` e `value: ""`. |
| Envio de WhatsApp, etiqueta, pixel, marco | Aparecem no `log` como reservados (`detail` lista as ações), mas nada é enviado/gravado. |

## Respostas e funil

**`lionchat_lead_forms_stats`** (`days` opcional, default 30, máximo 90) devolve
`views` (contador de VIDA INTEIRA do formulário — não obedece `days`), `starts`/`completed`/
`abandoned` da janela, `completion_rate` (% inteiro = completed/starts), `funnel` por bloco e
`milestones`. O funil lista os blocos que a pessoa vê (`start`, `question`, `choice`, `message`,
`booking`, `embed`, `end`), na ordem do desenho **publicado**; acima de 50.000 respostas na janela
sai parcial. **`milestones` hoje só enxerga bloco de Ações no formato antigo (`action_type:
"milestone"`)** — marco configurado em `items` (formato atual do editor) não aparece aqui; aparece
em `responses_show.milestones`.

**`lionchat_lead_forms_responses_list`** aceita `status` (`in_progress`, `completed`,
`abandoned`), `days` e `page` (até 10.000). A lista nunca traz as respostas em si — só `{id, status,
contact, current_node_label, answered_count, created_at, completed_at}` e `meta: {current_page,
per_page: 25, total_count}`. **`contact` pode vir `{id: null, name, phone, pending: true}`** — é
quem ainda está preenchendo (o contato só nasce nos três momentos); nome e telefone saem do que a
pessoa já digitou. `answered_count` conta todas as chaves de `answers`, inclusive as sintéticas.

**`lionchat_lead_forms_responses_show`** traz o conteúdo:

- `status`, `contact` (mesmo shape da lista), `current_node_label`, `started_at`, `completed_at`,
  `abandoned_at`, `created_at`.
- `answers`: `[{label, value_label, at, download_url?}]`, ordenado por `at`. **Atenção:**
  (1) o bloco de Ações grava entradas SINTÉTICAS com chave `"<node_id>::<n>"` e o fim degradado
  (beco sem saída/teto de passos) grava `"_walk_ended"` — nem toda chave é id de bloco;
  (2) no bloco de **Agendamento `value_label` é o id da reserva, não a data** (a aba Preenchimentos
  do contato mostra a data); (3) envio de WhatsApp pulado por falta de telefone aparece como
  entrada vazia do bloco de mensagem.
- `conversation`: `{id, display_id}` ou `null` — a conversa aberta na caixa vinculada.
- `milestones`: os marcos atingidos (`[{node_id, name, at}]`).
- `effects`: resultado de consulta/IA — `{node_id, label, state: pending|done|error, error, status,
  url_short, at}`. `url_short` é esquema + host + caminho, sem a query; corpo, cabeçalhos e prompt
  nunca saem.
- `utm_params`: de onde o lead veio.

Motivos de erro em `effects.error`: `invalid_method`, `invalid_url`, `http_<código>` (`http_0` =
falha de transporte sem código), `timeout`, `ssrf_blocked`, `result_too_large`, `stale`,
`effect_failed` (exceção no job), `effect_runs_exceeded` (laço: 20 execuções), `budget_exceeded`,
`no_ai_key`, `ai_error`. (Os motivos `busy` e `unresolved_variable`, citados antes, não existem no
código.)

## Preenchimentos do contato (`lionchat_contacts_form_entries_list` / `_show`) — 21/08 (entra com o próximo deploy do app depois de 21/08/2026)

A aba "Preenchimentos" da ficha junta, numa lista só ordenada por data, tudo que a pessoa preencheu
ou que entrou por ela, de QUATRO origens: nosso formulário público (`source: lead_form`),
formulário de anúncio do Meta (`meta_lead`), Webhook Universal (`custom_webhook`) e o webhook que o
FlowBuilder cria pro gatilho de um fluxo (`flow`, com o nome do fluxo). É a única rota que responde
"o que esta PESSOA preencheu" — as outras são por formulário/integração, e duas delas são só de
administrador; esta é liberada a qualquer agente.

- **Lista**: `{payload: [{source, id, title, status, at, count, conversation}], meta: {total,
  truncated}}`. `id` é o id do registro NA ORIGEM — só identifica junto com `source`. `status` é
  `in_progress|completed|abandoned` no nosso formulário e `received` nas demais. `count` = respostas
  (nosso) ou campos vinculados e gravados (de fora). `conversation` só existe em `lead_form`. Sem
  paginação de propósito; teto de 250 por origem — estourou, `truncated: true`. Só entram eventos
  do Meta/webhook com status processado.
- **Detalhe** (`source` + `id` da mesma linha): nosso formulário devolve `answers` (`[{label,
  value, at, download_url?, images?}]` — pergunta/resposta legíveis, na ordem; Escolha com opção
  ilustrada traz `images`, e opção sem texto vem com `value` vazio; Agendamento mostra a DATA),
  `written` (`[{scope: contact|conversation, label, value}]` — o que AQUELE preenchimento gravou) e
  `utm`. Meta/webhook/fluxo devolvem SÓ `fields: [{label, value}]` — os campos que foram vinculados a
  atributos daqui e realmente gravados, com o rótulo daqui; nunca o payload cru. `fields: []` = o
  evento não gravou nada. Origem fora da lista ou registro de outro contato = 404.
- A lista **não traz o `lead_form_id`** da resposta: pra chegar em `lionchat_lead_forms_responses_show`
  a partir dela, ache o formulário pelo `title` em `lionchat_lead_forms_list`.

## Conferência de iframe (`lionchat_lead_forms_check_embed`)

Body `{url}`. Resposta `{status, reason}`:

| `status` | `reason` | Significado |
|---|---|---|
| `allowed` | — | O site aceita ser exibido dentro do formulário |
| `blocked` | `not_https` | URL não começa com https:// |
| `blocked` | `x_frame_options` / `frame_ancestors` | O site declara que recusa iframe |
| `blocked` | `url_blocked` | Endereço bloqueado por segurança (rede interna etc.) |
| `unknown` | `unreachable` / `http_<código>` | Não deu pra conferir — a página tenta o iframe e o botão de abrir fora cobre |

O veredito deve ser gravado em `embed_allowed` do bloco. Sites de checkout são os que mais recusam.

## Receitas

### 1. Formulário simples que já publica

Início, nome, telefone, fim — E a caixa vinculada:

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

Mande isso em `lionchat_lead_forms_create` junto com `name` e um `inbox_id` de caixa WhatsApp,
depois `lionchat_lead_forms_publish` e `lionchat_lead_forms_update` com `active: true`.

### 2. Consultar o CEP e ramificar pela cidade

Igual à receita clássica: pergunta o CEP, consulta o ViaCEP (`method` pode ficar de fora — GET é o
padrão) e ramifica com `path` no ramo cuja fonte é a consulta. Obrigatórios: saída `error` ligada,
`else` ligado e o `path`.

### 3. Triagem por IA

`mode: "classify"` + `categories` + arestas `cat_<id>` e `other`. Inalterado.

### 4. Disparar um fluxo quando o formulário for concluído

O gatilho mora no **fluxo**: `{ "key": "lead_form_completed", "lead_form_id": 12 }` no bloco de
início do flow. Três gatilhos: `lead_form_completed`, `lead_form_milestone` (aceita
`milestone_node_id`), `lead_form_abandoned`. O `lead_form_id` pode ir no topo do item ou em
`config`. **O gatilho só dispara depois que o contato nasce** — antes fica guardado. O fluxo
recebe `form_name`, `form_kind`, `form_milestone` e uma variável `form_<pergunta>` por resposta.

### 5. Agendamento dentro do formulário

```json
{ "id": "agenda", "type": "booking", "position": { "x": 0, "y": 500 },
  "data": { "label": "Escolha um horário", "event_type_id": "34", "required": false } }
```

Ligue `success` (obrigatória) pro caminho de quem agendou e `no_booking` pro de quem seguiu sem
agendar (com `required: true` essa saída deixa de existir). O tipo de evento vem de
`lionchat_booking_event_types_list`.

## Armadilhas

- **O `slug` é EDITÁVEL** (mudou em 16/08). Trocar o slug derruba os links já divulgados —
  inclusive os já enviados em mensagens. Vazio mantém o atual; duplicado dá 422.
- **`inbox_id` só troca por caixa do MESMO tipo de canal** (`channel type cannot change`), e a
  troca só vale ao republicar.
- **`published_data` nunca sai pela API.** Para saber o que está no ar, olhe `published_at` e
  `published_inbox_id`.
- **`form_data` no update SUBSTITUI o desenho inteiro.** Não há merge. Leia com `show`, altere e
  mande o desenho completo de volta.
- **A cópia nasce desligada e não publicada** — e copia o `inbox_id`. Imagens viram blobs novos.
- **Publicar não ativa.** `publish` (foto) e `update` com `active: true` são dois passos.
- **Flag desligada = página 404.** Tools funcionando + link 404 = feature `lead_forms` desligada.
- **`media_urls` só existe no `show`.**
- **`answers` tem chaves sintéticas** `"<node_id>::<n>"` (bloco de Ações) — não são ids de bloco.
- **`embed_allowed` é veredito do servidor** (`check_embed`) — escrever `true` na mão faz a página
  tentar um iframe que pode estar bloqueado.
- **Nunca escreva segredo em cabeçalho/corpo literal** de `api_request` — use
  `{{conta.<variável>}}`, que resolve só no servidor.
- **Não há tool de rewind**: o "Voltar e corrigir" é da página pública (o lead corrige a própria
  resposta; telefone corrigido reencaminha a mensagem pro número certo). Pela API de dashboard,
  respostas são somente leitura.
- **`settings` no `update` também SUBSTITUI o objeto inteiro** — e sem `chat_avatar` o arquivo da
  foto é apagado pela varredura. Leia com `show`, altere e mande completo.
- **Imagem que some do `form_data` é apagada de verdade** logo após o salvamento (só sobrevive se
  ainda estiver na foto publicada ou tiver menos de 1 hora).
- **O simulador não roda consulta nem IA**: parou em `block.type: "wait"` = chegou num desses
  blocos. Teste o trecho seguinte pela página pública.
- **`stats.views` é de vida inteira** (ignora `days`); `stats.milestones` não vê marco em `items`.
- **`name` é interno; `settings.public_title` é o que o lead vê** (vazio = cai no `name`).
