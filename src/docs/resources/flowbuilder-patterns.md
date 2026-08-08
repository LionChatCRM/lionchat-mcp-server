# FlowBuilder — Templates Prontos

10 padrões testados para você adaptar em vez de criar do zero. Cada um já vem com layout válido, handles certos e campos no formato esperado. **Copie o `flow_data`, ajuste só o que o cliente pediu, e chame `flows_create`.**

---

## 1. Boas-vindas com triagem

**Caso:** lead nova chega no WhatsApp, oferece menu (vendas/suporte/financeiro), atribui ao time certo.

```json
{
  "nodes": [
    { "id": "n1", "type": "start", "position": { "x": 50, "y": 300 }, "data": { "label": "Início", "triggers": [{ "type": "conversation_created" }] } },
    { "id": "n2", "type": "send_message", "position": { "x": 370, "y": 300 }, "data": { "label": "Saudação", "messageItems": [
      { "id": "m1", "type": "text", "content": "Oi {{contact.name|default:'tudo bem?'}} 👋 Como posso ajudar hoje?\n\n1️⃣ Vendas\n2️⃣ Suporte\n3️⃣ Financeiro" }
    ] } },
    { "id": "n3", "type": "wait_response", "position": { "x": 690, "y": 300 }, "data": {
      "label": "Aguarda escolha", "waitTime": 30, "waitUnit": "minutes", "validation": "options",
      "acceptedOptions": ["1","2","3"], "invalidMessage": "Por favor responda 1, 2 ou 3", "maxRetries": 2, "saveTo": ""
    } },
    { "id": "n4", "type": "action", "position": { "x": 1010, "y": 120 }, "data": { "label": "→ Vendas", "items": [
      { "key": "assign_team", "config": { "team_id": 1 } },
      { "key": "add_label", "config": { "labels": ["vendas"] } }
    ] } },
    { "id": "n5", "type": "action", "position": { "x": 1010, "y": 300 }, "data": { "label": "→ Suporte", "items": [
      { "key": "assign_team", "config": { "team_id": 2 } },
      { "key": "add_label", "config": { "labels": ["suporte"] } }
    ] } },
    { "id": "n6", "type": "action", "position": { "x": 1010, "y": 480 }, "data": { "label": "→ Financeiro", "items": [
      { "key": "assign_team", "config": { "team_id": 3 } },
      { "key": "add_label", "config": { "labels": ["financeiro"] } }
    ] } },
    { "id": "n7", "type": "send_message", "position": { "x": 1330, "y": 660 }, "data": { "label": "Timeout msg", "messageItems": [
      { "id": "m2", "type": "text", "content": "Não recebi sua resposta. Vou encaminhar pra equipe geral." }
    ] } }
  ],
  "edges": [
    { "id": "e1", "source": "n1", "target": "n2", "sourceHandle": "success", "type": "deletable", "animated": true },
    { "id": "e2", "source": "n2", "target": "n3", "sourceHandle": "success", "type": "deletable", "animated": true },
    { "id": "e3", "source": "n3", "target": "n4", "sourceHandle": "option_1", "type": "deletable", "animated": true },
    { "id": "e4", "source": "n3", "target": "n5", "sourceHandle": "option_2", "type": "deletable", "animated": true },
    { "id": "e5", "source": "n3", "target": "n6", "sourceHandle": "option_3", "type": "deletable", "animated": true },
    { "id": "e6", "source": "n3", "target": "n7", "sourceHandle": "timeout", "type": "deletable", "animated": true }
  ]
}
```

---

## 2. Captura de lead simples

**Caso:** pega nome + email + interesse, cria card no funil "Novos Leads".

```json
{
  "nodes": [
    { "id": "n1", "type": "start", "position": { "x": 50, "y": 300 }, "data": { "label": "Início", "triggers": [{ "type": "conversation_created" }] } },
    { "id": "n2", "type": "send_message", "position": { "x": 370, "y": 300 }, "data": { "label": "Pede nome", "messageItems": [
      { "id": "m1", "type": "text", "content": "Olá! Antes de continuar, qual seu nome completo?" }
    ] } },
    { "id": "n3", "type": "wait_response", "position": { "x": 690, "y": 300 }, "data": {
      "label": "Aguarda nome", "waitTime": 15, "waitUnit": "minutes", "validation": "any",
      "saveTo": "contact_attr", "saveAttrKey": "nome_completo"
    } },
    { "id": "n4", "type": "send_message", "position": { "x": 1010, "y": 300 }, "data": { "label": "Pede email", "messageItems": [
      { "id": "m2", "type": "text", "content": "Perfeito, {{contact.custom_attribute.nome_completo}}. Qual seu melhor email?" }
    ] } },
    { "id": "n5", "type": "wait_response", "position": { "x": 1330, "y": 300 }, "data": {
      "label": "Aguarda email", "waitTime": 15, "waitUnit": "minutes", "validation": "regex",
      "regexPattern": "^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$", "invalidMessage": "Esse não parece um email válido. Tenta de novo?", "maxRetries": 2,
      "saveTo": "contact_attr", "saveAttrKey": "email"
    } },
    { "id": "n6", "type": "action", "position": { "x": 1650, "y": 300 }, "data": { "label": "Cria card", "items": [
      { "key": "create_kanban_item", "config": { "funnel_id": 1, "funnel_stage": "novo_lead" } },
      { "key": "add_label", "config": { "labels": ["lead-capturado"] } }
    ] } },
    { "id": "n7", "type": "send_message", "position": { "x": 1970, "y": 300 }, "data": { "label": "Confirma", "messageItems": [
      { "id": "m3", "type": "text", "content": "Tudo certo! Em breve um consultor vai te chamar." }
    ] } }
  ],
  "edges": [
    { "id": "e1", "source": "n1", "target": "n2", "sourceHandle": "success", "type": "deletable", "animated": true },
    { "id": "e2", "source": "n2", "target": "n3", "sourceHandle": "success", "type": "deletable", "animated": true },
    { "id": "e3", "source": "n3", "target": "n4", "sourceHandle": "success", "type": "deletable", "animated": true },
    { "id": "e4", "source": "n4", "target": "n5", "sourceHandle": "success", "type": "deletable", "animated": true },
    { "id": "e5", "source": "n5", "target": "n6", "sourceHandle": "success", "type": "deletable", "animated": true },
    { "id": "e6", "source": "n6", "target": "n7", "sourceHandle": "success", "type": "deletable", "animated": true }
  ]
}
```

