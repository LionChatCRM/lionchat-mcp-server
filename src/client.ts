// AIDEV-NOTE: HTTP client for LionChat API
// Uses native fetch (Node 18+), zero external dependencies
// Handles auth, retry (429/5xx/network), timeout, and response normalization

import { Config } from './config.js';

// AIDEV-NOTE: Request options passed to client.request()
export interface RequestOptions {
  method: string;
  path: string;
  body?: Record<string, unknown>;
}

// AIDEV-NOTE: Normalized pagination format returned by the client
export interface PaginatedResponse {
  data: unknown[];
  pagination?: {
    current_page: number;
    total_pages: number;
    total_count: number;
    has_more: boolean;
  };
}

// AIDEV-NOTE: Custom error class with HTTP status for callers to inspect
export class LionChatApiError extends Error {
  public readonly status: number;
  public readonly responseBody: unknown;

  constructor(message: string, status: number, responseBody?: unknown) {
    super(message);
    this.name = 'LionChatApiError';
    this.status = status;
    this.responseBody = responseBody;
  }
}

const TIMEOUT_MS = 30_000;
const MAX_RETRIES_429 = 3;
const MAX_RETRIES_5XX = 1;
const MAX_RETRIES_NETWORK = 1;

// AIDEV-NOTE: Actionable error messages per HTTP status
function getErrorMessage(status: number, body: unknown): string {
  switch (status) {
    case 401:
      return 'Authentication failed. Check your token at Login > Profile Settings';
    case 403:
      return 'Permission denied. Your token may not have access to this resource';
    case 404:
      return 'Resource not found. Check the ID and account_id';
    case 422: {
      const details = extractValidationDetails(body);
      return `Validation error: ${details}`;
    }
    case 429:
      return 'Rate limited. Wait and retry';
    default:
      if (status >= 500) {
        return 'LionChat server error. Try again later';
      }
      return `HTTP error ${status}`;
  }
}

// AIDEV-NOTE: Extract validation details from 422 response body
function extractValidationDetails(body: unknown): string {
  if (body && typeof body === 'object') {
    const obj = body as Record<string, unknown>;
    // Chatwoot returns errors in various formats
    if (obj.message && typeof obj.message === 'string') {
      return obj.message;
    }
    if (obj.error && typeof obj.error === 'string') {
      return obj.error;
    }
    if (obj.errors && Array.isArray(obj.errors)) {
      return obj.errors.join(', ');
    }
    if (obj.errors && typeof obj.errors === 'object') {
      return JSON.stringify(obj.errors);
    }
  }
  return JSON.stringify(body);
}

// AIDEV-NOTE: Check if an error is a network/timeout error worth retrying
function isNetworkError(err: unknown): boolean {
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    return (
      msg.includes('econnrefused') ||
      msg.includes('econnreset') ||
      msg.includes('etimedout') ||
      msg.includes('fetch failed') ||
      msg.includes('abort') ||
      err.name === 'AbortError'
    );
  }
  return false;
}

