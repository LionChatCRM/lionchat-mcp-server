// AIDEV-NOTE: [seguranca+slim 2026-07-24] Sanitizacao central de TODA resposta MCP.
// 1) Segredos: SEMPRE redigidos (sem opt-out) — respostas embutiam provider_config.api_key
//    (token da Meta Cloud), smtp_password, hmac_token etc. Chave de credencial vira '[REDACTED]'.
// 2) Slim: default LIGADO — poda sub-objetos pesados (message_templates com 13 templates,
//    working_hours, meta_history_import, avatares) que estouravam o teto de 80k e cortavam
//    o JSON no meio. Escape: full_response:true nas tools curadas (FULL_RESPONSE_TOOLS).
// AIDEV-SECURITY: recursivo POR NOME DE CHAVE (nao por caminho) de proposito — o conector NPM
// normaliza a resposta ({data,pagination}) e o remoto entrega o shape cru; poda por caminho
// fixo seria no-op num dos dois. Este arquivo e PORTADO byte-identico pro lionchat-mcp-remote
// (src/mcp/sanitize.ts) — alterar um exige alterar o outro.

const REDACT_PLACEHOLDER = '[REDACTED]';
const SLIM_PLACEHOLDER = '[omitido — use full_response:true ou a tool dedicada]';

// AIDEV-SECURITY: chaves EXATAS de credencial (case-insensitive). Fontes: _inbox.json.jbuilder
// (auth_token/account_sid Twilio, imap/smtp_password Email, hmac_token, provider_config Meta),
// _account.json.jbuilder (topsend_api_key, liontrack_token), _user.json.jbuilder (access_token).
const REDACT_EXACT = new Set([
  'api_key',
  'apikey',
  'api_key_plain',
  'auth_token',
  'access_token',
  'account_sid',
  'password',
  'imap_password',
  'smtp_password',
  'hmac_token',
  'webhook_verify_token',
  'pubsub_token',
  'topsend_api_key',
  'liontrack_token',
  'client_secret',
  'consumer_key',
  'consumer_secret',
  'app_secret',
  'secret',
]);
const REDACT_SUFFIXES = ['_password', '_secret', '_api_key', '_auth_token', '_access_token'];
// AIDEV-NOTE: website_token e publico por design (vai inline no HTML do site do cliente pro
// widget) — unica excecao da redacao. NAO adicionar excecoes sem decisao explicita do dono
// (politica 2026-07-24: censura total de credencial em resposta de robo).
const REDACT_EXCEPTIONS = new Set(['website_token']);

// AIDEV-NOTE: chaves PESADAS podadas pelo slim. NUNCA incluir aqui data_url/download_url/
// file_url/thumb_url — sao de ANEXO de mensagem (baixar midia e caso de uso legitimo).
// avatar_url/thumbnail/avatar sao foto de contato/agente/inbox (decorativo em lista).
const SLIM_KEYS = new Set([
  'message_templates',
  'working_hours',
  'meta_history_import',
  'avatar_url',
  'thumbnail',
  'avatar',
]);
// AIDEV-NOTE: tools cujo PROPOSITO e o campo pesado — slim nao se aplica nelas
// (segredos continuam redigidos mesmo assim).
const SLIM_EXEMPT_SUBSTRINGS = ['whatsapp_templates', 'csat_template'];

export const FULL_RESPONSE_PARAM = 'full_response';
export const FULL_RESPONSE_DESCRIPTION =
  'true = resposta COMPLETA, sem a poda de campos pesados (message_templates, working_hours, ' +
  'avatares, meta_history_import). Padrao false (resposta enxuta). Segredos sao SEMPRE censurados, ' +
  'com ou sem esta opcao.';

// AIDEV-NOTE: conjunto CURADO de tools pesadas que ganham o param full_response no schema.
// Nao injetar nas 682 (inflaria o tools/list em ~20-30k tokens). Tools fora da lista continuam
// com slim ligado — o dado podado e alcancavel pela tool dedicada (ex: whatsapp_templates_list).
export const FULL_RESPONSE_TOOLS = new Set([
  'lionchat_conversations_list',
  'lionchat_conversations_filter',
  'lionchat_conversations_search',
  'lionchat_conversations_show',
  'lionchat_conversations_meta',
  'lionchat_conversations_messages_list',
  'lionchat_conversations_messages_search',
  'lionchat_contacts_list',
  'lionchat_contacts_filter',
  'lionchat_contacts_search',
  'lionchat_contacts_show',
  'lionchat_campaigns_list',
  'lionchat_campaigns_show',
  'lionchat_inboxes_list',
  'lionchat_inboxes_show',
  'lionchat_inboxes_list_1',
  'lionchat_inboxes_show_1',
  'lionchat_kanban_items_list',
  'lionchat_kanban_items_filter',
  'lionchat_kanban_items_search',
  'lionchat_kanban_items_show',
  'lionchat_search_search',
  'lionchat_search_list',
  'lionchat_search_list_1',
  'lionchat_search_list_2',
  'lionchat_agents_list',
  'lionchat_teams_list',
  'lionchat_account_show',
]);

export function supportsFullResponse(toolId: string): boolean {
  return FULL_RESPONSE_TOOLS.has(toolId);
}

function shouldRedact(key: string): boolean {
  const k = key.toLowerCase();
  if (REDACT_EXCEPTIONS.has(k)) {
    return false;
  }
  if (REDACT_EXACT.has(k)) {
    return true;
  }
  return REDACT_SUFFIXES.some((suffix) => k.endsWith(suffix));
}

export interface SanitizeOptions {
  // slim=false SO via full_response:true das tools curadas. Segredos independem disto.
  slim: boolean;
  toolId?: string;
}

// AIDEV-NOTE: caminha a resposta inteira (qualquer shape) redigindo segredos e, se slim,
// substituindo campos pesados pelo marcador curto. Nao muta o objeto original.
export function sanitizeResponse(value: unknown, opts: SanitizeOptions): unknown {
  const slimActive =
    opts.slim &&
    !SLIM_EXEMPT_SUBSTRINGS.some((s) => (opts.toolId ?? '').includes(s));

  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) {
      return node.map(walk);
    }
    if (node && typeof node === 'object') {
      const out: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(node as Record<string, unknown>)) {
        if (shouldRedact(key)) {
          // AIDEV-SECURITY: valor vazio/null passa como esta (informativo); qualquer valor
          // presente vira o placeholder — nunca o conteudo.
          out[key] = val === null || val === undefined || val === '' ? val : REDACT_PLACEHOLDER;
          continue;
        }
        if (slimActive && SLIM_KEYS.has(key.toLowerCase()) && val !== null && val !== undefined) {
          out[key] = SLIM_PLACEHOLDER;
          continue;
        }
        out[key] = walk(val);
      }
      return out;
    }
    return node;
  };

  return walk(value);
}
