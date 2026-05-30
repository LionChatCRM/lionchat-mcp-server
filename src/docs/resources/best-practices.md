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

## Variáveis de conta (account_variables)

Pra dados que se repetem (slogans, endereços, horários):
- `account_variables_create` UMA vez
- Use em templates com `{{slogan}}`, `{{endereco}}`
- Atualiza UMA vez, propaga pra todo lugar

Nunca hard-code esses dados em respostas geradas.

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