// AIDEV-NOTE: Sleep utility for retry backoff
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// AIDEV-NOTE: Normalize LionChat API responses to a consistent format
// - Array with meta/payload pagination -> PaginatedResponse
// - Plain array -> { data: [...] }
// - Single object -> returned as-is
function normalizeResponse(body: unknown): unknown {
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    const obj = body as Record<string, unknown>;

    // AIDEV-NOTE: Chatwoot pagination format: { payload: [...], meta: { all_count, current_page } }
    if (Array.isArray(obj.payload) && obj.meta && typeof obj.meta === 'object') {
      const meta = obj.meta as Record<string, unknown>;
      const allCount =
        typeof meta.all_count === 'number' ? meta.all_count : 0;
      const currentPage =
        typeof meta.current_page === 'number' ? meta.current_page : 1;

      // AIDEV-NOTE: Chatwoot uses 25 items per page by default. Don't use payload.length
      // as it's wrong on the last page (e.g. 3 items on last page → wrong totalPages calc)
      const perPage = 25;
      const totalPages = perPage > 0 ? Math.ceil(allCount / perPage) : 1;

      return {
        data: obj.payload,
        pagination: {
          current_page: currentPage,
          total_pages: totalPages,
          total_count: allCount,
          has_more: currentPage < totalPages,
        },
      } satisfies PaginatedResponse;
    }

    // AIDEV-NOTE: Some endpoints return { data: [...], meta: {...} } format
    if (Array.isArray(obj.data) && obj.meta && typeof obj.meta === 'object') {
      const meta = obj.meta as Record<string, unknown>;
      const totalCount =
        typeof meta.total_count === 'number'
          ? meta.total_count
          : typeof meta.all_count === 'number'
            ? meta.all_count
            : (obj.data as unknown[]).length;
      const currentPage =
        typeof meta.current_page === 'number' ? meta.current_page : 1;
      const totalPages =
        typeof meta.total_pages === 'number'
          ? meta.total_pages
          : Math.ceil(totalCount / Math.max((obj.data as unknown[]).length, 1));

      return {
        data: obj.data,
        pagination: {
          current_page: currentPage,
          total_pages: totalPages,
          total_count: totalCount,
          has_more: currentPage < totalPages,
        },
      } satisfies PaginatedResponse;
    }

    // AIDEV-NOTE: Single object response — return as-is
    return body;
  }

  // AIDEV-NOTE: Flat array response — wrap in { data: [...] }
  if (Array.isArray(body)) {
    return { data: body };
  }

  return body;
}

export class LionChatClient {
  private config: Config;

  constructor(config: Config) {
    this.config = config;
  }

  // AIDEV-NOTE: Main request method with auth, timeout, retry, and normalization
  async request(options: RequestOptions): Promise<unknown> {
    const { method, path, body } = options;

    // AIDEV-NOTE: Build full URL (query params already embedded in path by tools.ts)
    const url = this.buildUrl(path);

    // AIDEV-NOTE: Build headers — api_access_token + User-Agent on all requests.
    // User-Agent permite o Rails detectar a origem em AccessTokenAuthHelper#detect_mcp_audit_source
    // e anotar o audit log via Current.audit_source.
    const headers: Record<string, string> = {
      api_access_token: this.config.apiToken,
      'User-Agent': `@lionchat/mcp-server/${this.config.version}`,
    };

    const hasBody = body && ['POST', 'PATCH', 'PUT', 'DELETE'].includes(method.toUpperCase());
    if (hasBody) {
      headers['Content-Type'] = 'application/json';
    }

    const fetchOptions: RequestInit = {
      method: method.toUpperCase(),
      headers,
    };

    if (hasBody) {
      fetchOptions.body = JSON.stringify(body);
    }

    // AIDEV-NOTE: Execute with retry logic
    return this.executeWithRetry(url, fetchOptions);
  }

  // AIDEV-NOTE: Build URL from base + path (query params already in path string)
  private buildUrl(path: string): string {
    const base = this.config.baseUrl.replace(/\/+$/, '');
    const cleanPath = path.startsWith('/') ? path : `/${path}`;
    return `${base}${cleanPath}`;
  }

