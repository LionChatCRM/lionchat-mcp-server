# Troubleshooting — Códigos de Erro Comuns

Como interpretar e responder a erros do MCP do LionChat.

## HTTP Status Codes

### 200 OK / 201 Created
Tudo certo. Use o body.

### 204 No Content
Sucesso, mas sem corpo. Comum em DELETE e algumas updates. NÃO espere JSON de volta.

### 400 Bad Request
Input malformado. Causas comuns:
- JSON inválido
- Campo obrigatório faltando
- Tipo errado (passou string onde esperava number)

**Ação:** Releia a mensagem de erro. Corrija o payload. NÃO retry sem mudar nada.

### 401 Unauthorized
Token de API inválido ou expirado.

**Ação:** Parar. Reportar pro usuário que precisa renovar credenciais. NÃO retry — vai falhar igual.

### 403 Forbidden
Token válido, mas SEM permissão pra essa ação.

Causas:
- Agente tentando ação de admin
- Conta diferente do escopo do token
- Feature flag desativada na conta
- Recurso pertence a outra conta (multi-tenant)

**Ação:** NÃO bypass. Informar limitação ao usuário.

### 403 `mcp_not_enabled` (acesso ao MCP não liberado)
O uso do MCP é liberado por conta (função "MCP (IA conectada)" no Super Admin, válida
para ADMINISTRADORES da conta) ou individualmente por usuário. Se nenhum dos dois estiver
ativo, TODA chamada de dados responde:

```json
{ "error": "mcp_not_enabled", "message": "O acesso via MCP não está habilitado para esta conta..." }
```

**Ação:** NÃO retry — nenhuma chamada vai passar. Repasse a `message` ao usuário e oriente
a pedir a liberação ao administrador da conta ou ao suporte do LionChat.

### 404 Not Found
Recurso não existe.

Causas comuns:
- ID errado
- Recurso foi deletado
- Está em outra conta
- Endpoint URL errado

**Ação:** Verificar se ID está correto. Se foi deletado, informar.

### 422 Unprocessable Entity
Dados passaram na sintaxe mas falharam validação.

Exemplo de response:
```json
{
  "errors": {
    "email": ["já está em uso"],
    "phone_number": ["formato inválido"]
  }
}
```

**Ação:** Ler `errors`, ajustar dados, reenviar.

### 429 Too Many Requests
Rate limit estourado.

Response inclui header `Retry-After: 60` (segundos).

**Ação:**
- Esperar o tempo indicado
- Reduzir concorrência
- Avaliar se está fazendo loop ineficiente

NÃO retry imediato — só piora.

### 500 Internal Server Error
Erro do servidor LionChat.

**Causas comuns:**
- Estrutura interna de lista errada (ex: `win_reasons: ["str"]` em vez de `[{id, title}]`)
- Tipos errados em campos (string onde espera int, hash onde espera array, etc)
- Validação de modelo lança exceção não tratada
- Bug genuíno do servidor

**Ação:**
- Revisar tipos e estrutura do payload contra `api-conventions.md` e `data-model.md`
- Retry 1x após 2-5 segundos
- Se persiste: reportar pro usuário com timestamp/request ID

> Nota: o Rails do projeto roda com `wrap_parameters: [:json]` global, então body raiz é auto-wrapped no nome do recurso. Falta de wrapper **não** gera 500 silencioso na maioria dos endpoints — descarte essa hipótese e foque em tipos/estrutura. Detalhes em `api-conventions.md → Wrapper de body`.

### "param is missing or the value is empty: <recurso>"
Status: 400 (raro)

Aparece em endpoints que rodam `params.require(:algo)` com nome não-padrão (fora da convenção REST que o auto-wrap deduz). Solução: enviar wrapper explícito `{"<recurso>": {...}}`.

### Contato criado com `name`/`phone` vazios após POST /contacts
Não é 5xx — request volta 200, mas o contato fica sem os dados que você mandou.

**Causa:** body foi enviado com wrapper (`{"contact": {"name": "..."}}`). O `ContactsController` usa `params.permit(:name, ...)` direto na raiz, sem `require(:contact)`. Como o auto-wrap não duplica quando o wrapper já está presente, os campos ficam só dentro de `params[:contact]` e o `permit` na raiz não pega.

**Solução:** mandar body raiz: `{"name": "Fulano", "phone_number": "+5511..."}`.

### 502 Bad Gateway / 503 Service Unavailable
Indisponibilidade temporária (deploy, manutenção, sobrecarga).

**Ação:** Retry com backoff exponencial (2s, 4s, 8s). Máx 3 tentativas.

### 504 Gateway Timeout
Operação demorou demais.

Causas:
- Query muito pesada (sem filtro)
- Export grande (use exports assíncronos)

**Ação:** Reformular a chamada com filtros mais agressivos.

## Erros específicos do MCP

### "mcp_not_enabled"
Status: 403

A conta não tem a feature MCP habilitada.

**Ação:** Pedir admin pra ativar no plano ou via Super Admin.

### "admin_required"
Status: 403

Só administradores podem usar essa funcionalidade.

**Ação:** Usuário com role `agent` precisa pedir pro admin.

### "invalid_account"
Status: 400 ou 404

`account_id` não pertence ao usuário autenticado.

**Ação:** Listar contas do user (`list_my_accounts`) e usar uma válida.