---

## 3. Qualificação BANT (Budget / Authority / Need / Timing)

**Caso:** 4 perguntas pra qualificar lead B2B. Ramifica em "quente" vs "frio".

```json
{
  "nodes": [
    { "id": "n1", "type": "start", "position": { "x": 50, "y": 300 }, "data": { "label": "Início", "triggers": [{ "type": "message_received", "keywords": ["proposta","orçamento"], "match_type": "contains" }] } },
    { "id": "n2", "type": "send_message", "position": { "x": 370, "y": 300 }, "data": { "label": "B - Budget", "messageItems": [{ "id": "m1", "type": "text", "content": "Pra te ajudar melhor, qual a faixa de investimento que vocês têm em mente?\n\n1️⃣ Até R$ 5k\n2️⃣ R$ 5k a R$ 20k\n3️⃣ Acima de R$ 20k" }] } },
    { "id": "n3", "type": "wait_response", "position": { "x": 690, "y": 300 }, "data": { "label": "Budget", "waitTime": 60, "waitUnit": "minutes", "validation": "options", "acceptedOptions": ["1","2","3"], "saveTo": "contact_attr", "saveAttrKey": "budget_tier" } },
    { "id": "n4", "type": "send_message", "position": { "x": 1010, "y": 300 }, "data": { "label": "A - Authority", "messageItems": [{ "id": "m2", "type": "text", "content": "Você é o decisor ou tem outras pessoas envolvidas?" }] } },
    { "id": "n5", "type": "wait_response", "position": { "x": 1330, "y": 300 }, "data": { "label": "Autoridade", "waitTime": 60, "waitUnit": "minutes", "validation": "any", "saveTo": "contact_attr", "saveAttrKey": "authority" } },
    { "id": "n6", "type": "send_message", "position": { "x": 1650, "y": 300 }, "data": { "label": "N - Need", "messageItems": [{ "id": "m3", "type": "text", "content": "Conta um pouco: o que vocês precisam resolver hoje?" }] } },
    { "id": "n7", "type": "wait_response", "position": { "x": 1970, "y": 300 }, "data": { "label": "Necessidade", "waitTime": 60, "waitUnit": "minutes", "validation": "any", "saveTo": "contact_attr", "saveAttrKey": "need" } },
    { "id": "n8", "type": "send_message", "position": { "x": 2290, "y": 300 }, "data": { "label": "T - Timing", "messageItems": [{ "id": "m4", "type": "text", "content": "Em quanto tempo precisam ter a solução rodando?\n\n1️⃣ Esse mês\n2️⃣ Próximos 3 meses\n3️⃣ Sem pressa" }] } },
    { "id": "n9", "type": "wait_response", "position": { "x": 2610, "y": 300 }, "data": { "label": "Prazo", "waitTime": 60, "waitUnit": "minutes", "validation": "options", "acceptedOptions": ["1","2","3"], "saveTo": "contact_attr", "saveAttrKey": "timing_tier" } },
    { "id": "n10", "type": "condition", "position": { "x": 2930, "y": 300 }, "data": { "label": "Quente?", "conditions": [
      { "id": "c1", "label": "Lead quente", "field": "{{contact.custom_attribute.budget_tier}}", "operator": "not_equal", "value": "1", "valueType": "variable" }
    ] } },
    { "id": "n11", "type": "action", "position": { "x": 3250, "y": 180 }, "data": { "label": "Quente", "items": [
      { "key": "assign_team", "config": { "team_id": 1 } },
      { "key": "add_label", "config": { "labels": ["lead-quente"] } },
      { "key": "create_kanban_item", "config": { "funnel_id": 1, "funnel_stage": "qualificado" } }
    ] } },
    { "id": "n12", "type": "action", "position": { "x": 3250, "y": 420 }, "data": { "label": "Frio", "items": [
      { "key": "add_label", "config": { "labels": ["lead-frio"] } },
      { "key": "create_kanban_item", "config": { "funnel_id": 1, "funnel_stage": "nutrir" } }
    ] } }
  ],
  "edges": [
    { "id": "e1", "source": "n1", "target": "n2", "sourceHandle": "success", "type": "deletable", "animated": true },
    { "id": "e2", "source": "n2", "target": "n3", "sourceHandle": "success", "type": "deletable", "animated": true },
    { "id": "e3", "source": "n3", "target": "n4", "sourceHandle": "option_1", "type": "deletable", "animated": true },
    { "id": "e4", "source": "n3", "target": "n4", "sourceHandle": "option_2", "type": "deletable", "animated": true },
    { "id": "e5", "source": "n3", "target": "n4", "sourceHandle": "option_3", "type": "deletable", "animated": true },
    { "id": "e6", "source": "n4", "target": "n5", "sourceHandle": "success", "type": "deletable", "animated": true },
    { "id": "e7", "source": "n5", "target": "n6", "sourceHandle": "success", "type": "deletable", "animated": true },
    { "id": "e8", "source": "n6", "target": "n7", "sourceHandle": "success", "type": "deletable", "animated": true },
    { "id": "e9", "source": "n7", "target": "n8", "sourceHandle": "success", "type": "deletable", "animated": true },
    { "id": "e10", "source": "n8", "target": "n9", "sourceHandle": "success", "type": "deletable", "animated": true },
    { "id": "e11", "source": "n9", "target": "n10", "sourceHandle": "option_1", "type": "deletable", "animated": true },
    { "id": "e12", "source": "n9", "target": "n10", "sourceHandle": "option_2", "type": "deletable", "animated": true },
    { "id": "e13", "source": "n9", "target": "n10", "sourceHandle": "option_3", "type": "deletable", "animated": true },
    { "id": "e14", "source": "n10", "target": "n11", "sourceHandle": "cond_0", "type": "deletable", "animated": true },
    { "id": "e15", "source": "n10", "target": "n12", "sourceHandle": "default", "type": "deletable", "animated": true }
  ]
}
```

