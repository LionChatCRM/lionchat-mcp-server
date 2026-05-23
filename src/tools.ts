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
            if (params[fp.name] !== undefined && params[fp.name] !== null) {
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
  const reference = `LIONCHAT FLOW BUILDER — SCHEMA REFERENCE

flow_data tem o formato Vue Flow: { nodes: [...], edges: [...] }.

═══ NODE GERAL ═══
{ "id": "string-unico", "type": "start|send_message|wait_response|condition|action|api|set_variable|wait|randomizer|update_group|ai|end", "position": {"x":0,"y":0}, "data": { ... } }

═══ NODE TYPES + source handles ═══

▸ start
  data: { label }
  (sem handles — start tem so output default pro proximo node)

▸ send_message
  data: { label, messageItems: [
    { id, type:"text", content },
    { id, type:"image", url, caption },
    { id, type:"template", template_name, ... }
  ]}
  Handles: "success", "no_response" (se timeout), "error", "window_closed" (WhatsApp API Official).
  Se messageItem text com buttons_enabled=true: gera "button_{value}" por botao.

▸ wait_response
  data: {
    label, waitTime, waitUnit: "minutes"|"seconds",
    validation: "any"|"options"|"regex",
    acceptedOptions: ["1","2"],     // se validation='options'
    regexPattern,                    // se validation='regex'
    invalidMessage, maxRetries,
    saveTo: "variable"|"attribute"|"",
    saveVariable, saveAttrKey
  }
  Handles validation='options': "option_{val}" por opcao + "timeout"
  Handles outros: "success" + "timeout"
  IMPORTANTE: validation='options' ja roteia por opcao — NAO precisa condition depois.

▸ condition
  data: { label, conditions: [
    { id, label, field, operator, value, valueType }
  ]}
  Handles: id de cada condicao + "default" (fallback).

▸ action
  data: { label, items: [
    { key, config: {...} }
  ]}
  ATENCAO: items[].config NAO items[].params.
  Keys validas:
    Conversa: assign_agent({agent_id}), assign_team({team_id}),
      change_status({status,snooze_option}), change_priority({priority}),
      mute_conversation({}), add_private_note({content}),
      send_email_transcript({email}), deactivate_flow({}),
      assign_captain({assistant_id}), deactivate_captain({})
    Contato: add_label({labels:[...]}), remove_label({labels:[...]}),
      update_attribute({attr_source,attr_key,attr_value})
    Kanban: create_kanban_item({funnel_id,funnel_stage,...}),
      move_kanban_stage({funnel_id,funnel_stage}),
      set_won({funnel_id}), set_lost({funnel_id,lost_reason}),
      assign_agent_card({funnel_id,agent_id}),
      add_card_note({funnel_id,text})
  Handles: "success", "error"

▸ api
  data: { label, method, url, headers:[{key,value}], body, apiResponseVar }
  Handles: "success", "error"

▸ set_variable
  data: { label, variables: [{name,value}] }

▸ wait
  data: { label, waitTime, waitUnit }

▸ randomizer
  data: { label, branches:[{id,percent}] }
  Handles: id de cada branch.

═══ EDGES ═══
[{ "id", "source", "target", "sourceHandle", "type":"deletable", "animated":true }]
sourceHandle OBRIGATORIO casar com handle exposto pelo node source.

═══ ERROS COMUNS ═══
1. action items[].config (nao params)
2. send_message messageItems (nao items)
3. wait_response validation='options' roteia por handle 'option_X' — NAO use condition depois
4. sourceHandle precisa ser o handle REAL do node source ('success', 'option_1', 'timeout', 'no_response', 'c1' do condition, etc)
5. inbox_ids no MCP vai no nivel raiz; no PUT bruto vai em {flow:{inbox_ids:[]}}
6. send_message com buttons gera 'button_{value}' (value do botao, nao titulo)
7. condition.field aceita liquid: '{{conversation.team_id}}', '{{contact.attributes.cpf}}', '{{var_nome}}'

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
    {"id":"e1","source":"s1","target":"m1","type":"deletable","animated":true},
    {"id":"e2","source":"m1","target":"w1","type":"deletable","animated":true},
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