### "feature_disabled"
Status: 403

Feature flag específica (ex: `feature_kanban`, `feature_captain`) está OFF.

**Ação:** Reportar qual feature precisa ser ativada.

## Erros de validação comuns

### Conversation
- `"contact must exist"` — passou `contact_id` inválido
- `"inbox must exist"` — `inbox_id` errado
- `"status invalid"` — use 0, 1, 2 ou 3 (open/resolved/pending/snoozed)

### Contact
- `"email has already been taken"` — duplicado na conta
- `"phone_number has already been taken"` — mesmo problema. **Desde 2026-09-01 é trava do BANCO** (índice
  único telefone+conta, como e-mail e identifier têm desde 2023): dois `contacts_create` com o mesmo
  telefone em paralelo já não criam gêmeos — o segundo volta 422. Antes de criar, procure com
  `lionchat_contacts_search` — **a busca acha o telefone com e sem o 9º dígito a partir da versão de
  05/09/2026** (29/08 entregou só a busca de ficha ÚNICA usada pela criação; a busca de LISTA e o filtro
  ficaram exatos até 05/09 — por isso a integração ficava presa: buscava, não achava, criava e levava 422).
  Para atualizar, use `contacts_update` no que já existe. Duplicado só aparece se as fichas nasceram
  ANTES da trava. O texto do 422 sai no idioma padrão da instalação (inglês) mesmo em conta pt_BR —
  case `attributes: ["phone_number"]`, nunca a frase
- `"phone_number must be a valid number with country code"` — formato E.164: `+5511999999999`

### Message
- `"content can't be blank"` — mensagem vazia (use template se for attachment-only)
- `"private must be boolean"` — true/false, não string

### KanbanItem
- `"STAGE_HAS_ITEMS"` (no `funnels_update`) — você tentou remover uma etapa que ainda tem card;
  `stages` na resposta diz quantos. Mova com `migrate_stage` antes. (Card criado em etapa
  inexistente NÃO dá erro: é redirecionado — confira o `funnel_stage` devolvido.)
- `"conversation_display_id must exist"` — conversa não existe ou foi deletada
- `"position must be a positive integer"` — não pode ser negativo

## Cenários problemáticos

### "A busca não acha o contato, mas ele existe" (novo 2026-08-04)

Primeira coisa a conferir: **o termo tem menos de 3 letras?** Desde 04/08 termo com letra precisa
de 3 caracteres; abaixo disso a busca é recusada e volta **vazia, sem erro**. Termo só de dígitos
é isento.

```
q=Bo   -> payload: []   (recusado, NÃO significa que não existe)
q=Bor  -> busca normal
q=42   -> busca normal (dígito é isento)
```

Vale nas cinco buscas: contato, conversa, mensagem, card e artigo. Um termo curto **invalida a
busca inteira**, mesmo com filtro estruturado junto.

O que fazer: complete o termo, peça o nome inteiro, ou use `lionchat_contacts_filter` com
`filter_operator: "contains"` — o `/filter` não tem esse piso.

**Nunca responda "esse contato não existe" a partir de uma busca de 1-2 letras.**

### "Criei uma conversa e voltou o id de uma que já existia" (novo 2026-08-04)

É o comportamento novo, não é defeito. Desde 04/08 não nasce conversa nova se o contato já tem uma
**aberta** naquela caixa — o sistema devolve a existente, com HTTP 200 e sem aviso.

- Contato com conversa aberta/pendente/adiada/silenciada → devolve a existente
- Só conversa resolvida → cria nova
- Caixa com "conversa única" ligada → sempre a existente, mesmo resolvida
- Caixa de e-mail → sempre cria nova

Se você PRECISA de conversa nova, feche a anterior antes (`conversations_toggle_status` para
`resolved`). E lembre: no reuso, `assignee_id` e `status` mandados na criação são **descartados** —
troque depois com `conversations_update`.

### "Token de cargo restrito passou a receber 403 em conversa que antes abria" (novo 2026-08-04)

Mudança de segurança, não é defeito. Até 04/08 as ações de conversa autorizavam a **CAIXA**, não a
**conversa** — então qualquer membro da caixa conseguia agir numa conversa que nem consegue abrir.
As 19 ações do controller de conversa agora conferem a conversa.

Na prática, com token de cargo restrito:

| Ação | Antes | Agora |
|---|---|---|
| `conversations_transcript` (mandar a conversa por e-mail) | Passava em qualquer conversa da caixa | Só nas que o cargo enxerga |
| Anexos e download do áudio | Idem | Idem |
| Resolver/reabrir, prioridade, silenciar, marcar não-lida, atributos | Idem | Idem |
| `conversations_scheduled_messages_list` / `_create` | **Sem autorização nenhuma** | Confere a conversa |

Dois acessos continuam valendo de propósito: conversa **órfã** (cuja caixa foi apagada) é de toda a
conta, e quem tem o **card do Kanban** enxerga a conversa vinculada mesmo sem ser membro da caixa.

Se o seu fluxo dependia do comportamento antigo, o caminho é dar acesso à caixa/time certo ao cargo
— não existe como pedir exceção pela API.

### "Estou recebendo 401 mesmo com token correto"
Possíveis causas:
- Token foi revogado
- Conta foi suspensa (`feature_account_suspended`)
- Token de outra conta