---

## 4. Pesquisa CSAT pós-atendimento

**Caso:** ao resolver conversa, pede nota de 1 a 5 e comentário.

```json
{
  "nodes": [
    { "id": "n1", "type": "start", "position": { "x": 50, "y": 300 }, "data": { "label": "Início", "triggers": [{ "type": "conversation_resolved" }] } },
    { "id": "n2", "type": "wait", "position": { "x": 370, "y": 300 }, "data": { "label": "Aguarda 5 min", "waitTime": 5, "waitUnit": "minutes" } },
    { "id": "n3", "type": "send_message", "position": { "x": 690, "y": 300 }, "data": { "label": "Pede nota", "messageItems": [{ "id": "m1", "type": "text", "content": "Antes de fechar: de 1 a 5, como foi seu atendimento?\n\n5 = excelente\n1 = ruim" }] } },
    { "id": "n4", "type": "wait_response", "position": { "x": 1010, "y": 300 }, "data": { "label": "Nota", "waitTime": 60, "waitUnit": "minutes", "validation": "options", "acceptedOptions": ["1","2","3","4","5"], "saveTo": "conversation_attr", "saveAttrKey": "csat_score" } },
    { "id": "n5", "type": "send_message", "position": { "x": 1330, "y": 300 }, "data": { "label": "Pede comentário", "messageItems": [{ "id": "m2", "type": "text", "content": "Obrigado pela nota! Quer deixar algum comentário?" }] } },
    { "id": "n6", "type": "wait_response", "position": { "x": 1650, "y": 300 }, "data": { "label": "Comentário", "waitTime": 30, "waitUnit": "minutes", "validation": "any", "saveTo": "conversation_attr", "saveAttrKey": "csat_comment" } },
    { "id": "n7", "type": "send_message", "position": { "x": 1970, "y": 300 }, "data": { "label": "Encerra", "messageItems": [{ "id": "m3", "type": "text", "content": "Valeu pelo feedback! 🙏" }] } }
  ],
  "edges": [
    { "id": "e1", "source": "n1", "target": "n2", "sourceHandle": "success", "type": "deletable", "animated": true },
    { "id": "e2", "source": "n2", "target": "n3", "sourceHandle": "success", "type": "deletable", "animated": true },
    { "id": "e3", "source": "n3", "target": "n4", "sourceHandle": "success", "type": "deletable", "animated": true },
    { "id": "e4", "source": "n4", "target": "n5", "sourceHandle": "option_1", "type": "deletable", "animated": true },
    { "id": "e5", "source": "n4", "target": "n5", "sourceHandle": "option_2", "type": "deletable", "animated": true },
    { "id": "e6", "source": "n4", "target": "n5", "sourceHandle": "option_3", "type": "deletable", "animated": true },
    { "id": "e7", "source": "n4", "target": "n5", "sourceHandle": "option_4", "type": "deletable", "animated": true },
    { "id": "e8", "source": "n4", "target": "n5", "sourceHandle": "option_5", "type": "deletable", "animated": true },
    { "id": "e9", "source": "n5", "target": "n6", "sourceHandle": "success", "type": "deletable", "animated": true },
    { "id": "e10", "source": "n6", "target": "n7", "sourceHandle": "success", "type": "deletable", "animated": true }
  ]
}
```

---

## 5. Roteamento por horário comercial

**Caso:** se dentro do expediente, atribui agente. Se fora, manda ausência.

```json
{
  "nodes": [
    { "id": "n1", "type": "start", "position": { "x": 50, "y": 300 }, "data": { "label": "Início", "triggers": [{ "type": "conversation_created" }] } },
    { "id": "n2", "type": "condition", "position": { "x": 370, "y": 300 }, "data": { "label": "Horário comercial?", "conditions": [
      { "id": "c1", "label": "Dentro do horário", "field": "{{now.hour}}", "operator": "greater_than", "value": "8", "valueType": "variable" }
    ] } },
    { "id": "n3", "type": "action", "position": { "x": 690, "y": 180 }, "data": { "label": "Atribui agente", "items": [
      { "key": "assign_team", "config": { "team_id": 1 } }
    ] } },
    { "id": "n4", "type": "send_message", "position": { "x": 690, "y": 420 }, "data": { "label": "Ausência", "messageItems": [
      { "id": "m1", "type": "text", "content": "Recebemos sua mensagem! Nosso horário é das 9h às 18h, dias úteis. Retornamos assim que possível." }
    ] } }
  ],
  "edges": [
    { "id": "e1", "source": "n1", "target": "n2", "sourceHandle": "success", "type": "deletable", "animated": true },
    { "id": "e2", "source": "n2", "target": "n3", "sourceHandle": "cond_0", "type": "deletable", "animated": true },
    { "id": "e3", "source": "n2", "target": "n4", "sourceHandle": "default", "type": "deletable", "animated": true }
  ]
}
```

---

## 6. Triagem com IA (classificação de intenção)

**Caso:** usa IA pra ler a primeira mensagem e classificar como compra/suporte/reclamação/dúvida.

