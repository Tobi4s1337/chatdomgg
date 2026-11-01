import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Pool } from 'pg';
import type { RealmAuthConfig } from '../realm-auth/config';
import { csrfFor } from '../realm-auth/secrets';
import { dockMutationAllowed, dockPrincipal, type DockPrincipal } from './auth';
import { DockActionSchema, DockOutcomeSchema, DockStateSchema, type DockAction, type DockOutcome, type DockState } from './contracts';

/** The bridge authenticates the actor and atomically rechecks role, revision, eligibility and idempotency at commit.
 * Accepted means delivered to the live stream; unknown means the outcome cannot be established. */
export interface DockBackend {
  status(principal: DockPrincipal, kingdomId: string): Promise<DockState | null>;
  action(principal: DockPrincipal, action: DockAction): Promise<DockOutcome>;
}
type Options = { pool: Pool; config: RealmAuthConfig; backend?: DockBackend };
const SIGN_IN = '/api/realm/auth/start?returnTo=%2Fdock';
const numeric = /^[1-9][0-9]{0,31}$/;
const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', Vary: 'Cookie' };
function reply(res: ServerResponse, code: number, body: unknown) { res.writeHead(code, headers).end(JSON.stringify(body)); }
function statusBase(config: RealmAuthConfig, status: string, message: string) {
  return { version: 1, status, mode: config.mode === 'live' ? 'LIVE' : 'SIMULATED', message, signInUrl: SIGN_IN };
}
function bridge(config: RealmAuthConfig): DockBackend | null {
  const address = process.env.DOCK_REALM_URL;
  if (!address || !config.internalSecret) return null;
  let base: URL;
  try { base = new URL(address); } catch { return null; }
  if (base.username || base.password || base.search || base.hash || (base.protocol !== 'https:' && !(base.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)))) return null;
  const call = async (path: string, body: unknown) => {
    const url = new URL(path, base);
    const response = await fetch(url, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(5000), headers: { 'content-type': 'application/json', authorization: `Bearer ${config.internalSecret}` }, body: JSON.stringify(body) });
    if (!response.ok) throw new Error('bridge unavailable');
    const reader = response.body?.getReader();
    if (!reader) throw new Error('empty bridge response');
    const chunks: Uint8Array[] = []; let size = 0;
    for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength; if (size > 256_000) { await reader.cancel(); throw new Error('bridge response too large'); } chunks.push(part.value); }
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  };
  return {
    async status(principal, kingdomId) {
      const result = await call('/internal/dock/status', { version: 1, origin: config.mode, principal, kingdomId });
      if (result === null) return null;
      return DockStateSchema.parse(result);
    },
    async action(principal, action) { return DockOutcomeSchema.parse(await call('/internal/dock/action', { version: 1, origin: config.mode, principal, action })); },
  };
}
function visibleState(state: DockState): DockState {
  return state.principal.role === 'moderator'
    ? { ...state, capabilities: state.capabilities.map(item => ({ ...item, allowed: false, reason: 'Only the broadcaster can perform royal acts.' })) } : state;
}
function validState(state: DockState, personId: string, kingdomId: string): boolean {
  return state.kingdom.id === kingdomId && (state.principal.role !== 'broadcaster' || personId === kingdomId);
}
async function body(req: IncomingMessage): Promise<unknown> {
  if (!/^application\/json(?:;|$)/i.test(typeof req.headers['content-type'] === 'string' ? req.headers['content-type'] : '')) throw new Error('json');
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of req) { const bytes = Buffer.from(chunk); size += bytes.length; if (size > 4096) throw new Error('size'); chunks.push(bytes); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}
/** Returns false for routes outside the dock. */
export async function handleDock(req: IncomingMessage, res: ServerResponse, options: Options): Promise<boolean> {
  const url = new URL(req.url ?? '/', 'http://api.invalid');
  if (url.pathname !== '/api/dock/status' && url.pathname !== '/api/dock/actions') return false;
  const { config, pool } = options;
  const isStatus = url.pathname.endsWith('/status');
  if (req.method !== (isStatus ? 'GET' : 'POST')) { res.setHeader('Allow', isStatus ? 'GET' : 'POST'); reply(res, 405, { version: 1, status: 'refused', message: 'Method not allowed.' }); return true; }
  try {
    const auth = await dockPrincipal(pool, config.mode, config.secureCookies, req.headers.cookie);
    if (!auth) { reply(res, 401, isStatus ? statusBase(config, 'anonymous', 'Sign in with Twitch to open the dock.') : { version: 1, status: 'refused', message: 'Sign in with Twitch to open the dock.' }); return true; }
    const backend = options.backend ?? bridge(config);
    if (!backend) { reply(res, 503, isStatus ? statusBase(config, 'unavailable', 'The kingdom is not connected to the dock yet.') : { version: 1, status: 'unavailable', message: 'The kingdom is not connected to the dock yet.' }); return true; }
    if (isStatus) {
      const requested = url.searchParams.get('kingdom') ?? auth.principal.personId;
      if (!numeric.test(requested) || [...url.searchParams.keys()].some(key => key !== 'kingdom') || url.searchParams.getAll('kingdom').length > 1) { reply(res, 400, statusBase(config, 'forbidden', 'Choose a valid kingdom.')); return true; }
      const state = await backend.status(auth.principal, requested);
      if (!state || !validState(DockStateSchema.parse(state), auth.principal.personId, requested)) { reply(res, 403, statusBase(config, 'forbidden', 'This dock is for the broadcaster and their moderators.')); return true; }
      reply(res, 200, { ...statusBase(config, 'ready', 'Your kingdom is connected.'), ...visibleState(state), csrfToken: csrfFor(auth.handle) }); return true;
    }
    if (!dockMutationAllowed(req.headers, config.publicOrigin, auth.handle)) { reply(res, 403, { version: 1, status: 'refused', message: 'Reload the dock and try again.' }); return true; }
    let parsed;
    try { parsed = DockActionSchema.safeParse(await body(req)); } catch { parsed = null; }
    if (!parsed?.success) { reply(res, 400, { version: 1, status: 'refused', message: 'This action is malformed.' }); return true; }
    const action = parsed.data;
    const state = await backend.status(auth.principal, action.kingdomId);
    if (!state || !validState(DockStateSchema.parse(state), auth.principal.personId, action.kingdomId)) { reply(res, 403, { version: 1, status: 'refused', message: 'This action is not available to you.' }); return true; }
    const allowed = state.capabilities.some(item => item.kind === action.kind && item.allowed);
    const target = action.targetId;
    const validTarget = action.kind === 'raid-welcome' ? state.raids.some(item => item.id === target)
      : action.kind === 'citizen-crown' || action.kind === 'citizen-knight' ? state.citizens.some(item => item.id === target)
        : action.kind === 'moment-play' ? state.moments.some(item => item.id === target && item.available)
          : action.kind === 'undo' ? !!target : target === undefined;
    if (!allowed || state.principal.role !== 'broadcaster' || !validTarget || state.revision !== action.expectedRevision) {
      reply(res, 409, { version: 1, status: 'refused', message: 'The kingdom has changed or this action is not available. Refresh the dock.' }); return true;
    }
    // No automatic retry: a lost reply may follow a delivered command. The realm owns idempotency.
    let outcome: DockOutcome;
    try { outcome = DockOutcomeSchema.parse(await backend.action(auth.principal, action)); }
    catch { outcome = { status: 'unknown', message: 'The kingdom may have received this action. Check the stream before trying again.' }; }
    if (outcome.status === 'accepted' && (outcome.witness?.actionId !== action.id || outcome.witness.kingdomId !== action.kingdomId || outcome.witness.origin !== config.mode)) outcome = { status: 'unknown', message: 'The stream delivery could not be verified. Check the stream.' };
    if (outcome.state && !validState(outcome.state, auth.principal.personId, action.kingdomId)) outcome = { status: 'unknown', message: 'The action outcome could not be verified. Check the stream.' };
    if (outcome.state) outcome = { ...outcome, state: visibleState(outcome.state) };
    reply(res, outcome.status === 'accepted' ? 200 : outcome.status === 'refused' ? 409 : 503, { version: 1, ...outcome }); return true;
  } catch { reply(res, 503, isStatus ? statusBase(config, 'unavailable', 'The kingdom cannot be reached right now.') : { version: 1, status: 'unavailable', message: 'The kingdom cannot be reached right now.' }); return true; }
}
