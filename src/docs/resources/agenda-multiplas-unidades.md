# Agenda — unidades, tipos de compromisso e Google por agenda

Guia da Agenda depois das frentes de 13/09 e 15/09/2026. Leia antes de mexer em agendas, tipos de
compromisso, Booking ligado a unidade, conexão Google ou tratamento em sessões.

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
- **Administrador enxerga todas**, sempre.
- `member_user_ids` e `member_team_ids` **substituem a lista inteira** (idioma do `InboxMember`).

A listagem de compromissos já vem recortada pelas agendas que o usuário enxerga, **mesmo sem mandar
`agenda_id`**. Ler ou editar compromisso de uma agenda que a pessoa não enxerga devolve 404.

---

## 7. Tratamento em sessões (15/09)

Um **tratamento** é um pacote de N sessões do mesmo tipo de evento para um contato ("10 sessões de
ondas de choque a cada 30 dias"). Só a primeira sessão nasce marcada; as outras ficam "a marcar" e a
ficha do contato mostra em que pé está: quantas foram feitas, quantos por cento, quando é a próxima
e se está atrasada.

- **Liga-se no tipo de evento**: `sessions_enabled` + `sessions_default_count` (2 a 60) +
  `sessions_interval_value`/`sessions_interval_unit` (`days`/`weeks`/`months`). Tipo sem isso não
  cria tratamento nunca.
- **O tratamento NASCE junto do agendamento** — não existe `create`. Todo agendamento de um tipo com
  sessões (painel, link público ou IA) cria o tratamento do contato ou **engrossa** o que já está em
  andamento como a próxima sessão livre. Um tratamento ativo por contato + tipo.
- **Plano por pessoa**: no `tasks_create` em modo booking, `treatment: {sessions, interval_value,
  interval_unit}` vence o padrão do tipo. É validado ANTES da reserva (422 sem agendar nada).
- **"Marcar próxima"**: `tasks_create` com `agenda_treatment_id` + `treatment_session_number`. Sessão já
  marcada dá 422; tratamento de outra ficha dá 422.
- **Sessão k = compromisso VIVO (não cancelado) de número k.** Cancelar devolve a sessão; remarcar
  mantém o número; **faltar consome** (decisão do dono — a falta gasta a sessão). "Usadas" = compareceu
  + faltou. Nada disso é cache: o resumo é derivado das tarefas na leitura.
- **Cheio** = todas as N marcadas e nenhuma usada ainda. Agendamento novo pelo painel/IA num
  tratamento cheio vira **sessão extra** (N+1, até 60); pelo link público não vira nada (o
  agendamento nasce solto, sem tratamento).
- **Concluído** = usadas ≥ N. O `status` do tratamento só vira `completed` na próxima reserva daquele
  tipo (aí abre um ciclo novo); `closed` é encerramento pela equipe (`close_reason: manual`) ou pela
  junção de contatos (`mesclagem` — o tratamento do perdedor que colide com um do vencedor).
- **Atrasado** = em andamento, próxima sessão com data prevista já passada e nenhuma sessão viva com
  data futura. A previsão é a última data conhecida + intervalo × distância.
- Ferramentas: `lionchat_agenda_treatments_list` (por `contact_id`, resumo pronto por tratamento),
  `_show`, `_update` (`planned_sessions` nunca abaixo da maior sessão já marcada; `status`
  `closed`/`active`). O compromisso devolve `tratamento: {id, sessao, total, titulo}` quando pertence a
  um. Compromisso de agenda que o usuário não enxerga aparece na sessão como `oculta: true`.
- O relatório de Agendamentos tem o bloco `treatments` (retrato de hoje, ver `reports-guide`).

---

## 8. Erros comuns

| Sintoma | Causa |
|---|---|
| 422 'Ha sessoes marcadas alem dessa quantidade' ao reduzir `planned_sessions` | já existe sessão marcada acima do novo total; cancele-a antes |
| 422 'Ja existe um tratamento em andamento deste tipo para este contato' ao reabrir | um tratamento ativo por contato + tipo; encerre o outro primeiro |
| Agendamento novo não entrou no tratamento | tipo sem `sessions_enabled`, ou tratamento CHEIO agendado pelo link público (sessão extra só pelo painel/IA) |
| 422 ao criar compromisso com `task_type: "consulta"` | os tipos clínicos saíram; use a `key` que `account_task_types_list` devolve |
| Ícone do tipo não aparece | valor fora da lista fechada de 12 |
| Agendamento do Booking caiu na unidade errada | `agenda_id` do tipo de evento não foi definido (nulo = principal) |
| Compromisso da filial no Google da matriz | não acontece mais; se aparecer, a conexão daquela agenda está com `agenda_id` errado |
| `agendas_create` recusado | recurso `multiple_agendas` desligado ou teto de Extras Manuais atingido |
| Histórico sumiu ao filtrar a principal | faltou incluir os compromissos com `agenda_id` **nulo** |
