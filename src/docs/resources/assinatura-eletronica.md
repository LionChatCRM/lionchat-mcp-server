# Assinatura eletrônica de contratos

**Não confundir com "assinatura" de PLANO/cobrança** (fatura, cartão, saldo) — essa área fica fora do MCP.
Aqui é a **assinatura eletrônica de documentos**: o cliente assina um contrato pelo WhatsApp (ou e-mail),
com código de uso único, e o LionChat guarda a prova (IP, aparelho, localização, hash, PDF selado).
Feature `document_signing` (ligada por conta; 403 `feature_disabled` quando desligada).

## As três camadas

| Camada | O que é | Ferramentas |
|---|---|---|
| **Modelo** (`signature_documents`) | O contrato padrão, escrito uma vez com `{{variáveis}}` da ficha. `kind`: `text` (escrito no editor — o único que a API cria), `file` (PDF pronto, igual pra todos) ou `word` (.docx que sai idêntico com os campos mapeados) — os dois últimos só pela tela (upload). | `lionchat_signature_documents_list/show/create/update/destroy/field_catalog` |
| **Contrato** (`signature_envelopes`) | Cada ENVIO a uma pessoa: PDF próprio com os dados dela, prazo, linha do tempo. | `lionchat_signature_envelopes_list/show/create/resend/cancel/limits`; documentos de quem assina: `_proofs` / `_approve_proofs` / `_reject_proofs` |
| **Participante** | Quem assina dentro de um contrato: `signer` (titular, pode ser mais de um), `witness` (testemunha, opcional), `sender` (o remetente, quando o modelo tem "eu também assino" — assina NO PAINEL, sem link). Cada um tem link e código próprios. | dentro do contrato (`participants[]`) |

## Estados do contrato (`status`) e os baldes de filtro

| Balde (`status` na listagem) | Estados | Significado |
|---|---|---|
| `aguardando` | `draft`, `sent`, `awaiting_data`, `awaiting_approval` | criado sem entrega (draft), enviado e ainda não aberto, "aguardando formulário" (a pessoa ainda não preencheu os dados — o contrato ainda não existe) ou (28/10) "aguardando aprovação dos documentos" (todos assinaram, falta a equipe aprovar os documentos pedidos) |
| `visualizado` | `viewed`, `partially_signed` | abriu o link / parte das pessoas já assinou |
| `assinado` | `signed_pending_seal`, `signed` | todos assinaram; selando / documento final pronto |
| `encerrado` | `refused`, `cancelled`, `expired` | recusado / cancelado pela equipe / prazo venceu |
| `falta_eu` | — | contratos abertos em que o usuário do token é o remetente e ainda não assinou |

Participante: `pending` → `viewed` → `verified` (confirmou o código) → `signed` | `refused`.

## Linha do tempo (`events[].kind`)
`created` · `delivered` (link entregue a uma pessoa) · `sent` · `opened` (cada abertura) · `code_requested` ·
`code_verified` · `signed` (com `ip`, `device`, `location`; `panel: true` = assinou no painel; desde 28/10
`signature_method` `drawn` = desenhada ou `typed` = o nome digitado numa letra de assinatura, com `typed_name`) · `all_signed` ·
`sealed` (documento final gerado, `sealed_sha256`) · `refused` · `cancelled` · `expired` · `delivery_failed`
(motivo em `delivery.failed[]`) · `reminded` · `resent` · `copy_sent` / `copy_failed` (a via assinada de cada pessoa,
estado em `delivery.copies[]`) · `data_filled` (27/10: a pessoa preencheu o formulário e o contrato foi gerado com os
dados dela) · (28/10) `proof_sent` (a pessoa mandou um documento pedido: `kind`, `document_type`) ·
`awaiting_approval` (o contrato passou a esperar a equipe, ou a pessoa reenviou depois de reprovada) · `proofs_approved`
/ `proofs_rejected` (com `reason` e quem decidiu). `code_requested`/`code_verified` com `method: "whatsapp"` = a pessoa
confirmou mandando a frase pelo WhatsApp, não pelo código. Tudo append-only — é o relatório de evidências. `delivery.failed[]` também mostra a
recusa que a Meta manda depois (caixa oficial fora da janela de 24 h, motivo `window_expired`) e some sozinha se a
mensagem acabar entregue.

