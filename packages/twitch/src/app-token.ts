import { z } from 'zod';
import { isTwitchFailure, TwitchRequestError } from './errors';
import { Secret } from './secret';
import { DEFAULT_TIMEOUT_MS, send, type FetchLike } from './transport';

export const TWITCH_ID_URL = 'https://id.twitch.tv';
/** Twitch asks maintained sessions to validate at least hourly. */
export const VALIDATE_INTERVAL_MS = 3_600_000;
/** Renew this long before Twitch's stated expiry so no request goes out on a dying token. */
const RENEW_MARGIN_MS = 300_000;

const AppTokenResponseSchema = z.object({
  access_token: z.string().min(1).max(512),
  expires_in: z.number().int().positive(),
  token_type: z.string().regex(/^bearer$/i),
});

/** `/oauth2/validate` answers; app tokens carry no login or user ID. */
export const ValidationSchema = z.object({
  client_id: z.string().min(1).max(64),
  login: z.string().nullish(),
  user_id: z.string().nullish(),
  scopes: z.array(z.string()).nullish(),
  expires_in: z.number().int().min(0),
});
export type TokenValidation = z.infer<typeof ValidationSchema>;

export type AppTokenEvent =
  | { readonly type: 'acquired'; readonly renewal: boolean; readonly expiresAt: number }
  | { readonly type: 'invalidated'; readonly reason: 'unauthorized' | 'expired' | 'closed' };

export interface AppTokenOptions {
  readonly clientId: string;
  readonly clientSecret: Secret;
  readonly fetch: FetchLike;
  readonly now?: () => number;
  readonly timeoutMs?: number;
  readonly idUrl?: string;
}

interface HeldToken {
  readonly value: Secret;
  readonly expiresAt: number;
  readonly validatedAt: number;
}

/**
 * The app access token, held in memory only. Every token is validated before first use: it must belong to
 * this client and carry no user identity. Acquisition is single-flight, so a burst of 401s mints one token.
 * App tokens are never refreshed; a rejected one is replaced by a new client-credentials grant.
 */
export class AppTokenSession {
  readonly clientId: string;
  readonly #secret: Secret;
  readonly #fetch: FetchLike;
  readonly #now: () => number;
  readonly #timeoutMs: number;
  readonly #idUrl: string;
  readonly #listeners = new Set<(event: AppTokenEvent) => void>();
  #token: HeldToken | null = null;
  #pending: Promise<Secret> | null = null;
  #acquisitions = 0;
  #closed = false;
  readonly #lifetime = new AbortController();

  constructor(options: AppTokenOptions) {
    this.clientId = options.clientId;
    this.#secret = options.clientSecret;
    this.#fetch = options.fetch;
    this.#now = options.now ?? Date.now;
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#idUrl = options.idUrl ?? TWITCH_ID_URL;
  }

  get status(): { readonly held: boolean; readonly expiresAt: number | null; readonly validatedAt: number | null; readonly acquisitions: number } {
    return {
      held: this.#token !== null,
      expiresAt: this.#token?.expiresAt ?? null,
      validatedAt: this.#token?.validatedAt ?? null,
      acquisitions: this.#acquisitions,
    };
  }

