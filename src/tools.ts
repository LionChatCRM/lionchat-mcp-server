// AIDEV-NOTE: Tool registration module for LionChat MCP server
// Reads endpoints.json and registers each endpoint as an MCP tool with Zod schemas

import { z, ZodTypeAny } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Config } from './config.js';
import { LionChatClient } from './client.js';
import {
  substitutePath,
  buildQueryString,
  formatResponse,
  separateParams,
} from './utils.js';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// AIDEV-NOTE: Shape of each endpoint entry in endpoints.json
interface EndpointParam {
  name: string;
  type: string;
  location: string;
  required: boolean;
  description: string;
  // AIDEV-NOTE: Wire key for Rails array query params (e.g. "priorities[]"). When set,
  // the schema exposes the clean `name` but the query string uses `query_name`.
  query_name?: string;
}

interface EndpointDef {
  id: string;
  method: string;
  path: string;
  title: string;
  description: string;
  category: string;
  params: EndpointParam[];
  // AIDEV-NOTE: Optional Rails strong_params wrapper (e.g. "variable", "assistant")
  // When set, all body params are wrapped under this key before sending the request.
  body_wrapper?: string;
}

// AIDEV-NOTE: Tool annotations based on HTTP method — informs MCP client about tool behavior
interface ToolAnnotations {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
}

// AIDEV-NOTE: Map HTTP method to tool annotations for MCP client hinting
function getToolAnnotations(method: string): ToolAnnotations {
  switch (method.toUpperCase()) {
    case 'GET':
      return { readOnlyHint: true, destructiveHint: false, idempotentHint: true };
    case 'POST':
      return { readOnlyHint: false, destructiveHint: false, idempotentHint: false };
    case 'PATCH':
    case 'PUT':
      return { readOnlyHint: false, destructiveHint: false, idempotentHint: true };
    case 'DELETE':
      return { readOnlyHint: false, destructiveHint: true, idempotentHint: true };
    default:
      return { readOnlyHint: false, destructiveHint: false, idempotentHint: false };
  }
}

// AIDEV-NOTE: Normalize category names to URL-safe slugs (lowercase, underscores, no accents)
// AIDEV-NOTE: Category slug map — Portuguese category names to English slugs.
// Used for --categories filter matching. Slugs match the tool ID prefix pattern.
const CATEGORY_SLUG_MAP: Record<string, string> = {
  'conta': 'account',
  'respostas rapidas': 'canned_responses',
  'contatos': 'contacts',
  'conversas': 'conversations',
  'caixas de entrada': 'inboxes',
  'mensagens': 'messages',
  'times': 'teams',
  'labels': 'labels',
  'filtros personalizados': 'custom_filters',
  'macros': 'macros',
  'busca': 'search',
  'notificacoes': 'notifications',
  'anuncios': 'announcements',
  'empresas': 'companies',
  'ofertas': 'offers',
  'upload': 'upload',
  'agenda / tarefas': 'tasks',
  'variaveis da conta': 'account_variables',
  'mensagens agendadas': 'scheduled_messages',
  'funis': 'funnels',
  'itens': 'kanban_items',
  'operacoes em massa': 'kanban_bulk',
  'agentes (kanban)': 'kanban_agents',
  'checklist': 'kanban_checklist',
  'notas': 'kanban_notes',
  'contatos (cliente)': 'public_contacts',
  'conversas (cliente)': 'public_conversations',
  'mensagens (cliente)': 'public_messages',
  'pesquisa csat': 'public_csat',
  'sessoes': 'flow_sessions',
  'tipos de evento': 'booking_event_types',
  'publica': 'public_booking',
  'chamadas': 'voip_calls',
  'flows': 'flows',
  'assistentes': 'captain_assistants',
  'base de conhecimento': 'captain_documents',
  'regras de automacao': 'automation_rules',
  'roles personalizados': 'custom_roles',
  'politicas de capacidade': 'capacity_policies',
  'sla': 'sla',
  'acesso de suporte': 'support_access',
  'dashboard apps': 'dashboard_apps',
  'grupos whatsapp': 'waha_groups',
  'templates whatsapp': 'whatsapp_templates',
  'csat template': 'csat_template',
  'migracao de inbox': 'inbox_migration',
  'google calendar': 'google_calendar',
  'politicas de atribuicao': 'assignment_policies',
  'webhooks': 'webhooks',
  'integracoes e-commerce': 'ecommerce_webhooks',
  'meta lead ads': 'meta_lead',
  'config kanban': 'kanban_config',
  'kanban v2': 'kanban_v2',
  'portais': 'portals',
  'config de notificacao': 'notification_settings',
  'relatorios': 'reports',
  'prompts salvos': 'copilot_prompts',
  'membros de inbox': 'inbox_members',
  'disponibilidade': 'agent_availability',
  'csat': 'csat',
  'atributos personalizados': 'custom_attributes',
  'agentes': 'agents',
};

