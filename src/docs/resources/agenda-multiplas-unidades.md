# Agenda — unidades, tipos de compromisso e Google por agenda

Guia da Agenda depois das frentes de 13/09 e 15/09/2026. Leia antes de mexer em agendas, tipos de
compromisso, Booking ligado a unidade, conexão Google ou programa de sessões.

---

## 1. Uma agenda é um LUGAR, nunca uma pessoa

Uma **agenda** é uma unidade: a matriz, uma filial, um consultório. Ela tem nome, fuso, cor, quem
enxerga e **conta Google próprios**. Não confunda com o calendário de uma pessoa — quem tem
calendário pessoal é o atendente, e ele aparece dentro da agenda.

**Toda conta tem UMA agenda.** Ter mais de uma exige o recurso `multiple_agendas` ligado na conta
(Super Admin), e o número de Extras Manuais define o teto — **zero ali significa ILIMITADO**, igual
a Voz, Coex e Contratos. Sem o recurso, `agendas_create` é recusado.

### `agenda_id` NULO significa "a agenda principal"

Essa é a regra mais importante deste documento, e vale em **quatro** lugares: `account_tasks`,
`booking_event_types`, `google_calendar_connections` e nos filtros.

Nulo **não** quer dizer "sem agenda": quer dizer "a principal". É o que todo registro anterior à
funcionalidade tem, e é por isso que ligar múltiplas agendas não exige retrocarga nenhuma — nada
precisa ser migrado, nada muda de lugar.

**Ao filtrar a agenda principal, inclua os nulos.** Filtrar `agenda_id = <id da principal>` sozinho
esconde todo o histórico da conta.

---

## 2. Tipos de compromisso

São **7 de fábrica**, no código: `task`, `follow_up`, `call`, `meeting`, `video_call`, `deadline`,
`custom`. Não existem `consulta`, `retorno` nem `procedimento` — foram removidos em 13/09; mandar
um desses em `task_type` dá 422.

