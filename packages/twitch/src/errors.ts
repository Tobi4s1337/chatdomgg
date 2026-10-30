/**
 * Every Twitch failure is reduced to a kind, the operation and the HTTP status. Provider bodies, URLs with
 * queries, tokens and causes never reach the message, so an error can be logged or shown as it is.
 */
export type TwitchFailureKind =
  | 'unauthorized'
  | 'forbidden'
  | 'bad_request'
  | 'not_found'
  | 'conflict'
  | 'gone'
  | 'limit_reached'
  | 'rate_limited'
  | 'provider'
  | 'network'
  | 'timeout'
  | 'aborted'
  | 'invalid_response'
  | 'overloaded'
  | 'credentials_rejected'
  | 'wrong_client'
  | 'not_app_token'
  | 'closed';

const PHRASES: Record<TwitchFailureKind, string> = {
  unauthorized: 'token was not accepted',
  forbidden: 'request was refused',
  bad_request: 'request was rejected as malformed',
  not_found: 'resource was not found',
  conflict: 'resource already exists',
  gone: 'this type or version has been removed',
  limit_reached: 'a Twitch limit for this client was reached',
  rate_limited: 'rate limit reached',
  provider: 'Twitch reported a server error',
  network: 'Twitch could not be reached',
  timeout: 'request timed out',
  aborted: 'request was cancelled',
  invalid_response: 'response did not match the expected shape',
  overloaded: 'too many requests are already waiting',
  credentials_rejected: 'app credentials were rejected',
  wrong_client: 'token belongs to a different client',
  not_app_token: 'token carries a user identity, not the app identity',
  closed: 'session is closed',
};

export class TwitchRequestError extends Error {
  readonly kind: TwitchFailureKind;
  readonly operation: string;
  readonly status: number | null;
  /** Epoch milliseconds when a rate-limited request may be tried again, if Twitch said. */
  readonly retryAt: number | null;

  constructor(kind: TwitchFailureKind, operation: string, status: number | null = null, retryAt: number | null = null) {
    super(`${operation}: ${PHRASES[kind]}${status === null ? '' : ` (HTTP ${status})`}`);
    this.name = 'TwitchRequestError';
    this.kind = kind;
    this.operation = operation;
    this.status = status;
    this.retryAt = retryAt;
  }
}

export function failureForStatus(status: number): TwitchFailureKind {
  if (status === 400) return 'bad_request';
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 409) return 'conflict';
  if (status === 410) return 'gone';
  if (status === 429) return 'rate_limited';
  return 'provider';
}

export function isTwitchFailure(error: unknown, kind?: TwitchFailureKind): error is TwitchRequestError {
  return error instanceof TwitchRequestError && (kind === undefined || error.kind === kind);
}