```json
{
  "nodes": [
    { "id": "n1", "type": "start", "position": { "x": 50, "y": 300 }, "data": { "label": "Início", "triggers": [{ "type": "message_received" }] } },
    { "id": "n2", "type": "ai", "position": { "x": 370, "y": 300 }, "data": {
      "label": "Classifica", "aiMode": "intent",
      "aiPrompt": "Classifique a intenção da última mensagem do cliente",
      "aiIntents": [{ "name": "compra" }, { "name": "suporte" }, { "name": "reclamacao" }, { "name": "duvida" }]
    } },
    { "id": "n3", "type": "action", "position": { "x": 690, "y": 60 }, "data": { "label": "→ Compra", "items": [{ "key": "assign_team", "config": { "team_id": 1 } }, { "key": "add_label", "config": { "labels": ["intent-compra"] } }] } },
    { "id": "n4", "type": "action", "position": { "x": 690, "y": 240 }, "data": { "label": "→ Suporte", "items": [{ "key": "assign_team", "config": { "team_id": 2 } }, { "key": "add_label", "config": { "labels": ["intent-suporte"] } }] } },
    { "id": "n5", "type": "action", "position": { "x": 690, "y": 420 }, "data": { "label": "→ Reclamação", "items": [{ "key": "assign_team", "config": { "team_id": 3 } }, { "key": "change_priority", "config": { "priority": "high" } }, { "key": "add_label", "config": { "labels": ["intent-reclamacao"] } }] } },
    { "id": "n6", "type": "action", "position": { "x": 690, "y": 600 }, "data": { "label": "→ Dúvida", "items": [{ "key": "assign_captain", "config": { "assistant_id": 1 } }] } },
    { "id": "n7", "type": "action", "position": { "x": 690, "y": 780 }, "data": { "label": "→ Não classificado", "items": [{ "key": "assign_team", "config": { "team_id": 2 } }] } }
  ],
  "edges": [
    { "id": "e1", "source": "n1", "target": "n2", "sourceHandle": "success", "type": "deletable", "animated": true },
    { "id": "e2", "source": "n2", "target": "n3", "sourceHandle": "intent_compra", "type": "deletable", "animated": true },
    { "id": "e3", "source": "n2", "target": "n4", "sourceHandle": "intent_suporte", "type": "deletable", "animated": true },
    { "id": "e4", "source": "n2", "target": "n5", "sourceHandle": "intent_reclamacao", "type": "deletable", "animated": true },
    { "id": "e5", "source": "n2", "target": "n6", "sourceHandle": "intent_duvida", "type": "deletable", "animated": true },
    { "id": "e6", "source": "n2", "target": "n7", "sourceHandle": "no_intent", "type": "deletable", "animated": true }
  ]
}
```

---

## 7. Re-engajamento de lead frio

**Caso:** após 7 dias sem resposta, manda template aprovado e marca label.

```json
{
  "nodes": [
    { "id": "n1", "type": "start", "position": { "x": 50, "y": 300 }, "data": { "label": "Início", "triggers": [{ "type": "label_added", "label_names": ["follow-up"] }] } },
    { "id": "n2", "type": "wait", "position": { "x": 370, "y": 300 }, "data": { "label": "Espera 7 dias", "waitTime": 7, "waitUnit": "days" } },
    { "id": "n3", "type": "send_message", "position": { "x": 690, "y": 300 }, "data": { "label": "Template re-engajamento", "messageItems": [
      { "id": "m1", "type": "whatsapp_template", "templateId": 42, "params": ["{{contact.name}}"] }
    ] } },
    { "id": "n4", "type": "action", "position": { "x": 1010, "y": 300 }, "data": { "label": "Marca tentativa", "items": [
      { "key": "add_label", "config": { "labels": ["reengajamento-enviado"] } },
      { "key": "remove_label", "config": { "labels": ["follow-up"] } }
    ] } }
  ],
  "edges": [
    { "id": "e1", "source": "n1", "target": "n2", "sourceHandle": "success", "type": "deletable", "animated": true },
    { "id": "e2", "source": "n2", "target": "n3", "sourceHandle": "success", "type": "deletable", "animated": true },
    { "id": "e3", "source": "n3", "target": "n4", "sourceHandle": "success", "type": "deletable", "animated": true }
  ]
}
```

---

## 8. Suporte com escalation pra humano

**Caso:** tenta resolver com IA. Se cliente pedir "atendente humano" ou IA não souber, escala.

```json
{
  "nodes": [
    { "id": "n1", "type": "start", "position": { "x": 50, "y": 300 }, "data": { "label": "Início", "triggers": [{ "type": "message_received" }] } },
    { "id": "n2", "type": "condition", "position": { "x": 370, "y": 300 }, "data": { "label": "Pede humano?", "conditions": [
      { "id": "c1", "label": "Sim", "field": "{{last_response}}", "operator": "contains", "value": "humano", "valueType": "variable" }
    ] } },
    { "id": "n3", "type": "action", "position": { "x": 690, "y": 120 }, "data": { "label": "→ Humano", "items": [
      { "key": "deactivate_captain", "config": {} },
      { "key": "assign_team", "config": { "team_id": 2 } },
      { "key": "add_label", "config": { "labels": ["escalado-humano"] } }
    ] } },
    { "id": "n4", "type": "action", "position": { "x": 690, "y": 480 }, "data": { "label": "→ IA atende", "items": [
      { "key": "assign_captain", "config": { "assistant_id": 1 } }
    ] } }
  ],
  "edges": [
    { "id": "e1", "source": "n1", "target": "n2", "sourceHandle": "success", "type": "deletable", "animated": true },
    { "id": "e2", "source": "n2", "target": "n3", "sourceHandle": "cond_0", "type": "deletable", "animated": true },
    { "id": "e3", "source": "n2", "target": "n4", "sourceHandle": "default", "type": "deletable", "animated": true }
  ]
}
```

---

## 9. Agendamento via API externa

**Caso:** cliente quer marcar reunião — fluxo chama API de booking, salva ID, confirma.

