// AIDEV-NOTE: Utility module for LionChat MCP server
// Path substitution, query string building, param separation, and response formatting
import { sanitizeResponse } from './sanitize.js';

// AIDEV-NOTE: Separates raw MCP tool input into path/query/body buckets based on endpoint param definitions
export interface SeparatedParams {
  pathParams: Record<string, unknown>;
  // AIDEV-NOTE: Values may be arrays (e.g. priorities[]) — buildQueryString expands
  // them to repeated keys. Kept as unknown so array query params survive intact.
  queryParams: Record<string, unknown>;
  bodyParams: Record<string, unknown>;
}

// AIDEV-NOTE: Replace {account_id} and other {param} placeholders in URL path templates
export function substitutePath(
  pathTemplate: string,
  accountId: string,
  params: Record<string, unknown>
): string {
  let result = pathTemplate.replace('{account_id}', accountId);

  for (const [key, value] of Object.entries(params)) {
    result = result.replace(`{${key}}`, String(value));
  }

  // AIDEV-NOTE: Catch any unsubstituted placeholders — caller forgot a required param
  const missing = result.match(/\{(\w+)\}/);
  if (missing) {
    throw new Error(`Missing required path parameter: ${missing[0]}`);
  }

  return result;
}

// AIDEV-NOTE: Convert params object to URL query string, skipping nulls and handling arrays
export function buildQueryString(params: Record<string, unknown>): string {
  const parts: string[] = [];

  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined) {
      continue;
    }

    if (Array.isArray(value)) {
      // AIDEV-NOTE: Arrays expand to repeated keys: key=val1&key=val2
      for (const item of value) {
        if (item !== null && item !== undefined) {
          parts.push(
            `${encodeURIComponent(key)}=${encodeURIComponent(String(item))}`
          );
        }
      }
    } else {
      parts.push(
        `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`
      );
    }
  }

  return parts.length > 0 ? `?${parts.join('&')}` : '';
}

// AIDEV-NOTE: Format API response data for MCP client consumption
// AIDEV-NOTE: [fix relatorios 18/07] Teto 80k (era 50k) — relatorios/listas gordas de conversa
// (partial + kanban_items com funnel.stages) estouravam 50k e cortavam o registro no meio.
// AIDEV-NOTE: [2026-07-24] Teto configuravel por env LIONCHAT_MCP_MAX_RESPONSE (min 10k).
const MAX_RESPONSE_LENGTH = (() => {
  const env = Number.parseInt(process.env.LIONCHAT_MCP_MAX_RESPONSE ?? '', 10);
  return Number.isFinite(env) && env >= 10000 ? env : 80000;
})();

export interface FormatResponseOptions {
  // slim=false SO via full_response:true (tools curadas). Segredos independem disto.
  slim?: boolean;
  toolId?: string;
}

// AIDEV-NOTE: [2026-07-24] TODA resposta passa por sanitizeResponse (segredos SEMPRE redigidos;
// campos pesados podados por default — ver sanitize.ts). Ao estourar o teto, tenta CORTE LIMPO:
// remove itens inteiros do final do maior array em vez de fatiar o JSON no meio de um registro.
export function formatResponse(data: unknown, opts?: FormatResponseOptions): string {
  const sanitized =
    typeof data === 'string'
      ? data
      : sanitizeResponse(data, { slim: opts?.slim !== false, toolId: opts?.toolId });
  const text =
    typeof sanitized === 'string' ? sanitized : JSON.stringify(sanitized, null, 2);

  if (text.length <= MAX_RESPONSE_LENGTH) {
    return text;
  }

  const clean = tryCleanCut(sanitized, MAX_RESPONSE_LENGTH);
  if (clean) {
    return clean;
  }

  // AIDEV-NOTE: [fix relatorios 18/07] Fallback: aviso HONESTO — o JSON acima esta cortado no
  // meio (INCOMPLETO). Nem toda ferramenta pagina (relatorios agregados nao), entao o certo e
  // ESTREITAR: intervalo de datas menor, mais filtros, per_page menor, ou page nas listas.
  return (
    text.slice(0, MAX_RESPONSE_LENGTH) +
    `\n\n[RESPOSTA CORTADA em ${MAX_RESPONSE_LENGTH} caracteres — os dados acima estao INCOMPLETOS e o JSON pode estar truncado no meio de um registro. Para obter tudo: reduza o intervalo de datas, adicione filtros, use per_page menor, ou pagine com page nas ferramentas de LISTA. Relatorios agregados NAO paginam — restrinja o periodo.]`
  );
}