Falhas de e-mail (16/10): o convite e a via por e-mail tentam de novo sozinhos (1, 5 e 15 min). Só se nada der certo
aparece `envio_falhou` (o servidor de e-mail não respondeu); `email_recusado` (o servidor de e-mail recusou o envio)
aparece na hora. Falha de convite antigo some se a pessoa abriu o link, pediu o código ou assinou depois. Contrato em
`signed_pending_seal` = o documento final está sendo gerado, com novas tentativas automáticas por até ~42 min; só um
`seal_failed` depois disso quer dizer que não deu (oriente falar com o suporte).

## A via assinada (15/10)
Quando o documento final fica pronto, cada pessoa que assinou pelo link (testemunhas incluídas) recebe a sua via em PDF
pelo mesmo canal do link: anexada numa mensagem na conversa dela (WhatsApp) ou no e-mail (acima de 10 MB vai sem anexo,
pedindo que peça a via a quem enviou). Quem assinou no painel não recebe. Não há ferramenta para mandar de novo: oriente
baixar na tela do documento. O código de 6 dígitos de quem assina por e-mail chega no próprio e-mail.

## Os dois jeitos de mandar (27/10)
- **Contrato pronto** (padrão, `collection: 'ready'`): o contrato sai agora com a ficha. Se faltar dado, mande junto
  `contact_data: { 'contact.marital_status': 'casado' }` — vai para a ficha e para o contrato (erro de um campo volta
  `422 dados_invalidos` com `field_errors`). Para saber o que falta antes: `GET .../signature_documents/:id/fill_fields?contact_id=`.
- **Formulário para a pessoa preencher** (`collection: 'form'`, exige `contact_id`): o link vai SÓ para o titular, ele
  preenche os dados dele (em branco) e o contrato nasce com o que ele digitou; o que ele digita atualiza a ficha. O
  contrato fica `awaiting_data` até lá. O link de quem preenche é o `participants[].public_url` do titular na resposta.
- Nos dois: `message` (até 1.000 caracteres) vai junto do link.
- `fill_fields` devolve cada campo que se preenche pela ficha (`value` e `missing`) e `blocked` = o que falta e NÃO se
  preenche por ali (telefone, dados da conta) — com algo em `blocked` o contrato pronto volta `variaveis_sem_valor`;
  `blocked_in_form` é o mesmo para o jeito formulário (lá o nome também é perguntado).
- **Como o formulário pergunta** (`roles_layout.field_prompts` no modelo): `{"contact.cpf": {"label": "Qual é o seu
  CPF?", "description": "Igual ao documento", "placeholder": "000.000.000-00"}}` — texto até 200 caracteres; sem
  pergunta, o formulário mostra o nome do campo; pergunta de variável que o modelo não usa é descartada ao salvar.
- Modelo de **Word** com campo sem escolha no mapeamento: o envio volta `422 campos_sem_escolha` (`missing` = os
  rótulos do Word) antes de gastar a vaga do mês — ajuste o mapeamento pela tela.

## Como a pessoa assina (28/10)
Na página do link (e no "Assinar agora" do painel) há duas abas: **Desenhar** (com o dedo ou o mouse) e **Digitar**
(o nome já vem escrito, pode ser corrigido, e aparece em três letras de assinatura). Os dois valem igual — quem prova
a autoria é o código de uso único. A folha de assinaturas e o relatório de evidências dizem "Assinatura desenhada à
mão" ou "Assinatura digitada: <nome>"; contratos assinados antes de 28/10 não dizem nada.

## Documentos de quem assina (28/10)
- No modelo, `roles_layout.required_proofs`: lista com `id_document` (documento com foto — a pessoa escolhe entre os
  aceitos, RG, CNH ou CPF; ver `accepted_types` abaixo), `selfie_with_document` e `address_proof` (comprovante, foto ou PDF). `[]` = nenhum. Outro valor = 422. O
  contrato guarda uma cópia ao nascer: mudar o modelo depois não muda contrato já enviado (`required_proofs` vem no
  `list` e no `show` do contrato).
- A pessoa manda os documentos na página, antes de assinar. Com algum documento pedido, o contrato NÃO fecha quando
  todos assinam: fica `awaiting_approval` e quem enviou recebe aviso no sininho.
- `lionchat_signature_envelopes_proofs` mostra, por pessoa, os documentos mandados (tipo, formato, quando — nunca o
  arquivo) e a revisão (`pending`/`approved`/`rejected`, motivo, quem, quando) e o `last_proof_event_id`.
- **Os arquivos NÃO saem por ferramenta** (documento de identidade e selfie são dado sensível): para olhar, oriente a
  tela — botão amarelo "Ver documentos" no contrato ou na aba Contratos da ficha. Aprovar sem alguém ter olhado o
  arquivo na tela não faz sentido: pergunte ao usuário se ele já conferiu.
