/**
 * Extract endpoints from the LionChat API documentation HTML
 * and produce a clean endpoints.json for MCP consumption.
 *
 * Usage: node scripts/extract-endpoints.ts
 */

import fs from 'fs';
import path from 'path';

// ── Read HTML ───────────────────────────────────────────────
const htmlPath = path.resolve(
  '/Volumes/Evo 1TB/Documentos IDE/lionchat/paginas/docs-api/api-clientes-docs-elementor.html'
);
const html = fs.readFileSync(htmlPath, 'utf-8');

// ── Extract the JS block that defines helpers + endpoints ───
const lines = html.split('\n');

let startIdx = lines.findIndex(l => l.trim().startsWith('const BASE='));
if (startIdx === -1) startIdx = lines.findIndex(l => l.includes('const BASE='));

const epStart = lines.findIndex(l => l.trim().startsWith('const endpoints=['));
let endIdx = -1;
for (let i = epStart + 1; i < lines.length; i++) {
  if (lines[i].trim() === '];') {
    endIdx = i;
    break;
  }
}

const jsBlock = lines.slice(startIdx, endIdx + 1).join('\n');

// ── Evaluate the block in a sandboxed context ───────────────
const extractCode = `
${jsBlock}
return endpoints;
`;

const endpointsRaw = new Function(extractCode)();

console.log(`Extracted ${endpointsRaw.length} raw endpoints`);

// ── Sub → slug mapping ──────────────────────────────────────
const SUB_SLUG = {
  'Conta': 'account',
  'Respostas Rapidas': 'canned_responses',
  'Contatos': 'contacts',
  'Conversas': 'conversations',
  'Caixas de Entrada': 'inboxes',
  'Mensagens': 'messages',
  'Times': 'teams',
  'Labels': 'labels',
  'Filtros Personalizados': 'custom_filters',
  'Macros': 'macros',
  'Busca': 'search',
  'Notificacoes': 'notifications',
  'Anuncios': 'announcements',
  'Empresas': 'companies',
  'Ofertas': 'offers',
  'Upload': 'upload',
  'Agenda / Tarefas': 'tasks',
  'Variaveis da Conta': 'account_variables',
  'Mensagens Agendadas': 'scheduled_messages',
  'Funis': 'funnels',
  'Itens': 'kanban_items',
  'Operacoes em Massa': 'kanban_bulk',
  'Agentes (Kanban)': 'kanban_agents',
  'Checklist': 'kanban_checklist',
  'Notas': 'kanban_notes',
  'Contatos (Cliente)': 'public_contacts',
  'Conversas (Cliente)': 'public_conversations',
  'Mensagens (Cliente)': 'public_messages',
  'Pesquisa CSAT': 'public_csat',
  'Sessoes': 'flow_sessions',
  'Tipos de Evento': 'booking_event_types',
  'Publica': 'public_booking',
  'Chamadas': 'voip_calls',
  'Flows': 'flows',
  'Assistentes': 'captain_assistants',
  'Base de Conhecimento': 'captain_documents',
  'Regras de Automacao': 'automation_rules',
  'Roles Personalizados': 'custom_roles',
  'Politicas de Capacidade': 'capacity_policies',
  'SLA': 'sla',
  'Acesso de Suporte': 'support_access',
  'Dashboard Apps': 'dashboard_apps',
  'Grupos WhatsApp': 'waha_groups',
  'Templates WhatsApp': 'whatsapp_templates',
  'CSAT Template': 'csat_template',
  'Migracao de Inbox': 'inbox_migration',
  'Google Calendar': 'google_calendar',
  'Politicas de Atribuicao': 'assignment_policies',
  'Webhooks': 'webhooks',
  'Integracoes E-commerce': 'ecommerce_webhooks',
  'Meta Lead Ads': 'meta_lead',
  'Config Kanban': 'kanban_config',
  'Kanban V2': 'kanban_v2',
  'Portais': 'portals',
  'Config de Notificacao': 'notification_settings',
  'Relatorios': 'reports',
  'Prompts Salvos': 'copilot_prompts',
  'Membros de Inbox': 'inbox_members',
  'Disponibilidade': 'agent_availability',
  'CSAT': 'csat',
  'Atributos Personalizados': 'custom_attributes',
  'Agentes': 'agents',
  'Validacao WhatsApp': 'waha_validation',
  'Chat Interno': 'internal_chat',
};

// ── Action derivation ───────────────────────────────────────