  on(listener: (event: AppTokenEvent) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** A validated token with time to spare, acquiring one if needed. */
  async current(): Promise<Secret> {
    this.#assertOpen('app token');
    const held = this.#token;
    if (held && held.expiresAt - RENEW_MARGIN_MS > this.#now()) return held.value;
    if (held) this.#drop('expired');
    return this.#acquire(false);
  }

  /**
   * Called after a 401 with the token that was refused. If another caller already replaced it, the
   * replacement is returned without a new grant; otherwise exactly one new token is acquired.
   */
  async renew(refused: Secret): Promise<Secret> {
    this.#assertOpen('app token');
    if (this.#pending) return this.#pending;
    const held = this.#token;
    if (held && !held.value.same(refused)) return held.value;
    if (held) this.#drop('unauthorized');
    return this.#acquire(true);
  }

  /**
   * The startup/hourly check. A token Twitch no longer accepts is replaced; one that changed client or gained
   * a user identity is dropped and the error rethrown, stopping everything that depends on it.
   */
  async validate(): Promise<'valid' | 'renewed'> {
    this.#assertOpen('validate app token');
    const held = this.#token;
    if (!held) {
      await this.current();
      return 'renewed';
    }
    try {
      const validation = await this.#check(held.value);
      this.#token = { value: held.value, validatedAt: this.#now(), expiresAt: Math.min(held.expiresAt, this.#now() + validation.expires_in * 1000) };
      return 'valid';
    } catch (error) {
      if (isTwitchFailure(error, 'unauthorized')) {
        await this.renew(held.value);
        return 'renewed';
      }
      if (isTwitchFailure(error, 'wrong_client') || isTwitchFailure(error, 'not_app_token')) this.#drop('unauthorized');
      throw error;
    }
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.#lifetime.abort();
    if (this.#token) this.#drop('closed');
    this.#pending = null;
    this.#listeners.clear();
  }

  #acquire(renewal: boolean): Promise<Secret> {
    if (this.#pending) return this.#pending;
    const pending = this.#mint(renewal).finally(() => {
      if (this.#pending === pending) this.#pending = null;
    });
    this.#pending = pending;
    return pending;
  }

  async #mint(renewal: boolean): Promise<Secret> {
    this.#acquisitions += 1;
    let raw: unknown;
    try {
      ({ body: raw } = await send(this.#fetch, {
        operation: 'app token',
        method: 'POST',
        url: new URL('/oauth2/token', this.#idUrl),
        form: new URLSearchParams({ client_id: this.clientId, client_secret: this.#secret.reveal(), grant_type: 'client_credentials' }),
        timeoutMs: this.#timeoutMs,
        signal: this.#lifetime.signal,
      }));
    } catch (error) {
      if (isTwitchFailure(error) && (error.kind === 'bad_request' || error.kind === 'unauthorized' || error.kind === 'forbidden')) {
        throw new TwitchRequestError('credentials_rejected', 'app token', error.status);
      }
      throw error;
    }
    const parsed = AppTokenResponseSchema.safeParse(raw);
    if (!parsed.success) throw new TwitchRequestError('invalid_response', 'app token');
    const value = new Secret(parsed.data.access_token);
    const validation = await this.#check(value);
    this.#assertOpen('app token');
    const now = this.#now();
    const expiresAt = now + Math.min(parsed.data.expires_in, validation.expires_in) * 1000;
    this.#token = { value, expiresAt, validatedAt: now };
    this.#emit({ type: 'acquired', renewal, expiresAt });
    return value;
  }

  async #check(token: Secret): Promise<TokenValidation> {
    const { body } = await send(this.#fetch, {
      operation: 'validate app token',
      method: 'GET',
      url: new URL('/oauth2/validate', this.#idUrl),
      headers: { Authorization: `OAuth ${token.reveal()}` },
      timeoutMs: this.#timeoutMs,
      signal: this.#lifetime.signal,
    });
    const parsed = ValidationSchema.safeParse(body);
    if (!parsed.success) throw new TwitchRequestError('invalid_response', 'validate app token');
    if (parsed.data.client_id !== this.clientId) throw new TwitchRequestError('wrong_client', 'validate app token');
    if (parsed.data.user_id || parsed.data.login) throw new TwitchRequestError('not_app_token', 'validate app token');
    return parsed.data;
  }

  #drop(reason: 'unauthorized' | 'expired' | 'closed'): void {
    this.#token = null;
    this.#emit({ type: 'invalidated', reason });
  }

  #emit(event: AppTokenEvent): void {
    for (const listener of [...this.#listeners]) {
      try {
        listener(event);
      } catch {
        // A listener's failure cannot be allowed to break token handling for everyone else.
      }
    }
  }

  #assertOpen(operation: string): void {
    if (this.#closed) throw new TwitchRequestError('closed', operation);
  }
}
