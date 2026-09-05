# Assinatura eletrônica de contratos

**Não confundir com "assinatura" de PLANO/cobrança** (fatura, cartão, saldo) — essa área fica fora do MCP.
Aqui é a **assinatura eletrônica de documentos**: o cliente assina um contrato pelo WhatsApp (ou e-mail),
com código de uso único, e o LionChat guarda a prova (IP, aparelho, localização, hash, PDF selado).
Feature `document_signing` (ligada por conta; 403 `feature_disabled` quando desligada).

## As três camadas

| Camada | O que é | Ferramentas |
|---|---|---|
| **Modelo** (`signature_documents`) | O contrato padrão, escrito uma vez com `{{variáveis}}` da ficha. `kind`: `text` (escrito no editor — o único que a API cria), `file` (PDF pronto, igual pra todos) ou `word` (.docx que sai idêntico com os campos mapeados) — os dois últimos só pela tela (upload). | `lionchat_signature_documents_list/show/create/update/destroy/field_catalog` |
| **Contrato** (`signature_envelopes`) | Cada ENVIO a uma pessoa: PDF próprio com os dados dela, prazo, linha do tempo. | `lionchat_signature_envelopes_list/show/create/resend/cancel/limits` |
| **Participante** | Quem assina dentro de um contrato: `signer` (titular, pode ser mais de um), `witness` (testemunha, opcional), `sender` (o remetente, quando o modelo tem "eu também assino" — assina NO PAINEL, sem link). Cada um tem link e código próprios. | dentro do contrato (`participants[]`) |

## Estados do contrato (`status`) e os baldes de filtro

| Balde (`status` na listagem) | Estados | Significado |
|---|---|---|
| `aguardando` | `draft`, `sent` | criado sem entrega (draft) ou enviado e ainda não aberto |
| `visualizado` | `viewed`, `partially_signed` | abriu o link / parte das pessoas já assinou |
| `assinado` | `signed_pending_seal`, `signed` | todos assinaram; selando / documento final pronto |
| `encerrado` | `refused`, `cancelled`, `expired` | recusado / cancelado pela equipe / prazo venceu |
| `falta_eu` | — | contratos abertos em que o usuário do token é o remetente e ainda não assinou |

Participante: `pending` → `viewed` → `verified` (confirmou o código) → `signed` | `refused`.

## Linha do tempo (`events[].kind`)
`created` · `delivered` (link entregue a uma pessoa) · `sent` · `opened` (cada abertura) · `code_requested` ·
`code_verified` · `signed` (com `ip`, `device`, `location`; `panel: true` = assinou no painel) · `all_signed` ·
`sealed` (documento final gerado, `sealed_sha256`) · `refused` · `cancelled` · `expired` · `delivery_failed`
(motivo em `delivery.failed[]`) · `reminded` · `resent`. Tudo append-only — é o relatório de evidências.

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
   (`contact_id`, `status`, `q`). Não chegou? `resend`. Errou? `cancel` (admin).

## Regras que valem sempre
- **Trava sagrada**: campo do modelo sem valor na ficha bloqueia o envio. Preencher a ficha primeiro.
- **Validade** (`roles_layout.validity_days`, padrão 7) conta do ENVIO; `{{document.deadline}}` imprime a data no
  texto; passou = `expired` (cron de hora em hora). **Lembrete** (`reminder_days`, padrão 2, 0 = off): quem não
  assinou recebe o link de novo a cada N dias.
- **Limite mensal** (`signature_envelopes_limits`): cada contrato criado consome 1 vaga; cancelar não devolve.
- **PDFs** (original, assinado, evidências) e o **QR de conferência** só existem pela tela/download autenticado —
  não há ferramenta que devolva os bytes. O `sealed_sha256` é o hash do documento final.
- **Assinar no painel** ("eu também assino") não tem ferramenta: é um gesto humano na página do modelo.
- **Envio por outros caminhos**: ação `send_signature_document` no FlowBuilder, na Macro e na Automação;
  bloco `generate_contract` no Formulário público (gera pelas respostas e manda o link). Gatilhos do Flow
  `signature_*` (8 acontecimentos) trazem `{{contrato.*}}` — ver `lionchat_flows_schema_reference`.

## Onde o cliente vê
Menu **Assinaturas** (modelos e contratos, filtros, "Falta você assinar"), aba **Contratos** na ficha do contato,
pílulas na conversa a cada acontecimento e avisos no sininho para quem enviou.
