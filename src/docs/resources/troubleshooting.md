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
- `"phone_number has already been taken"` — mesmo problema
- `"phone_number must be a valid number with country code"` — formato E.164: `+5511999999999`

### Message
- `"content can't be blank"` — mensagem vazia (use template se for attachment-only)
- `"private must be boolean"` — true/false, não string

### KanbanItem
- `"funnel_stage does not exist in funnel"` — etapa inválida pro funil
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
`additional_attributes.waha_whatsapp_lid` do contato e o status da sessão
(`GET /inboxes/{id}/waha/status`).

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

Cancelar vale pra TODOS os grupos (inclusive `permanent`, `window_expired`, `campaign` e `partial`,
que nunca seriam reenviados) — é assim que se limpa o painel. Ações irreversíveis: confirme com o
usuário e mostre as contagens do summary antes.

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

### "A gestão de assinatura volta 404 dizendo feature_disabled" (15/08)
Não é assinatura inexistente. O 404 com `code: "feature_disabled"` significa que a **feature de
gestão de assinatura está desligada** para essa conta (é liberada conta a conta no painel de
suporte). O 404 é de propósito — não anuncia a tela para quem não tem acesso.

**Ação:** não retry, não procure outro ID. Oriente o usuário a pedir a liberação ao suporte. Se o
`code` NÃO vier, aí sim é 404 de verdade: a assinatura não existe no Guru. E 403 é outra coisa —
a feature está ligada, mas quem chamou não é administrador da conta.

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