```json
{
  "nodes": [
    { "id": "n1", "type": "start", "position": { "x": 50, "y": 300 }, "data": { "label": "Início", "triggers": [{ "type": "message_received", "keywords": ["agendar","reunião"], "match_type": "contains" }] } },
    { "id": "n2", "type": "send_message", "position": { "x": 370, "y": 300 }, "data": { "label": "Pede data", "messageItems": [{ "id": "m1", "type": "text", "content": "Em que data você prefere? (formato DD/MM)" }] } },
    { "id": "n3", "type": "wait_response", "position": { "x": 690, "y": 300 }, "data": { "label": "Data", "waitTime": 30, "waitUnit": "minutes", "validation": "regex", "regexPattern": "^\\d{2}/\\d{2}$", "invalidMessage": "Formato inválido. Use DD/MM (ex: 25/05)", "maxRetries": 2, "saveTo": "variable", "saveVariable": "data_pref" } },
    { "id": "n4", "type": "api", "position": { "x": 1010, "y": 300 }, "data": {
      "label": "Cria booking", "apiMethod": "POST",
      "apiUrl": "https://api.example.com/bookings",
      "apiHeaders": [{ "key": "Authorization", "value": "Bearer {{account.custom_attribute.BOOKING_TOKEN}}" }, { "key": "Content-Type", "value": "application/json" }],
      "apiBody": "{\"contact_id\":\"{{contact.id}}\",\"date\":\"{{data_pref}}\"}",
      "apiResponseVar": "booking_result"
    } },
    { "id": "n5", "type": "send_message", "position": { "x": 1330, "y": 180 }, "data": { "label": "Confirma", "messageItems": [{ "id": "m2", "type": "text", "content": "Reunião agendada! ID {{booking_result.id}}. Te mando lembrete 1h antes." }] } },
    { "id": "n6", "type": "send_message", "position": { "x": 1330, "y": 420 }, "data": { "label": "Erro", "messageItems": [{ "id": "m3", "type": "text", "content": "Não consegui agendar agora. Um atendente vai te ajudar." }] } },
    { "id": "n7", "type": "action", "position": { "x": 1650, "y": 420 }, "data": { "label": "Escala", "items": [{ "key": "assign_team", "config": { "team_id": 1 } }] } }
  ],
  "edges": [
    { "id": "e1", "source": "n1", "target": "n2", "sourceHandle": "success", "type": "deletable", "animated": true },
    { "id": "e2", "source": "n2", "target": "n3", "sourceHandle": "success", "type": "deletable", "animated": true },
    { "id": "e3", "source": "n3", "target": "n4", "sourceHandle": "success", "type": "deletable", "animated": true },
    { "id": "e4", "source": "n4", "target": "n5", "sourceHandle": "success", "type": "deletable", "animated": true },
    { "id": "e5", "source": "n4", "target": "n6", "sourceHandle": "error", "type": "deletable", "animated": true },
    { "id": "e6", "source": "n6", "target": "n7", "sourceHandle": "success", "type": "deletable", "animated": true }
  ]
}
```

---

## 10. Notificação interna por webhook (label aplicada)

**Caso:** quando label "urgente" é aplicada, dispara webhook pro n8n/Slack.

```json
{
  "nodes": [
    { "id": "n1", "type": "start", "position": { "x": 50, "y": 300 }, "data": { "label": "Início", "triggers": [{ "type": "label_added", "label_names": ["urgente"] }] } },
    { "id": "n2", "type": "action", "position": { "x": 370, "y": 300 }, "data": { "label": "Dispara webhook", "items": [
      { "key": "send_webhook", "config": {
        "url": "https://hooks.slack.com/services/XXX/YYY/ZZZ",
        "headers": [{ "key": "Content-Type", "value": "application/json" }],
        "body": "{\"text\":\"🚨 Conversa urgente: {{conversation.id}} — cliente {{contact.name}}\"}"
      } },
      { "key": "change_priority", "config": { "priority": "urgent" } }
    ] } }
  ],
  "edges": [
    { "id": "e1", "source": "n1", "target": "n2", "sourceHandle": "success", "type": "deletable", "animated": true }
  ]
}
```

---

## 11. Flow disparado por webhook externo (Webhook Universal embutido)

**Caso:** sistema externo (checkout, formulário, ERP) chama uma URL e o flow roda na conversa do contato — etiqueta + mensagem.

**Passo a passo via API (a ordem importa):**
1. `flows_create` com o flow_data abaixo (sem o item webhook ainda)
2. `POST /custom_webhook_integrations` com `{ "custom_webhook_integration": { "flow_id": <id> } }` → guarde `id` (integration_id) e a URL retornada
3. `flows_update` adicionando o item `webhook_received` no start com o `integration_id`

```json
{
  "nodes": [
    { "id": "n1", "type": "start", "position": { "x": 50, "y": 300 }, "data": { "label": "Início", "items": [
      { "type": "webhook_received", "config": { "integration_id": 123 } }
    ] } },
    { "id": "n2", "type": "action", "position": { "x": 370, "y": 300 }, "data": { "label": "Marca origem", "items": [
      { "key": "add_conversation_label", "config": { "labels": ["compra-confirmada"] } }
    ] } },
    { "id": "n3", "type": "send_message", "position": { "x": 690, "y": 300 }, "data": { "label": "Confirma", "messageItems": [
      { "id": "m1", "type": "text", "content": "{{contact.name}}, recebemos a confirmação do seu pedido! 🎉" }
    ] } }
  ],
  "edges": [
    { "id": "e1", "source": "n1", "target": "n2", "sourceHandle": "success", "type": "deletable", "animated": true },
    { "id": "e2", "source": "n2", "target": "n3", "sourceHandle": "success", "type": "deletable", "animated": true }
  ]
}
```

---

## 12. Ferramenta da IA (ai_tool) mínima — consulta API + retorno estruturado

**Caso:** a IA precisa consultar um sistema externo durante a conversa (ex: status do pedido). Criar via `flow_tools_create` (NÃO `flows_create`), depois vincular ao assistente com `POST /flow_tools/{id}/assistants`.

