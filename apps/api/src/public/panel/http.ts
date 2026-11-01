import type { IncomingMessage, ServerResponse } from 'node:http';
import { createPassportHttp } from '../../passport/http';
import { createPassportReader, type PassportReadFault } from '../../passport/read';
import type { KingdomId, PersonId } from '../../citizen-card/contracts';
import { PANEL_ROUTES } from './contracts';
import type { PanelAuthority } from './reading';
import { extensionKey, PanelTokenError, verifyPanelToken } from './token';

/**
 * The Chatdom panel's Extension backend on the public origin. Every request carries the token Twitch's Helper gave
 * the panel; the channel and the viewer come from that verified token alone, never from the body or the URL.
 *
 * - `POST /api/panel/v1/reading`: the kingdom under the video and the viewer's own card and home.
 * - `POST /api/panel/v1/passport`: the viewer's raid passport through the passport reader (spec 45), whose card
 *   disclosure runs on every read.
 *
 * Only the extension's own origin (`https://<client id>.ext-twitch.tv`) may call, with CORS for exactly that origin.
 */
export interface PanelHttpOptions {
  readonly authority: PanelAuthority;
  readonly origin: 'live' | 'simulated';
  readonly extension: { readonly clientId: string; readonly secret: string } | null;
  /** Further allowed page origins (a capture rig's loopback server). Never `*`. */
  readonly extraOrigins?: readonly string[];
  readonly report?: (line: string) => void;
}

const BODY_LIMIT = 2_048;
const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };

export function createPanelHttp(options: PanelHttpOptions) {
  const report = options.report ?? (line => console.error(line));
  const key = options.extension ? extensionKey(options.extension.secret) : null;
  const allowed = new Set([...(options.extension ? [`https://${options.extension.clientId}.ext-twitch.tv`] : []), ...(options.extraOrigins ?? [])]);
  const empty = { revision: 0, items: [], nextCursor: null } as const;
  const reader = createPassportReader({
    origin: options.origin,
    card: (citizen, signal) => options.authority.cardSource(citizen, Date.now(), signal),
    // No Gate stamps, visits, bonds or keepsakes are recorded for anyone yet: each answers its honest empty page.
    stamps: async () => ({ hidden: false, revision: 0, stamps: [], nextCursor: null }),
    visits: async () => empty, bonds: async () => empty, keepsakes: async () => empty,
    kingdoms: async () => new Map(), roads: async () => new Map(), gifts: async () => [],
  }, { report: (fault: PassportReadFault) => report(`panel: passport read unavailable (${fault.kind})`) });

  const cors = (request: IncomingMessage): Record<string, string> => {
    const origin = request.headers.origin;
    return typeof origin === 'string' && allowed.has(origin)
      ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin', 'Access-Control-Max-Age': '600' } : { Vary: 'Origin' };
  };
  const send = (request: IncomingMessage, response: ServerResponse, status: number, body: unknown) =>
    response.writeHead(status, { ...JSON_HEADERS, ...cors(request) }).end(JSON.stringify(body));
  const refuse = (request: IncomingMessage, response: ServerResponse, status: number, message: string) =>
    send(request, response, status, { version: 1, status: status === 401 ? 'unauthenticated' : status === 503 ? 'unavailable' : 'refused', message });

  const viewerOf = async (request: IncomingMessage) => {
    if (!key) throw new PanelTokenError('The panel backend is not configured');
    const authorization = request.headers.authorization;
    return verifyPanelToken(typeof authorization === 'string' ? authorization : null, key);
  };

  const passportHttp = createPassportHttp({
    reader, clock: Date.now, origins: [...allowed],
    subject: async request => {
      const authorization = request.headers.get('authorization');
      if (!key) return null;
      try {
        const viewer = await verifyPanelToken(authorization, key);
        return viewer.kind === 'shared' ? { personId: viewer.personId as PersonId, kingdomId: viewer.channelId as KingdomId } : null;
      } catch { return null; }
    },
  });

  return async function handle(request: IncomingMessage, response: ServerResponse, pathname: string): Promise<void> {
    if (request.method === 'OPTIONS') {
      const origin = request.headers.origin;
      if (typeof origin !== 'string' || !allowed.has(origin)) { response.writeHead(403, { Vary: 'Origin' }).end(); return; }
      response.writeHead(204, { ...cors(request), 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'authorization, content-type, accept' }).end();
      return;
    }
    if (pathname !== PANEL_ROUTES.reading && pathname !== PANEL_ROUTES.passport) { refuse(request, response, 404, 'No such panel route'); return; }
    if (request.method !== 'POST') { response.setHeader('Allow', 'POST'); refuse(request, response, 405, 'Use POST for this route'); return; }
    const origin = request.headers.origin;
    if (typeof origin === 'string' && !allowed.has(origin)) { refuse(request, response, 403, 'This request did not come from the Chatdom panel'); return; }
    if (!key) { refuse(request, response, 503, 'The panel backend is not configured on this host yet.'); return; }

    // Bodies are tiny (`{}` or one passport read); anything larger is not a panel request.
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of request as AsyncIterable<Buffer>) {
      size += chunk.length;
      if (size > BODY_LIMIT) { refuse(request, response, 413, 'This request is too large'); return; }
      chunks.push(chunk);
    }
    const body = Buffer.concat(chunks);

    if (pathname === PANEL_ROUTES.reading) {
      let viewer;
      try { viewer = await viewerOf(request); }
      catch (error) { refuse(request, response, 401, error instanceof PanelTokenError ? error.message : 'The Twitch panel token did not verify'); return; }
      try { send(request, response, 200, await options.authority.reading(viewer)); }
      catch (error) {
        report(`panel: reading failed (${error instanceof Error ? error.name : 'unknown'})`);
        refuse(request, response, 503, 'The kingdom is not answering the panel right now. Try again shortly.');
      }
      return;
    }

    const controller = new AbortController();
    response.on('close', () => controller.abort());
    const headers = new Headers();
    for (const name of ['authorization', 'content-type', 'origin'] as const) {
      const value = request.headers[name];
      if (typeof value === 'string') headers.set(name, value);
    }
    const answer = await passportHttp.handle(new Request(`http://panel.invalid${pathname}`, { method: 'POST', headers, body, signal: controller.signal }));
    response.writeHead(answer.status, { ...Object.fromEntries(answer.headers), ...cors(request) }).end(Buffer.from(await answer.arrayBuffer()));
  };
}
