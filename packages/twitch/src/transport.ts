import { failureForStatus, TwitchRequestError } from './errors';

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export const DEFAULT_TIMEOUT_MS = 10_000;
/** Twitch pages are small; a body beyond this is treated as malformed rather than buffered. */
const MAX_BODY_CHARS = 4_000_000;

export interface HttpRequest {
  readonly operation: string;
  readonly method: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  readonly url: URL;
  readonly headers?: Readonly<Record<string, string>>;
  readonly form?: URLSearchParams;
  readonly json?: unknown;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal | undefined;
  /** Called with every response's headers before its body is read, including failures. */
  readonly observe?: (headers: Headers, status: number) => void;
}

export interface HttpResult {
  readonly status: number;
  readonly headers: Headers;
  /** Parsed JSON, or null for an empty 2xx body. */
  readonly body: unknown;
}

/**
 * One bounded HTTP exchange. Non-2xx responses throw a redacted `TwitchRequestError` and their bodies are
 * discarded unread; Twitch's error text is never surfaced.
 */
export async function send(fetchImpl: FetchLike, request: HttpRequest): Promise<HttpResult> {
  const timeout = AbortSignal.timeout(request.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const signal = request.signal ? AbortSignal.any([request.signal, timeout]) : timeout;
  const headers: Record<string, string> = { ...request.headers };
  let body: string | null = null;
  if (request.form) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    body = request.form.toString();
  } else if (request.json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(request.json);
  }

  let response: Response;
  try {
    response = await fetchImpl(request.url.toString(), { method: request.method, headers, body, signal, redirect: 'error' });
  } catch {
    throw abortFailure(request, timeout);
  }
  request.observe?.(response.headers, response.status);

  if (response.status < 200 || response.status > 299) {
    await response.body?.cancel().catch(() => undefined);
    const retryAt = response.status === 429 ? resetFromHeaders(response.headers) : null;
    throw new TwitchRequestError(failureForStatus(response.status), request.operation, response.status, retryAt);
  }

  let text: string;
  try {
    text = await response.text();
  } catch {
    throw abortFailure(request, timeout);
  }
  if (text.length > MAX_BODY_CHARS) throw new TwitchRequestError('invalid_response', request.operation, response.status);
  if (text.trim().length === 0) return { status: response.status, headers: response.headers, body: null };
  try {
    return { status: response.status, headers: response.headers, body: JSON.parse(text) as unknown };
  } catch {
    throw new TwitchRequestError('invalid_response', request.operation, response.status);
  }
}

function abortFailure(request: HttpRequest, timeout: AbortSignal): TwitchRequestError {
  if (request.signal?.aborted) return new TwitchRequestError('aborted', request.operation);
  if (timeout.aborted) return new TwitchRequestError('timeout', request.operation);
  return new TwitchRequestError('network', request.operation);
}

/** `Ratelimit-Reset` is epoch seconds. Returns epoch milliseconds, or null when absent or nonsense. */
export function resetFromHeaders(headers: Headers): number | null {
  const raw = headers.get('ratelimit-reset');
  if (raw === null || !/^\d{1,12}$/.test(raw.trim())) return null;
  return Number(raw.trim()) * 1000;
}

export function remainingFromHeaders(headers: Headers): number | null {
  const raw = headers.get('ratelimit-remaining');
  if (raw === null || !/^\d{1,9}$/.test(raw.trim())) return null;
  return Number(raw.trim());
}