- `lionchat_signature_envelopes_approve_proofs` (`participant_id`, `seen_event_id` = o `last_proof_event_id` que a pessoa
  viu): com todos aprovados o contrato fecha e cada um recebe a via. `lionchat_signature_envelopes_reject_proofs`
  (`participant_id`, `reason` obrigatório, `seen_event_id`): a pessoa recebe no canal dela o pedido de documento novo com
  o motivo. As duas MANDAM mensagem ao cliente — confirme com o usuário antes. 422: `fora_do_momento` (contrato não está
  esperando aprovação), `sem_documentos`, `motivo_obrigatorio`, `documentos_mudaram` (a pessoa mandou outro depois do
  que foi visto — leia `_proofs` de novo). Quem pode: administrador ou `signature_manage`.

## Documentos pedidos com anexo e conferência por IA (29/10)
- `roles_layout.proof_requests` é a lista completa (o que vale de verdade): itens `{key, label, accepts_pdf,
  attach_to_contract, from_witnesses}`. `key`: `id_document`, `rg`, `cnh`, `cpf`, `selfie_with_document`,
  `address_proof` ou um documento CRIADO, `custom_<6 a 12 letras/números minúsculos>` com `label` obrigatório (1 a 60).
  **Você inventa a chave do criado** (ex.: `custom_oab2026`) e a mantém igual nas gravações seguintes — o servidor não
  cria chave, e trocar a chave vira outro documento. Aceita `["rg", "cnh"]` (texto solto = padrões). Máximo 12 itens.
- **Documento com foto = `id_document` com `accepted_types`** (30/10): a lista dos documentos ACEITOS (`rg`, `cnh`, `cpf`;
  um ou mais) e a pessoa manda QUALQUER UM deles. Ex.: `{"key": "id_document", "accepted_types": ["rg", "cnh"]}` = aceita
  RG ou CNH. Sem a lista = os três. Com um só aceito a página não pergunta o tipo. O nome que a pessoa e a equipe veem
  diz os aceitos ("Documento com foto (RG ou CNH)") e a IA confere se a foto é de um deles. Lista vazia, tipo desconhecido
  ou `accepted_types` em outro item = 422. **Quando o usuário pedir "RG ou CNH", use isto** — `rg`, `cnh` e `cpf` como
  itens soltos continuam aceitos, mas cada um EXIGE aquele documento (pedir os três soltos = a pessoa manda os três), e a
  tela não os oferece mais.
- `accepts_pdf`: só no comprovante (sempre) e nos criados; RG/CNH/CPF/selfie com PDF = 422.
- `attach_to_contract: true` = o arquivo entra como páginas no contrato assinado. Teto: 10 arquivos anexados por
  contrato (itens "anexar" × pessoas que mandam) — 422 ao salvar o modelo e `anexos_demais` ao enviar.
- `from_witnesses: true` = as testemunhas também mandam aquele documento (padrão: sim nos fixos, não nos criados).
- Com anexo e testemunha o contrato fecha com DUAS vias: testemunha recebe a sua SEM as páginas de anexo.
- `roles_layout.ai_document_check: true` liga a conferência das FOTOS pela IA (só com a chave da OpenAI da conta;
  gasta crédito dela). Foto em dúvida não conta como entregue até a pessoa mandar outra ou tocar "Manter" (da 2ª dúvida
  em diante); a equipe vê o aviso em "Ver documentos". Falha da IA = foto aceita.
- `required_proofs` continua aceito (só as três antigas) e preserva os itens novos; prefira `proof_requests`.
- `_proofs` ganhou `requests`, `label`/`ai_check`/`ai_kept` por prova e `seal_blocked` (lista: anexo que não entrou no
  selo; o contrato fica parado em `signed_pending_seal` e só dá para REPROVAR aquele documento, com o motivo — aí ele
  volta a esperar a aprovação).
- Gatilhos do Flow novos: `signature_awaiting_approval`, `signature_proofs_approved`, `signature_proofs_rejected`, com
  `{{contrato.documentos_situacao}}` e `{{contrato.assinante.documentos_situacao}}` para condicionar.

## Confirmar pelo WhatsApp (28/10)
Quem recebe o link pelo WhatsApp pode confirmar que é ela mandando uma frase pronta (com um código `CT-XXXXXX`) para o
WhatsApp do contrato, em vez de digitar o código de 6 dígitos — resolve a caixa oficial com a janela de 24 h fechada.
Só vale do telefone da pessoa e na caixa do contrato. A mensagem aparece na conversa, mas a IA, os fluxos e as
automações não respondem a ela. Não há ferramenta: é só a página da pessoa.

