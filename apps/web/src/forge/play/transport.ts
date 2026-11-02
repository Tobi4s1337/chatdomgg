import {
  FORGE_CHAT_ROUTES, ForgeChatAuthorizeReplySchema, ForgeChatAuthorizeRequestSchema, ForgeChatErrorSchema,
  ForgeChatStatusReplySchema, ForgeChatStatusRequestSchema, ForgeChatWishReplySchema, ForgeChatWishRequestSchema,
  type ForgeChatError, type ForgeChatStatusReply, type ForgeChatWish, type KingdomId,
} from '@chatdom/shared';
import { REALM_AUTH_ROUTES, RealmSessionReplySchema } from '@chatdom/shared/realm';

export interface ForgeTransport {
  session(signal?: AbortSignal): Promise<{ readonly resumeScope: string } | null>;
  status(kingdomId: KingdomId, requestId?: string, signal?: AbortSignal, expectedScope?: string): Promise<ForgeChatStatusReply>;
  authorize(kingdomId: KingdomId, signal?: AbortSignal, expectedScope?: string): Promise<string>;
  wish(kingdomId: KingdomId, requestId: string, words: string, signal?: AbortSignal, expectedScope?: string): Promise<ForgeChatWish>;
}

/** An ambiguous send must be recovered by status for its existing UUID, never another POST. */
export class ForgeTransportError extends Error {
  constructor(
    readonly code: ForgeChatError['code'] | 'invalid-response' | 'connection-lost',
    message: string,
    readonly ambiguous = false,
    readonly retryAt?: number,
  ) { super(message); this.name = 'ForgeTransportError'; }
}

const PRIVATE: RequestInit = { credentials: 'same-origin', cache: 'no-store', redirect: 'error' };
const UNREADABLE = 'The Forge answered in a way we could not read. Check your wish status before trying again.';

async function request(path: string, init: RequestInit, ambiguous = false): Promise<unknown> {
  let response: Response;
  try { response = await fetch(path, { ...PRIVATE, ...init }); }
  catch (error) {
    if (init.signal?.aborted) throw error;
    throw new ForgeTransportError('connection-lost', ambiguous
      ? 'The reply was lost. Your wish may already be in Twitch chat. Checking its status will not send it again.'
      : 'The Forge cannot be reached right now.', ambiguous);
  }
  const contentType = response.headers.get('content-type')?.split(';')[0]?.trim() ?? '';
  if (!/^application\/(?:[\w.-]+\+)?json$/i.test(contentType)) {
    throw new ForgeTransportError('invalid-response', UNREADABLE, ambiguous);
  }
  let body: unknown;
  try { body = await response.json(); }
  catch { throw new ForgeTransportError('invalid-response', UNREADABLE, ambiguous); }
  if (!response.ok) {
    const parsed = ForgeChatErrorSchema.safeParse(body);
    if (parsed.success) throw new ForgeTransportError(parsed.data.code, parsed.data.message,
      ambiguous && response.status >= 500, parsed.data.retryAt);
    throw new ForgeTransportError('invalid-response', UNREADABLE, ambiguous);
  }
  return body;
}

async function readSession(signal?: AbortSignal) {
  const parsed = RealmSessionReplySchema.safeParse(await request(REALM_AUTH_ROUTES.session,
    { method: 'GET', headers: { Accept: 'application/json' }, ...(signal ? { signal } : {}) }));
  if (!parsed.success) throw new ForgeTransportError('invalid-response', 'Your Chatdom session could not be read. Reload before making a wish.');
  if (parsed.data.status === 'authenticated' && parsed.data.expiresAt <= Date.now()) {
    throw new ForgeTransportError('unauthenticated', 'Your visit has ended. Sign in with Twitch again.');
  }
  return parsed.data;
}

async function post(path: string, body: unknown, signal?: AbortSignal, send = false, expectedScope?: string): Promise<unknown> {
  const current = await readSession(signal);
  if (current.status !== 'authenticated') throw new ForgeTransportError('unauthenticated', 'Sign in with Twitch before making your wish.');
  if (expectedScope !== undefined && current.resumeScope !== expectedScope) {
    throw new ForgeTransportError('unauthenticated', 'Your Chatdom session changed. Reopen the Forge before making a wish. Your words have not been sent.');
  }
  // Closing the panel can cancel the session preflight, but cannot retract a posted chat message.
  signal?.throwIfAborted();
  return request(path, { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json',
    'X-CSRF-Token': current.csrfToken }, body: JSON.stringify(body), ...(!send && signal ? { signal } : {}) }, send);
}

/** Same-origin HTTP only: no realm intents, authority reservation, retries, storage or navigation. */
export const browserForgeTransport: ForgeTransport = {
  async session(signal) {
    const current = await readSession(signal);
    return current.status === 'authenticated' ? { resumeScope: current.resumeScope } : null;
  },
  async status(kingdomId, requestId, signal, expectedScope) {
    const input = ForgeChatStatusRequestSchema.safeParse({ version: 1, kingdomId, ...(requestId !== undefined ? { requestId } : {}) });
    if (!input.success) throw new ForgeTransportError('invalid-request', 'This wish status request could not be read.');
    const current = await readSession(signal);
    if (expectedScope !== undefined && (current.status !== 'authenticated' || current.resumeScope !== expectedScope)) {
      throw new ForgeTransportError('unauthenticated', 'Your Chatdom session changed. Reopen the Forge to read your wish status.');
    }
    const query = new URLSearchParams({ kingdomId });
    if (input.data.requestId) query.set('requestId', input.data.requestId);
    const parsed = ForgeChatStatusReplySchema.safeParse(await request(`${FORGE_CHAT_ROUTES.status}?${query}`,
      { method: 'GET', headers: { Accept: 'application/json' }, ...(signal ? { signal } : {}) }));
    if (!parsed.success || parsed.data.kingdomId !== kingdomId
      || (requestId !== undefined && parsed.data.wish !== null && parsed.data.wish.requestId !== requestId)) {
      throw new ForgeTransportError('invalid-response', UNREADABLE);
    }
    return parsed.data;
  },
  async authorize(kingdomId, signal, expectedScope) {
    const input = ForgeChatAuthorizeRequestSchema.safeParse({ version: 1, kingdomId });
    if (!input.success) throw new ForgeTransportError('invalid-request', 'This chat permission request could not be read.');
    const parsed = ForgeChatAuthorizeReplySchema.safeParse(await post(FORGE_CHAT_ROUTES.authorize, input.data, signal, false, expectedScope));
    if (!parsed.success) throw new ForgeTransportError('invalid-response', 'The Forge could not open Twitch chat permission.');
    return parsed.data.authorizationUrl;
  },
  async wish(kingdomId, requestId, words, signal, expectedScope) {
    const input = ForgeChatWishRequestSchema.safeParse({ version: 1, kingdomId, requestId, words });
    if (!input.success) throw new ForgeTransportError('invalid-request', 'Keep your wish within the chat limit and on one line. Your words have not been sent.');
    const parsed = ForgeChatWishReplySchema.safeParse(await post(FORGE_CHAT_ROUTES.wish, input.data, signal, true, expectedScope));
    if (!parsed.success || parsed.data.wish.kingdomId !== kingdomId || parsed.data.wish.requestId !== requestId) {
      throw new ForgeTransportError('invalid-response', UNREADABLE, true);
    }
    return parsed.data.wish;
  },
};