```json
{
  "tool_name": "consultar_pedido",
  "tool_description": "Consulta o status do pedido do cliente pelo número. Use quando o cliente perguntar do pedido dele.",
  "flow_data": {
    "nodes": [
      { "id": "n1", "type": "start", "position": { "x": 50, "y": 300 }, "data": { "label": "Início" } },
      { "id": "n2", "type": "api", "position": { "x": 370, "y": 300 }, "data": { "label": "Consulta ERP", "apiMethod": "GET", "apiUrl": "https://erp.exemplo.com/pedidos/{{numero_pedido}}", "apiHeaders": [{ "key": "Authorization", "value": "Bearer {{account.custom_attribute.ERP_TOKEN}}" }], "apiResponseVar": "pedido" } },
      { "id": "n3", "type": "end", "position": { "x": 690, "y": 300 }, "data": { "label": "Retorno", "mode": "structured" } },
      { "id": "n4", "type": "end", "position": { "x": 690, "y": 480 }, "data": { "label": "Erro", "mode": "structured" } }
    ],
    "edges": [
      { "id": "e1", "source": "n1", "target": "n2", "sourceHandle": "success", "type": "deletable", "animated": true },
      { "id": "e2", "source": "n2", "target": "n3", "sourceHandle": "success", "type": "deletable", "animated": true },
      { "id": "e3", "source": "n2", "target": "n4", "sourceHandle": "error", "type": "deletable", "animated": true }
    ]
  }
}
```

**Lembretes ai_tool:** nó `end` é OBRIGATÓRIO; sem `inbox_ids`; nodes permitidos = `start`, `end`, `api`, `condition`, `set_variable`, `ai`, `randomizer`, `action`, `send_message`, `note` (sem `wait`/`wait_response`/`update_group`); `action` sem keys da aba Sistema (`send_webhook`/`start_flow`). Teste com `POST /flow_tools/{id}/run` antes de vincular ao assistente.

---

## 13. Etiqueta na CONVERSA vs no CONTATO

**Caso:** marcar a conversa atual sem "sujar" o cadastro do contato (ex: assunto desta conversa), ou o inverso (perfil permanente do contato).

```json
{
  "nodes": [
    { "id": "n1", "type": "start", "position": { "x": 50, "y": 300 }, "data": { "label": "Início", "triggers": [{ "type": "message_received", "keywords": ["orçamento"], "match_type": "contains" }] } },
    { "id": "n2", "type": "action", "position": { "x": 370, "y": 300 }, "data": { "label": "Marca", "items": [
      { "key": "add_conversation_label", "config": { "labels": ["pediu-orcamento"] } },
      { "key": "add_label", "config": { "labels": ["interessado-em-comprar"] } }
    ] } }
  ],
  "edges": [
    { "id": "e1", "source": "n1", "target": "n2", "sourceHandle": "success", "type": "deletable", "animated": true }
  ]
}
```

**Regra de bolso:** fato sobre ESTA conversa → `add_conversation_label` / `remove_conversation_label`. Característica permanente do CONTATO → `add_label` / `remove_label`.

---

## 14. Sim/Não com sinônimos (varied_options) + salvar e-mail com segurança

**Caso:** cliente pode responder "sim" de vários jeitos ("claro", "quero", "pode ser") — `varied_options` agrupa tudo numa só saída. Depois pede o e-mail e salva no cadastro com a validação certa (`email`), pra não ser revertido em silêncio.

```json
{
  "nodes": [
    { "id": "n1", "type": "start", "position": { "x": 50, "y": 300 }, "data": { "label": "Início", "triggers": [{ "type": "conversation_created" }] } },
    { "id": "n2", "type": "send_message", "position": { "x": 370, "y": 300 }, "data": { "label": "Oferece", "messageItems": [
      { "id": "m1", "type": "text", "content": "Quer receber nossas novidades por e-mail?" }
    ] } },
    { "id": "n3", "type": "wait_response", "position": { "x": 690, "y": 300 }, "data": {
      "label": "Quer?", "waitTime": 30, "waitUnit": "minutes", "validation": "varied_options",
      "optionGroups": [
        { "id": "sim", "terms": ["sim", "claro", "quero", "pode ser", "aceito"], "matchType": "contains" },
        { "id": "nao", "terms": ["nao", "não", "agora nao", "passo"], "matchType": "contains" }
      ],
      "invalidMessage": "Responda com sim ou não, por favor.", "maxRetries": 2, "saveTo": ""
    } },
    { "id": "n4", "type": "send_message", "position": { "x": 1010, "y": 180 }, "data": { "label": "Pede e-mail", "messageItems": [
      { "id": "m2", "type": "text", "content": "Show! Qual seu melhor e-mail?" }
    ] } },
    { "id": "n5", "type": "wait_response", "position": { "x": 1330, "y": 180 }, "data": {
      "label": "Captura e-mail", "waitTime": 15, "waitUnit": "minutes", "validation": "email",
      "invalidMessage": "Esse e-mail não parece válido, pode conferir?", "maxRetries": 2,
      "saveTo": "contact_email"
    } },
    { "id": "n6", "type": "send_message", "position": { "x": 1650, "y": 180 }, "data": { "label": "Confirma", "messageItems": [
      { "id": "m3", "type": "text", "content": "Pronto, anotei aqui. Obrigado!" }
    ] } },
    { "id": "n7", "type": "send_message", "position": { "x": 1010, "y": 420 }, "data": { "label": "Tudo bem", "messageItems": [
      { "id": "m4", "type": "text", "content": "Sem problema! Qualquer coisa é só chamar." }
    ] } }
  ],
  "edges": [
    { "id": "e1", "source": "n1", "target": "n2", "sourceHandle": "success", "type": "deletable", "animated": true },
    { "id": "e2", "source": "n2", "target": "n3", "sourceHandle": "success", "type": "deletable", "animated": true },
    { "id": "e3", "source": "n3", "target": "n4", "sourceHandle": "option_sim", "type": "deletable", "animated": true },
    { "id": "e4", "source": "n3", "target": "n7", "sourceHandle": "option_nao", "type": "deletable", "animated": true },
    { "id": "e5", "source": "n4", "target": "n5", "sourceHandle": "success", "type": "deletable", "animated": true },
    { "id": "e6", "source": "n5", "target": "n6", "sourceHandle": "success", "type": "deletable", "animated": true }
  ]
}
```