## Caixa do modelo e as mensagens (29/10)
- `roles_layout.communication: {inbox_id, code_message, invite_message, copy_message, proofs_again_message,
  code_template, invite_template, copy_template, proofs_again_template}`. A caixa (`inbox_id`, WhatsApp da conta: oficial ou QR Code) vale para TODA a comunicação dos contratos
  do modelo: código, link de quem assina e das testemunhas, cópia assinada e o link do contrato para divulgar.
- Caixa de QR Code: os quatro textos (em branco = o texto de sempre). `code_message` precisa ter `{{codigo}}`;
  `invite_message`, `copy_message` e `proofs_again_message` (pedido de documento de novo), `{{link}}`; `{{contrato}}`
  põe o nome e, no pedido de documento de novo, `{{motivo}}` põe o motivo da equipe. Sem a variável = 422.
- Caixa oficial: os quatro modelos (`code_template`, `invite_template`, `copy_template`, `proofs_again_template`), cada um `{name, language}` de um modelo do WhatsApp APROVADO com UMA variável no corpo e
  sem foto/arquivo/variável no cabeçalho; o do código é de Autenticação. `null` tira. Para criar o modelo na Meta use
  `lionchat_inboxes_whatsapp_templates_create` (o do código: categoria `AUTHENTICATION`, corpo com
  `add_security_recommendation: true`, rodapé `code_expiration_minutes: 10`, botão `OTP`/`COPY_CODE`) — confirme com o
  usuário antes: cada código enviado por ele é cobrado pela Meta.
- Mande só o que muda: o que não vem fica o guardado.
- O código de 6 dígitos aparece no painel (decisão do dono, 29/10); no webhook de saída ele vai escondido.

## Como a pessoa pode assinar (29/10)
- `roles_layout.signature_methods`: `["drawn","typed"]` (os dois, o padrão quando não vem), `["drawn"]` (só desenhar) ou
  `["typed"]` (só digitar o nome). Lista vazia ou valor desconhecido = 422. Vale para os próximos envios; o contrato
  grava o que valia quando saiu.

## Link do contrato para divulgar (28/10; formulário e código desde 29/10)
- No modelo, `roles_layout.public_link: {enabled: true}`. O link usa a caixa de `communication` (o `inbox_id` dentro de
  `public_link` só vale para modelo sem caixa em `communication`). A leitura devolve `{enabled, inbox_id, path}` — o
  endereço é o domínio da instalação + `path` (`/contrato/<código>`). Mande `regenerate: true` para trocar o código (o
  endereço antigo para de funcionar). Salvar sem `regenerate` mantém o mesmo endereço; desligar e religar também.
- Só para modelo com UM assinante principal e sem `sender_signs` (422 com `public_link` no texto do erro), e só caixa de
  WhatsApp (oficial ou QR Code). Na oficial o link fica "indisponível" até o modelo do código estar aprovado.
- Quem abre o endereço preenche um formulário (os dados do contrato, o WhatsApp dela e as testemunhas do modelo), recebe
  um código no WhatsApp digitado e, com o código certo, o contrato dela nasce com os dados preenchidos
  (`additional_attributes.link_padrao: true`). Contato que já existe não tem a ficha alterada. A mesma pessoa (mesmo
  WhatsApp e mesmo CPF) preenchendo de novo em 24 h ganha contrato novo e o anterior sem assinatura é cancelado.
- **Limite do mês:** o contrato do link só nasce (e conta) depois que a pessoa confirma o código. Quem abre e some não
  gasta vaga.

## Como mandar um contrato (receita)
1. `lionchat_signature_documents_list` → escolha o modelo (ou crie um `text` com `signature_documents_create`;
   variáveis em `signature_documents_field_catalog`).
2. Confira a ficha: toda `{{variável}}` do modelo precisa ter valor no contato (nome, CPF, endereço…) —
   senão o envio volta `422 variaveis_sem_valor` com a lista do que falta.
3. `lionchat_signature_envelopes_create` com `signature_document_id`, `contact_id` e `participants`
   (`[{name, role: 'signer', phone, delivery_channel: 'whatsapp', contact_id}]`; testemunha = mais um item
   com `role: 'witness'` e o telefone dela).
4. `422 escolher_caixa` → a pessoa conversa em mais de uma caixa de WhatsApp: repita com `inbox_id`.
5. Acompanhe com `signature_envelopes_show` (linha do tempo) ou `signature_envelopes_list`
   (`contact_id`, `status`, `q`). Não chegou? `resend`. Errou? `cancel` (admin). Falta a SUA assinatura
   (modelo com "eu também assino")? `signature_envelopes_sign_as_sender` — ver regra abaixo.

