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
| `conversations_list` | `status` (open/resolved/pending/snoozed/all), `assignee_type`, `conversation_type` (unread/unattended/mention/participating), `inbox_id`, `team_id`, `labels`, `captain_assistant` (any=com IA / none=sem IA / id do assistente), `quick_q` (busca rápida na lista), `source_id`, `updated_within` (segundos) |
| `contacts_list` | `q` (nome/email/telefone), `include_contact_inboxes` |
| `messages_search` | `q`, `file_type[]`, `private_only`, `page` (busca dentro de UMA conversa) |
| `kanban_items_list` | `funnel_id`, `funnel_stage`, `assigned_agent_id` |
| `reports_list_*` | `since`, `until`, `metric`, `type` |

**Dica:** sempre filtre por período (`since`/`until`) em relatórios — sem isso pode trazer anos de histórico.

## Paginação

Endpoints listáveis paginam (page-size varia: contatos=15, conversas/chamadas=25, busca de msg=20). Use `page`:

```
page=1 → primeira página
page=2 → próxima
```

O conector devolve `pagination.total_count` e `pagination.has_more` — **pagine enquanto `has_more=true`** (não pare na 1ª página). Se `has_more=false`, acabou. Não tente "paginar até zerar" quando o total já é enorme (milhões) — filtre antes.

**Respostas grandes (atualizado 2026-07-24):** o teto continua 80 mil caracteres, mas agora com 3 melhorias:
(1) **Slim por padrão** — listas voltam sem campos pesados/decorativos (`message_templates`, `working_hours`, avatares, `meta_history_import` viram `[omitido...]`); pra resposta completa use `full_response:true` (tools de lista/show pesadas). (2) **Corte limpo** — ao estourar o teto, a resposta é enxugada por ITENS INTEIROS com o aviso `[LISTA ENXUGADA: exibindo N de M itens...]`; o JSON nunca vem quebrado no meio. (3) **Segredos** — chaves de credencial (api_key, tokens, senhas) saem SEMPRE `[REDACTED]`, sem exceção. Se ainda aparecer `[RESPOSTA CORTADA ...]` (shape sem lista reconhecível), os dados vieram INCOMPLETOS — NÃO insista na mesma chamada: **ESTREITE** (reduza `since`/`until`, adicione filtros, use `per_page` menor, ou pagine com `page`). **Relatórios agregados** (`reports_summary`, `sla_metrics`, `csat_metrics`, `journey_funnel_reports`, `lead_origin_reports`) **NÃO paginam** — se cortar, restrinja o período. Pra CSAT em lista (`csat_list`), o total vem só no `csat_metrics` — combine os dois. Guia completo de filtros: resource `filtros-e-relatorios`.

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

- `kanban_bulk_bulk_actions` — **NÃO é de cards do Kanban**, apesar do nome. Ela bate em
  `POST /bulk_actions` e age em **conversas ou contatos** (o `type` é `Conversation` ou `Contact`).
  Usar ela achando que move card não dá erro visível — só não faz o que você queria.
- Cards do Kanban têm **três** ferramentas próprias, uma por ação:
  - `kanban_bulk_create` → `bulk_move_items` (mover cards de etapa)
  - `kanban_bulk_create_1` → `bulk_assign_agent` (definir o responsável)
  - `kanban_bulk_create_2` → `bulk_set_priority` (definir a prioridade)
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

## Formato do `config` no `captain_assistants_update` (2026-07-11)

O `config` DEVE ser enviado como **objeto** (ex.: `config: { disabled_tools: [...] }`), NUNCA como string/texto. Se vier em formato errado, o backend retorna **422** (não salva ignorando em silêncio). O update do `config` é **merge parcial** — mandar só o subset que muda (ex.: só `disabled_tools`) preserva os demais campos.

## AI Agente roteando por TIME (novo 2026-08-03)

O AI Agente ganhou 3 ferramentas de time: **Listar Times**, **Mover para Time** e **Tirar do Time**.
Antes ele só conseguia atribuir uma PESSOA; trocar de time exigia automação ou bloco de fluxo, com
o time escolhido de antemão por quem montou a regra.

**A descrição do time virou peça funcional.** É lendo `teams.description` que a IA decide para onde
mandar a conversa. Time sem descrição obriga a chumbar o nome no cenário — que é justamente o que
essas ferramentas vieram resolver.

> **Ao criar ou atualizar time (`lionchat_teams_create` / `_update`), preencha `description`
> dizendo QUANDO mandar para lá.** Ex.: `"Financeiro — cobrança, boleto, nota fiscal, reembolso,
> segunda via"`. Não é enfeite de tela: é o que a IA lê.