  // AIDEV-NOTE: Retry logic: 429 (exponential backoff, 3x), 5xx (once, 2s), network (once, 2s)
  private async executeWithRetry(
    url: string,
    fetchOptions: RequestInit
  ): Promise<unknown> {
    let lastError: unknown;
    let retries429 = 0;
    let retries5xx = 0;
    let retriesNetwork = 0;

    // AIDEV-NOTE: B1 — só retentamos 5xx/rede em métodos idempotentes. POST não é
    // idempotente: reenviar após timeout/502 (quando o Rails JÁ processou) duplicaria
    // mensagem/contato/conversa. 429 segue retentando p/ todos (é pré-processamento).
    const httpMethod = (fetchOptions.method || 'GET').toUpperCase();
    const isIdempotent = ['GET', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].includes(httpMethod);

    // AIDEV-NOTE: Max possible attempts = 1 initial + 3 (429) + 1 (5xx) + 1 (network)
    // In practice, only one retry category applies per request
    const maxAttempts = 1 + MAX_RETRIES_429 + MAX_RETRIES_5XX + MAX_RETRIES_NETWORK;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        // AIDEV-NOTE: AbortController for 30s timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

        let response: Response;
        try {
          response = await fetch(url, {
            ...fetchOptions,
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timeoutId);
        }

        // AIDEV-NOTE: 204 No Content / empty body (e.g. DELETE endpoints) — read text
        // once and short-circuit BEFORE parsing so an empty body never throws
        // "Unexpected end of JSON input". The operation succeeded; return clean success.
        const rawText = await response.text();
        const isEmptyBody = response.status === 204 || rawText.trim() === '';
        if (isEmptyBody && response.ok) {
          return { success: true, status: response.status };
        }

        // AIDEV-NOTE: Parse response body.
        // B9 — corpo vazio com status de erro: não tenta parsear (JSON.parse('') jogaria
        // "Unexpected end of JSON input"); deixa responseBody undefined p/ getErrorMessage.
        // B4 — sempre parseia em try/catch (mesmo com content-type application/json): um
        // corpo malformado (proxy/CDN/502 parcial) cai no fallback de texto em vez de
        // jogar SyntaxError cru no LLM.
        let responseBody: unknown;
        if (isEmptyBody) {
          responseBody = undefined;
        } else {
          try {
            responseBody = JSON.parse(rawText);
          } catch {
            responseBody = rawText;
          }
        }

        // AIDEV-NOTE: Success — normalize and return
        if (response.ok) {
          return normalizeResponse(responseBody);
        }

        // AIDEV-NOTE: 429 — exponential backoff with Retry-After header support
        if (response.status === 429 && retries429 < MAX_RETRIES_429) {
          retries429++;
          const retryAfter = response.headers.get('Retry-After');
          let delayMs: number;
          if (retryAfter) {
            const seconds = parseInt(retryAfter, 10);
            // AIDEV-NOTE: Retry-After can be seconds (integer) or HTTP-date. parseInt on
            // a date string returns NaN, so fall back to exponential backoff.
            delayMs = Number.isNaN(seconds) ? 1000 * Math.pow(2, retries429 - 1) : seconds * 1000;
          } else {
            delayMs = 1000 * Math.pow(2, retries429 - 1); // 1s, 2s, 4s
          }
          await sleep(delayMs);
          continue;
        }

        // AIDEV-NOTE: 5xx — retry once after 2s (apenas métodos idempotentes; ver B1)
        if (response.status >= 500 && isIdempotent && retries5xx < MAX_RETRIES_5XX) {
          retries5xx++;
          await sleep(2000);
          continue;
        }

        // AIDEV-NOTE: Non-retryable error — throw with actionable message
        const message = getErrorMessage(response.status, responseBody);
        throw new LionChatApiError(message, response.status, responseBody);
      } catch (err) {
        // AIDEV-NOTE: Re-throw our own errors (already handled above)
        if (err instanceof LionChatApiError) {
          throw err;
        }

        // AIDEV-NOTE: Network/timeout errors — retry once after 2s (apenas idempotentes; ver B1)
        if (isNetworkError(err) && isIdempotent && retriesNetwork < MAX_RETRIES_NETWORK) {
          retriesNetwork++;
          lastError = err;
          await sleep(2000);
          continue;
        }

        // AIDEV-NOTE: Unrecoverable network error
        if (isNetworkError(err)) {
          throw new LionChatApiError(
            `Network error: Could not connect to ${this.config.baseUrl}. Check your base URL and network connection.`,
            0,
            undefined
          );
        }

        // AIDEV-NOTE: Unexpected error — rethrow
        throw err;
      }
    }

    // AIDEV-NOTE: Should not reach here, but safety fallback
    throw lastError ?? new Error('Request failed after all retries');
  }
}
