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
import {
  FULL_RESPONSE_PARAM,
  FULL_RESPONSE_DESCRIPTION,
  supportsFullResponse,
} from './sanitize.js';

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
// AIDEV-NOTE: [2026-07-24] toolId opcional — tools curadas (sanitize.FULL_RESPONSE_TOOLS)
// ganham o param full_response no schema (escape do slim). NAO injetar nas 682 (inflaria
// o tools/list em ~20-30k tokens).
function buildZodSchema(
  params: EndpointParam[],
  toolId?: string
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

  // AIDEV-NOTE: [2026-07-24] Escape do slim so nas tools curadas — ver sanitize.ts.
  if (toolId && supportsFullResponse(toolId)) {
    shape[FULL_RESPONSE_PARAM] = z
      .boolean()
      .optional()
      .describe(FULL_RESPONSE_DESCRIPTION);
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
  const schema = buildZodSchema(endpoint.params, endpoint.id);
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

        // AIDEV-NOTE: [2026-07-24] full_response e flag do CONECTOR (escape do slim) — stripar
        // SEMPRE antes do bucketing (mesmo tratamento do account_id), senao o catch-all
        // default->body do separateParams vazaria o campo pro corpo enviado ao Rails.
        const fullResponse = params[FULL_RESPONSE_PARAM] === true;
        delete paramsWithoutAccount[FULL_RESPONSE_PARAM];

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
          content: [
            {
              type: 'text' as const,
              text: formatResponse(result, {
                slim: !fullResponse,
                toolId: endpoint.id,
              }),
            },
          ],
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
  const reference = `LIONCHAT FLOW BUILDER — SCHEMA REFERENCE (atualizado 2026-08-18)

flow_data tem o formato Vue Flow: { nodes: [...], edges: [...] }.

═══ DOIS TIPOS DE FLOW (e o modo do conversation) ═══
- conversation (default): dispara por evento de inbox. Criar via lionchat_flows_create.
  conversation_mode: 'individual' (1-a-1, default) ou 'group' (grupo WhatsApp). IMUTAVEL apos criar.
  O node update_group (Gestao de Grupos, 17 operacoes) roda em fluxo de QUALQUER modo/canal desde que a
  conta tenha caixa WhatsApp QR Code (Channel::Waha) — em fluxo nao-grupo informe data.groupInboxId
  (ver o node update_group). 'group' NAO tem gatilhos/condicoes de LionTrack (pagetrack). Na UI aparecem
  como 3 opcoes: Mensagem / Grupo / IA Agente.
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
    'label' singular), card_created/card_moved (funnel_ids[] de STRINGS ex ["37"] — numero puro [37]
    NAO casa; + funnel_stages[] no formato 'funnel_id:chave_interna_da_etapa' ex '37:agendamento_pendente'
    — a chave e o SLUG/UUID INTERNO da etapa no funil, NAO o nome exibido; card precisa estar num funil
    de funnel_ids pro filtro de etapa valer),
    conversation_attribute_changed/card_attribute_changed (novo 2026-07-08: disparam na VIRADA de um
    atributo pro valor que casa, RE-ENTRAM a cada mudanca; config {logic:'and'|'or', rules:[{attr_key,
    operator, value | values:[...]}]}; attrSource IMPLICITO pela chave do gatilho (conversa vs card),
    NAO informe; operadores da condition EXCETO is_empty/is_not_empty (removidos do contexto reativo
    09/07 — use so no node condition); card_attribute_changed aceita funnel_id/card_source
    opcionais na rule),
    contact_attribute_changed (NOVO 2026-07-22 — 'Atributo do contato muda': dispara quando um
    custom_attribute do CONTATO muda e a condicao casa, mesmo com o contato fora de flow. Item:
    {key:'contact_attribute_changed', config:{logic:'and'|'or', rules:[{attrSource:'contact',
    attr_key, operator, value | values:[...]}]}} — 1 a 10 regras; DIFERENTE dos irmaos de 08/07,
    aqui o attrSource VAI na rule e e SEMPRE 'contact'; operadores iguais aos do node condition.
    VERSAO SEGURA por decisao de produto: dispara SO na conversa mais recente que JA EXISTE numa
    caixa do flow (reabre se resolvida); contato sem conversa NAO dispara e NUNCA cria conversa.
    Dedup 30s por contato, anti-loop por profundidade de cadeia; so flows de conversa),
    sla_missed (NOVO 24/07 — 'SLA estourado': dispara no momento EXATO do estouro de um prazo de
    SLA na conversa. Item: {key:'sla_missed', config:{sla_policy_id:''|'any'|'<id>',
    sla_type:'any'|'frt'|'nrt'|'rt'}} — vazio/'any' = qualquer politica / qualquer prazo; frt =
    1a resposta, nrt = resposta ao cliente, rt = resolucao. NAO re-dispara se o flow ja tem sessao
    ativa na conversa; flow antigo sem config = todos os SLAs/qualquer prazo),
    date_trigger (NOVO 2026-07-10 — Gatilho de Data: dispara quando uma DATA do CONTATO chega,
    aniversario/exame; modelo agenda, sem varredura; SO flow individual). Item usa config ANINHADO:
    {type:'date_trigger', config:{ attr_key ('_date_of_birth'=aniversario nativo, OU chave de
    atributo do contato tipo Data ex 'data_exame' — OBRIGATORIO), offset_direction 'before'|'on'|
    'after', offset_days 0-365, repeat_yearly bool (true=ignora ano/aniversario), send_time_source
    'fixed'|'attribute'|'variable' (+ send_time 'HH:MM' | send_time_attr_key | send_time_template
    Liquid so-contato), inbox_mode 'contact_recent'|'fixed' (+ inbox_id obrigatorio se fixed),
    filters {logic,rules[...]} opcional (attrSource sempre 'contact') }}. trigger_uuid e preenchido
    pelo backend (NAO envie). 29/02 vira 28/02 em ano nao-bissexto; tolerancia 24h; ativar o flow
    agenda quem ja tem a data; pulos aparecem em flows_executions_list.
    campaign_trigger (NOVO 2026-07-28 — Gatilho 'Campanha'): AUTORIZACAO, nao evento. Sozinho
    NUNCA dispara — libera o flow pra ser disparado por uma CAMPANHA DE FLUXO (Campanhas >
    Fluxo), pessoa por pessoa, no ritmo da campanha. Item SEM config: {key:'campaign_trigger'}.
    SEM ele o flow nao aparece na lista da campanha e campaigns_create com flow_id da 422 —
    e o passo que todo mundo esquece. Convive com outros gatilhos no mesmo flow e e ISENTO da
    trava de gatilho duplicado. Caixa WhatsApp OFICIAL: o 1o bloco de mensagem do flow tem que
    ser template aprovado (senao a campanha e recusada na criacao); QR Code nao tem essa regra.
    Escreva o 1o bloco assumindo CONTATO FRIO (a pessoa nao mandou nada — a campanha e que
    iniciou). Receita: flows_update com o item -> flows_list com with_campaign_trigger=true e
    inbox_id pra confirmar -> campaigns_create com flow_id.
    lead_form_completed / lead_form_milestone / lead_form_abandoned (NOVOS 2026-08-15 — gatilhos
    de FORMULARIO PUBLICO, feature Formularios): disparados pelo formulario de captacao, NAO por
    evento de conversa (inertes no matcher). Item: {key:'lead_form_completed', lead_form_id:<id>}
    — lead_form_id pode ir no topo do item (caminho API/MCP) ou dentro de config (tela);
    lead_form_milestone aceita milestone_node_id (vazio = qualquer marco); lead_form_abandoned
    dispara pelo tempo de abandono configurado no formulario. SO flow individual (nunca grupo).
    O flow nasce com variaveis form_* + respostas planas (form_<slug_da_pergunta>). Ver tools
    lionchat_lead_forms_* e o resource formularios-publicos.
    cron, webhook. NOVO message_sent (2026-06-11): par do message_received pra mensagens de
    SAIDA (atendente, celular/eco, IA — nota privada NAO) com keywords+match_type; cuidado: acao
    'desativar IA' com esse trigger sem keywords = a propria resposta da IA dispara o flow.
    group_participant_joined / group_participant_left (NOVO 07/08 — 'Entrou no grupo' / 'Saiu do
    grupo', evento de grupo WhatsApp QR Code). Item {key:'group_participant_joined'|
    'group_participant_left', config:{group_match:'any'|'contains'|'does_not_contain'|'equal_to'|
    'not_equal_to'|'starts_with'|'ends_with', group_name:'<termo>', group_ids:['<id ou 1203..@g.us>']}}
    — os dois filtros se SOMAM (E logico), cada um vazio deixa passar: group_match/group_name filtra
    pelo NOME do grupo; group_ids (so via API/MCP, compara por digitos) mira grupos exatos. Vale nos 2
    tipos de flow: em flow de grupo roda na conversa do grupo; em flow individual roda na conversa da
    PESSOA que entrou/saiu ('entrou no grupo -> manda no privado').
  WEBHOOK EMBUTIDO (Webhook Universal): 1) criar flow; 2) POST /custom_webhook_integrations com
    {custom_webhook_integration:{flow_id}} (idempotente, retorna URL unica); 3) flows_update com
    item {type:'webhook_received', config:{integration_id}} no data.items do start. Remover o item
    desativa o webhook. Excluir flow destroi o webhook. Duplicar flow NAO copia o gatilho.
  VALIDACAO flow_trigger_conflict: criar/atualizar/ativar retorna HTTP 422
    {error_code:'flow_trigger_conflict', conflicts:[{flow_id, flow_name, trigger_type, inbox_id,
    inbox_name}]} se outro flow ATIVO na MESMA inbox tiver gatilho do mesmo tipo que colide
    (card_created/card_moved por funil/etapa sobreposto; message_received/sent por keyword;
    label por label; conversation_resolved sempre). Flow INATIVO nao conta. Estrategia: 1 flow com
    gatilho amplo + node condition/exit_conditions, em vez de 2 flows concorrentes.
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
  Botoes em TEMPLATE (NOVO 2026-07-22): item de template com botoes quick-reply tambem PAUSA e
  roteia pelo clique. Item DEVE ter type:"template" (NAO whatsapp_template — o canvas so expoe os
  handles com "template") + template_id + template_buttons:[{title,value}] (title = texto EXATO do
  botao aprovado na Meta — o WhatsApp devolve o TITULO no clique e o match e por ele; value = slug
  do titulo, deduplicado). Handles: "button_{value}" por botao + "no_response" (sempre — texto livre)
  + "no_reply_timeout" (so com buttons_timeout > 0; buttons_timeout_unit minutes|hours|days, 0 = sem
  timeout). Modo sincrono (ai_tool) e dry_run NAO pausam — o template so e enviado. So faz sentido
  em caixa WhatsApp com template de botoes quick-reply aprovado.
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
  FALLBACK DE SAIDA (mudou 2026-08-15): quando o handle esperado nao tem fio, o avanco de ultimo
    recurso NUNCA segue fio negativo (timeout/no_reply_timeout/retries_exhausted/no_response/error).
    Antes ele podia "roubar" o fio do timeout e rotear resposta valida pro caminho de silencio;
    agora o ramo simplesmente PARA. Nao conte com o comportamento antigo: ligue o fio de sucesso.
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
    { id, label, field, operator, value, valueType }
  ]}
  CRITICO (2026-07-10, aprendido em flow real de producao):
    1. field SEMPRE com chaves: "{{contact.custom_attribute.plano}}", "{{minha_var}}", "{{last_response}}".
       Sem chaves o motor compara o TEXTO LITERAL do caminho — a saida NUNCA casa (tudo cai no default).
    2. Inclua "valueType": "variable" em CADA regra de expressao. O motor roda sem, mas o EDITOR VISUAL
       identifica o tipo da regra por esse campo — sem ele a saida aparece VAZIA na tela e, se alguem
       salvar o flow pela tela nesse estado, a regra e PERDIDA. (Excecoes que nao usam field/valueType
       "variable": regras por attr_key/attrSource="attr_config", business_hours, can_reply, sla_check,
       kanban_*, conversation_has_agent/no_agent, pagetrack_*.)
  Agrupar E/OU: cada saida pode trocar a regra plana por rules[]+logic:
    { id, label, logic: "and"|"or", rules: [ {field,operator,value,valueType}, ... ] }
    logic ausente = "and"; ate 10 regras por saida; sem rules = grupo de 1 (retrocompat).
    label = nome OPCIONAL da saida (cosmetico, aparece no canvas; NAO muda roteamento).
    As regras de um grupo podem ser de tipos diferentes (atributo + status + etiqueta + SLA...).
  Handles: "cond_0", "cond_1", ... (POSICAO no array, NAO o id da condicao!) + "default".
  First-match-wins: avalia em ordem e PARA na primeira que bate.
  Operadores: equal/not_equal, contains/not_contains, starts_with/ends_with,
    is_empty/is_not_empty (NAO existe is_present/is_blank), greater_than/less_than,
    number_range ("min-max"), regex,
    equal_any/not_equal_any/contains_any/not_contains_any/starts_with_any/ends_with_any (multi-valor
      via values[], case-insensitive; starts_with_any/ends_with_any NOVOS 07/08 — o texto COMECA/TERMINA
      com alguma das palavras da lista),
    business_hours/outside_business_hours (campos opcionais days[0=dom..6=sab]/start_hour/end_hour/timezone
      IANA ex. America/Sao_Paulo; outside_business_hours HERDA days/start_hour/end_hour/timezone da
      business_hours ANTERIOR no array — pode deixar ausentes que o backend preenche),
    can_reply/can_reply_closed, conversation_has_agent/no_agent,
    conversation_no_team (NOVO 2026-08-15: conversa SEM equipe atribuida — e o preset "Sem equipe"
      da tela; operador dedicado, sem value), conversation_has_ai_agent/conversation_no_ai_agent
      (IA ativa/inativa na conversa; not_ai_agent = sinonimo de no_ai_agent),
    contact_has_label/contact_no_label/conversation_has_label/conversation_no_label
      (values = array de titulos ou string com virgula. ATENCAO 2026-08-18: escreva operator E
      field JUNTOS — conversa usa field '{{conversation.label}}', contato usa '{{contact.label}}';
      a tela reabre a regra casando o par, e condicao escrita so com operator roda certa mas
      APARECE errada pro cliente. Mesma regra vale pros pares kanban_exists/kanban_in_stage
      (fields '_kanban_check'/'_kanban_stage'), kanban_won/kanban_lost (field '_kanban_status') e
      resposta do cliente/do atendente (fields '{{last_response}}'/'{{last_agent_response}}')),
    kanban_exists/kanban_in_stage/kanban_won/kanban_lost (funnel_id e CHAVE SEPARADA da condicao,
      numero ex funnel_id:37; a etapa vai em value=slug puro ex value:"avaliacao_aceita" ou em stage,
      NAO no formato "37:etapa"), pagetrack_visited/pagetrack_event,
    sla_check (SO value, codigo fixo: frt_breached/frt_ok/nrt_breached/nrt_ok/rt_breached/rt_ok/has_sla/no_sla;
      frt=primeira resp, nrt=proxima, rt=resolucao; _ok exige politica de SLA aplicada).
  greater_than/less_than: atributo numero (valor numerico) OU temporais (novo 2026-07-21) —
    date (value ISO YYYY-MM-DD, compara por DIA), time (value "HH:MM", compara minutos-do-dia),
    datetime (value "YYYY-MM-DDTHH:MM", compara HORARIO DE PAREDE — ignora fuso/offset).
    Backend detecta o FORMATO do value: instante > dia > minutos > numero.
    number_range SO em numero. NUNCA maior/menor em texto/lista.
  RESPOSTA DO CLIENTE (valueType 'response_multi', tipicamente field '{{last_response}}'): campo
    especial cuja "resposta" e uma LISTA de palavras — oferece EXATAMENTE 8 operadores: equal_any,
    contains_any, not_equal_any, not_contains_any, starts_with_any, ends_with_any (todos multi-valor
    via values[]) + is_empty / is_not_empty (SEM values[]).
  EQUIPE (condicao "Esta na equipe", field '{{conversation.team_id}}'): aceita VARIAS equipes de uma
    vez — passe values:['24','25'] (array de ids) em vez de value unico; casa se bater qualquer uma.
    Array de values vazio cai no value unico legado.

▸ action
  data: { label, items: [ { key, config: {...} } ] }
  ATENCAO: items[].config NAO items[].params.
  Keys validas:
    Conversa: assign_agent({agent_id}), assign_team({team_id})
      — agent_id aceita tambem a string 'nil' (NOVO 2026-07-28), que REMOVE o responsavel da
      conversa (opcao 'Nenhum' da tela) — deixa a conversa sem atendente em vez de trocar,
      — agent_id/team_id aceitam id fixo OU variavel Liquid (ex: team_id: '{{target_team}}');
      variavel mal escrita e RECUSADA no save; em runtime, se nao resolver pra um numero,
      o erro fica visivel no historico do node (equipe/agente precisa pertencer a conta),
      distribute_agents({agents:[{agent_id}], dist_id}) — RODIZIO (round-robin): cada lead vai pro
        PROXIMO agente da lista na vez (1,2,3,1,2,3). dist_id = id fixo da acao (chave do cursor no
        Redis; gere um unico por acao, ex 'd_ab12cd'). Ordem da lista = ordem do rodizio, sem porcentagem.
        DIFERENTE do randomizer mode distribute_agents (sorteio ponderado),
      change_status({status: open|resolved|pending|snoozed}), change_priority({priority}),
      mute_conversation({}), mark_unread({}), add_private_note({content}), send_email_transcript({email}),
      add_conversation_label({labels:[...]}), remove_conversation_label({labels:[...]}),  // etiqueta NA CONVERSA
      assign_captain({assistant_id}), deactivate_captain({}),
      // mark_unread({}) — NOVO 07/08: deixa a conversa NAO LIDA pro time (badge acende). Tipico logo
      //   apos assign_agent/assign_team numa transferencia. Conversa ja nao-lida nao e mexida.
      add_sla({sla_policy_id}) — NOVO 24/07: aplica politica de SLA na conversa (id de sla_list;
        aceita variavel Liquid). NO-OP se a conversa JA tem SLA (nunca troca/reinicia); politica
        inexistente nao quebra o fluxo
    Contato: add_label({labels:[...]}), remove_label({labels:[...]}),  // etiqueta NO CONTATO
      update_attribute({attr_source:'contact'|'conversation'|'card', attr_key, attr_value})
        — campos EXATOS (NAO entity/key/value). Somar/subtrair via Liquid no attr_value:
        "{{ contact.custom_attribute.pontos | plus: 1 }}"
    Kanban: create_kanban_item({funnel_id, funnel_stage, title?, description?})
        — funnel_id e funnel_stage OBRIGATORIOS; title/description aceitam {{ }},
      move_kanban_stage({funnel_id,funnel_stage}), set_kanban_item_status({status:won|lost|active}),
      set_won({}), set_lost({reason?}), add_card_note({content}),
      assign_agent_card({agent_id, mode?}) — RESPONSAVEL DO CARD. mode (NOVO 2026-07-28):
        'add' (default, SOMA na lista — comportamento historico), 'replace' (so o escolhido
        fica; atribui ANTES de remover os outros, entao falha de atribuicao nunca deixa o card
        sem responsavel) ou 'remove_all' (tira TODOS; agent_id dispensado). Automacoes/macros
        e flows antigos nao mandam mode e seguem no 'add'. Cada remocao grava atividade na
        linha do tempo do card, igual a remocao manual,
      add_card_checklist({template_id}) — aplica um modelo de checklist ao card (vira grupo),
      add_card_offer({offer_id, use_custom_value?, custom_value?, funnel_id?, card_source?}) — adiciona
        oferta (produto/servico) ao card; offer_id de offers_list; use_custom_value:true + custom_value
        grava valor personalizado, senao usa o valor cadastrado; total do card recalcula sozinho
    Sistema (SO flow conversation): send_webhook({url,headers?,body?}), start_flow({flow_id}
      — flow_id tem que ser de OUTRO flow: apontar pro proprio flow e aceito no save mas IGNORADO
      EM SILENCIO na execucao, e o fluxo para ali [2026-08-18]), deactivate_flow({})
  card_source (acoes de card): 'funnel' (default, acha o card pelo funnel_id) | 'trigger' (usa o card
    que DISPAROU o flow em card_created/card_moved/card_won/card_lost). Com 'trigger' o funnel_id e
    ignorado — EXCETO create_kanban_item/move_kanban_stage (funil = DESTINO). Vale pra move_kanban_stage,
    set_won/set_lost/set_open, assign_agent_card, add_card_note, add_card_checklist, add_card_offer e
    update_attribute (attr_source:'card').
  Handles: "success" (sem handle error — falha vira warning e o flow continua).

▸ api
  data: { label, apiMethod (default GET), apiUrl (obrigatorio), apiHeaders:[{key,value}], apiBody
    (string; ou apiBodyMode:'fields' + apiBodyFields:[{key,value}]), apiQueryParams, apiAuthType,
    apiAuthToken, apiTimeout, apiResponseVar }
  CAMPOS PREFIXADOS COM api — NAO use method/url/headers/body crus (o motor ignora -> GET vazio, ou
    erro "URL not configured" sem apiUrl).
  Variaveis de conta/segredo: {{account.custom_attribute.NOME}} — NAO existe {{env.X}} (resolve vazio
    -> 401). Secret so resolve dentro do node api (apiUrl/apiHeaders/apiBody).
  Ler a resposta adiante: {{apiResponseVar.campo}} navega por ponto (default var api_response, ex
    {{api_response.user.name}}); NAO existe .payload/.response; status em {{api_response_status}}.
  Handles: "success", "error"

▸ ai
  data: { label, aiMode: "generate"|"custom"|"intent"|"sentiment"|"extract", aiPrompt,
    aiAssistantId,                   // OBRIGATORIO via API — sem ele o node sai cedo
                                     // (nao grava nada; {{ai_response}}/{{ai_intent}} ficam vazios)
    aiModel,                         // opcional: modelo LLM SO deste node (ex "gpt-4.1-mini");
                                     // vazio/ausente = modelo padrao da conta; vale em TODOS os
                                     // modos e tambem com assistente (sobrepoe o modelo dele)
    aiModelExplicit: true,           // OBRIGATORIO junto do aiModel — sem esta flag o backend
                                     // IGNORA o aiModel (protecao de nodes antigos)
    aiIntents: [{name}],            // se intent — ARRAY DE OBJETOS (NAO array de strings)
    aiResponseVar,                   // saida (default ai_response); extract usa esta var
    contextMessages: 25|50|75|100 }  // quantas msgs a IA enxerga
  Handles intent: "intent_{name}" por intencao + "no_intent" + "error" (var {{ai_intent}} disponivel)
  Handles sentiment: "positive", "negative", "neutral" + "error"
  Handles generate/custom/extract: "success", "error"

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
  weekday: waitWeekday (0=dom..6=sab) + waitWeekdayTime ("HH:MM" 24h) + waitWeekdayTimeMode
        ("fixed" default | "variable") + waitTimezone. O Horario ACEITA VARIAVEL desde 29/07
        (antes era sempre fixo por decisao de produto — o dono reverteu). Mesmo contrato do modo
        date: em "variable" o waitWeekdayTime contem {{...}} (atributo tipo time), resolve UMA vez
        na entrada do node, aceita "14:30"/"9:30"/"14h30", variavel invalida -> saida "error".
        waitWeekdayTimeMode e OBRIGATORIO ao usar variavel: sem ele (ou em "fixed") o motor trata o
        campo como TEXTO FIXO e o calculo recebe a chave literal {{...}} — como o MCP grava o JSON
        do flow direto, sem passar pela tela, nada preenche esse campo por voce.
  (NAO existem waitUnit:"weekday", targetWeekday nem targetHour — erro de doc antiga)
  Handles: "success" (+ "error" quando a variavel de data/hora nao resolve — vale nos DOIS modos
    com variavel, date e weekday, erro invalid_variable_datetime; no modo fixo nunca ha "error")

▸ randomizer
  data: { label, mode:"branches", branches:[{id,label,percent}] }
    O campo e "percent", NAO "weight" (30/07): a tela sempre gravou percent e o motor lia so weight —
    todo node configurado pela tela quebrava. Hoje o motor le percent e aceita weight so como dado
    antigo. Escreva SEMPRE percent: com weight o node roda, mas abre com as porcentagens EM BRANCO
    na tela do cliente.
  mode "distribute_agents" (SORTEIO ponderado): data.agents:[{agent_id, percent}] (percentuais somando
    100) — sorteia 1 agente por probabilidade e atribui; handle unico "success". E SORTEIO, nao rodizio
    (pode cair no mesmo agente varias vezes seguidas). Pra RODIZIO exato use a ACAO distribute_agents.
  Handles: o id de cada branch (mode branches); "success" (mode distribute_agents).

▸ update_group (Gestao de Grupos WhatsApp — REESCRITO 07/08: UMA operacao por bloco, 17 no total)
  Roda em fluxo de QUALQUER canal desde que a conta tenha caixa WhatsApp QR Code (Channel::Waha).
  Em flow de GRUPO o campo de caixa e opcional (vazio = caixa da conversa); em flow NAO-grupo
  data.groupInboxId e OBRIGATORIO (id de inbox Channel::Waha da conta).
  data comum:
    groupOperation: <uma das 17 abaixo>   // ausente/vazio = 'legacy' (comportamento antigo — NAO usar em node novo)
    groupTargetId: "<id do grupo>"        // vazio = grupo da conversa; aceita '1203..@g.us', so digitos ou {{var}}. Ignorado nas TARGETLESS (create, find_by_name)
    groupInboxId: <id inbox QR Code>      // OBRIGATORIO em flow nao-grupo
    groupResponseVar: "grupo"             // nome da variavel de resposta (default 'grupo'); leia depois {{grupo.CAMPO}}
  Teto de 20 participantes por execucao (add/remove/promote/demote) — trava ANTI-BANIMENTO.
  Operacoes -> chaves de data (+ campos que a resposta devolve em {{grupo.*}}):
    create            -> groupName(obrig), groupDescription, groupPicture(url), groupInitialAdmins, groupParticipants, groupAttributes (opcional, NOVO 2026-08-08: linhas {attr_source,attr_key,attr_value} — grava atributos personalizados no contato-grupo recem-criado; {{grupo.id}}/{{grupo.conversation_id}} ja valem em attr_value; campos nativos name/email/card sao recusados) -> id,name,description,picture,participants_count  [risco de banimento]
    find_by_id        -> (groupTargetId) -> id,name,description,picture,participants,participants_count
    find_by_name      -> groupSearchName(obrig), groupSearchMode(contains[padrao]|does_not_contain|equal_to|not_equal_to|starts_with|ends_with) -> results,results_count  [TARGETLESS]
    update_subject    -> updateSubject(obrig) -> id,name
    update_description -> updateDescription -> id,description
    update_picture    -> updatePicture(obrig, url) -> id
    leave             -> (groupTargetId) -> id  [IRREVERSIVEL]
    list_participants -> (groupTargetId) -> id,participants(ate 100),participants_count
    add_participants  -> groupParticipants(obrig; array de telefones/JIDs ex ['5511999999999@c.us'] ou lista por virgula; aceita {{var}}) -> id,added,not_added,added_count,not_added_count  [risco de banimento]
    remove_participants -> groupParticipants(obrig) -> id,removed,not_removed,removed_count,not_removed_count
    promote_admin     -> groupParticipants(obrig) -> id,participants
    demote_admin      -> groupParticipants(obrig) -> id,participants
    get_invite        -> (groupTargetId) -> id,invite_link
    revoke_invite     -> (groupTargetId) -> id,invite_link  [IRREVERSIVEL — invalida o link antigo]
    send_invite       -> groupInviteTo(obrig, telefone), groupInviteMessage(opcional) -> id,invite_link,invite_sent_to
    settings          -> pelo menos UMA de: infoAdminOnly(bool), messagesAdminOnly(bool), membersCanAddNewMember(bool) -> id,settings_updated
  ATENCAO settings: membersCanAddNewMember tem semantica INVERTIDA (true = TODOS podem adicionar);
    infoAdminOnly/messagesAdminOnly seguem o padrao (true = SO admin).
  Toda operacao tambem devolve {{grupo.ok}} (bool) e {{grupo.error.message}}.
  Handles: "success", "error"

▸ end
  EXCLUSIVO de flow ai_tool — NUNCA use em flow conversation (a paleta do editor nem oferece;
  o backend rejeita na gravacao: "contains node types not allowed in conversation flow"). Em
  conversation o ramo termina sozinho no ultimo node, sem node de fim. Em ai_tool: OBRIGATORIO —
  data define o retorno estruturado pro LLM (suporta saida Liquid com {{ }}).

▸ note
  Sticky note visual (bloco colorido de anotacao). Sem handles, nunca executa, nao ligue edges.
  data: title (cabecalho), body (corpo), color (yellow|teal|blue|violet|pink|orange|slate, default yellow),
  width (px, default 320, min 200), height (px, default 200, min 80). ATENCAO: texto vai em title+body,
  NUNCA em 'content' (usar content grava nota vazia). Disponivel nos 2 tipos de flow.

═══ EXIT CONDITIONS (saida automatica do flow) ═══
flow_data.exit_conditions: array no NIVEL DO FLOW (irmao de nodes/edges, NAO e node). Se QUALQUER
condicao bater, o lead sai do flow NA HORA. Cada item tem "type":
- Evento: label_added/label_removed ({type,value:'<slug>'}), conversation_resolved ({type}),
  agent_assigned/team_assigned ({type,value:'<id opcional>'} — vazio=qualquer),
  kanban_won/kanban_lost ({type,value:'<funnel_id opcional>'}).
- Rico por atributo (novo 2026-07-08; REATIVO desde 2026-07-09):
  {type:'attribute_condition', logic:'and'|'or', rules:[{attr_key, attrSource:'contact'|'conversation'
   |'card', operator, value | values:[...], funnel_id?, card_source?}]}.
  AQUI o attrSource VAI na rule (ao contrario do gatilho de entrada por atributo, onde e implicito).
  Operadores da condition EXCETO is_empty/is_not_empty (removidos do contexto reativo 09/07 — use so
  no node condition); reativa: so reavalia quando o atributo VIGIADO muda; cada rule exige value|values;
  card aceita funnel_id/card_source na rule; rule sem attr_key (ou sem value/values) e ignorada.

═══ VARIAVEIS {{ }} ═══
contact.name, contact.email, contact.phone, contact.custom_attribute.X (SINGULAR — plural resolve vazio)
CADASTRAL forma curta (canonica): contact.cpf, contact.cnpj, contact.rg, contact.address.street,
  contact.address.number, ... (NAO e custom_attribute!)
conversation.id — JA E o numero que aparece no app (o motor devolve o display_id). Use ESTE pra
  montar link de conversa. NAO existe um "id interno do banco" separado nas variaveis.
  conversation.display_id e so um APELIDO, aceito desde 29/07, que devolve o mesmo numero — antes
  disso resolvia VAZIO, e todo link de conversa montado por flow saiu quebrado.
conversation.status, conversation.team_id, conversation.custom_attribute.X
conversation.label (SINGULAR — etiquetas da conversa em texto separado por virgula).
  {{conversation.labels}} NAO EXISTE: some do texto sem erro nenhum.
agent.* = o RESPONSAVEL da conversa: agent.name, agent.first_name, agent.last_name,
  agent.id (USE ESTE pro id do responsavel — conversation.agent_id resolvia VAZIO ate 29/07, quando
  virou apelido de agent.id; escreva a forma canonica), agent.email (email NOVO 23/07)
inbox.id, inbox.name (antes resolviam vazio fora do Enviar Mensagem — corrigido 23/07)
account.name, account.id (id NOVO 23/07), account.custom_attribute.X (inclui variaveis de conta e
  segredos — NAO existe env.X), {{var_criada_no_set_variable}}, {{ai_intent}}, {{api_response_var}}
trigger.* (variaveis do GATILHO que iniciou o flow — NOVO 07/08 no autocomplete de TODO bloco):
  trigger.type (codigo do gatilho), trigger.name, trigger.activated_at (hora do disparo),
  trigger.message.content (msg que iniciou), trigger.conversation.channel (canal de origem),
  trigger.conversation.status, trigger.kanban_item_id (numero do card), trigger.funnel_id,
  trigger.user_name (quem acionou manual), trigger.campaign_title (campanha que disparou),
  trigger.event_name (evento no site), trigger.page_url (pagina visitada),
  trigger.source_flow_name (fluxo que chamou). Cada uma so tem valor quando o gatilho fornece (ex:
  page_url so em gatilho de site) — fora disso resolve vazio.
DESDE 23/07 essas variaveis padrao funcionam em TODOS os nodes (Chamada API, Condicoes, IA, Definir
  Variavel) — antes so no Enviar Mensagem. Campo vazio resolve pra string vazia (nunca trava o flow).
REGRA-MAE: variavel FORA da lista acima SOME do texto, sem erro em lugar nenhum — nao quebra o save,
  nao quebra a execucao, nao aparece no historico do node. So o buraco no texto denuncia. Por isso
  escreva exatamente as chaves desta lista e nunca invente plural/sinonimo. Em caixa WhatsApp
  OFICIAL o preco e maior: parametro de template que chega vazio faz a META RECUSAR o envio
  (#132000) e o cliente NAO RECEBE NADA — foi assim que um aviso de medicacao deixou de ser
  entregue (conta 56, 29/07, {{conversation.assignee.name}} resolvendo vazio).

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
11. condition: field SEM '{{}}' compara texto literal (nunca casa) E regra sem valueType:'variable'
12. NOTA (type:'note'): o texto vai em data.title + data.body — 'content'/'label'/'text' NAO
    renderizam (nota aparece EM BRANCO na tela). Nunca crie nota sem body preenchido.
13. ESPACAMENTO: colunas de nodes a >=320px no eixo x (ex.: 50, 370, 690, 1010...) e irmaos/ramos a
    >=180px no eixo y — nodes colados escondem as linhas de conexao. Sticky notes ficam AO LADO ou
    ACIMA do trecho comentado (ex.: y do node - 240), NUNCA sobre nodes ou sobre as linhas.
    fica INVISIVEL no editor (salvar pela tela perde a regra) — ver secao condition acima
12. Atribuir equipe/agente DINAMICO: NAO use node api chamando a propria plataforma
    (/conversations/{id}/assignments com token). Use a acao nativa: action item
    { key:'assign_team', config:{ team_id:'{{minha_var}}', team_id_mode:'variable' } }
    (idem assign_agent/agent_id). O servidor valida o template na gravacao; id que nao
    resolve numa equipe/agente real da conta gera erro VISIVEL no historico do node.
    Recomendado: node condition antes ({{minha_var}} is_number) roteando falha pro fallback.
13. Assistente de Formulas no editor (2026-07-10): quem edita pela tela tem preview ao vivo
    (inclusive com contato real), avisos ao digitar e 'Gerar com IA' nos campos de formula —
    ao entregar um flow com Liquid, sugira ao usuario validar as formulas la.

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
