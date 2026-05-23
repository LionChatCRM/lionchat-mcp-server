// AIDEV-NOTE: Utility module for LionChat MCP server
// Path substitution, query string building, param separation, and response formatting

// AIDEV-NOTE: Separates raw MCP tool input into path/query/body buckets based on endpoint param definitions
export interface SeparatedParams {
  pathParams: Record<string, unknown>;
  queryParams: Record<string, string>;
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
// Truncates at 50k chars to avoid overwhelming the LLM context
const MAX_RESPONSE_LENGTH = 50000;

export function formatResponse(data: unknown): string {
  const text =
    typeof data === 'string' ? data : JSON.stringify(data, null, 2);

  if (text.length > MAX_RESPONSE_LENGTH) {
    return (
      text.slice(0, MAX_RESPONSE_LENGTH) +
      '\n\n[Response truncated at 50,000 characters. Use pagination parameters (page, limit) to fetch smaller result sets.]'
    );
  }

  return text;
}

// AIDEV-NOTE: Route each input param to path/query/body based on endpoint parameter definitions
// Supports nested body params via dot-notation: `config.temperature` becomes body.config.temperature
// AIDEV-NOTE: When `bodyWrapper` is set, the entire bodyParams object is nested under that key
// before returning. Required by Rails strong_params controllers that expect a single root key
// (e.g. `{ variable: { attribute_key: ... } }` for AccountVariablesController).
export function separateParams(
  input: Record<string, unknown>,
  paramDefs: Array<{ name: string; location: string }>,
  bodyWrapper?: string
): SeparatedParams {
  const pathParams: Record<string, unknown> = {};
  const queryParams: Record<string, string> = {};
  const bodyParams: Record<string, unknown> = {};

  // AIDEV-NOTE: Build a lookup map for O(1) location resolution per param
  const locationMap = new Map<string, string>();
  for (const def of paramDefs) {
    locationMap.set(def.name, def.location);
  }

  // AIDEV-NOTE: Helper that places a value into bodyParams, expanding dot-notation
  // names into nested objects. Example: `config.temperature` => body.config.temperature
  // Rationale: Rails strong_params expect nested objects (e.g. assistant: { config: {...} })
  // not flat keys with dots. Without this expansion the backend silently drops the field.
  const assignBody = (name: string, value: unknown): void => {
    const dotIdx = name.indexOf('.');
    if (dotIdx <= 0) {
      // AIDEV-NOTE: Merge plain objects to avoid clobbering when caller mixes
      // `config: {...}` and `config.X` in the same input (P0 fix 2026-05-05).
      const existingTop = bodyParams[name];
      if (
        value && typeof value === 'object' && !Array.isArray(value) &&
        existingTop && typeof existingTop === 'object' && !Array.isArray(existingTop)
      ) {
        bodyParams[name] = { ...(existingTop as Record<string, unknown>), ...(value as Record<string, unknown>) };
      } else {
        bodyParams[name] = value;
      }
      return;
    }
    const root = name.slice(0, dotIdx);
    const leaf = name.slice(dotIdx + 1);
    const existing = bodyParams[root];
    const target =
      existing && typeof existing === 'object' && !Array.isArray(existing)
        ? (existing as Record<string, unknown>)
        : {};
    // AIDEV-NOTE: Recurse to support multi-level dot-notation (a.b.c)
    const nested: Record<string, unknown> = target;
    const innerDot = leaf.indexOf('.');
    if (innerDot <= 0) {
      nested[leaf] = value;
    } else {
      // AIDEV-NOTE: Build deeper nesting by reusing assignBody logic on a temp container
      const subPath = leaf;
      const subRoot = subPath.slice(0, innerDot);
      const subRest = subPath.slice(innerDot + 1);
      const subExisting = nested[subRoot];
      const subTarget =
        subExisting && typeof subExisting === 'object' && !Array.isArray(subExisting)
          ? (subExisting as Record<string, unknown>)
          : {};
      // Iteratively walk the rest of the path
      let cursor: Record<string, unknown> = subTarget;
      let remaining = subRest;
      while (true) {
        const idx = remaining.indexOf('.');
        if (idx <= 0) {
          cursor[remaining] = value;
          break;
        }
        const head = remaining.slice(0, idx);
        const tail = remaining.slice(idx + 1);
        const next = cursor[head];
        const nextObj =
          next && typeof next === 'object' && !Array.isArray(next)
            ? (next as Record<string, unknown>)
            : {};
        cursor[head] = nextObj;
        cursor = nextObj;
        remaining = tail;
      }
      nested[subRoot] = subTarget;
    }
    bodyParams[root] = target;
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
          queryParams[key] = String(value);
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
