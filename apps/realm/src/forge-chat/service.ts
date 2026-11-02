import { createHash, createHmac, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { FORGE_CHAT_LIMITS, FORGE_CHAT_SCOPE,
  ForgeChatStatusRequestSchema, ForgeChatAuthorizeRequestSchema, ForgeChatWishRequestSchema,
  ForgeChatRevokeRequestSchema, TokenSchema,
  type ForgeChatAvailability, type ForgeChatGrant, type ForgeChatStatusReply, type ForgeChatWish,
  type ForgeChatObservation, type KingdomId, type ForgeChatError } from '@chatdom/shared';
import type { ForgeChatConfig } from './config';
import { ForgeChatRequestConflict, ForgeChatRequestExpired, type ForgeChatStore, type ChatGrant } from './store';

export interface ForgeChatPrincipal { readonly personId: string; readonly sessionId: string }
export interface ForgeChatTarget { readonly broadcasterId: string; readonly availability: ForgeChatAvailability }
export interface ForgeChatServiceOptions {
  readonly origin: 'live' | 'simulated';
  readonly store: ForgeChatStore;
  readonly config: ForgeChatConfig | null;
  /** Reads the actual adopted founded directory and current retained stream authority. */
  readonly resolveTarget: (kingdomId: KingdomId) => Promise<ForgeChatTarget | null>;
  readonly recoverCommitted?: (input: { kingdomId: KingdomId; personId: string; messageId: string }) => Promise<{
    attachmentId: string; committedAt: number; message?: string;
  } | null>;
  readonly fetch?: typeof fetch;
  readonly now?: () => number;
}
export class ForgeChatServiceError extends Error {
  constructor(readonly http: 400 | 401 | 403 | 409 | 429 | 503,
    readonly code: ForgeChatError['code'], message: string) { super(message); this.name = 'ForgeChatServiceError'; }
}
const unavailable = () => new ForgeChatServiceError(503, 'unavailable', 'The forge cannot reach chat just now. You can still type !forge in the channel.');
const consent = () => new ForgeChatServiceError(403, 'consent-required', 'Allow the forge to post your wish to Twitch chat first.');
const safeMessage = (text: string) => text.slice(0, 240);
const Tokens = z.object({ access_token: z.string().min(1).max(4096), refresh_token: z.string().min(1).max(4096),
  expires_in: z.number().int().positive(), token_type: z.string().refine(v => v.toLowerCase() === 'bearer') });
const Validation = z.object({ client_id: z.string(), user_id: z.string(), scopes: z.array(z.string()), expires_in: z.number().nonnegative() });
const Sent = z.object({ data: z.array(z.object({ is_sent: z.boolean(), message_id: z.string(),
  drop_reason: z.object({ code: z.string() }).passthrough().nullable().optional() })).length(1) });
const warmingMessage = 'The forge is warming. You can still wish with !forge in the channel.';
const cold: ForgeChatAvailability = { status: 'cold', reason: 'service-unavailable', message: warmingMessage };

/** This service only transports chat. The Herald and existing Forge remain the sole creation authority. */
export function createForgeChatService(options: ForgeChatServiceOptions) {
  const { store, config } = options, now = options.now ?? Date.now, http = options.fetch ?? fetch;
  let timer: ReturnType<typeof setInterval> | undefined, running: Promise<void> | undefined, stopped = false;
  let starting: Promise<void> | undefined;
  const pending = new Set<Promise<unknown>>();
  const request = async (url: string, init: RequestInit = {}) => {
    try { return await http(url, { ...init, signal: AbortSignal.timeout(7000), redirect: 'error' }); }
    catch { throw unavailable(); }
  };
  const exchange = async (values: Record<string, string>): Promise<ChatGrant> => {
    if (!config) throw unavailable();
    const response = await request('https://id.twitch.tv/oauth2/token', { method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, ...values }) });
    if (!response.ok) { if (response.status === 400 || response.status === 401) throw consent(); throw unavailable(); }
    const parsed = Tokens.safeParse(await response.json().catch(() => null));
    if (!parsed.success) throw unavailable();
    return { accessToken: parsed.data.access_token, refreshToken: parsed.data.refresh_token,
      expiresAt: now() + parsed.data.expires_in * 1000, validatedAt: 0 };
  };
  const validate = async (personId: string, grant: ChatGrant, expectedScopes: readonly string[] = [FORGE_CHAT_SCOPE]): Promise<ChatGrant> => {
    if (!config) throw unavailable();
    const response = await request('https://id.twitch.tv/oauth2/validate', { headers: { Authorization: `OAuth ${grant.accessToken}` } });
    if (response.status === 401) throw consent();
    if (!response.ok) throw unavailable();
    const parsed = Validation.safeParse(await response.json().catch(() => null));
    if (!parsed.success) throw unavailable();
    if (parsed.data.client_id !== config.clientId || parsed.data.user_id !== personId
      || !parsed.data.scopes.includes(FORGE_CHAT_SCOPE) || expectedScopes.some(scope => !parsed.data.scopes.includes(scope))) throw consent();
    return { ...grant, expiresAt: now() + parsed.data.expires_in * 1000, validatedAt: now() };
  };
  const checkGrant = async (personId: string, force = false): Promise<ForgeChatGrant> => {
    if (!config) return { status: 'unavailable', reason: 'not-configured', message: 'Chat wishes are not connected here yet. Type !forge in the channel to make your wish.' };
    try {
      await prepareGrant(personId, false, force);
      return { status: 'ready' };
    } catch (error) {
      if (error instanceof ForgeChatServiceError && error.code === 'consent-required') return { status: 'required', reason: 'not-granted' };
      return { status: 'unavailable', reason: 'service-unavailable', message: 'Chat permission cannot be checked just now. Check channel chat before making another wish.' };
    }
  };
  // Commit rotated credentials before their first use by a sender. A later send lock re-reads the grant,
  // so a revocation between these transactions still prevents the outbound write.
  const prepareGrant = async (personId: string, refresh = false, forceValidation = false, rejectedAccessToken?: string): Promise<void> => {
    const active = await store.withGrantLock(personId, async (grant, save) => {
      if (!grant) return false;
      try {
        if ((refresh && (!rejectedAccessToken || rejectedAccessToken === grant.accessToken)) || grant.expiresAt <= now() + 30_000) {
          await save(await exchange({ grant_type: 'refresh_token', refresh_token: grant.refreshToken }));
        }
        else if (forceValidation && grant.validatedAt) await save({ ...grant, validatedAt: 0 });
        return true;
      } catch (error) {
        if (error instanceof ForgeChatServiceError && error.code === 'consent-required') { await save(null); return false; }
        throw error;
      }
    });
    if (!active) throw consent();
    // A rotation can invalidate the old refresh token. Its new pair survives a temporary validation
    // outage, marked unvalidated, and is checked again before any send can use it.
    const validated = await store.withGrantLock(personId, async (grant, save) => {
      if (!grant) return false;
      try {
        if (forceValidation || !grant.validatedAt || grant.validatedAt + FORGE_CHAT_LIMITS.validationMs <= now()) await save(await validate(personId, grant));
        return true;
      } catch (error) {
        if (error instanceof ForgeChatServiceError && error.code === 'consent-required') { await save(null); return false; }
        throw error;
      }
    });
    if (!validated) throw consent();
  };
  const knownScopes = async (personId: string): Promise<string[]> => {
    const settings = requireConfig();
    const tokenResponse = await request('https://id.twitch.tv/oauth2/token', { method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: settings.clientId, client_secret: settings.clientSecret, grant_type: 'client_credentials' }) });
    const AppToken = z.object({ access_token: z.string().min(1), token_type: z.string(), expires_in: z.number().positive() });
    const token = AppToken.safeParse(await tokenResponse.json().catch(() => null));
    if (!tokenResponse.ok || !token.success) throw unavailable();
    const response = await request(`https://api.twitch.tv/helix/authorization/users?user_id=${encodeURIComponent(personId)}`, {
      headers: { Authorization: `Bearer ${token.data.access_token}`, 'Client-Id': settings.clientId } });
    const Authorization = z.object({ data: z.array(z.object({ user_id: z.string(), has_authorized: z.boolean(), scopes: z.array(z.string()) })) });
    const granted = Authorization.safeParse(await response.json().catch(() => null));
    if (!response.ok || !granted.success) throw unavailable();
    if (granted.data.data.length !== 1 || granted.data.data[0]?.user_id !== personId) throw unavailable();
    const account = granted.data.data[0];
    if (!account.has_authorized && account.scopes.length) throw unavailable();
    return account.has_authorized ? account.scopes : [];
  };
  const target = async (kingdomId: KingdomId) => {
    try { return await options.resolveTarget(kingdomId); } catch { return null; }
  };
  const requireConfig = () => { if (!config) throw new ForgeChatServiceError(503, 'not-configured', 'Chat wishes are not connected here yet. Type !forge in the channel.'); return config; };
  const parse = <T>(schema: z.ZodType<T>, body: unknown): T => {
    const result = schema.safeParse(body);
    if (!result.success) throw new ForgeChatServiceError(400, 'invalid-request', 'This wish request could not be read. Reload the page and try again.');
    return result.data;
  };
  const service = {
    async status(principal: ForgeChatPrincipal | null, raw: unknown): Promise<ForgeChatStatusReply> {
      const body = parse(ForgeChatStatusRequestSchema, raw), resolved = await target(body.kingdomId);
      let wish: ForgeChatWish | null;
      try { wish = principal ? await store.getWish(principal.personId, body.kingdomId, body.requestId) : null; }
      catch (error) {
        if (error instanceof ForgeChatRequestExpired) throw new ForgeChatServiceError(409, 'request-expired', 'This wish receipt has expired. This request will never send again.');
        throw error;
      }
      if (principal && wish && 'messageId' in wish && wish.status !== 'delivered' && options.recoverCommitted) {
        const committed = await options.recoverCommitted({ kingdomId: body.kingdomId, personId: principal.personId, messageId: wish.messageId }).catch(() => null);
        if (committed) {
          await service.observe({ origin: options.origin, kingdomId: body.kingdomId, personId: principal.personId as ForgeChatObservation['personId'],
            messageId: wish.messageId, at: committed.committedAt, status: 'delivered', ...committed });
          wish = await store.getWish(principal.personId, body.kingdomId, wish.requestId);
        }
      }
      return { version: 1, status: 'ok', kingdomId: body.kingdomId,
        grant: principal ? await checkGrant(principal.personId) : { status: 'signed-out' },
        availability: resolved?.availability ?? cold,
        wish };
    },
    async authorize(principal: ForgeChatPrincipal, raw: unknown) {
      const body = parse(ForgeChatAuthorizeRequestSchema, raw), settings = requireConfig();
      if (!await target(body.kingdomId)) throw unavailable();
      const scopes = [...new Set([FORGE_CHAT_SCOPE, ...await knownScopes(principal.personId)])].sort();
      const state = randomBytes(32).toString('base64url');
      await store.putState({ hash: createHash('sha256').update(state).digest('hex'), sessionId: principal.sessionId,
        personId: principal.personId, kingdomId: body.kingdomId, scopes, expiresAt: now() + FORGE_CHAT_LIMITS.stateTtlMs });
      const url = new URL('https://id.twitch.tv/oauth2/authorize');
      url.search = new URLSearchParams({ response_type: 'code', client_id: settings.clientId, redirect_uri: settings.redirectUri,
        scope: scopes.join(' '), state, force_verify: 'true' }).toString();
      return { version: 1 as const, status: 'authorize' as const, authorizationUrl: url.toString() };
    },
    async callback(principal: ForgeChatPrincipal, query: URLSearchParams, current: () => Promise<boolean>): Promise<string> {
      const settings = requireConfig(), state = query.get('state');
      if (!state || state.length > 256) return '/?forgeChat=expired';
      let rejected: ChatGrant | undefined;
      const result = await store.withGrantLock(principal.personId, async (_grant, save, context) => {
        const hash = createHash('sha256').update(state).digest('hex');
        const accepted = context ? await context.takeState(hash, principal.sessionId, now())
          : await store.takeState(hash, principal.sessionId, principal.personId, now());
        if (!accepted) return '/?forgeChat=expired';
        // Back into the walk the wish was started from. `/kingdom/<id>` would hand a founded kingdom over to its
        // watch-only stream, and the visitor would lose the anvil they were standing at.
        const back = `/?walk=1&kingdom=${encodeURIComponent(accepted.kingdomId)}&forgeChat=`;
        if (query.has('error')) return back + 'denied';
        const code = query.get('code');
        if (!code || code.length > 4096) return back + 'unavailable';
        let exchanged: ChatGrant | undefined, retained = false;
        try {
          exchanged = await exchange({ grant_type: 'authorization_code', code, redirect_uri: settings.redirectUri });
          // This also resets the database's idle-transaction clock between two bounded provider calls.
          if (!await (context?.sessionCurrent ? context.sessionCurrent(principal.sessionId) : current())) return back + 'expired';
          const grant = await validate(principal.personId, exchanged, accepted.scopes);
          if (!await (context?.sessionCurrent ? context.sessionCurrent(principal.sessionId) : current())) return back + 'expired';
          await save(grant);
          retained = true;
          return back + 'connected';
        } catch (error) {
          return back + (exchanged && error instanceof ForgeChatServiceError && error.code === 'consent-required' ? 'wrong-account' : 'unavailable');
        } finally {
          // A rejected newly exchanged token is never retained, including wrong-account and expired sessions.
          // Revoking an accepted token here would disable the separately stored grant.
          if (exchanged && !retained) rejected = exchanged;
        }
      });
      // State consumption commits before this best-effort provider cleanup. Rejected-token cleanup
      // cannot hold the shared grant transaction open or make the one-time callback reusable.
      if (rejected) await request('https://id.twitch.tv/oauth2/revoke', { method: 'POST',
        body: new URLSearchParams({ client_id: settings.clientId, token: (rejected as ChatGrant).accessToken }),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }).catch(() => {});
      return result;
    },
    async revoke(principal: ForgeChatPrincipal, raw: unknown) {
      parse(ForgeChatRevokeRequestSchema, raw);
      requireConfig();
      // Forget this separate permission durably; no sign-in grant or session is changed.
      let revoked: ChatGrant | null = null;
      if (store.revokeGrant) revoked = await store.revokeGrant(principal.personId);
      else await store.withGrantLock(principal.personId, async (grant, save) => { revoked = grant; await save(null); });
      if (revoked && config) await request('https://id.twitch.tv/oauth2/revoke', { method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: config.clientId, token: (revoked as ChatGrant).accessToken }) }).catch(() => {});
      return { version: 1 as const, status: 'revoked' as const };
    },
    async wish(principal: ForgeChatPrincipal, raw: unknown, current: () => Promise<boolean>) {
      const body = parse(ForgeChatWishRequestSchema, raw), settings = requireConfig();
      const digest = createHmac('sha256', settings.tokenKey).update(JSON.stringify([options.origin, principal.personId, body.kingdomId, body.words])).digest('hex');
      let claimed: Awaited<ReturnType<ForgeChatStore['claimWish']>>;
      try { claimed = await store.claimWish(principal.personId, { requestId: body.requestId, kingdomId: body.kingdomId, status: 'sending', updatedAt: now() }, digest, principal.sessionId); }
      catch (error) {
        if (error instanceof ForgeChatRequestExpired) throw new ForgeChatServiceError(409, 'request-expired', 'This wish receipt has expired. This request will never send again.');
        if (error instanceof ForgeChatRequestConflict) throw new ForgeChatServiceError(409, 'request-conflict', 'This request already belongs to another wish. Make a new wish to send new words.');
        throw error;
      }
      if (!claimed.created) return { version: 1 as const, status: 'accepted' as const, wish: claimed.wish };
      const saveFailure = async (reason: Extract<ForgeChatWish, { status: 'not-sent' }>['reason'], message: string, retryAt?: number) => {
        const wish: ForgeChatWish = { requestId: body.requestId, kingdomId: body.kingdomId, updatedAt: now(), status: 'not-sent', reason, message,
          ...(retryAt === undefined ? {} : { retryAt }) };
        await store.setWish(principal.personId, wish); return wish;
      };
      let wish: ForgeChatWish;
      let sending = false;
      let confirmed: Extract<ForgeChatWish, { status: 'sent' }> | undefined;
      try {
        const resolved = await target(body.kingdomId);
        if (!resolved || resolved.availability.status !== 'ready') {
          wish = await saveFailure(resolved?.availability.status === 'cold' && resolved.availability.reason === 'stream-offline' ? 'stream-offline' : 'service-unavailable',
            resolved?.availability.status === 'cold' ? resolved.availability.message : warmingMessage);
        } else {
          await prepareGrant(principal.personId);
          let firstUnauthorized = false;
          type Failure = { kind: 'failure'; reason: Extract<ForgeChatWish, { status: 'not-sent' }>['reason']; message: string; retryAt?: number };
          type Attempt = Failure | { kind: 'retry'; accessToken: string } | { kind: 'sent'; wish: Extract<ForgeChatWish, { status: 'sent' }> };
          const send = async (): Promise<Attempt> => {
            if (!await current()) return { kind: 'failure', reason: 'consent-required', message: 'Sign in again before sending your wish.' };
            // Refresh the authority preflight before taking the token lock. Pool queries must not nest
            // under that lock: simultaneous senders could otherwise consume every shared pool connection.
            const latest = await target(body.kingdomId);
            if (!latest || latest.broadcasterId !== resolved.broadcasterId || latest.availability.status !== 'ready') return { kind: 'failure', reason: 'stream-offline', message: 'The forge fire rests while the stream is offline. Your coal stays yours.' };
            return store.withGrantLock<Attempt>(principal.personId, async (grant, save, context) => {
              if (!grant) return { kind: 'failure', reason: 'consent-required', message: 'Allow the forge to post your wish to Twitch chat first.' };
              if (!grant.validatedAt || grant.validatedAt + FORGE_CHAT_LIMITS.validationMs <= now() || grant.expiresAt <= now()) {
                return { kind: 'failure', reason: 'service-unavailable', message: 'Chat permission is still being checked. Check chat before making another wish.' };
              }
              if (context?.sessionCurrent && !await context.sessionCurrent(principal.sessionId)) return { kind: 'failure', reason: 'consent-required', message: 'Sign in again before sending your wish.' };
              sending = true;
              const response = await request('https://api.twitch.tv/helix/chat/messages', { method: 'POST',
                headers: { Authorization: `Bearer ${grant.accessToken}`, 'Client-Id': settings.clientId, 'Content-Type': 'application/json' },
                body: JSON.stringify({ broadcaster_id: resolved.broadcasterId, sender_id: principal.personId, message: `!forge ${body.words}` }) });
              if (response.status === 401 && !firstUnauthorized) { firstUnauthorized = true; return { kind: 'retry', accessToken: grant.accessToken }; }
              if (response.status === 401 || response.status === 403) { await save(null); return { kind: 'failure', reason: 'consent-required', message: 'Twitch needs chat permission again. Your wish was not sent.' }; }
              if (response.status === 429) {
                const seconds = Number(response.headers.get('ratelimit-reset')), delay = Number(response.headers.get('retry-after'));
                const retryAt = Number.isFinite(seconds) && seconds * 1000 > now() ? seconds * 1000
                  : Number.isFinite(delay) && delay > 0 ? now() + delay * 1000 : now() + 30_000;
                return { kind: 'failure', reason: 'rate-limited', message: 'Twitch chat is busy. Wait a moment before making a new wish.', retryAt };
              }
              if (!response.ok) { if (response.status >= 500) throw unavailable(); return { kind: 'failure', reason: 'chat-dropped', message: 'Twitch could not post this wish. You can try it in channel chat.' }; }
              const parsed = Sent.safeParse(await response.json().catch(() => null));
              if (!parsed.success) throw unavailable();
              const result = parsed.data.data[0]!;
              if (!result.is_sent) {
                const reason = result.drop_reason?.code ?? '';
                const message = reason.includes('automod') ? 'Twitch AutoMod held this message. Check channel chat before making another wish.'
                  : reason.includes('duplicate') ? 'Twitch stopped a duplicate chat message. Check chat before making another wish.'
                    : reason.includes('slow') ? 'Twitch slow mode stopped this message. Wait before making another wish.'
                      : 'Twitch did not post this wish. Check the channel chat rules before trying again.';
                return { kind: 'failure', reason: 'chat-dropped', message };
              }
              const message = TokenSchema.safeParse(result.message_id);
              if (!message.success) throw unavailable();
              const sent: Extract<ForgeChatWish, { status: 'sent' }> = { requestId: body.requestId, kingdomId: body.kingdomId, status: 'sent', updatedAt: now(),
                messageId: message.data, receiptId: `forge:${createHash('sha256').update(message.data).digest('hex').slice(0, 48)}` };
              // Retain Twitch's exact confirmation even if the surrounding grant transaction loses
              // its COMMIT reply. Only the idempotent receipt binding may be retried, never this send.
              confirmed = sent;
              return { kind: 'sent', wish: sent };
            });
          };
          let attempt = await send();
          if (attempt.kind === 'retry') { sending = false; await prepareGrant(principal.personId, true, false, attempt.accessToken); attempt = await send(); }
          if (attempt.kind === 'sent') wish = await store.bindSent(principal.personId, attempt.wish, now());
          else if (attempt.kind === 'failure') wish = await saveFailure(attempt.reason, attempt.message, attempt.retryAt);
          else wish = await saveFailure('consent-required', consent().message);
        }
      } catch (error) {
        if (confirmed) {
          wish = await store.bindSent(principal.personId, confirmed, now());
        } else if (sending) {
          wish = { requestId: body.requestId, kingdomId: body.kingdomId, status: 'unknown', updatedAt: now(),
            message: 'Twitch did not confirm the send. Check chat before making another wish; this request will not send again.' };
          await store.setWish(principal.personId, wish);
        } else wish = await saveFailure(error instanceof ForgeChatServiceError && error.code === 'consent-required' ? 'consent-required' : 'service-unavailable', unavailable().message);
      }
      return { version: 1 as const, status: 'accepted' as const, wish };
    },
    async observe(observation: ForgeChatObservation): Promise<void> {
      if (observation.origin !== options.origin || !TokenSchema.safeParse(observation.messageId).success) return;
      const projected = { ...observation, ...('message' in observation ? { message: safeMessage(observation.message) } : {}) };
      await store.observe(projected, now());
    },
    async start(): Promise<void> {
      if (stopped || timer) return;
      if (starting) return starting;
      const sweep = () => {
        if (running) return running;
        running = (async () => {
          await store.cleanup(now());
          if (!config) return;
          const people = await store.listGrantPeople();
          let next = 0;
          await Promise.all(Array.from({ length: Math.min(4, people.length) }, async () => {
            while (!stopped && next < people.length) {
              const person = people[next++];
              if (person) await checkGrant(person, true);
            }
          }));
        })()
          .finally(() => { running = undefined; });
        return running;
      };
      starting = (async () => {
        await sweep();
        if (stopped) return;
        timer = setInterval(() => { void sweep().catch(() => {}); }, FORGE_CHAT_LIMITS.validationMs - 5 * 60_000); timer.unref?.();
      })();
      try { await starting; } finally { starting = undefined; }
    },
    async stop(): Promise<void> {
      stopped = true; if (timer) clearInterval(timer); timer = undefined;
      await Promise.allSettled([...pending, ...(running ? [running] : []), ...(starting ? [starting] : [])]);
    },
  };
  function tracked<A extends unknown[], R>(action: (...args: A) => Promise<R>): (...args: A) => Promise<R> {
    return (...args) => {
      if (stopped) return Promise.reject(unavailable());
      const result = action(...args);
      pending.add(result);
      void result.finally(() => pending.delete(result)).catch(() => {});
      return result;
    };
  }
  return { ...service, status: tracked(service.status), authorize: tracked(service.authorize), callback: tracked(service.callback),
    revoke: tracked(service.revoke), wish: tracked(service.wish), observe: tracked(service.observe) };
}
export type ForgeChatService = ReturnType<typeof createForgeChatService>;