Verificar: `GET /api/v1/profile` (se 401 aqui, token tá inválido)

### "GET retorna 200 mas POST/PATCH retorna 403"
Token tem `scope: read` apenas. Precisa de token com scope completo pra escritas.

### "Operação foi pelo MCP mas não aparece na UI"
- Frontend pode estar com cache (refresh)
- WebSocket pode estar caído
- Pode ter sido criado em outra conta (verificar `account_id`)

### "Timer/job rodou mas dados estão errados"
Sidekiq pode estar retry-ando. Verificar:
- Job tem `discard_on` apropriado?
- Status final no banco vs UI

### "Tool não está disponível"
Possíveis razões:
- MCP server não foi atualizado (`npm install -g @lionchat/mcp-server@latest`)
- Feature flag bloqueando endpoint
- Plano do cliente não inclui a feature

### "Rate limit constante"
Padrões que causam:
- Polling agressivo (use webhooks)
- Listar tudo sem paginar
- Não cache de dados estáticos
- Loop sem `break` apropriado

## Cenários de produto (diagnóstico rápido, 2026-06)

### "Mensagens pro contato X não chegam no WhatsApp (WAHA)" — contato mudo
Causa clássica: cache de LID inválido no contato. Desde 2026-06-10 há **self-healing**: o LID
é validado (formato `digitos@lid`), o cache invalida sozinho se o número conectado ou o canal
mudarem, e o envio re-resolve o LID na primeira falha. Se ainda assim falhar: confira
`custom_attributes.waha_whatsapp_lid` do contato (é em `custom_attributes`, não em
`additional_attributes`) e o status da sessão (`GET /inboxes/{id}/waha/status`).

Desde 2026-09-02 há uma rede a mais: quando o WhatsApp recusa o endereço gravado na conversa
(erro `no LID found`), o envio tenta o endereço por onde as mensagens **daquela conversa**
chegaram e guarda a correção. Interruptor `WAHA_SEND_PROVEN_ADDRESS` (Super Admin > App Config >
WAHA). Não cobre campanha de WhatsApp QR nem convivência, que montam o endereço por conta própria.

### "Cliente mandou um contato (vCard) e não apareceu nada"
Corrigido em 2026-06-09: vCard agora vira anexo `file_type: "contact"` na mensagem (nome +
telefone extraídos). Em versões antigas a mensagem era descartada.

### "IA parou de responder / erro de OpenAI"
- Mensagens de erro agora distinguem **sem saldo** (insufficient_quota) de **limite de taxa** (429).
- A conta pode ter **chaves OpenAI reservas** (fallback automático com cooldown — configurado na
  integração OpenAI, campo fallback_api_keys). Se a principal falha, a reserva assume sozinha.
- A chave é validada na hora de salvar a integração (chave inválida nem salva).
- Se a transcrição de um áudio falha, a IA **não responde no escuro** — ela espera intervenção
  em vez de responder sem saber o que o cliente disse.
- Sem AI Agente ativo na conversa = nenhuma resposta de IA (motor antigo V1 foi aposentado).
- IA travada pelo anti-loop avisa um humano via notificação (não fica muda).
- Desde 22/07: quando a IA falha, a nota privada de erro traz o **erro literal da OpenAI** (429 TPM,
  sem saldo, chave inválida) e sai em TODA tentativa falhada — se o cliente pergunta "por que a IA
  parou", leia a última nota privada da conversa que a causa está escrita nela.
- Desde 22/07: desligar a IA no meio de uma resposta **interrompe na hora** — os blocos restantes
  daquela resposta são abortados antes de ir ao cliente (a despedida do próprio handoff continua saindo).

### "Agente sumiu / não sumiu da lista após excluir" (22/07)
Exclusão de agente COM reatribuição roda em **segundo plano** (minutos em conta grande): a resposta
é 202 `{status:'processing'}`, o index de agentes traz `deleting: true` enquanto processa e a linha
some quando termina. Segunda tentativa durante o processamento = **409 agent_already_being_deleted**
— é sinal de que JÁ está rodando; não repita a chamada.

### "Disparei a campanha e a tag/atributo não apareceu no contato" (23/07)
Comportamento novo, não é bug: as ações pós-envio da campanha (tag/atributo/prioridade/atendente)
aplicam SÓ quando a Meta confirma a ENTREGA (delivered/read) — nunca no aceite. Leva de segundos a
minutos. Mensagem que falhou ou foi barrada por spam NÃO recebe as ações (de propósito: evita que a
exclusão "quem já recebeu" fure no disparo seguinte). Se a tag não apareceu, confira o status da
mensagem da campanha antes de suspeitar da automação.

### "Import de histórico WAHA criou DUAS conversas pro mesmo contato" (23/07)
Comportamento novo, de propósito: o import de histórico agora grava as mensagens com a DATA ORIGINAL
numa conversa de HISTÓRICO separada (resolvida, marcada como importada) — o contato fica com 2 cards:
o vivo e o histórico. A conversa viva nunca se mistura com a de histórico.

### "Participante não recebeu notificação de mensagem nova" (22/07)
Comportamento novo, não é bug: notificação de nova mensagem vai SÓ pro **responsável** da conversa.
Participantes continuam vendo a conversa, mas não recebem sino/push a cada mensagem — pra acionar
alguém específico, use @menção em nota interna (que notifica pelo caminho próprio; a lista de quem
pode ser mencionado vem de `lionchat_conversations_mentionable_users`).

