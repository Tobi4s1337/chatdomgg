import { type FetchLike, isTwitchFailure, Secret, send, TWITCH_ID_URL } from '@chatdom/twitch';
import { type AuthorityRecord, type HeldAuthority, RAID_SCOPE, type RaidAuthorityStore, UserTokenSchema, validateUserToken } from './raid-authority-store';

/** Where the broadcaster's raid grant stands, as the gate's `RaidGrants` port reads it. */
export type RaidGrantState = 'granted' | 'missing' | 'revoked' | 'unknown';

/** Why no user token can be had right now. `unknown` is transient (Twitch or the disk could not answer). */
export class RaidGrantUnavailable extends Error {
  override readonly name = 'RaidGrantUnavailable';
  constructor(readonly state: Exclude<RaidGrantState, 'granted'>) {
    super(`raid grant ${state}`);
  }
}

/** A cached access token is not used within this margin of Twitch's stated expiry. */
export const USER_TOKEN_MARGIN_MS = 60_000;

export interface RaidUserSessionOptions {
  /** Null when `HERALD_TOKEN_KEY` is not configured: nothing can be held, so the grant reads `missing`. */
  readonly store: RaidAuthorityStore | null;
  readonly clientId: string;
  readonly clientSecret: Secret;
  /** The configured broadcaster's Twitch user ID: the only account whose token this session will use. */
  readonly broadcasterId: string;
  readonly fetch: FetchLike;
  readonly now?: () => number;
  readonly idUrl?: string;
  readonly timeoutMs?: number;
}

interface Cached { readonly value: Secret; readonly expiresAt: number; readonly recordedAt: number }

/**
 * The broadcaster's user access token for raid writes, held in memory only. It is minted from the sealed refresh
 * token when needed (single-flight: concurrent callers share one refresh), validated as this broadcaster's with
 * `channel:manage:raids`, and dropped a minute before it expires. A rotated refresh token is persisted before the
 * new access token is used. A definite refusal (`400`/`401` on refresh, the raid scope gone, or a `401` that
 * survives one refresh) revokes the stored grant on disk, so it stays `revoked` across restarts until a re-grant.
 */
export class RaidUserSession {
  readonly #options: RaidUserSessionOptions;
  readonly #now: () => number;
  #cached: Cached | null = null;
  #pending: Promise<Secret> | null = null;
  /** The recorded grant found revoked when the disk could not be told; a newer grant clears it. */
  #revokedRecord: number | null = null;
  /** A rotated refresh token the disk refused, kept so this process does not reuse the one Twitch retired. */
  #rotated: { readonly recordedAt: number; readonly refresh: Secret } | null = null;
  readonly counters = { refreshes: 0, rotations: 0, rotationFailures: 0, revocations: 0 };

  constructor(options: RaidUserSessionOptions) {
    this.#options = options;
    this.#now = options.now ?? Date.now;
  }