Travas que valem conhecer (não dá pra desligar):

| Trava | Efeito |
|---|---|
| Conta sem nenhum time | As 3 ferramentas nem aparecem para o agente |
| Alguém está atendendo (`assignee_id` preenchido) | Mover e Tirar **não agem**. Evita a IA arrancar a conversa da mão do atendente |
| Nome do time no cenário | Resolve por nome exato; não achando, tenta CONTÉM. Se der mais de um candidato, devolve a lista e **não adivinha** |
| Mover de time | **Não** faz handoff sozinho. Se a intenção é o humano assumir, o cenário precisa mandar chamar o handoff no mesmo turno |

`list_teams` é ferramenta de descoberta: fica escondida da tela de ferramentas e só carrega se
"Mover para Time" estiver ativa. Não tente ligá-la ou desligá-la sozinha em `config.disabled_tools`.

## Limite do prompt e cache OpenAI (2026-05-22)

- `config.instructions` (system prompt do agente) aceita até **20.000 caracteres** (antes 10k). Acima de 15k, o frontend mostra aviso "lost in the middle" — prefira colocar instruções críticas no início ou final.
- **Cache automático** ativo em todos os 16 modelos oferecidos na plataforma. Desconto 50-75% no input cachado, sem configuração. Reuso do prompt do agente em múltiplas conversas maximiza a economia.

### Lista real de modelos (`config.model`)

Estes são os 16 valores que o seletor de modelo do painel oferece (`ModelSelector.vue`). Só recomende
valores desta lista:

| Faixa | Modelos |
|---|---|
| Econômicos / rápidos | `gpt-4.1-nano`, `gpt-4o-mini`, `gpt-4.1-mini`, `gpt-5.4-nano`, `gpt-5.4-mini` |
| Intermediários | `gpt-4o`, `gpt-4.1`, `gpt-5-mini`, `gpt-5.4` |
| Raciocínio | `o3-mini`, `o4-mini` |
| Premium | `gpt-5`, `gpt-5.2`, `gpt-5.5`, `o1`, `o3` |

**`GPT-5.2 Pro` não existe.** O valor válido é `gpt-5.2`, sem "Pro".