function deriveAction(method, pathStr) {
  const segments = pathStr.split('/').filter(Boolean);
  const lastSeg = segments[segments.length - 1];
  const isParam = lastSeg.startsWith('{');

  if (isParam) {
    switch (method) {
      case 'GET': return 'show';
      case 'PUT':
      case 'PATCH': return 'update';
      case 'DELETE': return 'destroy';
      case 'POST': return 'create';
      default: return method.toLowerCase();
    }
  }

  // Not a param — could be collection or custom action
  // Standard CRUD on collections
  switch (method) {
    case 'GET': {
      // Check if it's a custom sub-action (not a plain resource name)
      // e.g. /conversations/{id}/messages → list (messages is resource)
      // e.g. /csat_survey_responses/metrics → metrics (custom action)
      const prevSeg = segments.length >= 2 ? segments[segments.length - 2] : '';
      // If previous segment is a param like {id}, the last segment is a sub-resource or action
      if (prevSeg.startsWith('{')) {
        // Could be listing a nested resource or a custom action on a member
        // We check if it looks like a resource name (plural) or action (singular/verb)
        const knownActions = [
          'metrics', 'download', 'export', 'search', 'filter', 'summary',
          'availability', 'status', 'activities', 'meta', 'counts',
        ];
        if (knownActions.includes(lastSeg)) return lastSeg;
        return 'list';
      }
      // No param before — it's either a collection list or a custom action on a collection
      const collectionActions = [
        'metrics', 'download', 'export', 'search', 'filter', 'summary',
        'availability', 'meta', 'counts',
      ];
      if (collectionActions.includes(lastSeg)) return lastSeg;
      return 'list';
    }
    case 'POST': {
      const postActions = [
        'clone', 'search', 'filter', 'toggle', 'mute', 'unmute',
        'lock', 'unlock', 'snooze', 'unsnooze', 'archive', 'unarchive',
        'trash', 'untrash', 'read', 'unread', 'resolve', 'reopen',
        'sync', 'import', 'execute', 'automate', 'move', 'reorder',
        'positions', 'batch_update', 'batch_destroy', 'batch_move',
        'bulk_actions', 'assignments', 'participants', 'attachments',
        'transcript', 'send', 'mark_all_read',
      ];
      if (postActions.includes(lastSeg)) return lastSeg;
      return 'create';
    }
    case 'PUT':
    case 'PATCH': {
      const patchActions = [
        'toggle', 'mute', 'unmute', 'lock', 'unlock',
        'snooze', 'unsnooze', 'archive', 'unarchive',
        'read', 'unread', 'resolve', 'reopen', 'move',
        'reorder', 'positions', 'batch_update', 'assignments',
      ];
      if (patchActions.includes(lastSeg)) return lastSeg;
      return 'update';
    }
    case 'DELETE': {
      const delActions = ['batch_destroy'];
      if (delActions.includes(lastSeg)) return lastSeg;
      return 'destroy';
    }
    default:
      return method.toLowerCase();
  }
}

// ── Build ID with collision avoidance ────────────────────────

const idCounts = {};

function makeId(sub, method, pathStr) {
  const slug = SUB_SLUG[sub];
  if (!slug) {
    console.error(`Missing slug mapping for sub: "${sub}"`);
    process.exit(1);
  }

  const action = deriveAction(method, pathStr);

  // Determine nesting: look for parent resource in path
  const segments = pathStr.replace(/^\/api\/v[12]\//, '').split('/').filter(Boolean);

  // Remove accounts/{account_id} prefix
  if (segments[0] === 'accounts' && segments[1] === '{account_id}') {
    segments.splice(0, 2);
  }

  // Remove public/v1 prefix for client APIs
  if (segments[0] === 'public' && segments[1] === 'api' && segments[2] === 'v1') {
    segments.splice(0, 3);
  }

  // Check for nested resource pattern: parent/{parent_id}/child/...
  let id;
  const parentSlugMap = {
    'conversations': 'conversations',
    'contacts': 'contacts',
    'inboxes': 'inboxes',
    'portals': 'portals',
    'captain_assistants': 'captain_assistants',
    'kanban_items': 'kanban_items',
  };

  if (segments.length >= 3 && segments[1] && segments[1].startsWith('{')) {
    const parentResource = segments[0];
    const parentSlug = parentSlugMap[parentResource];
    if (parentSlug && parentSlug !== slug) {
      id = `lionchat_${parentSlug}_${slug}_${action}`;
    } else {
      id = `lionchat_${slug}_${action}`;
    }
  } else {
    id = `lionchat_${slug}_${action}`;
  }

  // Handle collisions
  if (idCounts[id] !== undefined) {
    idCounts[id]++;
    id = `${id}_${idCounts[id]}`;
  } else {
    idCounts[id] = 0;
  }

  return id;
}

// ── Transform endpoints ─────────────────────────────────────

const output = endpointsRaw.map(ep => {
  // Filter out account_id from params, lowercase location
  const params = (ep.params || [])
    .filter(p => p.name !== 'account_id')
    .map(p => {
      // AIDEV-NOTE: Rails array params arrive as `priorities[]`. The `[]` is invalid
      // in MCP tool-schema property keys (^[a-zA-Z0-9_.-]{1,64}$), so we expose a clean
      // `name` to the LLM and stash the wire key in `query_name` (used by separateParams
      // to keep the `priorities[]=a&priorities[]=b` Rails array convention).
      const isBracketArray = typeof p.name === 'string' && p.name.endsWith('[]');
      const cleanName = isBracketArray ? p.name.slice(0, -2) : p.name;
      const out: {
        name: string;
        type: string;
        location: string;
        required: boolean;
        description: string;
        query_name?: string;
      } = {
        name: cleanName,
        type: p.type,
        location: (p.location || '').toLowerCase(),
        required: !!p.required,
        description: p.description || '',
      };
      if (isBracketArray) out.query_name = p.name;
      return out;
    });

  return {
    id: makeId(ep.sub, ep.m, ep.path),
    method: ep.m,
    path: ep.path,
    title: ep.title,
    description: ep.desc,
    category: ep.sub,
    params,
  };
});

// ── Write output ────────────────────────────────────────────
const outPath = path.resolve(
  '/Volumes/Evo 1TB/Documentos IDE/lionchat-mcp/endpoints.json'
);
fs.writeFileSync(outPath, JSON.stringify(output, null, 2), 'utf-8');
console.log(`Wrote ${output.length} endpoints to ${outPath}`);

// Validate
if (output.length !== 545) {
  console.error(`WARNING: Expected 545 endpoints, got ${output.length}`);
}

// Check for any duplicate IDs
const ids = output.map(e => e.id);
const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
if (dupes.length > 0) {
  console.error(`WARNING: Duplicate IDs found: ${[...new Set(dupes)].join(', ')}`);
} else {
  console.log('All IDs are unique.');
}