### "Mandei reenviar a mensagem falhada e voltou 422" (25/07)
Não é bug: mensagem **cancelada** ou **excluída** nunca reenvia. O bloqueio é na fonte e vale pros
três caminhos — botão da bolha (`lionchat_conversations_messages_create_1`), reenvio em lote
(`lionchat_inboxes_failed_messages_bulk_retry`) e a auto-recuperação do WAHA. Se o usuário quer
mesmo mandar de novo, o caminho é escrever uma mensagem nova.

### "A falha sumiu do painel" / "apareceu um grupo Excluídas" (25/07)
Dois comportamentos novos e propositais no painel Falhas de envio
(`lionchat_inboxes_failed_messages_summary`):
- **Cancelada** (`cancel_retry` / `bulk_cancel`) some do painel de vez — cancelar é limpar.
- **Excluída** NÃO some: vira o grupo informativo `deleted` (campo `deleted_count`), guardando
  contato, horário e o **motivo original** da falha. É registro, então não tem botão de reenviar
  nem de cancelar e fica fora de `retryable_count` e do `total`.

Cancelar vale pra TODOS os grupos (inclusive `permanent`, `window_expired`, `campaign`, `partial` e
`accepted_then_failed`, que nunca seriam reenviados) — é assim que se limpa o painel. Ações
irreversíveis: confirme com o usuário e mostre as contagens do summary antes.

### Grupos novos no painel de falhas (18/08) — e o `partial` mudou de significado
Três mudanças no `lionchat_inboxes_failed_messages_summary`:
- **`accepted_then_failed`** (campo `accepted_then_failed_count`): mensagem COM recibo da Meta
  (aceita no envio, recusada depois por aviso assíncrono) e até 1 anexo. Antes essas caíam em
  `partial` com a explicação errada de "3 fotos e só a 1ª chegou". O motivo real de cada uma está na
  própria linha (`error`). Nunca reenviáveis em lote (anti-duplicata) — reenvio é disparar de novo
  pela conversa.
- **`partial`** agora é SÓ o caso que o rótulo sempre descreveu: recibo presente E **mais de um
  anexo** (envio multi-anexo que foi pela metade). `bulk_cancel` com `classification: "partial"`
  **deixou de atingir** as mensagens de 1 anexo — elas agora são `accepted_then_failed`.
- **`account_locked`** (dentro de `groups`): conta comercial TRANCADA pela Meta (erro 131031).
  Nunca reenviável — nem aqui, nem pelo "Reenviar falhas" da campanha (bloqueado na fonte). A ação é
  humana: resolver no Business Manager. Aparece também na aba Saúde da caixa e na quebra de falhas
  do card de campanha.

### "Erro 131026 / Message undeliverable" — NUNCA chute a causa (30/07)
A Meta devolve o MESMO código 131026 pra duas coisas diferentes: **o número não tem WhatsApp** e **a
pessoa não está recebendo** (bloqueou, aparelho fora, não aceita mensagem de empresa). A Meta não diz
qual das duas — então a plataforma carimba um fato NOSSO em
`content_attributes.undeliverable_history`:

| Carimbo | O que significa | O que dizer ao cliente |
|---|---|---|
| `never_delivered` | nunca entregamos nada pra esse contato | provavelmente o número não tem WhatsApp — vale conferir o número |
| `delivered_before` | já entregamos antes, hoje não entrega | o número existe; a pessoa é que não está recebendo agora |
| ausente (mensagem antiga) | sem histórico carimbado | enuncie as DUAS possibilidades, sem escolher |

**Nunca afirme "esse número não tem WhatsApp" sem o carimbo `never_delivered`.** Foi exatamente esse
palpite que fez atendente encerrar conversa de paciente que existia (conta 56, conv 3629).

### "Mídia recusada pela Meta (131053) e a faixa vermelha sumiu sozinha" (30/07)
Comportamento novo, não é bug. O 131053 é um balde: uma das variantes (a que menciona `weblink`) é
TRANSITÓRIA — o buscador da Meta falhou ao baixar o arquivo pela URL. Nesse caso a plataforma reenvia
sozinha, agora por upload direto, e a mensagem fica verde sem precisar de F5. As demais variantes do
131053 (formato/tamanho recusado) NÃO são resgatadas — regra fail-closed de propósito, pra não ficar
reenviando eternamente algo que a Meta nunca vai aceitar.

### "Template falhou e depois ficou verde sozinho" — socorro de TEMPLATE (18/08)
O socorro automático passou a cobrir também mensagens de MODELO (template) da caixa oficial —
qualquer tipo: só texto, imagem, vídeo ou documento no cabeçalho. Quando a falha é passageira
(inclusive erro desconhecido), a plataforma remonta o modelo INTEIRO (mesmo texto, variáveis e
botões) e reenvia em ondas de até ~1h; com mídia no cabeçalho, entrega o arquivo direto pra Meta em
vez do link (imune ao buscador). Regras que valem explicar ao usuário:
- Ficam FORA de propósito: campanha (tem reenvio próprio), modelo de código de verificação (OTP),
  conta trancada (131031), número sem WhatsApp (131026), freios de spam/limite da Meta e erros de
  configuração do modelo — nesses, reenviar não resolve e a mensagem fica vermelha com o motivo.