## Regras que valem sempre
- **Quem pode**: administrador ou cargo personalizado com "Gerenciar Assinaturas" (`signature_manage`) — vale para
  criar/editar modelo, prévia, enviar, reenviar, baixar e "eu também assino" (403 sem a chave). A LISTA de modelos e a
  leitura de um modelo continuam abertas a qualquer membro. Cancelar contrato e apagar modelo: só administrador.
- **Trava sagrada**: campo do modelo sem valor na ficha bloqueia o envio. Preencher a ficha primeiro.
- **Validade** (`roles_layout.validity_days`, padrão 7) conta do ENVIO; `{{document.deadline}}` imprime a data no
  texto; passou = `expired` (cron de hora em hora). **Lembrete NÃO é mais função do sistema** (14/09): o campo
  `reminder_days` e a tarefa diária das 10h foram REMOVIDOS. Quem lembra é um fluxo do cliente, com o texto e a
  caixa dele — gatilho "Link de assinatura enviado para uma pessoa" (`signature_delivered`, um disparo por
  pessoa), bloco Esperar em dias e a condição "Situação do contrato". Nunca sugerir `reminder_days`.
- **Conversor de Word** é um serviço separado (docx-converter). Fora do ar = `422 conversor_indisponivel` na prévia e no envio de modelo Word — é o serviço, não o arquivo; repetir em instantes. Modelos `text` e `file` não passam por ele.
- **Fila única de conversão do Word**: uma conversão por vez em toda a instalação (todas as contas); pela tela espera-se até 10 s, automação/macro/fluxo/formulário até 2 s.
  Passou disso o envio/prévia volta `422 fila_cheia` — é só repetir em instantes (o modelo está bom).
- **Limite mensal** (`signature_envelopes_limits`): cada contrato criado consome 1 vaga; cancelar não devolve.
  Exceção (28/10): o contrato que nasce do link do modelo só conta depois que a pessoa confirma. O teto por conta é
  ajustado pelo operador da plataforma (fora do MCP).
- **PDFs** (original, assinado, evidências) e o **QR de conferência** só existem pela tela/download autenticado —
  não há ferramenta que devolva os bytes. O `sealed_sha256` é o hash do documento final. Exceção desde 15/10: a via
  assinada vira anexo da mensagem na conversa de quem assinou por WhatsApp, então aparece nas ferramentas de mensagens
  da conversa (`conversations_messages_*`).
- **Só pela tela, de propósito** (existem na API, mas NÃO como ferramenta): importar um Word (`import_docx`),
  pré-visualizar modelo ou rascunho (`preview`, `preview_draft`) e baixar PDF (`download`). Nesta área o conector
  não sobe o Word do modelo nem baixa o PDF — não prometa "vou gerar a prévia" ou "vou baixar o assinado"; oriente a tela.
- **Assinar no painel** ("eu também assino", 08/09): `lionchat_signature_envelopes_sign_as_sender` assina como o
  REMETENTE (a pessoa do token) — nunca no lugar do cliente. Manda `signature_image` (PNG em base64 com prefixo
  `data:image/png;base64,...`), opcional `location {latitude, longitude, accuracy}` (vai pra prova),
  `remember_drawing` e (28/10) `signature_method` (`drawn` ou `typed`) + `typed_name` — a folha de assinaturas diz
  "Assinatura desenhada à mão" ou "Assinatura digitada: <nome>"; sem o campo, não diz nada. 422: `nao_e_sua` (não é o remetente deste contrato), `ja_assinado`, `sem_desenho`. Era a
  última que faltava? o contrato fecha e o PDF final é gerado em seguida. Os que esperam você: `status=falta_eu`.
- **Envio por outros caminhos**: ação `send_signature_document` no FlowBuilder (28/10: `collection` `ready`/`form`,
  `message` junto do link e `send_link: false` para só gerar; o contrato criado vira `{{contrato.*}}`, com
  `{{contrato.link}}`, para os blocos seguintes), na Macro e na Automação;
  bloco `generate_contract` no Formulário público (gera pelas respostas e manda o link). Gatilhos do Flow
  `signature_*` (12 acontecimentos, 29/10) trazem `{{contrato.*}}` — ver `lionchat_flows_schema_reference`.

## Onde o cliente vê
Menu **Assinaturas** (modelos e contratos, filtros, "Falta você assinar"), aba **Contratos** na ficha do contato,
pílulas na conversa a cada acontecimento e avisos no sininho para quem enviou.