  /** The grant as stored, without calling Twitch. A store that cannot be read is `unknown`, never `missing`. */
  async standing(): Promise<RaidGrantState> {
    const record = await this.#record().catch(() => 'unknown' as const);
    if (record === 'unknown') return 'unknown';
    return grantOf(record, this.#options.broadcasterId);
  }

  /** The stored record, or null; throws when the store cannot be read. */
  async record(): Promise<AuthorityRecord | null> {
    const record = await this.#record();
    return record && this.#effective(record);
  }

  /** A validated access token with at least a minute to spare. Throws `RaidGrantUnavailable`. */
  token(): Promise<Secret> {
    const cached = this.#cached;
    if (cached && cached.expiresAt - USER_TOKEN_MARGIN_MS > this.#now()) return Promise.resolve(cached.value);
    return this.#refresh();
  }

  /**
   * After Twitch answered `401` to `refused`: the token another caller already replaced is returned as is;
   * otherwise exactly one refresh runs. The caller decides what a second `401` means.
   */
  renew(refused: Secret): Promise<Secret> {
    if (this.#pending) return this.#pending;
    const cached = this.#cached;
    if (cached && !cached.value.same(refused) && cached.expiresAt - USER_TOKEN_MARGIN_MS > this.#now()) return Promise.resolve(cached.value);
    if (cached?.value.same(refused)) this.#cached = null;
    return this.#refresh();
  }

  /**
   * The grant is definitely gone: a `401` that survived a refresh, or Herald's `user.authorization.revoke` for the
   * broadcaster. The stored token is erased; if the disk refuses, this process still treats the grant as revoked.
   */
  async revoke(): Promise<void> {
    this.#cached = null;
    this.counters.revocations++;
    let record: AuthorityRecord | null;
    try { record = await this.#record(); } catch { return; }
    if (record?.state !== 'held') return;
    this.#revokedRecord = record.recordedAt;
    this.#rotated = null;
    const stored = await this.#options.store?.revoke(record, this.#now()).catch(() => false);
    if (stored) this.#revokedRecord = null;
  }

  #refresh(): Promise<Secret> {
    if (this.#pending) return this.#pending;
    const pending = this.#mint().finally(() => {
      if (this.#pending === pending) this.#pending = null;
    });
    this.#pending = pending;
    return pending;
  }

  async #mint(): Promise<Secret> {
    let record: AuthorityRecord | null;
    try { record = await this.#record(); } catch { throw new RaidGrantUnavailable('unknown'); }
    const state = grantOf(record, this.#options.broadcasterId);
    if (state !== 'granted' || record?.state !== 'held') throw new RaidGrantUnavailable(state === 'granted' ? 'unknown' : state);
    const authority: HeldAuthority = record;
    const refresh = this.#rotated?.recordedAt === record.recordedAt ? this.#rotated.refresh : record.refresh;
    const { clientId, clientSecret, fetch } = this.#options;
    const timeoutMs = this.#options.timeoutMs ?? 8_000;
    this.counters.refreshes++;
    let raw: unknown;
    try {
      ({ body: raw } = await send(fetch, { operation: 'refresh user token', method: 'POST', url: new URL('/oauth2/token', this.#options.idUrl ?? TWITCH_ID_URL),
        form: new URLSearchParams({ client_id: clientId, client_secret: clientSecret.reveal(), grant_type: 'refresh_token', refresh_token: refresh.reveal() }), timeoutMs }));
    } catch (error) {
      // Twitch answers an invalid or withdrawn refresh token with 400 (sometimes 401): the grant is gone.
      if (isTwitchFailure(error) && (error.status === 400 || error.status === 401)) {
        await this.revoke();
        throw new RaidGrantUnavailable('revoked');
      }
      throw new RaidGrantUnavailable('unknown');
    }
    const parsed = UserTokenSchema.safeParse(raw);
    if (!parsed.success) throw new RaidGrantUnavailable('unknown');
    const access = new Secret(parsed.data.access_token);
    const next = parsed.data.refresh_token ? new Secret(parsed.data.refresh_token) : null;
    if (next && !next.same(refresh)) {
      // Persist first: once Twitch rotates, the old refresh token may never work again.
      this.counters.rotations++;
      const kept = await this.#options.store?.rotate(authority, next).catch(() => false);
      if (kept) this.#rotated = null;
      else { this.#rotated = { recordedAt: authority.recordedAt, refresh: next }; this.counters.rotationFailures++; }
    }
    let validated;
    try {
      validated = await validateUserToken({ access, fetch, timeoutMs, ...(this.#options.idUrl ? { idUrl: this.#options.idUrl } : {}) });
    } catch (error) {
      if (isTwitchFailure(error) && error.status === 401) {
        await this.revoke();
        throw new RaidGrantUnavailable('revoked');
      }
      throw new RaidGrantUnavailable('unknown');
    }
    // Never act for another account or app; a token without the raid scope no longer carries the raid control.
    if (validated.grant.clientId !== clientId || validated.grant.userId !== this.#options.broadcasterId) throw new RaidGrantUnavailable('unknown');
    if (!validated.grant.scopes.includes(RAID_SCOPE)) {
      await this.revoke();
      throw new RaidGrantUnavailable('revoked');
    }
    const lifetime = Math.min(parsed.data.expires_in ?? validated.expiresIn, validated.expiresIn) * 1000;
    this.#cached = { value: access, expiresAt: this.#now() + lifetime, recordedAt: authority.recordedAt };
    return access;
  }

  async #record(): Promise<AuthorityRecord | null> {
    const store = this.#options.store;
    if (!store) return null;
    const record = await store.read();
    if (record && this.#cached && this.#cached.recordedAt !== record.recordedAt) this.#cached = null;
    return record && this.#effective(record);
  }

  #effective(record: AuthorityRecord): AuthorityRecord {
    if (record.state === 'held' && this.#revokedRecord === record.recordedAt) {
      return { userId: record.userId, login: record.login, scopes: record.scopes, recordedAt: record.recordedAt, state: 'revoked', revokedAt: record.recordedAt };
    }
    if (this.#revokedRecord !== null && this.#revokedRecord !== record.recordedAt) this.#revokedRecord = null;
    return record;
  }
}

/** Standing of a stored record for this broadcaster. A grant for another account, or without raids, is missing. */
export function grantOf(record: AuthorityRecord | null, broadcasterId: string): Exclude<RaidGrantState, 'unknown'> {
  if (!record || record.userId !== broadcasterId) return 'missing';
  if (record.state === 'revoked') return 'revoked';
  return record.scopes.includes(RAID_SCOPE) ? 'granted' : 'missing';
}