// AIDEV-NOTE: [2026-07-24] Corte limpo — localiza o maior array de itens nos shapes conhecidos
// ({data:[...]}, {payload:[...]}, {items:[...]}, {data:{payload:[...]}} ou array na raiz) e faz
// busca binaria pelo maior prefixo de itens INTEIROS que cabe no teto. Shape nao reconhecido ou
// array com <2 itens => null (chamador usa o fallback de fatia crua).
function tryCleanCut(value: unknown, max: number): string | null {
  const isObj = (v: unknown): v is Record<string, unknown> =>
    !!v && typeof v === 'object' && !Array.isArray(v);

  let arr: unknown[] | null = null;
  let rebuild: ((sliced: unknown[]) => unknown) | null = null;

  if (Array.isArray(value)) {
    arr = value;
    rebuild = (sliced) => sliced;
  } else if (isObj(value)) {
    for (const key of ['data', 'payload', 'items']) {
      const v = value[key];
      if (Array.isArray(v) && v.length > 1) {
        arr = v;
        rebuild = (sliced) => ({ ...value, [key]: sliced });
        break;
      }
      // Shape cru aninhado de conversas: { data: { meta, payload: [...] } }
      if (key === 'data' && isObj(v) && Array.isArray(v.payload) && v.payload.length > 1) {
        arr = v.payload;
        rebuild = (sliced) => ({ ...value, data: { ...v, payload: sliced } });
        break;
      }
    }
  }

  if (!arr || !rebuild || arr.length < 2) {
    return null;
  }

  let lo = 1;
  let hi = arr.length - 1;
  let best: string | null = null;
  let bestKeep = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const text = JSON.stringify(rebuild(arr.slice(0, mid)), null, 2);
    if (text.length <= max) {
      best = text;
      bestKeep = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  if (!best) {
    return null;
  }
  return (
    best +
    `\n\n[LISTA ENXUGADA para caber no limite: exibindo ${bestKeep} de ${arr.length} itens desta resposta (JSON acima esta INTEIRO, so com menos itens). Para o restante: pagine, adicione filtros ou reduza o periodo.]`
  );
}

// AIDEV-NOTE: Route each input param to path/query/body based on endpoint parameter definitions
// Supports nested body params via dot-notation: `config.temperature` becomes body.config.temperature
// AIDEV-NOTE: When `bodyWrapper` is set, the entire bodyParams object is nested under that key
// before returning. Required by Rails strong_params controllers that expect a single root key
// (e.g. `{ variable: { attribute_key: ... } }` for AccountVariablesController).
export function separateParams(
  input: Record<string, unknown>,
  paramDefs: Array<{ name: string; location: string; query_name?: string }>,
  bodyWrapper?: string
): SeparatedParams {
  const pathParams: Record<string, unknown> = {};
  const queryParams: Record<string, unknown> = {};
  const bodyParams: Record<string, unknown> = {};

  // AIDEV-NOTE: Build a lookup map for O(1) location resolution per param
  const locationMap = new Map<string, string>();
  // AIDEV-NOTE: Maps clean param name -> wire query key for Rails array params
  // (e.g. "priorities" -> "priorities[]"). Only set for params with query_name.
  const queryNameMap = new Map<string, string>();
  for (const def of paramDefs) {
    locationMap.set(def.name, def.location);
    if (def.query_name) {
      queryNameMap.set(def.name, def.query_name);
    }
  }

  // AIDEV-NOTE: Helper that places a value into bodyParams, expanding dot-notation
  // names into nested objects. Example: `config.temperature` => body.config.temperature
  // Rationale: Rails strong_params expect nested objects (e.g. assistant: { config: {...} })
  // not flat keys with dots. Without this expansion the backend silently drops the field.
  // B2 (2026-06-02): deep-merge em CADA nível (não só na raiz). Misturar `item_details: {...}`
  // (objeto) com `item_details.title` (sub-path) no mesmo input preserva ambos os lados — o
  // resultado deixa de depender da ordem de Object.entries. Objetos planos fazem merge;
  // arrays e escalares SUBSTITUEM.
  const isPlainObject = (v: unknown): v is Record<string, unknown> =>
    !!v && typeof v === 'object' && !Array.isArray(v);

  const deepMerge = (target: Record<string, unknown>, source: Record<string, unknown>): void => {
    for (const [k, v] of Object.entries(source)) {
      const existing = target[k];
      if (isPlainObject(existing) && isPlainObject(v)) {
        deepMerge(existing, v);
      } else {
        target[k] = v;
      }
    }
  };

  const assignBody = (name: string, value: unknown): void => {
    // Constrói o objeto aninhado representado pelo nome (a.b.c => {a:{b:{c:value}}}).
    const parts = name.split('.');
    let built: unknown = value;
    for (let i = parts.length - 1; i >= 1; i--) {
      built = { [parts[i]]: built };
    }
    const root = parts[0];
    const existing = bodyParams[root];
    if (isPlainObject(built) && isPlainObject(existing)) {
      deepMerge(existing, built);
    } else if (isPlainObject(built)) {
      const container: Record<string, unknown> = {};
      deepMerge(container, built);
      bodyParams[root] = container;
    } else {
      bodyParams[root] = built;
    }
  };

  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) {
      continue;
    }
    const location = locationMap.get(key);

    switch (location) {
      case 'path':
        pathParams[key] = value;
        break;
      case 'query':
        if (value !== null) {
          const wireKey = queryNameMap.get(key);
          if (wireKey) {
            // AIDEV-NOTE: Rails array convention — pass value through (array stays array)
            // so buildQueryString emits priorities[]=a&priorities[]=b (multi-value support).
            queryParams[wireKey] = value;
          } else {
            queryParams[key] = String(value);
          }
        }
        break;
      case 'body':
        assignBody(key, value);
        break;
      default:
        // AIDEV-NOTE: Params not in definitions go to body (catch-all for nested/extra fields)
        // Honor dot-notation here too in case a caller forwards an undeclared nested field
        assignBody(key, value);
        break;
    }
  }

  // AIDEV-NOTE: Wrap body under `bodyWrapper` key ONLY if there's at least one body param.
  // Edge case: wrapper defined but no body params -> return empty bodyParams (avoid {wrapper:{}}).
  // Backward-compat: undefined wrapper -> behavior identical to pre-wrapper era.
  const wrappedBody =
    bodyWrapper && Object.keys(bodyParams).length > 0
      ? { [bodyWrapper]: bodyParams }
      : bodyParams;

  return { pathParams, queryParams, bodyParams: wrappedBody };
}