- Mensagem com mais de 2 horas não é mais entregue pelo socorro (lembrete velho não chega atrasado).
- O histórico do FLUXO pode continuar mostrando o bloco vermelho mesmo com a mensagem entregue pelo
  socorro — o contador do nó não é revertido (limitação declarada).
- Pesquisa de satisfação (CSAT) por modelo NÃO tem socorro (não guarda os dados do modelo).

### "A mensagem falhou dizendo 'Template not found or invalid template name'" (30/07)
Se a caixa é **WhatsApp oficial** e faz mais de 24h que o cliente não fala, a causa quase sempre é a
**janela de 24h fechada** — não um template faltando. Até 30/07 o erro gravado era esse texto
enganoso; hoje a mensagem diz que a janela fechou, e o classificador põe a falha no grupo
`window_expired` (fora do reenvio em lote — reenviar não adiantaria).

Regras de produto pra explicar ao cliente:
- **Mandar template NÃO abre a janela.** Só a mensagem do CLIENTE abre.
- Fora da janela, só template aprovado sai. Texto livre é recusado pela Meta.
- O follow-up automático da IA passou a entender isso: fora das 24h ele escolhe um modelo aprovado em
  vez de escrever texto livre e tomar recusa (ver `lionchat://docs/best-practices`).
- Erro sem tradução deixou de existir: todo `external_error` agora vira texto em português na bolha e
  no painel de falhas. Se aparecer erro em inglês cru pro usuário, isso é reportável.

### "O Messenger parou de enviar / 'Invalid parameter'" (24/07)
Causa raiz do apagão de 22 a 24/07: a Meta **aposentou a message tag** que o sistema mandava em todo
envio de Messenger. Corrigido em 24/07. Agora o Messenger respeita a **janela de 24h** de verdade:
dentro da janela envia normal; passou de 24h da última mensagem do cliente, a Meta recusa — não é
falha do LionChat, é regra da plataforma. Não existe template de Messenger pra "reabrir" a janela
(isso é WhatsApp). Instagram nunca usou tag e não foi afetado.

### "A importação de histórico do WhatsApp (QR) parou no meio" (25/07)
A importação agora se recupera sozinha: se o servidor reiniciar no meio, ela fica `interrupted` e
**retoma de onde parou** (não baixa de novo o que já entrou) na próxima verificação. Estados
possíveis: `importing` (rodando), `interrupted` (caiu, vai retomar sozinha), `paused` (alguém pausou
pelo painel de suporte — só volta no botão Retomar), `cancelled` (encerrada de vez), `completed`.
Enquanto uma importação está viva, o repescador de mensagens da sessão fica fora do caminho, de
propósito. Pausar, retomar e cancelar são ações do painel de suporte — não existem no MCP.

