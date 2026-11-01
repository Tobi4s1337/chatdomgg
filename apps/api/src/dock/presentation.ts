import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import { KingdomIdSchema, TokenSchema } from '@chatdom/shared';
import type { RealmAuthConfig } from '../realm-auth/config';
import { dockMutationAllowed, dockPrincipal, type DockSessionPool } from './auth';

const WitnessSchema = z.strictObject({ kingdomId: KingdomIdSchema, streamEventId: TokenSchema,
  presenterToken: z.string().min(32).max(192).regex(/^[A-Za-z0-9_-]+$/) });
export function dockRealmAddress(): URL | null {
  const raw = process.env.DOCK_REALM_URL ?? process.env.CHATDOM_REALM_TARGET;
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.username || url.password || url.search || url.hash || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) return null;
    return url;
  } catch { return null; }
}
const reply = (res: ServerResponse, code: number, status: string, message: string) => {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
    .end(JSON.stringify({ version: 1, status, message }));
};

/** Same-origin bridge: browser data never chooses a principal, origin, realm endpoint or service credential. */
export async function handleDockPresentation(req: IncomingMessage, res: ServerResponse, options: { pool: DockSessionPool; config: RealmAuthConfig }): Promise<boolean> {
  const url = new URL(req.url ?? '/', 'http://api.invalid');
  if (url.pathname !== '/api/dock/presentations' && url.pathname !== '/api/dock/witness') return false;
  const { pool, config } = options;
  const stream = url.pathname.endsWith('/presentations');
  if (req.method !== (stream ? 'GET' : 'POST')) { reply(res, 405, 'refused', 'Method not allowed.'); return true; }
  const base = dockRealmAddress();
  if (!base || !config.internalSecret) { reply(res, 503, 'unavailable', 'The throne is not connected to the kingdom.'); return true; }
  const session = await dockPrincipal(pool, config.mode, config.secureCookies, req.headers.cookie);
  if (!stream) {
    if (!session) { reply(res, 401, 'unauthenticated', 'Sign in to present a royal act.'); return true; }
    if (!dockMutationAllowed(req.headers, config.publicOrigin, session.handle)) { reply(res, 403, 'refused', 'Reload the stream view before presenting an act.'); return true; }
    if (!/^application\/json(?:;|$)/i.test(String(req.headers['content-type'] ?? ''))) { reply(res, 415, 'refused', 'Send JSON.'); return true; }
    const chunks: Buffer[] = []; let bytes = 0;
    for await (const chunk of req) { bytes += chunk.length; if (bytes > 4096) { reply(res, 413, 'refused', 'That acknowledgement is too large.'); return true; } chunks.push(Buffer.from(chunk)); }
    let parsed;
    try { parsed = WitnessSchema.safeParse(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { parsed = null; }
    if (!parsed?.success || url.search) { reply(res, 400, 'refused', 'That acknowledgement is malformed.'); return true; }
    try {
      const response = await fetch(new URL('/internal/dock/witness', base), { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(5000),
        headers: { 'content-type': 'application/json', authorization: `Bearer ${config.internalSecret}` },
        body: JSON.stringify({ version: 1, origin: config.mode, principal: session.principal, ...parsed.data }) });
      const text = await response.text();
      if (text.length > 4096 || !response.headers.get('content-type')?.includes('application/json')) throw new Error('Invalid realm acknowledgement');
      const value: unknown = JSON.parse(text);
      res.writeHead(response.status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(value));
    } catch { reply(res, 503, 'unavailable', 'The kingdom could not confirm this presentation.'); }
    return true;
  }
  const kingdom = KingdomIdSchema.safeParse(url.searchParams.get('kingdom'));
  if (!kingdom.success || url.searchParams.size !== 1 || url.searchParams.getAll('kingdom').length !== 1) { reply(res, 400, 'refused', 'Choose a kingdom to watch.'); return true; }
  const controller = new AbortController();
  const close = () => controller.abort(); res.once('close', close);
  const opening = setTimeout(close, 8000);
  try {
    // Only the broadcaster's independently checked session can request a witness capability.
    const presenter = !!session && session.principal.personId === kingdom.data;
    const response = await fetch(new URL(`/internal/dock/presentations/${kingdom.data}`, base), {
      method: presenter ? 'POST' : 'GET', redirect: 'error', signal: controller.signal,
      headers: { Accept: 'text/event-stream', authorization: `Bearer ${config.internalSecret}`, ...(presenter ? { 'content-type': 'application/json' } : {}) },
      ...(presenter ? { body: JSON.stringify({ version: 1, origin: config.mode, principal: session!.principal, kingdomId: kingdom.data }) } : {}),
    });
    clearTimeout(opening);
    if (!response.ok || !response.headers.get('content-type')?.includes('text/event-stream') || !response.body) throw new Error('Presentation stream unavailable');
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no', 'X-Content-Type-Options': 'nosniff' });
    res.flushHeaders();
    const reader = response.body.getReader();
    for (;;) {
      const part = await reader.read(); if (part.done) break;
      if (!res.write(part.value)) await new Promise<void>((resolve, reject) => {
        const done = () => { res.off('close', ended); resolve(); };
        const ended = () => { res.off('drain', done); reject(new Error('Presenter closed')); };
        res.once('drain', done); res.once('close', ended);
      });
    }
    res.end();
  } catch { if (!res.headersSent) reply(res, 503, 'unavailable', 'The royal acts cannot reach the stream right now.'); else res.end(); }
  finally { clearTimeout(opening); controller.abort(); res.off('close', close); }
  return true;
}
