import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Pool } from 'pg';
import type { RealmAuthConfig } from '../realm-auth/config';
import { csrfFor } from '../realm-auth/secrets';
import { dockMutationAllowed, dockPrincipal } from '../dock/auth';

/**
 * The session authority for a streamer's own place on the Atlas (decision 39: every channel, with a self-serve hide).
 *
 *   GET  /api/atlas/me[?preview=<map id>]   who is signed in, and their own channel's visibility (and, while they hid
 *                                          it, their own card as the map would draw it)
 *   POST /api/atlas/me/hide                hide the signed-in broadcaster's own channel
 *   POST /api/atlas/me/show                show it again
 *
 * The channel is always the session's own person: a signed-in Twitch user is the broadcaster of exactly one channel,
 * their own, so nothing the browser sends can name another. Mutations need the page's exact origin and the
 * session's CSRF token. Replies are `no-store` and vary on the cookie, so nothing personal enters a shared cache.
 * Only LIVE sessions reach the Atlas; a SIMULATED sign-in never hides a real channel.
 *
 * The Atlas service's private listener does the work (`/v1/channels/<id>/hide|unhide|visibility`, bearer token).
 * Without `ATLAS_PRIVATE_URL` and `ATLAS_INGEST_TOKEN` the routes answer `unavailable` and the map offers no button.
 */
export interface AtlasOwnerBackend {
  visibility(channelId: string, preview: string | null): Promise<unknown>;
  act(channelId: string, act: 'hide' | 'unhide'): Promise<unknown>;
}
type Options = { pool: Pool; config: RealmAuthConfig; backend?: AtlasOwnerBackend | null; env?: NodeJS.ProcessEnv };

export const ATLAS_OWNER_PATHS = ['/api/atlas/me', '/api/atlas/me/hide', '/api/atlas/me/show'] as const;
const PREVIEW = /^pv-[0-9]{8}T[0-9]{6}Z-[a-f0-9]{12}$/;
const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', Vary: 'Cookie' };
function reply(res: ServerResponse, code: number, body: unknown) { res.writeHead(code, headers).end(JSON.stringify(body)); }

/** The Atlas service's private listener, from the environment; null when it is not configured. */
export function atlasOwnerBackend(env: NodeJS.ProcessEnv = process.env): AtlasOwnerBackend | null {
  const base = env.ATLAS_PRIVATE_URL;
  const token = env.ATLAS_INGEST_TOKEN;
  if (!base || !token) return null;
  let origin: URL;
  try { origin = new URL(base); } catch { return null; }
  if (origin.protocol !== 'http:' && origin.protocol !== 'https:') return null;
  const call = async (path: string, init: { method: 'GET' | 'POST'; body?: unknown }) => {
    const response = await fetch(new URL(path, origin), {
      method: init.method, redirect: 'error', signal: AbortSignal.timeout(5_000),
      headers: { authorization: `Bearer ${token}`, ...(init.body ? { 'content-type': 'application/json' } : {}) },
      ...(init.body ? { body: JSON.stringify(init.body) } : {}),
    });
    const text = await response.text();
    if (!response.ok || text.length > 64_000) throw new Error('atlas unavailable');
    return JSON.parse(text) as unknown;
  };
  return {
    visibility: (id, preview) => call(`/v1/channels/${id}/visibility${preview ? `?preview=${preview}` : ''}`, { method: 'GET' }),
    act: (id, act) => call(`/v1/channels/${id}/${act}`, { method: 'POST', body: { version: 1, at: Date.now() } }),
  };
}

type Visibility = { hidden: boolean; onMap: boolean; card: unknown };
/** Only the fields the browser needs, checked; anything else from the private side never passes. */
function visibilityOf(value: unknown, channelId: string): Visibility | null {
  const v = value as { kingdomId?: unknown; hidden?: unknown; onMap?: unknown; card?: unknown } | null;
  if (!v || v.kingdomId !== channelId || typeof v.hidden !== 'boolean' || typeof v.onMap !== 'boolean') return null;
  return { hidden: v.hidden, onMap: v.onMap, card: v.card && typeof v.card === 'object' ? v.card : null };
}

/** Returns false for routes outside the Atlas owner's own. */
export async function handleAtlasOwner(req: IncomingMessage, res: ServerResponse, options: Options): Promise<boolean> {
  const url = new URL(req.url ?? '/', 'http://api.invalid');
  const route = ATLAS_OWNER_PATHS.find(path => path === url.pathname);
  if (!route) return false;
  const isRead = route === '/api/atlas/me';
  if (req.method !== (isRead ? 'GET' : 'POST')) { res.setHeader('Allow', isRead ? 'GET' : 'POST'); reply(res, 405, { version: 1, status: 'refused' }); return true; }
  const { config, pool } = options;
  try {
    const auth = await dockPrincipal(pool, config.mode, config.secureCookies, req.headers.cookie);
    if (!auth) { reply(res, isRead ? 200 : 401, { version: 1, status: 'anonymous' }); return true; }
    const channelId = auth.principal.personId;
    const csrfToken = csrfFor(auth.handle);
    const backend = config.mode === 'live' ? options.backend === undefined ? atlasOwnerBackend(options.env) : options.backend : null;
    if (!backend) { reply(res, isRead ? 200 : 503, { version: 1, status: 'unavailable', channelId }); return true; }
    if (isRead) {
      const preview = url.searchParams.get('preview');
      if ([...url.searchParams.keys()].some(key => key !== 'preview') || (preview !== null && !PREVIEW.test(preview))) { reply(res, 400, { version: 1, status: 'refused' }); return true; }
      const state = visibilityOf(await backend.visibility(channelId, preview), channelId);
      if (!state) { reply(res, 200, { version: 1, status: 'unavailable', channelId }); return true; }
      reply(res, 200, { version: 1, status: 'broadcaster', channelId, ...state, csrfToken });
      return true;
    }
    if (!dockMutationAllowed(req.headers, config.publicOrigin, auth.handle)) { reply(res, 403, { version: 1, status: 'refused' }); return true; }
    if (url.search) { reply(res, 400, { version: 1, status: 'refused' }); return true; }
    const state = visibilityOf(await backend.act(channelId, route.endsWith('/hide') ? 'hide' : 'unhide'), channelId);
    if (!state) { reply(res, 503, { version: 1, status: 'unavailable', channelId }); return true; }
    reply(res, 200, { version: 1, status: 'broadcaster', channelId, hidden: state.hidden, onMap: state.onMap, card: null, csrfToken });
    return true;
  } catch {
    reply(res, 503, { version: 1, status: 'unavailable' });
    return true;
  }
}
