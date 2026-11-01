import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { createPanelHttp as createReader, type PanelHttpOptions } from '../public/panel/http';
import { extensionKey } from '../public/panel/token';
import { createTwitchUsers, type TwitchUsers } from '../public/panel/twitch-users';
import { verifyViewerToken } from './token';
import { PanelPictures, validWebp } from './pictures';

interface PanelServices {
  realmOrigin: string;
  panelSecret: string | null;
  painterSecret: string | null;
  pictures: PanelPictures;
  users: TwitchUsers;
  fetch?: typeof fetch;
}
const PREFIX = '/api/panel/v1/';
const ID = /^[1-9][0-9]{0,31}$/;
const HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff' };
const hash = (value: string) => createHash('sha256').update(value).digest();
const matches = (actual: string | undefined, secret: string | null) => Boolean(secret && secret.length >= 32 && actual?.startsWith('Bearer ') && timingSafeEqual(hash(actual.slice(7)), hash(secret)));

/** Wrap the existing reading and passport authority; identities and channels only come from verified Extension JWTs. */
export function createPanelHttp(options: PanelHttpOptions, supplied?: PanelServices) {
  const env = process.env;
  const services: PanelServices = supplied ?? {
    realmOrigin: env.PUBLIC_REALM_TARGET ?? env.CHATDOM_REALM_TARGET ?? 'http://127.0.0.1:5173',
    panelSecret: env.REALM_INGRESS_PANEL_SECRET ?? null, painterSecret: env.PANEL_PAINTER_SECRET ?? null,
    pictures: new PanelPictures(env.PANEL_STILL_DIRECTORY ?? '/tmp/chatdom-panel-stills'),
    users: createTwitchUsers(env.TWITCH_CLIENT_ID && env.TWITCH_CLIENT_SECRET ? { clientId: env.TWITCH_CLIENT_ID, clientSecret: env.TWITCH_CLIENT_SECRET } : null),
  };
  const reader = createReader(options), fetcher = services.fetch ?? fetch;
  const key = options.extension ? extensionKey(options.extension.secret) : null;
  const allowed = new Set([...(options.extension ? [`https://${options.extension.clientId}.ext-twitch.tv`] : []), ...(options.extraOrigins ?? [])]);
  const realm = async (path: string, body: unknown): Promise<Record<string, unknown>> => {
    if (!services.panelSecret || services.panelSecret.length < 32) throw new Error('REALM_INGRESS_PANEL_SECRET');
    const response = await fetcher(new URL(path, services.realmOrigin), {
      method: 'POST', headers: { authorization: `Bearer ${services.panelSecret}`, 'content-type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) throw new Error('realm unavailable');
    return response.json() as Promise<Record<string, unknown>>;
  };
  return async (request: IncomingMessage, response: ServerResponse, pathname: string): Promise<void> => {
    if ([`${PREFIX}reading`, `${PREFIX}passport`].includes(pathname)) {
      if (key && request.method !== 'OPTIONS') { try { await verifyViewerToken(request.headers.authorization ?? null, key); } catch { response.writeHead(401, HEADERS).end(JSON.stringify({ version: 1, status: 'unauthenticated' })); return; } }
      return reader(request, response, pathname);
    }
    const origin = request.headers.origin;
    const cors = typeof origin === 'string' && allowed.has(origin) ? { 'access-control-allow-origin': origin, vary: 'Origin' } : { vary: 'Origin' };
    const send = (status: number, body: unknown) => { if (!response.destroyed) response.writeHead(status, { ...HEADERS, ...cors }).end(JSON.stringify(body)); };
    if (request.method === 'OPTIONS') {
      if (!origin || !allowed.has(origin)) { send(403, { status: 'refused' }); return; }
      response.writeHead(204, { ...cors, 'access-control-allow-methods': 'GET, POST', 'access-control-allow-headers': 'authorization, content-type, accept', 'access-control-max-age': '600' }).end(); return;
    }
    if (pathname === `${PREFIX}stills`) {
      if (request.method !== 'POST' || origin || !matches(request.headers.authorization, services.painterSecret)) { send(401, { status: 'refused' }); return; }
      const channel = request.headers['x-chatdom-kingdom-id'], revision = request.headers['x-chatdom-revision'], at = Number(request.headers['x-chatdom-captured-at']);
      const kind = request.headers['x-chatdom-picture-kind'] === 'sketch' ? 'sketch' : 'realm';
      if (typeof channel !== 'string' || !ID.test(channel) || typeof revision !== 'string' || !/^[\w:.-]{1,200}$/.test(revision)
        || !Number.isSafeInteger(at) || at < Date.now() - 3_600_000 || at > Date.now() + 5_000 || request.headers['content-type'] !== 'image/webp') { send(400, { status: 'refused' }); return; }
      const chunks: Buffer[] = []; let size = 0;
      for await (const chunk of request as AsyncIterable<Buffer>) { size += chunk.length; if (size > 60 * 1024) { send(413, { status: 'refused' }); return; } chunks.push(chunk); }
      const bytes = Buffer.concat(chunks);
      if (!validWebp(bytes)) { send(400, { status: 'refused' }); return; }
      try { const stored = await services.pictures.put(channel, bytes, { capturedAt: at, revision, kind }); send(stored ? 201 : 409, { version: 1, status: stored ? 'stored' : 'superseded' }); }
      catch { send(503, { version: 1, status: 'unavailable' }); }
      return;
    }
    if (typeof origin === 'string' && !allowed.has(origin)) { send(403, { version: 1, status: 'refused' }); return; }
    if (!['kingdom', 'light', 'presence', 'pledge', 'picture'].some(name => pathname === PREFIX + name)) { send(404, { status: 'refused' }); return; }
    if (request.method !== (pathname === `${PREFIX}picture` ? 'GET' : 'POST')) { send(405, { status: 'refused' }); return; }
    if (!key) { send(503, { version: 1, status: 'unavailable', message: 'TWITCH_EXTENSION_CLIENT_ID and TWITCH_EXTENSION_SECRET are required.' }); return; }
    let viewer;
    try { viewer = await verifyViewerToken(request.headers.authorization ?? null, key); }
    catch { send(401, { version: 1, status: 'unauthenticated' }); return; }
    if (pathname === `${PREFIX}picture`) {
      const painting = await services.pictures.read(viewer.channelId);
      if (!painting) { send(404, { status: 'unavailable' }); return; }
      response.writeHead(200, { ...cors, 'content-type': 'image/webp', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }).end(painting.bytes); return;
    }
    const chunks: Buffer[] = []; let size = 0;
    for await (const chunk of request as AsyncIterable<Buffer>) { size += chunk.length; if (size > 2048) { send(413, { status: 'refused' }); return; } chunks.push(chunk); }
    let observe = true;
    try {
      const body: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error();
      const entries = Object.entries(body);
      if (entries.length && !(pathname === `${PREFIX}light` && entries.length === 1 && entries[0]![0] === 'observe' && typeof entries[0]![1] === 'boolean')) throw new Error();
      if ('observe' in body) observe = body.observe as boolean;
    }
    catch { send(400, { version: 1, status: 'refused' }); return; }
    try {
      if (pathname === `${PREFIX}kingdom`) {
        const state = await realm('/internal/realm/panel/kingdom', { kingdomId: viewer.channelId });
        const stored = await services.pictures.read(viewer.channelId);
        const picture = stored ? { capturedAt: stored.capturedAt, revision: stored.revision, kind: stored.kind } : null;
        // Only a committed public fact is projected; no interpretation of private observations or rejected words.
        const fact = state.moment as { body?: { kind?: string }; occurredAt?: number } | null;
        const words: Record<string, string> = { raid: 'Guests are arriving at the gate', fireworks: 'Fireworks over the kingdom', feast: 'The kingdom gathers for a feast', battle: 'The kingdom stands together', bell: 'The bell rings over the square', parade: 'A parade crosses the square', train: 'The Hype Train is arriving' };
        const event = state.publicEvent as { type?: string; at?: number } | null;
        const moment = event?.type === 'home' ? 'A home is raised' : event?.type === 'forge' ? 'A new piece leaves the Forge' : fact?.body?.kind ? words[fact.body.kind] ?? null : null;
        send(200, { version: 1, status: state.status, stream: state.stream ?? 'resting', lights: state.lights ?? null, moment, picture, pledges: state.pledges ?? null }); return;
      }
      if (viewer.kind !== 'shared') { send(403, { version: 1, status: 'refused' }); return; }
      if (pathname === `${PREFIX}pledge`) {
        send(200, await realm('/internal/realm/panel/pledge', { kingdomId: viewer.channelId, personId: viewer.personId })); return;
      }
      const person = await services.users.person(viewer.personId);
      if (!person) { send(503, { version: 1, status: 'unavailable', message: 'Twitch has not told us your name just now.' }); return; }
      let claim: Record<string, unknown>;
      if (pathname === `${PREFIX}presence`) {
        const reading = await options.authority.reading(viewer);
        const kind = reading.viewer.kind;
        if (!['citizen', 'guest', 'monarch'].includes(kind)) { send(403, { version: 1, status: 'refused' }); return; }
        const prior = await realm('/internal/realm/panel/presence', { kingdomId: viewer.channelId, personId: viewer.personId });
        if (prior.held === true) { send(200, { version: 1, status: 'held', lit: false }); return; }
        claim = { version: 1, status: kind === 'citizen' ? 'deed' : kind === 'monarch' ? 'castle' : 'guest' };
      } else claim = await realm('/internal/realm/panel/claim', { kingdomId: viewer.channelId, personId: viewer.personId, name: person.displayName });
      if (!['deed', 'guest', 'castle'].includes(String(claim.status))) { send(200, { ...claim, lit: false }); return; }
      const state = await realm('/internal/realm/panel/kingdom', { kingdomId: viewer.channelId });
      if (state.stream !== 'live' || !observe) { send(200, { ...claim, ...(pathname.endsWith('/presence') ? { status: 'accepted' } : {}), lit: false, stream: state.stream ?? 'resting' }); return; }
      await realm('/internal/realm/ingress', { version: 1, observation: {
        version: 1, id: `panel-${randomUUID()}`, kingdomId: viewer.channelId, observedAt: Date.now(), origin: options.origin,
        kind: 'observe', source: 'panel', coverage: 'activity', people: [{ personId: viewer.personId, disclosure: 'named', displayName: person.displayName }],
      } });
      let presence: Record<string, unknown> = {};
      const deadline = Date.now() + 3500;
      do { presence = await realm('/internal/realm/panel/presence', { kingdomId: viewer.channelId, personId: viewer.personId }); if (presence.lit === true || presence.held === true) break; await delay(50); } while (Date.now() < deadline && !response.destroyed);
      send(200, { ...claim, ...(pathname.endsWith('/presence') ? { status: 'accepted' } : {}), lit: presence.lit === true, stream: presence.stream ?? 'live' });
    } catch { send(503, { version: 1, status: 'unavailable', message: 'The kingdom is out of reach. Try again shortly.' }); }
  };
}