> **PERIGO — família `gpt-5.6` (`gpt-5.6-luna`, `gpt-5.6-terra`, `gpt-5.6-sol`): REMOVIDA em 29/07/2026.**
> Esses modelos **recusam function tools** em `/v1/chat/completions` (erro 400 real: "Function tools with
> reasoning_effort are not supported"). Como o AI Agente usa ferramentas em **toda** resposta, 100% das
> chamadas falhavam e a IA ficava **MUDA** — sem erro na tela, sem resposta. Ficou 2 semanas invisível.
> **Nunca sugira, nunca grave** um `gpt-5.6` — nem se o cliente pedir "o mais novo/mais forte".
>
> O campo `config.model` **não tem lista branca no servidor**: ele é `store_accessor` do `config` e
> aceita qualquer texto sem validar. Modelo inválido salva com 200 e só quebra na hora de responder.
> Desde 29/07 o erro vira uma **nota privada em português** na conversa (`llm_request_rejected`) — é o
> primeiro lugar a olhar quando "a IA parou de responder logo depois de mexerem nas configurações".

## Follow-up automático multi-etapa (2026-06)

O follow-up do AI Agente agora suporta **cadência de até 3 etapas** via `config.follow_up_steps`:

```json
{ "config": { "feature_follow_up": true, "follow_up_steps": [
  { "after_minutes": 30,  "prompt": "Pergunte gentilmente se ainda tem interesse" },
  { "after_minutes": 240, "prompt": "Ofereça tirar dúvidas" },
  { "after_minutes": 1110, "prompt": "Última tentativa, despeça-se cordialmente" }
] } }
```

Regras: cada etapa ≥ 5 min; **soma total ≤ 1380 min (23h)**; máx 3 etapas. Campos legados
`follow_up_time` + `follow_up_prompt` continuam funcionando como 1 etapa única (e obedecem ao **mesmo
teto de 1380**).

> **O teto é 1380, não 1440** (`Captain::Assistant::FOLLOW_UP_MAX_TOTAL_MINUTES`). Motivo: a janela de
> 24h do WhatsApp conta a partir da **mensagem do cliente**, não do primeiro acompanhamento — 1h de
> folga evita agendar uma cobrança que a Meta recusaria na hora de enviar. Montar a cadência somando
> 1440 faz o salvamento ser **recusado**. Pegadinha: a mensagem de erro do campo legado `follow_up_time`
> ainda diz "must be between 5 and 1440 minutes", mas a validação usa 1380 — não confie no texto do erro.

(O exemplo acima soma exatamente 1380: 30 + 240 + 1110.)

Dispara quando o CLIENTE fica inativo após resposta da IA. O motor de follow-up é dedicado e
**só-leitura** (não executa ferramentas, não coleta dado — só redige a mensagem de retomada,
com saída estruturada garantida). `paused=true` no assistente corta os follow-ups também.

### "A IA nunca faz o follow-up" — o conserto é de 29/07, NÃO de 24/07

**Não repita que isso foi corrigido em 24/07.** A versão de 24/07 agendava o follow-up **dentro** do
bloco do "Responder na hora": ou seja, ela só funcionava quando esse interruptor estava **LIGADO** —
justamente o caso que menos precisa dela. Com "Responder na hora" **desligado**, a IA não fala, o único
outro gatilho (o hook de mensagem enviada) também não dispara, e a conversa fica **com IA ativa e sem
nenhum acompanhamento, para sempre**. Aconteceu em **140 conversas da conta 52** — todas criadas
DEPOIS do suposto conserto de 24/07. A ativação **manual pela tela** nunca esteve coberta em nenhuma
das duas versões até 29/07.

**"Responder na hora" e acompanhamento são INDEPENDENTES.** São perguntas diferentes:
- *Responder na hora* (`captain_reply_now` / `proactive`) = "a IA fala agora, sem esperar o cliente?"
- *Acompanhamento* (`feature_follow_up`) = "a IA cobra depois, se ninguém responder?"

Desligar o primeiro **não** deve desligar o segundo. Nunca oriente o cliente a ligar "Responder na
hora" para o acompanhamento funcionar.

**Corrigido de verdade em 2026-07-29**, nos três caminhos que ativam a IA, com o agendamento **fora**
do bloco do "Responder na hora":
- Flow, ação "Ativar IA" (`FlowBuilder::ActionDelegator`) — só em ativação nova (a conversa não tinha IA)
- Automação, ação "Atribuir assistente" (`AutomationRules::ActionService`)
- Ativação manual pela tela da conversa (`ConversationsController`) — armado **antes** da checagem do
  "Responder na hora"

**Ainda descoberto (não corrigido):** ativar a IA em **lote** (ação em massa de conversas com
`captain_assistant_id`) **não arma o acompanhamento nem dispara resposta imediata**. Se o cliente
ativou a IA em massa e reclama que ela não cobra de volta, é isso — e o caminho é reativar pela tela
ou por automação.

Diagnóstico, nesta ordem, quando relatarem "a IA nunca faz o follow-up":
1. `config.feature_follow_up` está ligado no assistente? E `paused` está desligado? (`paused=true`
   corta os follow-ups)
2. A ativação veio por **lote**? Então nunca foi armado.
3. Tem `follow_up_skip_conditions` batendo (etiqueta, atributo, janela de silêncio)?
4. A soma das etapas passa de 1380 min? Nesse caso o assistente nem salvou a cadência.

## Condições para NÃO fazer follow-up + horário de silêncio (2026-07)

`config.follow_up_skip_conditions` — array de até 3 condições (lógica OU: qualquer uma verdadeira
pula o follow-up). Tipos:

```json
{ "config": { "follow_up_skip_conditions": [
  { "type": "label", "operator": "present", "labels": ["follow-pausar"] },
  { "type": "conversation_attr", "attribute": "status_negociacao", "operator": "equal", "value": "fechado" },
  { "type": "time_window", "start": 22, "end": 7 }
] } }
```

- `label`: pula se a conversa TEM (`present`) / NÃO tem (`absent`) alguma das etiquetas.
- `contact_attr` / `conversation_attr`: pula quando o atributo do contato/conversa bate o operador
  (`equal`, `not_equal`, `contains`, `present`, `blank`, `gt`, `lt`) com `value`.
- **`time_window` (horário de silêncio)**: `start` e `end` são horas inteiras 0-23 (fuso America/Sao_Paulo).
  No período a IA **NÃO envia follow-up**, mas **continua respondendo o cliente normalmente**. Janela
  **circular**: `22→7` = silêncio das 22h até as 7h (22,23,0…6). O passo que cai no silêncio é PULADO
  (não empurra pra frente — evita disparo em massa na abertura); a cadência segue nos passos seguintes.
  `start == end` = janela inválida (ignorada). Ideal pra não incomodar cliente de madrugada.

## Follow-up fora da janela de 24h usa TEMPLATE (novo 2026-07-30)

Em caixa **WhatsApp oficial**, passadas 24h da última mensagem do cliente, a Meta recusa qualquer texto
escrito pela IA. Até 30/07 o follow-up nem perguntava: escrevia, o canal recusava e sobrava um balão
vermelho com o erro enganoso "Template not found or invalid template name" (392 balões assim num único
dia numa conta). Agora o gerador de follow-up recebe os modelos aprovados da caixa ANTES de escrever e
escolhe um deles quando a janela está fechada.

O que isso significa na prática, pra explicar ao cliente:
- **Conta em caixa oficial que quer follow-up depois de 24h PRECISA ter template aprovado na Meta.**
  Sem nenhum template, não há como falar fora da janela — não é limitação da plataforma, é regra da Meta.
- **Mandar template não reabre a janela.** Só a resposta do cliente reabre. Um follow-up por template
  pode ser respondido — e é a resposta dele que libera texto livre de novo.
- **Trava anti-repetição:** modelo já enviado naquele ciclo de follow-up sai da lista. Numa conta com um
  único template (normalmente o mesmo da campanha), sem essa trava o cliente receberia minutos depois o
  mesmo texto que acabou de ler.
- Dentro da janela nada muda: o follow-up continua sendo texto livre, escrito pela IA.

## Desligar a IA quando um humano assume (2026-07)

`config.feature_pause_on_human_reply` (bool, padrão false). Ligado, a IA **se desliga sozinha** na
conversa (fica `captain_assistant_id=null` + `custom_attributes.captain_manually_disabled=true`)
assim que um HUMANO DE VERDADE assume — atendente responde o cliente pelo painel (ao vivo) OU a
mensagem sai do celular (coexistência WhatsApp). NÃO desliga: nota privada, mensagem da própria IA,
follow-up, automação, campanha, confirmação de agendamento, mensagem agendada. Gera uma pílula
"atendimento assumido pela equipe" na conversa. Pra religar: reatribuir o agente na conversa.

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
- **Corrigido em 2026-07-24:** a IA agora enxerga no prompt a lista de atributos personalizados
  definidos de **Conversa** e de **Card do Kanban** (antes só a de Contato chegava, e mesmo essa em
  parte) — por isso ela conseguia gravar atributo de contato mas "não funcionava" pra conversa/card.
  Regra prática que continua valendo: só dá pra a IA preencher atributo que **existe cadastrado**
  (`custom_attributes_create`) no modelo certo — conversa, contato ou card.

## Cenários com parâmetro fixo e execução determinística (2026-06)

- O admin pode FIXAR o parâmetro de uma ferramenta no cenário (campo scenario.tool_bindings): quais mídias enviar, qual funil+etapa do card, quais agendas no agendamento. "Deixar a IA decidir" = binding vazio.
- Quando UM cenário fixa a tool, a execução vira determinística (a IA não escolhe): mídia e kanban são aplicados pós-turno pelo BindingResolver (ordem texto→ação, sem duplicar, idempotente); o agendamento força/restringe a agenda mas a IA ainda define data/hora.
- Via MCP: scenarios_create/update persiste binding de send_media_asset e create_kanban_item/move_kanban_item (re-escopados por conta). O binding de create_booking NÃO é aceito pela API — pra limitar agendas via MCP, use config.booking_event_type_ids no assistente (captain_assistants_update). **Atualização 15/08:** o modo direto/avulso do create_booking foi REMOVIDO — agenda de Booking é o ÚNICO caminho de agendamento da IA (ver seção "O que mudou no agendamento DA IA").
- Receita pra criar/editar cenário com binding via MCP (scenarios_create / scenarios_update): (1) o corpo vai SEMPRE embrulhado em `scenario`; (2) a instrução PRECISA mencionar a ferramenta como link markdown `[Rótulo](tool://slug)` — menção crua `(tool://slug)` NÃO conta e o binding é descartado no salvamento; (3) envie `tool_bindings` com o shape: `send_media_asset` → `{ "asset_ids": [Int] }`, `create_kanban_item`/`move_kanban_item` → `{ "funnel_id": Int, "stage": "<chave da etapa>" }`. Não precisa mandar `tools` (é auto-extraído da instrução e sobrescrito). `create_booking` NÃO entra em tool_bindings pela API.
- Pra APONTAR uma página da base de conhecimento num cenário via MCP, escreva `[@Nome](document://ID)` (o ID numérico do documento) DENTRO do texto da `instruction` — igual ao link de tool, o motor deriva daí o campo `document_ids`. NÃO existe param `document_ids` na API/MCP (mandar seria descartado em silêncio). Teto de 3 documentos; a página apontada ganha PRIORIDADE na busca RAG, NÃO exclusividade (o resto da base continua pesquisável).

## Variáveis {{ }} nas instruções do AI Agente (2026-06)

As instruções aceitam variáveis Liquid `{{ }}` que chegam JÁ PREENCHIDAS com os dados reais do contato/conversa do atendimento — vale pra instrução base do assistente (`config.instructions`) e pra instrução de cada cenário (`scenario.instruction`). O texto é gravado como está (sem sanitização); cap de 20.000 chars na base.

- Contato: `{{contact.name}}`, `{{contact.first_name}}`, `{{contact.last_name}}`, `{{contact.email}}`, `{{contact.phone}}`, `{{contact.cpf}}`, `{{contact.cnpj}}`, `{{contact.rg}}`, `{{contact.date_of_birth}}`, `{{contact.profession}}`, `{{contact.address.city}}` (e `.cep`/`.street`/`.number`/`.neighborhood`/`.state`...), `{{contact.custom_attribute.<chave>}}`.
- Conversa: `{{conversation.display_id}}`, `{{conversation.custom_attribute.<chave>}}`.
- Variável sem valor sai vazia (não quebra). Texto SEM `{{` sai idêntico (preserva o cache do prompt) — só use variável quando agregar. Erro de digitação (filtro inválido, `{{` sem fechar) degrada suave: o pedaço com erro sai vazio e o resto das variáveis continua resolvendo (exceção: bloco `{% %}` sem fechar ainda cai pra texto cru).
- Conta (2026-07): `{{account.custom_attribute.<chave>}}` (slogan, endereço...) AGORA resolve nas instruções e cenários — MAS só os atributos de conta que você DEFINIU (via `account_variables_create`); campos internos de faturamento e secrets NUNCA aparecem no autocomplete nem resolvem. O editor de Instruções/Cenários já sugere essas variáveis de conta ao digitar `{{`.
- Simulador/Playground: agora também substitui as variáveis (com os dados do painel de teste). Obs.: CPF/CNPJ/endereço não são coletados no painel, então saem vazios só no teste (na conversa real funcionam).

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

## Campanhas: público avançado + exclusão ("negativar") (2026-07)

`audience` aceita 7 tipos de seção combináveis (cada seção é `{type, ...}`):
- `Label` `{id}` — etiqueta de CONVERSA
- `Funnel` `{id, stage_id?, include_won?, include_lost?}` — etapa de funil Kanban
- `ConversationAttribute` `{key, value}` — atributo da conversa
- `ContactLabel` `{id}` — etiqueta de CONTATO (novo)
- `ContactAttribute` `{key, value}` — atributo do contato (novo)
- `CardAttribute` `{key, value}` — atributo do card Kanban (novo)
- `AgentTeam` `{assignee_ids:[], team_ids:[]}` — responsável atual OU time da conversa (novo)

O campo `audience_mode` define a combinação ENTRE seções:
- `"sum"` (default): união — contato em QUALQUER seção entra
- `"all"`: interseção — contato precisa atender TODAS as seções preenchidas

**Exclusão / "negativar" (novo 2026-07):** `exclusion` é uma lista no MESMO formato do `audience`.
Quem cair na exclusão é REMOVIDO do disparo, mesmo que esteja no público. No `campaigns_estimate_audience`
o `exclusion` (e o `audience_mode`) vão TOP-LEVEL; ao CRIAR/EDITAR a campanha eles vão dentro de
`trigger_rules` (`trigger_rules.exclusion` e `trigger_rules.audience_mode`).

**Ações pós-disparo** (`template_params.bulk_actions`, campanhas QR/WAHA) aceitam, além de
`{assignee_id, priority, labels}`: `contact_labels: []` (aplica etiqueta ao CONTATO que recebeu) e
`attribute_changes: [{scope:'contact'|'conversation', key, value}]` (grava/sobrescreve atributo de quem recebeu).

**Público por PLANILHA (novo 2026-07-31):** o painel passou a aceitar CSV/XLS como público do disparo,
nas três abas de campanha. **Não existe tipo novo de público** — a importação marca os contatos da
planilha com uma **etiqueta de contato** e/ou um **atributo de contato**, e a campanha usa os tipos que
já existiam (`ContactLabel` / `ContactAttribute`).

Ou seja: **dá pra reproduzir pela API.** Importe os contatos aplicando uma marca própria da lista (ex.:
etiqueta `lista-black-friday`) e monte o `audience` com `{"type": "ContactLabel", "id": <id>}`. Se o
cliente pedir "disparar pra essa planilha", esse é o caminho. A marcação em lote é feita em silêncio
(sem callback nem evento), então importar uma lista grande **não acorda automação nem fluxo** — foi
desenhada assim de propósito, pra não repetir a tempestade de eventos de 29/07.

SEMPRE rode `campaigns_estimate_audience` com o MESMO audience + audience_mode + exclusion antes de
criar a campanha e mostre a contagem ao usuário — estimativa e disparo usam o mesmo motor (não divergem).

## Agendamento (booking): idempotência e limites (2026-06)

- Reservar o MESMO contato+evento+horário de novo retorna a reserva existente (não duplica) —
  retry de rede é seguro.
- Rate limit da reserva pública: 10/5min por IP + 20/min por conta (429 ao estourar).
- Todo agendamento aparece vinculado a uma conversa (cria/reusa a conversa do contato).

### O que mudou no agendamento DA IA (2026-08-15)

**1. A IA só agenda por AGENDA de Booking.** `view_booking_option` virou a ÚNICA fonte de horário
— o modo direto/avulso do `create_booking` foi REMOVIDO (era o único caminho que criava
compromisso fora do motor de reservas). Consequência prática: a IA passou a respeitar os dias em
que a agenda NUNCA abre (parou de oferecer domingo) e não inventa mais identificador de agenda —
com uma única agenda liberada ela assume essa; com duas ou mais, recusa nomeando as válidas. Para
restringir quais agendas a IA oferece, continua valendo `captain_assistants_update` com
`config.booking_event_type_ids`.

**2. A IA entrega o link do Meet sozinha.** O link do Google Meet não existe no instante em que o
agendamento é criado (nasce depois da ida ao Google), e antes a IA prometia o link e nunca voltava.
Agora o sistema arma uma volta de ~25s; sem link ainda, ele remarca sozinho (+40s) sem gastar turno
de IA; com link, a IA manda o endereço literal. Se na segunda tentativa o link não veio, ela avisa
o cliente e aciona um humano (nota privada com menção). Requisitos: o tipo de agendamento precisa
gerar Meet e o dono da agenda precisa ter o Google conectado. `{{conversation.custom_attribute.meet_link}}`
e o `{{meet_link}}` da mensagem de confirmação do Booking passaram a vir preenchidos (antes saíam
vazios) — isso vale inclusive para cliente que não usa IA.

**3. A IA não confirma reunião que não existe.** No último instante antes da resposta virar
mensagem: se ela afirma agendamento concluído, a agenda está liberada e não há compromisso real na
conversa, o sistema roda UMA tentativa guiada que agenda de verdade com a data/hora prometidas.
Agendou, sai a confirmação verdadeira; não agendou, a frase é trocada por uma honesta — nunca
silêncio. Diagnóstico: se o cliente disser "a IA confirmou e não tem nada na agenda", esse é o
comportamento ANTIGO (medido: 39 afirmações falsas em 30 dias antes do conserto).

## Variáveis de conta (account_variables)

Pra dados fixos que se repetem (slogans, endereços, horários):
- `account_variables_create` UMA vez — campos: `attribute_display_name` (rótulo), `attribute_key` (a chave usada no `{{ }}`), `attribute_display_type`, `value`. Admin-only.
- Tipos oferecidos na tela (2026-07-25): **Texto** (`text`), **Data** (`date`), **Hora** (`time`) e **Confidencial** (`secret`). Data e Hora gravam o valor já normalizado (`AAAA-MM-DD` e `HH:MM` em 24h) — antes a tela só tinha Texto e a data entrava como texto solto, sem validar formato. Os demais tipos do enum (`number`, `list`, `link`, `checkbox`, `currency`, `percent`, `datetime`) funcionam pela API, mas a tela os edita como texto.
- O **tipo e a chave não mudam depois de criados** — `account_variables_update` só altera rótulo, descrição e valor. Pra trocar o tipo, apague e crie de novo.
- Use em templates com a sintaxe COMPLETA `{{ account.custom_attribute.<attribute_key> }}` (ex: `{{ account.custom_attribute.slogan }}`). NÃO existe atalho `{{slogan}}` solto — sem o prefixo `account.custom_attribute.` não resolve.
- Resolve em: mensagens, respostas prontas, campanhas e automações. NÃO resolve nas instruções do AI Agente (base/cenário) — ali só `contact.*` e `conversation.*`.
- `secret` nunca aparece em template (sai vazio); só resolve em nós API Request do FlowBuilder.
- Atualiza UMA vez, propaga pra todo lugar.
- **Teto de 32 KB por variável (novo 01/08/2026).** Valor maior que isso é recusado com HTTP 422. É por
  VARIÁVEL, não pela soma — conta com dezenas de tokens legítimos (uma delas tem 23 tokens de
  integração) não é punida. A maior variável legítima medida na plataforma tem 348 bytes, então o teto
  dá ~90x de folga: cabe qualquer token, URL, endereço ou texto de configuração; **não** cabe base de
  dados, JSON gigante nem script. Se o cliente quiser guardar algo desse tamanho, o lugar é um arquivo
  ou uma integração, não uma Variável de Conta.

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
- Botão com link (CTA) da resposta pronta/flow: a URL do botão aceita variáveis
  (`{{contact.name}}`, `{{contact.phone}}`, atributo etc.) — cada valor é codificado
  automaticamente (espaço vira `%20`), então o link nunca quebra. Útil pra rastrear cliques.

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

**Variável sem mapping tem preço (2026-08-04).** Placeholder que ninguém disse como preencher:

1. **Tira o modelo do alcance do AI Agente.** Basta UMA variável sem mapping para o modelo inteiro
   deixar de ser oferecido no follow-up automático fora da janela de 24h.
2. **Faz a mensagem sair com um PONTO no lugar da variável.** Desde 04/08/2026 posição sem valor
   não derruba mais o envio (antes era `#132000`): o sistema preenche `.` e entrega — "Olá ., sua
   consulta é dia ." chega assim pro cliente, marcado como sucesso. Rastro:
   `additional_attributes.template_param_fallback` na mensagem (lista das posições preenchidas com
   o piso). Numa campanha isso vira dezenas de clientes recebendo ponto (caso real 21/08: 65
   pessoas).

Vale para os dois formatos de marcador: posicional (`{{1}}`) e nomeado (`{{nome_cliente}}`).

> Ao registrar modelo por API, **mapeie todas as variáveis do corpo** — ou preencha TODAS as
> posições em `processed_params` na hora do envio/campanha, e confira antes de criar a campanha que
> nenhuma está vazia. Modelo com variável órfã é modelo que a IA não usa e que entrega ponto.

Confira o que ficou de fora lendo o modelo com `lionchat_inboxes_whatsapp_templates_list` e
comparando os `{{...}}` do texto do BODY com as chaves do `variable_mapping`.

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

### Apontar variáveis SEM reenviar pra Meta (2026-08-07)

Antes, mudar o `variable_mapping` de um template JÁ APROVADO exigia o endpoint de update
(`POST .../whatsapp_templates/{id}`) — que reenvia o modelo pra Meta e o status volta pra
**Pendente** à toa. Agora existe um endpoint SÓ pro apontamento local:

```
PATCH /api/v1/accounts/{account_id}/inboxes/{inbox_id}/whatsapp_templates/{template_id}/variable_mapping
Body: { "variable_mapping": { "1": { "source": "contact", "field": "name", "label": "Nome do contato" } } }
```

- **ZERO chamada à Meta**: o template continua Aprovado, sem nova revisão. Use SEMPRE este quando a
  mudança for só o apontamento; o update de verdade fica pra quando o TEXTO/estrutura mudar.
- `{template_id}` é o **id numérico da Meta** (o campo `id` do template na listagem), não o nome.
- O conjunto enviado **substitui** todos os apontamentos de corpo: mande TODAS as variáveis que
  devem ficar apontadas, não só a que mudou (a ausente é removida). Vazio `{}` limpa tudo.
- Chaves `_` (`_button_url`, `_header_media`, `_header_location`) são preservadas sozinhas e
  **recusadas** como entrada — pra mexer nelas, use o update normal.
- Recusas (422): categoria AUTHENTICATION, chave que não existe no corpo aprovado, valor sem
  `{source, field}`, `source` fora de contact/conversation/account/custom, caixa que não seja
  WhatsApp Cloud oficial.
- Papel: administrador.

### Botão de link do template com variável — link rastreável por cliente (2026-07-25)

O botão de URL do template pode terminar com uma variável, pra montar um link diferente por contato
(rastrear cliques, pré-preencher formulário, etc).

Regras da Meta (o template é recusado na hora se furar qualquer uma):

- No máximo **UMA** variável no botão, e ela é sempre `{{1}}`.
- `{{1}}` só pode ficar **no FINAL** da URL, com base `https://` fixa antes.
- O componente `BUTTONS` precisa mandar `example` com a URL completa de exemplo (sem ele, erro 100).

E o `variable_mapping` recebe a chave especial `_button_url` (com underscore na frente de propósito:
ela **não** conta como variável de corpo):

```json
{
  "components": [
    { "type": "BODY", "text": "Olá {{1}}, sua proposta está pronta." ,
      "example": { "body_text": [["Maria"]] } },
    { "type": "BUTTONS", "buttons": [
      { "type": "URL", "text": "Ver proposta",
        "url": "https://minhaempresa.com.br/proposta?cliente={{1}}",
        "example": ["https://minhaempresa.com.br/proposta?cliente=Maria Silva"] }
    ] }
  ],
  "variable_mapping": {
    "1": { "source": "contact", "field": "name.split.first", "label": "Primeiro nome" },
    "_button_url": { "source": "contact", "field": "name", "label": "Nome completo",
                     "example": "Maria Silva", "button_index": 0 }
  }
}
```

- `button_index` = a **posição do botão** dentro do componente `BUTTONS` (0 = primeiro).
- `source`/`field` usam a mesma tabela de fontes acima, mais `custom` (texto fixo, escrito no `field`).
- No envio, o valor é **codificado automaticamente** (espaço vira `%20`) — o link nunca quebra.
- Vale em conversa, automação, flow, agendada e campanha (na campanha resolve por contato).

O mesmo vale pro **botão de link (CTA)** de resposta pronta e do FlowBuilder: a URL aceita
`{{contact.name}}`, `{{contact.phone}}`, atributo personalizado etc., com a mesma codificação
automática. Ver a seção de variáveis de conta acima.

## FlowBuilder — notas de editor (2026-07)

- **Tipo de atributo `time` (Hora 24h):** ao criar custom attribute com `attribute_display_type: "time"` (ou o numérico `9`), o valor canônico é `"HH:MM"` 24h e o fuso mora na definição (`attribute_timezone`, IANA, default `America/Sao_Paulo`). Uso principal: alimentar o campo Horário do node `wait` (modo date, `waitTimeMode: "variable"`).
- **Tipo de atributo `datetime` (Data e Hora, novo 2026-07-18):** `attribute_display_type: "datetime"` (ou numérico `10`), com `attribute_timezone` (default `America/Sao_Paulo`). Guarda data+hora juntas em ISO com offset (`"2026-07-18T14:55:00-03:00"`); exibe `"DD/MM/AAAA - HH:MM"`. Um porteiro no backend aceita e converte vários formatos de entrada (ISO/UTC/BR/AM-PM/unix). **ATENÇÃO ao montar flows:** o tipo `datetime` NÃO é selecionável no Gatilho de Data nem nos campos Data/Horário do node `wait` — esses continuam exigindo `date`(5) pra data e `time`(9) pra hora, SEPARADOS. O `datetime` é, por ora, tipo de armazenamento/exibição (sidebar + mensagens humanas), não fonte de entrada de fluxo. Em condição, atributo `datetime` é tratado como string (compara o ISO cru).
- **Timeout de flow `ai_tool` com node `api`:** sobe sozinho de 20s pro teto de 45s quando ainda está no padrão — não precisa configurar nada; só evite setar `execution_timeout_ms` custom se quiser manter o auto-ajuste.
- **Teste do node `api`:** o resultado do último teste fica salvo no servidor (pin, TTL 30 dias) — sobrevive a trocar de navegador/máquina. Isso é recurso do editor humano; não há tool MCP pra isso.

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
4. **Anexo de MENSAGEM aceita QUALQUER tipo de arquivo (novo 15/08)** — só o TAMANHO reprova. Se
   houver dúvida sobre um arquivo grande, confira antes com `lionchat_upload_limits_show` (segue
   sendo a fonte dos tetos).

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
| Automação "ao Ganhar → criar card noutro funil" | regra AutomationRule complexa | popular `funnel.settings.automations` com `action: duplicate_item` |
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


## Regras rápidas de 18/08

- **Mensagens: ordene SEMPRE por `created_at`, nunca por `id`.** Conversa com histórico importado
  tem id fora de ordem por desenho (o id cresce na importação, a data é a original). A API já
  devolve em ordem cronológica.
- **Import de contatos: o DDI é da planilha.** O sistema não completa 55; sem DDI = erro na linha;
  `contacts_import_validate` NÃO valida telefone. No import do Kanban, telefone inválido cria card
  SEM contato em silêncio. Oriente o cliente a subir `5511988887777` ou `+351912345678`.
- **Caixa oficial com aviso de bloqueio por pagamento** (`whatsapp_send_blocked_billing`):
  `GET /inboxes/{id}/health` consulta a Meta e LIMPA o aviso se o envio voltou — além de sucesso
  de template, é o único jeito de limpar.
- **Template Cloud que falhou pode virar `sent` sozinho** (socorro automático, até ~1h; o
  `source_id` muda). Não reenvie por conta própria uma mensagem de template recém-falhada de erro
  passageiro — o socorro cuida; reenviar por cima entrega em dobro.
- **Filtros de data fixa cortam o dia no fuso da CONTA** (padrão America/Sao_Paulo) — e mudar o
  `timezone` da conta move essa fronteira.