**Lembretes:** em `varied_options` o handle é `option_<id do grupo>` (não por termo); use `matchType: "equals"` quando um termo curto colidiria (ex: "1" casando "12" com `contains`). Pra salvar telefone use `validation: "phone"` + `saveTo: "contact_phone"`.

## 15. Condição agrupada (E/OU) + SLA — escalar atrasados

**Caso:** quando a conversa furou o SLA de primeira resposta **E** ainda está aberta, escala pro supervisor; quem está no prazo segue o fluxo normal. Mostra três recursos novos: regras agrupadas (`rules`/`logic`), o operador `sla_check` e o nome de saída (`label`).

```json
{
  "nodes": [
    { "id": "start", "type": "start", "position": { "x": 50, "y": 300 }, "data": { "label": "Início", "trigger": "conversation_created" } },
    { "id": "n2", "type": "condition", "position": { "x": 370, "y": 300 }, "data": { "label": "Atrasado?", "conditions": [
      { "id": "c1", "label": "SLA estourado e aberta", "logic": "and", "rules": [
        { "operator": "sla_check", "value": "frt_breached" },
        { "field": "{{conversation.status}}", "operator": "equal", "value": "open", "valueType": "variable" }
      ] }
    ] } },
    { "id": "n3", "type": "action", "position": { "x": 690, "y": 180 }, "data": { "label": "Etiqueta Atrasado", "actionType": "add_conversation_label", "labels": ["atrasado"] } },
    { "id": "n4", "type": "send_message", "position": { "x": 690, "y": 420 }, "data": { "label": "Segue normal", "messageType": "text", "content": "Obrigado por aguardar! Em que posso ajudar?" } },
    { "id": "end", "type": "end", "position": { "x": 1010, "y": 300 }, "data": { "label": "Fim" } }
  ],
  "edges": [
    { "id": "e1", "source": "start", "target": "n2" },
    { "id": "e2", "source": "n2", "sourceHandle": "cond_0", "target": "n3" },
    { "id": "e3", "source": "n2", "sourceHandle": "default", "target": "n4" },
    { "id": "e4", "source": "n3", "target": "end" },
    { "id": "e5", "source": "n4", "target": "end" }
  ]
}
```

**Lembretes:** a saída agrupada continua sendo `cond_0` (uma saída por item de `conditions`, não por regra). `sla_check` só dá resultado de prazo se a conversa tiver uma Política de SLA aplicada; senão use `has_sla`/`no_sla`. Para "OU" troque `"logic": "and"` por `"or"`.

---

## 16. Feliz aniversário (Gatilho de Data)

**Caso:** manda uma mensagem de parabéns todo ano no aniversário do contato, às 09:00, pela caixa onde ele conversa. Usa o gatilho `date_trigger` (dispara na data, sem varredura). Só flow **individual**.

```json
{
  "nodes": [
    { "id": "start", "type": "start", "position": { "x": 50, "y": 300 }, "data": { "label": "Início", "items": [
      { "type": "date_trigger", "config": {
        "attr_key": "_date_of_birth",
        "offset_direction": "on",
        "offset_days": 0,
        "repeat_yearly": true,
        "send_time_source": "fixed",
        "send_time": "09:00",
        "inbox_mode": "contact_recent",
        "filters": { "logic": "and", "rules": [] }
      } }
    ] } },
    { "id": "n2", "type": "send_message", "position": { "x": 370, "y": 300 }, "data": { "label": "Parabéns", "messageItems": [
      { "id": "m1", "type": "text", "content": "Feliz aniversário, {{contact.name}}! 🎉 Toda a equipe deseja um dia incrível." }
    ] } }
  ],
  "edges": [
    { "id": "e1", "source": "start", "target": "n2", "sourceHandle": "success", "type": "deletable", "animated": true }
  ]
}
```

**Variações:**
- **3 dias antes de um exame:** `attr_key` = a chave do atributo de data (ex.: `"data_exame"`), `offset_direction` = `"before"`, `offset_days` = 3, `repeat_yearly` = false (data única).
- **Horário do próprio contato:** `send_time_source` = `"attribute"` + `send_time_attr_key` = chave do atributo com o HH:MM; ou `"variable"` + `send_time_template` = fórmula Liquid (só campos do contato).
- **Caixa fixa:** `inbox_mode` = `"fixed"` + `inbox_id` = id de uma caixa do flow.
- **Só parte da base:** preencha `filters.rules` (ex.: só quem tem etiqueta/atributo X) — mesmo formato do gatilho de atributo, avaliado na hora do envio.

**Lembretes:** `attr_key` é obrigatório; `_date_of_birth` é o Aniversário nativo. `trigger_uuid` é preenchido pelo backend (não envie). Ativar o flow já agenda os contatos que têm a data. Pulos (contato sem telefone, caixa desvinculada, etc.) aparecem em `flows_executions_list`.

---

## 17. Gestão de Grupos WhatsApp por fluxo (`update_group`)

**Caso:** ao marcar um lead como GANHO no Kanban, criar automaticamente um grupo de onboarding com ele e
confirmar pela conversa. Usa o node `update_group` (bloco "Gestão de Grupos") na operação `create`. Só
funciona em conta com caixa **WhatsApp QR Code (`Channel::Waha`)** — a caixa vai em `groupInboxId`
(OBRIGATÓRIO neste fluxo, que não é de grupo).