function slugify(text: string): string {
  const normalized = text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
  return CATEGORY_SLUG_MAP[normalized] || normalized.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

// AIDEV-NOTE: Map endpoint param type strings to Zod schema types
function paramTypeToZod(param: EndpointParam): ZodTypeAny {
  let schema: ZodTypeAny;

  switch (param.type) {
    case 'integer':
      schema = z.number().int();
      break;
    case 'number':
      schema = z.number();
      break;
    case 'boolean':
      schema = z.boolean();
      break;
    case 'object':
      schema = z.record(z.unknown());
      break;
    case 'array':
      schema = z.array(z.unknown());
      break;
    case 'file':
      schema = z
        .string()
        .describe(
          'File path or URL — file upload not supported in MCP v1'
        );
      break;
    case 'string':
    default:
      schema = z.string();
      break;
  }

  // AIDEV-NOTE: Add param description unless already set (file type sets its own)
  if (param.type !== 'file' && param.description) {
    schema = schema.describe(param.description);
  }

  if (!param.required) {
    schema = schema.optional();
  }

  return schema;
}

// AIDEV-NOTE: Build Zod object schema from endpoint params.
// account_id is exposed as OPTIONAL — when omitted we fall back to LIONCHAT_ACCOUNT_ID.
// This enables multi-tenant usage (single MCP instance can hit several accounts).
function buildZodSchema(
  params: EndpointParam[]
): z.ZodObject<Record<string, ZodTypeAny>> {
  const shape: Record<string, ZodTypeAny> = {};
  let hasAccountIdInPath = false;

  for (const param of params) {
    if (param.name === 'account_id') {
      hasAccountIdInPath = true;
      // AIDEV-NOTE: Force account_id optional regardless of how it was declared upstream.
      // Tool handler resolves the effective value (input || config.accountId).
      shape[param.name] = z
        .string()
        .optional()
        .describe(
          'ID da conta. Opcional — se ausente, usa LIONCHAT_ACCOUNT_ID. Informe para chamar uma conta diferente sem reiniciar o MCP.'
        );
      continue;
    }
    // AIDEV-NOTE: B3 (2026-06-02) — file upload não é suportado no MCP v1. Se o param file
    // for `required`, ele entraria no required[] do schema mas o handler rejeita assim que
    // for fornecido → tool impossível de chamar. Não expomos file no schema: a tool roda com
    // os demais params (o aviso fica na descrição; o guard abaixo permanece como defesa).
    if (param.type === 'file') {
      continue;
    }
    shape[param.name] = paramTypeToZod(param);
  }

  // AIDEV-NOTE: Some endpoints embed {account_id} in the path but do NOT declare it as a param.
  // Expose it as optional so callers can override the env even on those tools.
  if (!hasAccountIdInPath) {
    shape['account_id'] = z
      .string()
      .optional()
      .describe(
        'ID da conta. Opcional — se ausente, usa LIONCHAT_ACCOUNT_ID. Informe para chamar uma conta diferente sem reiniciar o MCP.'
      );
  }

  return z.object(shape);
}

// AIDEV-NOTE: Check if endpoint has any file-type params (unsupported in MCP v1)
function hasFileParam(params: EndpointParam[]): boolean {
  return params.some((p) => p.type === 'file');
}

// AIDEV-NOTE: Register a single API endpoint as an MCP tool
function registerSingleTool(
  server: McpServer,
  config: Config,
  client: LionChatClient,
  endpoint: EndpointDef
): void {
  const schema = buildZodSchema(endpoint.params);
  const annotations = getToolAnnotations(endpoint.method);
  const hasFile = hasFileParam(endpoint.params);

  // AIDEV-NOTE: Prepend file upload warning to description when endpoint needs file params
  let description = `[${endpoint.method.toUpperCase()}] ${endpoint.description}`;
  if (hasFile) {
    description =
      '⚠️ This endpoint requires file upload which is not yet supported via MCP.\n\n' +
      description;
  }

  server.tool(
    endpoint.id,
    description,
    schema.shape,
    annotations,
    async (params: Record<string, unknown>) => {
      try {
        // AIDEV-NOTE: Block execution if file param was actually provided
        if (hasFile) {
          const fileParams = endpoint.params.filter((p) => p.type === 'file');
          for (const fp of fileParams) {
            // AIDEV-NOTE: B10 (2026-06-02) — trata "" como "não fornecido" (igual ao remoto
            // runner.ts), pra os dois conectores terem o mesmo guard de file vazio.
            if (params[fp.name] !== undefined && params[fp.name] !== null && params[fp.name] !== '') {
              return {
                content: [
                  {
                    type: 'text' as const,
                    text: 'File upload is not supported via MCP. Use the LionChat web interface or direct API calls.',
                  },
                ],
                isError: true,
              };
            }
          }
        }

        // AIDEV-NOTE: Multi-tenant — input account_id (if provided) overrides env LIONCHAT_ACCOUNT_ID.
        // Resolve and strip account_id BEFORE bucketing so it never lands in body/query for
        // endpoints that don't declare it as an explicit param.
        const rawAccountId = params['account_id'];
        const effectiveAccountId =
          rawAccountId !== undefined && rawAccountId !== null && String(rawAccountId).length > 0
            ? String(rawAccountId)
            : config.accountId;
        const paramsWithoutAccount: Record<string, unknown> = { ...params };
        delete paramsWithoutAccount['account_id'];

        const { pathParams, queryParams, bodyParams } = separateParams(
          paramsWithoutAccount,
          endpoint.params,
          endpoint.body_wrapper
        );

        const path = substitutePath(
          endpoint.path,
          effectiveAccountId,
          pathParams
        );
        const queryStr = buildQueryString(queryParams);
        const fullPath = queryStr ? `${path}${queryStr}` : path;

        const result = await client.request({
          method: endpoint.method,
          path: fullPath,
          body: Object.keys(bodyParams).length > 0 ? bodyParams : undefined,
        });

        return {
          content: [{ type: 'text' as const, text: formatResponse(result) }],
        };
      } catch (err) {
        // AIDEV-NOTE: Return actionable error messages from LionChatApiError to the LLM
        // instead of letting MCP SDK swallow them into generic protocol errors
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: 'text' as const, text: message }],
          isError: true,
        };
      }
    }
  );
}