Além dos 7, a empresa **cria os dela** com o nome que usa ("Consulta", "Ondas de Choque", "Visita
ao imóvel"), em `account_task_types`.

- `key` é derivada do nome e **nunca muda**. É ela que fica gravada em `account_tasks.task_type`.
  Renomear o tipo troca só o que aparece na tela; o histórico fica inteiro.
- `icon` é uma **lista fechada de 12**. Qualquer outro valor é recusado pelo servidor — nome fora da
  lista produz uma classe que nunca foi gerada e o ícone **some da tela, sem erro**.
- Excluir um tipo **em uso** não apaga: **desativa** (`deactivated: true` na resposta). Os
  compromissos antigos continuam com nome e ícone.

⚠️ **O tipo que a conta cria conta como agendamento para a IA.** É o que impede o agente de IA de
concluir que ainda não agendou e marcar o cliente **duas vezes**. Não existe interruptor para
desligar isso — a chave saiu do `permit` de propósito.

---

## 3. Booking → agenda

Cada tipo de evento do Booking tem `agenda_id`: é a unidade em que o agendamento feito pelo cliente
vai nascer. Nulo = principal.

Sem isso (até 13/09) **todo agendamento feito por Booking caía na agenda principal**, mesmo quando o
profissional atendia na filial — e quem trocasse para a agenda da filial não via o agendamento.

`agenda_id` de outra conta é recusado pelo modelo. A FK garante que a agenda existe; ela não garante
que é sua.

---

## 4. Página pública (cancelar, remarcar, confirmar presença)

O tipo de evento controla o que o cliente pode fazer:

| Campo | Padrão | O que faz |
|---|---|---|
| `allow_cancel` | `true` | cliente pode cancelar |
| `allow_reschedule` | `true` | cliente pode remarcar |
| `ask_attendance_confirmation` | **`false`** | mostra "Sim, vou comparecer" |
| `cancel_min_notice_hours` | vazio | antecedência mínima para cancelar |
| `reschedule_min_notice_hours` | vazio | antecedência mínima para remarcar |
| `reschedule_max_advance_days` | vazio | até quando pode remarcar |
| `max_reschedules` | vazio | quantas vezes pode remarcar |

**Vazio ou zero = sem limite** (falha aberta, de propósito: uma regra em branco nunca deve trancar o
cliente para fora).

### Variáveis da mensagem de abertura

`{{nome}} {{titulo}} {{tipo}} {{agente}} {{data}} {{horario}} {{dia_semana}} {{duracao}}
{{telefone}} {{email}} {{link_cancelar}} {{link_remarcar}} {{link_confirmar}}`

As chaves são **em português nos dois idiomas** — elas são o identificador, não a tradução.
Variável desconhecida **sai crua** para o cliente ("Olá {{name}}, ...").

`{{link_confirmar}}` só é útil com `ask_attendance_confirmation` ligado.

### Presença é CARIMBO, não status

`attendance` (`attended` / `no_show`) é um campo separado de `status`. Marcar falta **não devolve o
horário** para a agenda — decisão do dono. Não use `attendance` para deduzir se o compromisso está
ativo; para isso existe `status`.

Marcar Compareceu/Faltou também **não conclui a tarefa**: ela segue `pending` (e contando nas
pendências) até alguém concluir. É de propósito — concluir um compromisso de Booking encerra os lembretes
e as mensagens pós-atendimento dele e dispara o gatilho de fluxo "agendamento concluído". **Nunca conclua
a tarefa só porque a presença foi marcada.**

Para responder "o que aconteceu com este compromisso?" use o campo **`selo`** da tarefa (17/09), que já
junta os dois eixos e a remarcação: `cancelled` > `no_show` / `attended` > `completed` > `snoozed` >
`rescheduled` > `pending`. É o mesmo rótulo que o painel mostra ao lado da tarefa (Faltou, Compareceu,
Remarcada...). É só de leitura.

### Responsável de compromisso de Booking é FIXO

O compromisso marcado por um tipo de evento (Booking) cai SEMPRE na agenda do profissional configurado
nele. Na criação, `assignee_ids` nunca valeu; desde 17/09 também é **ignorado na edição**
(`lionchat_tasks_update` / `_update_1`): a resposta é 200, o resto da edição vale e o responsável continua
o mesmo. Para mudar quem atende, altere o profissional do tipo de evento (`booking_event_types_update`).

### Ver como está o dia antes de marcar

`lionchat_agent_availability_day` (17/09) devolve UM dia de até 6 pessoas: o expediente de cada uma e os
intervalos já ocupados, em "HH:MM" do fuso pedido. O intervalo ocupado de qualquer pessoa da conta vem
sempre (é o que permite marcar com um colega); o título do compromisso só vem para quem já o veria no
calendário, e compromisso privado de outra pessoa nunca vem com título. Para Booking, os horários válidos
continuam sendo os de `booking_event_types_slots` — essa ferramenta é para compromisso COMUM.

---

## 5. Google Calendar é UMA CONEXÃO POR AGENDA

A regra já mudou duas vezes; hoje é: **uma conta Google por agenda**. Cada unidade liga a conta
Google dela — inclusive a **mesma pessoa** com contas Google diferentes, uma por unidade.

- `google_calendar_agendas` devolve uma linha por agenda com o estado de cada uma.
- `agendas_list` / `agendas_show` trazem `google: { connected, email, state }` em cada agenda — dá para saber qual conta Google está ligada a qual unidade sem chamar o Google (o estado sai do banco). [13/09]
- Agenda **sem** Google conectado simplesmente **não sincroniza** — ela não cai no Google da matriz.
  O contrário mandaria o compromisso de uma unidade para o calendário de outra.
- Os sub-calendários compartilhados com agentes pertencem à conexão daquela unidade.

---

## 6. Quem enxerga uma agenda

- Agenda **sem** pessoas e **sem** equipes: todo mundo da conta enxerga.
- Marcando pessoas e/ou equipes: só elas. Quem entrar na equipe ganha acesso sozinho.
- **Administrador enxerga todas**, sempre. Desde 21/09, **quem tem a caixinha `agenda_manage`** ("Gerenciar
  agenda da equipe") também enxerga todas — é a função da secretária.
- `member_user_ids` e `member_team_ids` **substituem a lista inteira** (idioma do `InboxMember`).

### `agenda_manage`: a caixinha da secretária (21/09)

Permissão de função personalizada (`custom_roles.permissions`). Quem a tem, **sem ser administrador**:
- vê a agenda e os compromissos de TODA a conta (`tasks_list` deixa de recortar por pessoa);
- cria, edita, remarca, cancela e exclui compromisso de qualquer pessoa;
- marca pelo `booking_event_type` de qualquer pessoa (`tasks_create` com `booking_event_type_id` de outro);
- cria/edita/apaga `booking_event_types` de outra pessoa (inclusive mandando `user_id` de outro no create);
- lê e ajusta a disponibilidade de outra pessoa (`agent_availability_*`) e abre o painel de Agentes.

**NÃO** permite criar/editar/apagar AGENDA (unidade): `agendas_create/update/destroy` seguem só administrador —
agenda é recurso do plano, com limite. Sem a caixinha, o atendente vê só a própria agenda e a de quem ligou
`agenda_public` no perfil, e não mexe na dos outros.

A listagem de compromissos já vem recortada pelas agendas que o usuário enxerga, **mesmo sem mandar
`agenda_id`**. Ler ou editar compromisso de uma agenda que a pessoa não enxerga devolve 404.

**Quem não enxerga NENHUMA agenda não vê compromisso nenhum** (21/09). Antes, "lista de agendas
visíveis vazia" abria em vez de fechar: o recorte tratava igual dois estados opostos — *a conta não
tem agenda nenhuma* (aí não há o que recortar, devolve tudo) e *a conta tem agendas e esta pessoa não
foi posta em nenhuma* (aí ela não pode ver nada). Medido: atendente fora das duas agendas da conta
enxergava todos os compromissos.

## 6.1. Toda conta tem a agenda "Principal" (21/09)

Antes, a agenda de uma conta era **implícita**: não havia linha no banco e todo compromisso nascia com
`agenda_id` NULO. A aba Agendas abria dizendo "Nenhuma agenda ainda" numa conta que **tinha** agenda —
e não havia onde escolher quem a enxerga.

Hoje `Agenda.garantir_padrao!` (chamada no `index`) materializa essa agenda como **Principal**, marcada
`is_default`, com o fuso da conta. Vale para **toda conta, com ou sem o recurso de múltiplas agendas**:
quem tem uma agenda só pode editá-la e escolher equipes/pessoas — só não pode **criar outra**, o que
continua barrado por `Agendas::Quota` (motivo `feature_off`, que é avaliado ANTES do número).

**NEVER CHANGE / GOTCHAS**
- A condição é "não existe agenda **PADRÃO**", nunca "não existe agenda": enquanto o defeito do
  `is_default` esteve no ar, quem criou agenda ficou **sem padrão** e com os compromissos antigos
  invisíveis. Perguntar só por "existe agenda?" deixaria essas contas quebradas para sempre.
- **Não promover** uma agenda existente a padrão: ela é um LUGAR que o cliente nomeou (uma filial), e
  herdar os compromissos da agenda de antes jogaria o histórico inteiro dentro da filial errada.
- A Principal nasce **sem membros** — lista vazia é visível a todos, então ninguém perde acesso no
  deploy.
- Criar agenda: a pergunta "é a primeira?" tem que ir ao **banco** (`exists?`) e **antes** do `.new`.
  `conta.agendas.new(...)` ACRESCENTA o registro não salvo à coleção em memória, então o `.empty?`
  que existia ali respondia sempre `false` e `is_default` **nunca** era marcado.

---

## 7. Programa de sessões (15/09)

Um **programa** é um pacote de N sessões do mesmo tipo de evento para um contato ("10 sessões de ondas
de choque a cada 30 dias", "8 encontros de mentoria", "4 sessões de onboarding").

⚠️ **Na TELA o nome é "programa"** (bloco "Programas", botão "Encerrar programa") — decisão do dono em
15/09, porque nem sempre é saúde. No CÓDIGO e na API tudo continua `treatment`/`agenda_treatments`: as
ferramentas, os campos e a tabela não mudaram. Ao falar com o cliente, diga **programa**; ao chamar a
API, use os nomes de sempre. Cada encontro continua se chamando **sessão** nos dois lados. Só a primeira sessão nasce marcada; as outras ficam "a marcar" e a
ficha do contato mostra em que pé está: quantas foram feitas, quantos por cento, quando é a próxima
e se está atrasada.

- **Liga-se no tipo de evento**: `sessions_enabled` + `sessions_default_count` (2 a 60) +
  `sessions_interval_value`/`sessions_interval_unit` (`days`/`weeks`/`months`). Tipo sem isso não
  cria programa nunca.
- **O programa NASCE junto do agendamento** — não existe `create`. Todo agendamento de um tipo com
  sessões (painel, link público ou IA) cria o programa do contato ou **engrossa** o que já está em
  andamento como a próxima sessão livre. Um programa ativo por contato + tipo.
- **Plano por pessoa**: no `tasks_create` em modo booking, `treatment: {sessions, interval_value,
  interval_unit}` vence o padrão do tipo. É validado ANTES da reserva (422 sem agendar nada).
- **"Marcar próxima"**: `tasks_create` com `agenda_treatment_id` + `treatment_session_number`. Sessão já
  marcada dá 422; programa de outra ficha dá 422.
- **Sessão k = compromisso VIVO (não cancelado) de número k.** Cancelar devolve a sessão; remarcar
  mantém o número; **faltar consome** (decisão do dono — a falta gasta a sessão). "Usadas" = compareceu
  + faltou. Nada disso é cache: o resumo é derivado das tarefas na leitura.
- **Cheio** = todas as N marcadas e nenhuma usada ainda. Agendamento novo pelo painel/IA num
  programa cheio vira **sessão extra** (N+1, até 60); pelo link público não vira nada (o
  agendamento nasce solto, sem programa).
- **Concluído** = usadas ≥ N. O `status` do programa só vira `completed` na próxima reserva daquele
  tipo (aí abre um ciclo novo); `closed` é encerramento pela equipe (`close_reason: manual`) ou pela
  junção de contatos (`mesclagem` — o programa do perdedor que colide com um do vencedor).
- **Atrasado** = em andamento, próxima sessão com data prevista já passada e nenhuma sessão viva com
  data futura. A previsão é a última data conhecida + intervalo × distância.
- **Marcar TODAS as sessões que faltam** (15/09): `lionchat_agenda_treatments_plano_sugerido` devolve o dia e a
  hora sugeridos por sessão (data prevista; sem vaga, anda para a frente e marca `deslocada`), e
  `lionchat_agenda_treatments_marcar_todas` marca o que for confirmado. **Não é transação única**: sucesso parcial é
  200 com `falhas` nomeadas, e o que entrou na agenda fica. Com confirmação ligada no tipo, o cliente recebe UMA
  mensagem por sessão — avise isso antes de marcar em lote.
- Ferramentas: `lionchat_agenda_treatments_list` (por `contact_id`, resumo pronto por programa),
  `_show`, `_update` (`planned_sessions` nunca abaixo da maior sessão já marcada; `status`
  `closed`/`active`). O compromisso devolve `tratamento: {id, sessao, total, titulo}` quando pertence a
  um. Compromisso de agenda que o usuário não enxerga aparece na sessão como `oculta: true`.
- O relatório de Agendamentos tem o bloco `treatments` (vale o período escolhido: programas, sessões do período e quem parou no meio — ver `reports-guide`).

---

## 8. Erros comuns

| Sintoma | Causa |
|---|---|
| 422 'Ha sessoes marcadas alem dessa quantidade' ao reduzir `planned_sessions` | já existe sessão marcada acima do novo total; cancele-a antes |
| 422 'Ja existe um tratamento em andamento deste tipo para este contato' (texto do servidor) ao reabrir | um programa ativo por contato + tipo; encerre o outro primeiro |
| Agendamento novo não entrou no programa | tipo sem `sessions_enabled`, ou programa CHEIO agendado pelo link público (sessão extra só pelo painel/IA) |
| 422 ao criar compromisso com `task_type: "consulta"` | os tipos clínicos saíram; use a `key` que `account_task_types_list` devolve |
| Ícone do tipo não aparece | valor fora da lista fechada de 12 |
| Agendamento do Booking caiu na unidade errada | `agenda_id` do tipo de evento não foi definido (nulo = principal) |
| Compromisso da filial no Google da matriz | não acontece mais; se aparecer, a conexão daquela agenda está com `agenda_id` errado |
| `agendas_create` recusado | recurso `multiple_agendas` desligado ou teto de Extras Manuais atingido |
| Histórico sumiu ao filtrar a principal | faltou incluir os compromissos com `agenda_id` **nulo** |