```json
{
  "nodes": [
    { "id": "n1", "type": "start", "position": { "x": 50, "y": 300 }, "data": { "label": "Início", "triggers": [{ "type": "card_won", "funnel_ids": ["1"] }] } },
    { "id": "n2", "type": "update_group", "position": { "x": 370, "y": 300 }, "data": {
      "label": "Cria grupo de onboarding",
      "groupOperation": "create",
      "groupInboxId": 5,
      "groupName": "Onboarding — {{contact.name}}",
      "groupParticipants": ["5511999999999@c.us"],
      "groupResponseVar": "grupo"
    } },
    { "id": "n3", "type": "send_message", "position": { "x": 690, "y": 300 }, "data": { "label": "Confirma", "messageItems": [
      { "id": "m1", "type": "text", "content": "Prontinho, {{contact.name}}! Criei seu grupo de onboarding (id {{grupo.id}}) com {{grupo.participants_count}} participante(s). Já te chamo por lá." }
    ] } }
  ],
  "edges": [
    { "id": "e1", "source": "n1", "target": "n2", "sourceHandle": "success", "type": "deletable", "animated": true },
    { "id": "e2", "source": "n2", "target": "n3", "sourceHandle": "success", "type": "deletable", "animated": true }
  ]
}
```

**Chaves de `data` por operação (`groupOperation`):**

Comuns a (quase) todas:
- `groupOperation` — a operação (uma por bloco).
- `groupTargetId` — o grupo alvo. Vazio = grupo da conversa (só faz sentido em fluxo de grupo); aceita
  `"1203...@g.us"`, só dígitos ou uma variável `{{var}}`. **Ignorado** em `create` e `find_by_name` (não têm alvo).
- `groupInboxId` — id da caixa QR Code que fala com o WhatsApp. **OBRIGATÓRIO em fluxo não-grupo**; opcional em
  fluxo de grupo (padrão = grupo da conversa).
- `groupResponseVar` — nome da variável de saída (padrão `"grupo"`); leia com `{{grupo.CAMPO}}`.

| Operação | Chaves específicas | Retorno (`{{grupo.*}}`) |
|---|---|---|
| `create` | `groupName` (obrig), `groupDescription`, `groupPicture` (url), `groupInitialAdmins`, `groupParticipants` | `id`, `name`, `participants_count` |
| `add_participants` | `groupParticipants` (obrig — ex.: `["5511999999999@c.us"]` ou lista) | `added`, `not_added`, `added_count` |
| `send_invite` | `groupInviteTo` (obrig — telefone de destino), `groupInviteMessage` (opc) | `invite_link` |
| `settings` | pelo menos uma de `infoAdminOnly` / `messagesAdminOnly` / `membersCanAddNewMember` (booleans) | — |

**ATENÇÃO na `settings` — semântica INVERTIDA de `membersCanAddNewMember`:** `true` = **TODOS** podem adicionar
membros. Já `infoAdminOnly: true` e `messagesAdminOnly: true` = **SÓ admin** edita infos / manda mensagem.
Confundir os dois LIBERA o grupo achando que está trancando.

**Gatilho novo `group_participant_joined` (entrou no grupo → manda boas-vindas):** em um flow de grupo
(`conversation_mode: "group"`), o start pode ter o item `{ "key": "group_participant_joined", "config": {
"group_match": "any", "group_name": "", "group_ids": [] } }`. Filtro OPCIONAL de quais grupos disparam:
`group_match` (`any` padrão, ou os mesmos operadores do "Buscar por nome": `contains`, `equal_to`, `starts_with`,
`ends_with`, `does_not_contain`, `not_equal_to`) + `group_name`, e/ou `group_ids` (mira exata por id — casa por
dígitos, aceita `1203...@g.us` ou só o número). Quando alguém entra, o `send_message` seguinte cai **no próprio
grupo** (o grupo é a conversa do flow).

**Lembretes:**
- **Teto de 20 participantes por execução** (`add_participants`/`create`) — trava ANTI-BANIMENTO, não performance.
  Adicionar em lote é o que mais rápido derruba número no WhatsApp não-oficial.
- O fluxo só dispara/roda em caixa `Channel::Waha` (QR Code). WhatsApp oficial/Instagram/Facebook/e-mail não
  têm grupo.
- No fluxo de card ganho acima, o `send_message` vai para a conversa do CONTATO (o lead), não para o grupo
  criado. Para postar DENTRO do grupo, use um flow de grupo (`conversation_mode: "group"`) — normalmente com o
  gatilho `group_participant_joined`.
- Em `add_participants`, quem tem privacidade de grupo ligada pode não entrar mesmo com resposta de sucesso do
  WhatsApp: confira `{{grupo.not_added}}` / `{{grupo.not_added_count}}`.

---

## Como usar este catálogo

1. **Identifique o pattern mais próximo** do que o cliente pediu
2. **Copie o `flow_data` inteiro**
3. **Substitua os IDs e valores reais** (team_id, funnel_id, assistant_id, templateId, URLs, etc) — confira antes via `teams_list`, `funnels_list`, `captain_assistants_list`, `inboxes_whatsapp_templates_list`
4. **Adicione campos do flow**: `name`, `description`, `channel_type` (`Channel::Waha` etc), `inbox_ids`
5. **Chame `flows_create`** com o payload completo
6. Após criar, **ative** com `flows_toggle` se o cliente quiser que rode já. ATENÇÃO (2026-06-16): se já existir outro flow ATIVO com o mesmo gatilho na mesma inbox (e mesmo modo), a ativação retorna **422 `flow_trigger_conflict`** — exceto `webhook_received`/`manual_trigger`, que podem coexistir. Não fique reativando: explique o conflito ao usuário (qual flow + qual caixa) e ofereça desativar o outro ou mudar o gatilho. Dá pra checar antes com `POST /flows/check_conflicts` (não salva). Detalhes no `flowbuilder-design-guide` (seção 2.1, "Trava de gatilho duplicado").

Se a necessidade não bate com nenhum pattern, monte do zero seguindo o **`flowbuilder-design-guide`** — mas use estes templates como referência de layout/handle/schema válidos.