// AIDEV-NOTE: Meta tool — tests connectivity by calling GET /api/v1/profile
function registerPingTool(
  server: McpServer,
  config: Config,
  client: LionChatClient
): void {
  server.tool(
    'lionchat_ping',
    'Test connectivity to the LionChat API. Returns your user profile if the token is valid.',
    {},
    { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    async () => {
      try {
        const result = await client.request({
          method: 'GET',
          path: '/api/v1/profile',
        });

        return {
          content: [{ type: 'text' as const, text: formatResponse(result) }],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: 'text' as const, text: message }],
          isError: true,
        };
      }
    }
  );
}

// AIDEV-NOTE: Meta tool — lists all available categories with tool counts (no API call)
function registerListCategoriesTool(
  server: McpServer,
  allEndpoints: EndpointDef[]
): void {
  // AIDEV-NOTE: Pre-compute category counts at registration time (static data)
  const categoryCounts = new Map<string, number>();
  for (const ep of allEndpoints) {
    const slug = slugify(ep.category);
    categoryCounts.set(slug, (categoryCounts.get(slug) ?? 0) + 1);
  }

  const categoryList = Array.from(categoryCounts.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([slug, count]) => `${slug}: ${count} tools`)
    .join('\n');

  server.tool(
    'lionchat_list_categories',
    'List all available API categories and how many tools each has. Use category slugs with the --categories config flag to filter tools.',
    {},
    { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    async () => {
      return {
        content: [{ type: 'text' as const, text: categoryList }],
      };
    }
  );
}

// AIDEV-NOTE: Meta tool — returns full Flow Builder schema reference (no API call).
// Helps LLMs build correct flow_data without hitting trial-and-error on
// node types, action keys, source handles, etc.
function registerFlowsSchemaReferenceTool(server: McpServer): void {
  const reference = `LIONCHAT FLOW BUILDER — SCHEMA REFERENCE (atualizado 2026-07-03)

flow_data tem o formato Vue Flow: { nodes: [...], edges: [...] }.

═══ DOIS TIPOS DE FLOW (e o modo do conversation) ═══
- conversation (default): dispara por evento de inbox. Criar via lionchat_flows_create.
  conversation_mode: 'individual' (1-a-1, default) ou 'group' (grupo WhatsApp). IMUTAVEL apos criar.
  So 'group' aceita o node update_group (Configurar Grupo: nome/foto/permissoes). 'group' NAO tem
  gatilhos/condicoes de LionTrack (pagetrack). Na UI aparecem como 3 opcoes: Mensagem / Grupo / IA Agente.
- ai_tool: ferramenta que o AI Agente invoca. Criar via lionchat_flow_tools_create (NAO flows_create!),
  com tool_name (snake_case, max 50) + tool_description (max 500). SEM inbox_ids. No 'end' OBRIGATORIO.
  Nodes permitidos em ai_tool: start, end, api, condition, set_variable, ai, randomizer, action,
  send_message, note (SEM wait, wait_response, update_group). No action de ai_tool NAO use keys da
  aba Sistema (send_webhook/start_flow). Vincular ao assistente: POST /flow_tools/{id}/assistants.
  Testar: POST /flow_tools/{id}/run.

═══ NODE GERAL ═══
{ "id": "string-unico", "type": "start|send_message|wait_response|condition|action|api|set_variable|wait|randomizer|update_group|ai|end|note", "position": {"x":0,"y":0}, "data": { ... } }
(activate_flow existe como node LEGADO — nao crie novos; use action start_flow)

═══ NODE TYPES + source handles ═══

▸ start
  data: { label, triggers: [...] }
  Triggers: message_received (keywords[] min 3 chars + match_type 'contains'|'exact' — dispara em
    QUALQUER msg do cliente que case), conversation_created/conversation_reopened (match_mode +
    keywords opcionais), conversation_resolved, label_added/label_removed (label_names[] — NAO
    'label' singular), card_created/card_moved (funnel_ids[] + funnel_stages[] 'funnel_id:stage'),
    cron, webhook. NOVO message_sent (2026-06-11): par do message_received pra mensagens de
    SAIDA (atendente, celular/eco, IA — nota privada NAO) com keywords+match_type; cuidado: acao
    'desativar IA' com esse trigger sem keywords = a propria resposta da IA dispara o flow.
  WEBHOOK EMBUTIDO (Webhook Universal): 1) criar flow; 2) POST /custom_webhook_integrations com
    {custom_webhook_integration:{flow_id}} (idempotente, retorna URL unica); 3) flows_update com
    item {type:'webhook_received', config:{integration_id}} no data.items do start. Remover o item
    desativa o webhook. Excluir flow destroi o webhook. Duplicar flow NAO copia o gatilho.
  Handle: "success".

▸ send_message
  data: { label, messageItems: [
    { id, type:"text", content },
    { id, type:"delay", seconds },
    { id, type:"whatsapp_template", templateId, params },
    { id, type:"canned_response"|"user_input"|"attachment"|"audio", ... }
  ]}
  ATENCAO: messageItems (NAO items).
  Botoes: item text com buttons_enabled=true + buttons:[{title,value}] gera handle "button_{value}"
  por botao + "no_response" (texto livre em vez de clique) + "no_reply_timeout" (se timeout).
  Timeout (opcional, mesmo item): buttons_timeout + buttons_timeout_unit (minutes|hours|days).
  buttons_timeout_action: "advance" (padrao, segue no_reply_timeout ao esgotar) | "remind" (manda 1
  lembrete buttons_reminder_text e CONTINUA esperando; depois segue no_reply_timeout). No modo remind
  a unidade NAO pode ser days e horas <= 23 (janela 24h do WhatsApp).
  Handles sem botoes: "success", "error".

▸ wait_response
  data: {
    label, waitTime, waitUnit: "minutes"|"seconds"|"hours",
    groupInputsSeconds: 0|10|15|20|25|30|40,   // 0=off (padrao). Agrupa baloes picados do cliente antes de validar (debounce)
    validation: "any"|"number"|"email"|"phone"|"options"|"varied_options"|"regex"|"cpf"|"cnpj"|"cpf_cnpj"|"date"|"rg"|"profession",
    acceptedOptions: ["1","2"],     // se validation='options'
    optionGroups: [{ id, terms:["sim","claro"], matchType:"contains"|"equals" }], // se validation='varied_options'
    regexPattern,                    // se validation='regex'
    invalidMessage, maxRetries,
    saveTo: "variable"|"contact_name"|"contact_email"|"contact_phone"|"contact_cpf"|"contact_cnpj"|"contact_document"|"contact_birthdate"|"contact_rg"|"contact_profession"|"contact_attr"|"conversation_attr"|"",
    saveVariable, saveAttrKey        // saveAttrKey obrigatorio p/ contact_attr e conversation_attr
  }
  CPF/CNPJ validam digito verificador (documento falso -> invalidMessage). Alvos cadastrais so com a validation
    correspondente: cpf=>contact_cpf, cnpj=>contact_cnpj, cpf_cnpj=>contact_document (decide pelos digitos),
    date=>contact_birthdate (dd/mm/aaaa->ISO), rg=>contact_rg, profession=>contact_profession. Campo cadastral
    ja preenchido NAO e sobrescrito (imutavel). saveTo contact_attr/conversation_attr: se o atributo tiver tipo
    (number/currency/percent/date/list ou text+regex), a resposta tambem e validada/formatada por esse tipo.
  saveTo "attribute"/"contact_attribute" NAO EXISTEM — nao salvam nada.
  TIMEOUT DISPARA DE VERDADE (corrigido 2026-06-09): waitTime estourou -> handle "timeout"
  (ou "option_{val}_timeout" no modo options). Sempre ligue um edge no timeout.
  Respostas invalidas alem de maxRetries -> handle "retries_exhausted" (distinto do timeout de silencio;
    se nao houver edge nele, cai no "timeout").
  Handles validation='options': "option_{val}" por opcao + "timeout"
  Handles validation='varied_options': "option_{group_id}" por grupo (optionGroups) + "timeout"
  Handles outros: "success" + "timeout"
  options/varied_options normalizam a resposta (sem acento/maiuscula); varied_options usa matchType por
    grupo ('contains' padrao ou 'equals'). saveTo contact_email/contact_phone exige validation 'email'/'phone'
    (valor invalido NAO grava; telefone vira E.164) — pra texto livre use saveTo "variable".
  IMPORTANTE: validation='options'/'varied_options' ja roteia por opcao/grupo — NAO precisa condition depois.

▸ condition
  data: { label, conditions: [
    { id, label, field, operator, value }
  ]}
  Agrupar E/OU: cada saida pode trocar a regra plana por rules[]+logic:
    { id, label, logic: "and"|"or", rules: [ {field,operator,value}, ... ] }
    logic ausente = "and"; ate 10 regras por saida; sem rules = grupo de 1 (retrocompat).
    label = nome OPCIONAL da saida (cosmetico, aparece no canvas; NAO muda roteamento).
    As regras de um grupo podem ser de tipos diferentes (atributo + status + etiqueta + SLA...).
  Handles: "cond_0", "cond_1", ... (POSICAO no array, NAO o id da condicao!) + "default".
  First-match-wins: avalia em ordem e PARA na primeira que bate.
  Operadores: equal/not_equal, contains/not_contains, starts_with/ends_with,
    is_empty/is_not_empty (NAO existe is_present/is_blank), greater_than/less_than,
    number_range ("min-max"), regex, equal_any/contains_any (values[]),
    business_hours/outside_business_hours (campos opcionais days[0=dom..6=sab]/start_hour/end_hour/timezone
      IANA ex. America/Sao_Paulo; outside_business_hours HERDA days/start_hour/end_hour/timezone da
      business_hours ANTERIOR no array — pode deixar ausentes que o backend preenche),
    can_reply/can_reply_closed, conversation_has_agent/no_agent,
    contact_has_label/conversation_has_label,
    kanban_exists/kanban_in_stage/kanban_won/kanban_lost, pagetrack_visited/pagetrack_event,
    sla_check (SO value, codigo fixo: frt_breached/frt_ok/nrt_breached/nrt_ok/rt_breached/rt_ok/has_sla/no_sla;
      frt=primeira resp, nrt=proxima, rt=resolucao; _ok exige politica de SLA aplicada).
  Operador numerico SO em atributo numero.

▸ action
  data: { label, items: [ { key, config: {...} } ] }
  ATENCAO: items[].config NAO items[].params.
  Keys validas:
    Conversa: assign_agent({agent_id}), assign_team({team_id}),
      change_status({status: open|resolved|pending|snoozed}), change_priority({priority}),
      mute_conversation({}), add_private_note({content}), send_email_transcript({email}),
      add_conversation_label({labels:[...]}), remove_conversation_label({labels:[...]}),  // etiqueta NA CONVERSA
      assign_captain({assistant_id}), deactivate_captain({})
    Contato: add_label({labels:[...]}), remove_label({labels:[...]}),  // etiqueta NO CONTATO
      update_attribute({attr_source:'contact'|'conversation'|'card', attr_key, attr_value})
        — campos EXATOS (NAO entity/key/value). Somar/subtrair via Liquid no attr_value:
        "{{ contact.custom_attribute.pontos | plus: 1 }}"
    Kanban: create_kanban_item({funnel_id, funnel_stage, title?, description?})
        — funnel_id e funnel_stage OBRIGATORIOS; title/description aceitam {{ }},
      move_kanban_stage({funnel_id,funnel_stage}), set_kanban_item_status({status:won|lost|active}),
      set_won({}), set_lost({reason?}), assign_agent_card({agent_id}), add_card_note({content}),
      add_card_checklist({template_id}) — aplica um modelo de checklist ao card (vira grupo)
    Sistema (SO flow conversation): send_webhook({url,headers?,body?}), start_flow({flow_id}),
      deactivate_flow({})
  Handles: "success" (sem handle error — falha vira warning e o flow continua).

▸ api
  data: { label, method, url, headers:[{key,value}], body, apiResponseVar }
  Handles: "success", "error"

▸ ai
  data: { label, aiMode: "generate"|"intent"|"sentiment"|"extract", aiPrompt,
    aiIntents: [{name}],            // se intent — ARRAY DE OBJETOS (NAO array de strings)
    aiResponseVar,                   // se extract
    contextMessages: 25|50|75|100 }  // quantas msgs a IA enxerga
  Handles intent: "intent_{name}" por intencao + "no_intent" + "error" (var {{ai_intent}} disponivel)
  Handles sentiment: "positive", "negative", "neutral" + "error"
  Handles generate/extract: "success", "error"

▸ set_variable
  data: { label, variables: [{name,value}] }
  Handle: "success"

▸ wait
  data.waitMode: "duration" (default) | "date" | "weekday"
  duration: waitDuration + waitUnit (seconds|minutes|hours|days)
  date: waitDate ("YYYY-MM-DD") + waitTime ("HH:MM" 24h) + waitTimezone (IANA, default America/Sao_Paulo)
        + waitDateMode/waitTimeMode ("fixed"|"variable"). Em "variable" o campo contem {{contact.custom_attribute.X}}
        (Data SO aceita atributo tipo date; Horario SO tipo time). Resolve UMA vez na entrada do node.
        Variavel invalida -> saida "error" (invalid_variable_datetime). Data no passado -> segue por "success".
  weekday: waitWeekday (0=dom..6=sab) + waitWeekdayTime ("HH:MM", SEMPRE fixo, sem variavel) + waitTimezone
  (NAO existem waitUnit:"weekday", targetWeekday nem targetHour — erro de doc antiga)
  Handles: "success" (+ "error" so com variavel invalida no modo date)

▸ randomizer
  data: { label, mode:"branches", branches:[{id,label,weight}] }
  Handles: o id de cada branch.

▸ update_group (WAHA, conversa de grupo apenas)
  Handles: "success", "error"

▸ end
  Terminal, sem handles de saida. Em conversation: encerra o ramo. Em ai_tool: OBRIGATORIO —
  data define o retorno estruturado pro LLM (suporta saida Liquid com {{ }}).

▸ note
  Sticky note visual (bloco colorido de anotacao). Sem handles, nunca executa, nao ligue edges.
  data: title (cabecalho), body (corpo), color (yellow|teal|blue|violet|pink|orange|slate, default yellow),
  width (px, default 320, min 200), height (px, default 200, min 80). ATENCAO: texto vai em title+body,
  NUNCA em 'content' (usar content grava nota vazia). Disponivel nos 2 tipos de flow.

═══ VARIAVEIS {{ }} ═══
contact.name, contact.email, contact.phone, contact.custom_attribute.X (SINGULAR — plural resolve vazio)
CADASTRAL forma curta (canonica): contact.cpf, contact.cnpj, contact.rg, contact.address.street,
  contact.address.number, ... (NAO e custom_attribute!)
conversation.id, conversation.status, conversation.team_id, conversation.agent_id,
  conversation.labels, conversation.custom_attribute.X
account.custom_attribute.X, env.CHAVE, {{var_criada_no_set_variable}}, {{ai_intent}}, {{api_response_var}}

═══ ANTI-LOOP ═══
Cadeias automacao<->flow tem profundidade maxima 5 hand-offs (MAX_CHAIN_DEPTH). No 5o a cadeia e
cortada em silencio. "Flow nao disparou" no fim de cadeia longa = essa protecao.

═══ EDGES ═══
[{ "id", "source", "target", "sourceHandle", "type":"deletable", "animated":true }]
sourceHandle OBRIGATORIO casar com handle exposto pelo node source.

═══ ERROS COMUNS ═══
1. action items[].config (nao params)
2. send_message messageItems (nao items)
3. wait_response validation='options' roteia por handle 'option_X' — NAO use condition depois
4. condition usa 'cond_0'/'cond_1' (INDICE) + 'default' — NUNCA o id da condicao ('c1' QUEBRA)
5. inbox_ids no MCP vai no nivel raiz; no PUT bruto vai em {flow:{inbox_ids:[]}}
6. send_message com buttons gera 'button_{value}' (value do botao, nao titulo)
7. condition.field/mensagens aceitam liquid: '{{conversation.team_id}}', '{{contact.custom_attribute.plano}}',
   '{{contact.cpf}}' (cadastral curto), '{{var_nome}}' — NUNCA '{{contact.attributes.X}}'
8. saveTo 'attribute'/'contact_attribute' nao existem — use 'contact_attr'/'conversation_attr'
9. ai_tool via flow_tools_create (flows_create rejeita/cria do tipo errado); no end obrigatorio
10. node sem position empilha tudo em (0,0) — sempre informe e nunca repita (x,y)

═══ EXEMPLO MINIMO — Menu 3 opcoes ═══
{
  "nodes": [
    {"id":"s1","type":"start","position":{"x":50,"y":200},"data":{"label":"Inicio"}},
    {"id":"m1","type":"send_message","position":{"x":300,"y":200},"data":{
      "label":"Menu",
      "messageItems":[{"id":"t1","type":"text","content":"Digite:\\n1 - Vendas\\n2 - Suporte\\n3 - Financeiro"}]
    }},
    {"id":"w1","type":"wait_response","position":{"x":600,"y":200},"data":{
      "label":"Aguarda","waitTime":60,"waitUnit":"minutes",
      "validation":"options","acceptedOptions":["1","2","3"],
      "invalidMessage":"Digite 1, 2 ou 3.","maxRetries":3,
      "saveTo":"variable","saveVariable":"menu"
    }},
    {"id":"a1","type":"action","position":{"x":900,"y":50},"data":{
      "label":"Vendas","items":[{"key":"assign_team","config":{"team_id":24}}]
    }},
    {"id":"a2","type":"action","position":{"x":900,"y":200},"data":{
      "label":"Suporte","items":[{"key":"assign_team","config":{"team_id":23}}]
    }},
    {"id":"a3","type":"action","position":{"x":900,"y":350},"data":{
      "label":"Financeiro","items":[{"key":"assign_team","config":{"team_id":25}}]
    }}
  ],
  "edges":[
    {"id":"e1","source":"s1","target":"m1","sourceHandle":"success","type":"deletable","animated":true},
    {"id":"e2","source":"m1","target":"w1","sourceHandle":"success","type":"deletable","animated":true},
    {"id":"e3","source":"w1","sourceHandle":"option_1","target":"a1","type":"deletable","animated":true},
    {"id":"e4","source":"w1","sourceHandle":"option_2","target":"a2","type":"deletable","animated":true},
    {"id":"e5","source":"w1","sourceHandle":"option_3","target":"a3","type":"deletable","animated":true}
  ]
}`;

  server.tool(
    'lionchat_flows_schema_reference',
    'Returns the full Flow Builder schema reference: node types, action keys, source handles, edge format, common pitfalls and a minimal working example. CALL THIS BEFORE building or editing a flow_data via lionchat_flows_create or lionchat_flows_update.',
    {},
    { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    async () => {
      return {
        content: [{ type: 'text' as const, text: reference }],
      };
    }
  );
}

// AIDEV-NOTE: Main entry point — reads endpoints.json, filters, and registers all tools + meta tools
export function registerTools(
  server: McpServer,
  config: Config,
  client: LionChatClient
): number {
  // AIDEV-NOTE: Resolve endpoints.json relative to compiled dist/ directory (one level up)
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const endpointsPath = resolve(__dirname, '..', 'endpoints.json');
  let endpoints: EndpointDef[];
  try {
    endpoints = JSON.parse(readFileSync(endpointsPath, 'utf-8'));
  } catch (err) {
    throw new Error(
      `Failed to load endpoints.json from ${endpointsPath}. ` +
      `Reinstall with: npm install @lionchat/mcp-server\n` +
      `Original error: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  let filtered = endpoints;

  // AIDEV-NOTE: Filter by category slugs if configured via --categories or env var
  if (config.categories) {
    const allowedSlugs = new Set(config.categories.map(slugify));
    filtered = endpoints.filter((e) => allowedSlugs.has(slugify(e.category)));
  }

  // AIDEV-NOTE: Exclude public API endpoints unless explicitly opted in
  if (!config.includePublicApi) {
    filtered = filtered.filter((e) => !e.id.startsWith('lionchat_public_'));
  }

  // AIDEV-NOTE: Register each filtered endpoint as an MCP tool
  for (const endpoint of filtered) {
    registerSingleTool(server, config, client, endpoint);
  }

  // AIDEV-NOTE: Always register meta tools regardless of category filters
  registerPingTool(server, config, client);
  registerListCategoriesTool(server, endpoints);
  registerFlowsSchemaReferenceTool(server);

  return filtered.length + 3; // +3 for ping, list_categories, flows_schema_reference
}