**A mídia vem DEPOIS do texto (desde 19-20/08/2026).** O import grava as conversas só com o texto
(779 conversas em ~3 min num caso real) e busca os arquivos em segundo plano, numa fila por caixa
com poucas vagas na instalação inteira — pode levar horas (o dono aceitou "até 24 h, contanto que
não atrapalhe nada"). Enquanto isso a mensagem carrega `content_attributes.media_failed` com
`retryable: true` (bolha âmbar "mídia chegando"); quando o arquivo chega, o selo some e o anexo
aparece; se o WhatsApp já apagou o arquivo (tudo com mais de ~2 semanas), o selo vira
`retryable: false` (vermelho, definitivo — não há repesca). `lionchat_inboxes_waha_import_status`
responde "ainda está chegando?": `media_pending` (arquivos na fila desta caixa; 0 = tudo pedido),
`media_swept_at`/`media_swept_count` (varredura final que recolocou órfãos na fila). `status:
completed` com `media_pending > 0` é normal — texto pronto, fotos a caminho. Conversa de histórico
NÃO é repescada pelo vigia de mensagens, de propósito.

### "Editei o evento no Google Calendar e não sincronizou"
Auto-cura desde 2026-06-09: o vigia horário re-arma o "watch" morto de conexões saudáveis
sozinho (sem reconectar a conta). Se persistir >1h, aí sim investigar a conexão
(`google_calendar` tools — campo watch_expiration).

### "Publiquei o formulário e voltou 422 com uma lista de nomes estranhos" (15/08)
Não é bug nem erro de payload: o `publish` do Formulário público **valida o desenho** e devolve 422
com um array das pendências (chaves curtas como `api_without_error_exit`, `no_start`,
`question_without_exit`, `choice_without_options`, `ai_without_prompt`). Cada chave aponta um bloco
mal montado — bloco de API sem saída de erro, pergunta sem para onde ir, escolha sem opções, etc.
**Ação:** conserte o desenho (`form_data`) e publique de novo; a lista das chaves e o que cada uma
cobra está em `lionchat://docs/formularios-publicos`. Enquanto não publicar, a página pública
continua servindo a última versão publicada (ou nada, se nunca houve).

## Webhooks como alternativa a polling

Se você precisa monitorar mudanças em conversas/mensagens, NÃO faça polling:

```
Polling errado:
  while True: GET /conversations every 5s → MUITO ruim
```

Use webhooks (config na conta):
- `conversation_created`
- `message_created`
- `conversation_resolved`
- Etc

LionChat envia POST pro seu endpoint quando o evento dispara.

## OAuth (apenas MCP Remote)

### "invalid_client_metadata"
Cliente OAuth registrado errado. Verifique:
- `token_endpoint_auth_method` = `none` (pra Claude/ChatGPT)
- `redirect_uris` exato (https, sem trailing slash extra)

### "invalid_grant"
Auth code expirou (vida curta — segundos). Refazer login.

### "Conector desconectou sozinho"
Geralmente: refresh_token expirou (TTL passou).

Hoje no LionChat: TTL é ~100 anos. Se desconectar, provavelmente:
- Token revogado manualmente
- Conta suspensa
- Restart do serviço MCP Remote

### "Consent loop infinito"
Bug conhecido: `Grant` não criado explicitamente. Atualizar MCP Remote pra versão >= 0.3.0.

## Logs e debugging

### Como pegar request ID
Toda resposta da API tem header `X-Request-ID`. Inclua no relatório se algo falhar.

### Como ver logs do MCP Server local
```bash
# Stdio MCP imprime em stderr — capture no Claude Desktop logs:
~/Library/Logs/Claude/mcp*.log
```

### Como ver logs do MCP Remote (servidor produção)
- Painel Portainer → serviço `mcp_remote` → logs
- Cloudflare Worker logs (se proxy)
- Sentry pra exceptions

## "Import de contatos deu erro de telefone em toda linha" — regra do DDI (18/08)

O import (de contatos e do Kanban) **não completa mais o DDI**: o telefone precisa vir da planilha
COM o código do país (`5511988887777` ou `+5511988887777`; o `+` é opcional). Quem sobe sem DDI
recebe **erro na linha** — "Telefone ... em formato invalido — confira se veio COM o DDI" — e o
contato NÃO é criado (antes o sistema completava 55, o que colava 55 em número estrangeiro).
Regras: número que não existe em país nenhum é recusado; começando com 0 (zero de operadora) é
recusado; brasileiro com 55 e 12-13 dígitos é aceito mesmo no formato antigo sem o 9º dígito.
**Armadilhas**: `contacts_import_validate` NÃO valida telefone (validate verde não garante import
sem erro de telefone); no import do KANBAN, telefone inválido cria o card SEM contato e SEM
conversa, em silêncio — comportamento diferente do import de contatos.

**Complementos de 19/08:** telefone PREENCHIDO e inválido **recusa a linha inteira** — o contato não
nasce (antes ele nascia mudo, sem telefone). Coluna de telefone **vazia** continua criando o contato
(lista de nome + e-mail é uso legítimo). **Linha totalmente vazia não é erro**: é pulada e contada em
`blank_rows` no resultado — planilha de 300 linhas com 2 preenchidas deixa de gerar 298 "Nome é
obrigatório". Telefone em notação científica do Excel (`9,88888E+12`) recebe mensagem própria
("formate a coluna como texto"), não "confira o DDI". No `contacts_import_validate`, o número da
linha no relatório é a posição REAL no arquivo (linhas vazias contam na numeração, não no total
conferido).

## "A caixa oficial parou de disparar / de receber" — avisos automáticos da Meta (18/08)

Duas famílias de chaves novas em `additional_attributes` da caixa `Channel::Whatsapp`
(visíveis em `inboxes_show`/`inboxes_list`):
- **Bloqueio por pagamento** (erro Meta 131042): `whatsapp_send_blocked_billing` (true) +
  `whatsapp_send_blocked_at`. A caixa CONTINUA recebendo e respondendo dentro da janela; só o
  disparo iniciado pela empresa está travado. Limpa sozinha no próximo envio de TEMPLATE
  bem-sucedido — ou chamando `GET /inboxes/{id}/health`, que consulta a Meta e apaga o aviso se
  ela disser que o envio voltou (é o único GET da plataforma que escreve).
- **Desconexão** (aparelho/parceiro removido na Meta): `whatsapp_disconnect_event`,
  `whatsapp_disconnect_reason`, `whatsapp_disconnect_initiated_by`, `whatsapp_disconnected_at` —
  e `reauthorization_required` vira `true` SOZINHO. Com `reauthorization_required: true` a caixa
  fica MUDA (descarta o que chega) até reconectar. A ausência dessas chaves NÃO prova que a caixa
  está conectada (caixa antiga só ganha o aviso após reinscrição).
- **Registro do número incompleto** (20/08): `whatsapp_registration_error` (texto, a frase da
  própria Meta — ex.: verificação em duas etapas ligada num número que veio de outra plataforma).
  A caixa foi criada e **continua recebendo**; só o registro do número não terminou. É diferente de
  `reauthorization_required` (esse emudece a caixa). Orientação: resolver do lado da Meta e clicar
  em "Concluir registro" na caixa; a chave some quando o registro passa. Conectar uma caixa oficial
  é ação de administrador e respeita o teto de caixas do plano (402 antes de abrir a janela da Meta).
- Reconectar uma caixa em convivência pelo botão volta a pedir o histórico de 180 dias sozinho
  (19/08); é um tiro único por onboarding — se a Meta recusar fora da janela de 24 h, não há
  repetição.

## "O filtro de etiqueta 'não está presente' mente" — NUNCA mentiu pela API

O defeito corrigido em 17/08 era SÓ do navegador (a tela travava). O SQL de
`contacts_filter`/`conversations_filter` sempre esteve correto para `is_not_present` em etiquetas.
Se alguma anotação antiga disser que esse filtro mente por API, está errada. O que MUDOU de
verdade nos filtros: data FIXA com `is_greater_than`/`is_less_than` passou a cortar o dia no fuso
da CONTA (ver resource `filtros-e-relatorios`).

## "Mapeei o campo da integração pro atributo da conversa e nada foi gravado" (Meta Lead / Webhook Universal)

ATENÇÃO (26/08/2026): atributo de conversa mapeado existe SÓ no Meta Lead e no Webhook Universal.
Nos 9 gateways de pagamento a opção "salvar também na conversa" foi REMOVIDA (existiu de 21 a
26/08) — o backend ignora `conversation_attribute_keys` se estiver gravada; os gateways gravam os
dados da compra automaticamente no CONTATO, como sempre.

Três causas, nesta ordem: (1) o evento não abriu conversa — atributo de conversa só existe na
conversa que a automação/fluxo mapeado cria (contato sozinho não tem onde gravar); (2) a chave é
reservada (`imported_from`, `type`, `captain_*`... — lista em `api-conventions`) e foi recusada;
(3) o valor não é do TIPO do atributo (texto num campo de Número, data em formato estranho) e foi
descartado — o log do servidor tem `[IntegrationAttributes] ... tipo_invalido=[...]`.
Gravar por integração é silencioso: não espere automação nem webhook de saída reagindo ao atributo.

## Quando reportar pro suporte

Reporte se:
- 500/502/503 persistente após 3 retries
- 401 com token recém-gerado
- Dados sumindo sem ação clara
- Comportamento inconsistente entre contas

NÃO precisa reportar:
- 4xx (você fez algo errado)
- Rate limit (esperado)
- 404 de recurso deletado

## Conector REMOTO "conecta e desconecta" a cada ~6 minutos (Claude Code / VS Code / Codex ligados direto)

Vale SÓ para o conector remoto (`mcp.lionchat.com.br`). O conector local (npm, stdio) não tem canal de rede.
Sintoma: `/mcp` alterna connected/disconnected a cada ~6 min; nenhuma chamada falha.
Causa (21/08/2026): o cliente segura um canal GET esperando avisos do servidor; o Cloudflare derruba
qualquer resposta que fique 125 s sem um byte (Proxy Read Timeout). Quem usa pela claude.ai/ChatGPT não
abre esse canal e nunca vê isso.
Correção (v1.15.1): o servidor manda um `ping` a cada 30 s enquanto o canal está aberto.
Interruptor: `MCP_KEEPALIVE_INTERVAL_MS` (0 = desligado). Detalhe: `docs/plans/mcp-keepalive-cloudflare/`.

## "O grupo não recebeu o resumo diário" (Avisos de relatório) — 27/08

Diagnóstico em 2 passos: `lionchat_report_alerts_list` (colunas `last_delivery_status`/`last_error`
resumem o último dia; `next_send_on` diz o próximo) e `lionchat_report_alerts_deliveries` (histórico
de 90 dias com o TEXTO congelado de cada envio). Leitura dos status: `confirmed` = entregue COM
recibo do canal; `sent` = saiu e o recibo ainda não veio (reconfere sozinho em ~15 min); `send_failed`
= o canal recusou (motivo em `error_message` — caixa desconectada é o clássico: mande reconectar o
WhatsApp QR); `skipped_late` = não saiu na janela de 3h (sistema congestionado; tenta amanhã — não é
preciso fazer nada); `error` = falhou antes de enviar (ex.: 'conta suspensa', 'a conversa de destino
não existe mais', 'nenhum bloco do relatório pôde ser calculado'). Aviso criado hoje DEPOIS do
horário não dispara hoje (primeiro envio é amanhã) — não é defeito.

## "A prévia do Aviso fica em pending pra sempre" — 27/08

`report_alerts_preview_status` devolve `pending` enquanto o job (fila de baixa prioridade) não roda —
normalmente 5-60 s, até ~2-3 min com a plataforma cheia. Espere 5-10 s entre leituras; NUNCA dispare
outra prévia por impaciência (cada rodada com IA gasta a chave OpenAI da conta). O resultado expira
5 min depois de pronto: `pending` que virou `error: token inválido` = token errado/expirado, rode a
prévia de novo. Token tem 32 caracteres hex — confira que guardou o valor INTEIRO.

## "Mandei mensagem numa conversa cheia de histórico e a Meta recusou (131047)" — 26/08

Conversa que só tem mensagens IMPORTADAS de histórico NÃO tem janela de 24h aberta — para a Meta,
aquele contato nunca escreveu pela conexão oficial (a mensagem existe no painel porque a importação a
copiou do celular). O envio de texto livre é recusado mesmo com a fala do cliente visível na tela.
Saída: modelo aprovado (template) ou esperar o cliente escrever de verdade pela caixa oficial.

## "Adicionei etiqueta e as antigas sumiram" — CORRIGIDO em 24/08

Era defeito real (o segundo bloco "Adicionar etiqueta" do mesmo fluxo apagava as do primeiro, e
salvar status/prioridade apagava etiqueta posta por outro no meio do caminho). Hoje ADICIONAR SOMA,
em todos os caminhos (fluxo, IA, API, ações em massa). Se um cliente relatar isso em versão antiga
(whitelabel atrasado), é a versão — não oriente gambiarra de "reaplicar etiqueta".

## "Os leads do Meta chegam só com id de campanha, sem nome" — 25/08

Nome de campanha/conjunto/anúncio exige o **token de ANÚNCIOS** (é outro token, de CONTA — o login
da página não basta). Diagnóstico: `lionchat_meta_lead_validate_token` (sem corpo testa o salvo) diz
se o token é válido, de qual app e se alcança anúncio de verdade. Gravar/trocar:
`lionchat_meta_lead_ads_token` — ao gravar, o servidor reprocessa retroativamente os leads que
ficaram sem nome. E desde 25/08 o CONECTAR exige escolha: `meta_lead_create` com `page_ids` (sem
ele TODAS as páginas do login entram — caso real de 25 páginas numa conta); pra limpar excesso
antigo, `lionchat_meta_lead_bulk_destroy`.

### "Testei o token de anúncios e voltou '(#100) App_id did not match' / a tela dizia Pendente com o token salvo" — 01/09

Corrigido em 01/09. O token de anúncios que o cliente cola pode ser de OUTRO app da Meta (usuário de
sistema da própria BM) — o `debug_token` só responde para tokens do nosso app, e o teste concluía
"inválido" para um token válido (caso real: conta 53, 51 contas de anúncio alcançáveis). Agora
`lionchat_meta_lead_validate_token` cai num caminho sem `debug_token`: responde `valid: true` com
`app_verified: false` e `app_id`/`app_name`/`expires_at` **nulos** (não há como saber sem o debug_token —
NÃO afirme "nunca expira"), `permissions` (do `me/permissions`, só as concedidas) e `ads_check`
(`{ok, ad_accounts_count}` = alcança anúncio de verdade). Token do NOSSO app segue com `app_verified: true`
e validade. Segundo ajuste: o resumo de conta (`ads_capable`/`has_manual_ads_token` em `meta_lead_list` e na
resposta de `ads_token`) considerava só integrações LIGADAS — conta com todas as páginas desligadas parecia
"sem token". Agora prefere as ligadas e, sem nenhuma, olha todas. Páginas com `token_expired` continuam
precisando de reconexão por um admin da página — o token de anúncios não resolve isso.

### "Menção em grupo mostra um código no lugar do nome" — 01/09

`@201103320871050` no lugar de `@Marcelo`: o WhatsApp identifica cada APARELHO com `:NN` no fim do
telefone e o aprendizado do grupo colava o número do aparelho no telefone (`551599749220048`), que não
existe. Corrigido em 01/09 (aguarda deploy): a próxima mensagem de cada participante conserta o par
sozinha; para reescrever menções antigas há o rake `waha:backfill_mentions` — só DEPOIS do deploy.

## "Atualizei a chave da caixa oficial pelo update e ela parou de receber" — 26/08

`inboxes_update` com `channel.provider_config` SUBSTITUI o objeto inteiro: mandar só o campo
alterado APAGA `webhook_verify_token` e a marca `source` em silêncio — a caixa para de receber
webhook da Meta. Regra: leia a caixa antes (`inboxes_show`), reenvie o `provider_config` COMPLETO
com o campo trocado. Os três campos da conexão manual (`phone_number_id`, `business_account_id`,
`api_key`) são validados JUNTOS na Meta a cada gravação — 422 "Invalid Credentials" significa que
algum dos três está errado ou a chave venceu (não salve campo a campo).

## Mutirões que NÃO são da API — o MCP não executa, mas deve saber que existem (02/09/2026)

São tarefas de terminal (o operador da plataforma roda). Se o cliente pedir uma destas, explique o
que faz e encaminhe — não tente resolver por comando do MCP.

| Situação | Tarefa | Como é chamada |
|---|---|---|
| Contato com a conversa de arquivo separada da conversa viva (pares antigos, anteriores a 02/09) | juntar os pares | `conversas:juntar_pares[conta, modo, limite]` — **modo `ensaio` por padrão**, só junta com `valendo`; e `conversas:juntar_par[arquivo, viva]` para um par nomeado |
| Fluxo parado em "ativo" há horas depois de uma queda de banco | destravar sessões | `flow_builder:sessoes_presas` com `MODO=ensaio` (padrão), `encerrar` ou `retomar` |
| Gravação de ligação do VTCall que não abre | reconferir gravações | tarefa própria de VTCall |

**A regra do ensaio:** os dois primeiros nascem em modo ENSAIO de propósito — mostram o que fariam
sem mexer em nada. Nunca oriente a rodar direto em "valendo" sem o ensaio antes.

## Conversa de arquivo: por que a mensagem não sai (02/09/2026)

Conversa que só tem histórico importado, sem nenhuma resposta viva do cliente, está com a **janela de
24h FECHADA** — para o WhatsApp aquele contato nunca escreveu. Texto livre falha; só modelo aprovado
sai. Confira `last_incoming_message_at` na conversa: vazio ou antigo = janela fechada.

Desde 02/09 a mensagem que chega ADOTA essa conversa (não abre outra). Se um fluxo/automação/IA
dependia do gatilho **"conversa criada"** para acordar nesse caso, ele não roda mais na adoção —
troque para **"Conversa reaberta"**.
