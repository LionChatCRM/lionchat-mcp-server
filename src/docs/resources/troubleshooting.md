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

### "Editei o evento no Google Calendar e não sincronizou"
Auto-cura desde 2026-06-09: o vigia horário re-arma o "watch" morto de conexões saudáveis
sozinho (sem reconectar a conta). Se persistir >1h, aí sim investigar a conexão
(`google_calendar` tools — campo watch_expiration).

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
