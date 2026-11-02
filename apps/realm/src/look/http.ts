import type { uWebSocketsTransport } from '@colyseus/uwebsockets-transport';
import { KingdomIdSchema, REALM_LOOK_ROUTES, RealmCitizenFactsSchema, type KingdomId, type PersonId, type RealmCitizenFacts } from '@chatdom/shared';
import type { CitizenFacts } from './citizen';
import { canonicalJson } from '../persistence/codec';
import type { LookSessions } from './ports';
import { sameSecret } from './session';
import { LOOK_REASONS, refusal, type LookSaveOutcome, type LookStore } from './store';
import { LOOK_LIMITS, isSavedLookToken, lookTokenOf } from './token';

type App = uWebSocketsTransport['app'];
type Response = Parameters<Parameters<App['get']>[1]>[0];
type Headers = Readonly<Record<string, string>>;

const STATUS: Readonly<Record<number, string>> = {
  200: '200 OK', 304: '304 Not Modified', 400: '400 Bad Request', 401: '401 Unauthorized', 403: '403 Forbidden', 404: '404 Not Found',
  413: '413 Content Too Large', 422: '422 Unprocessable Content', 429: '429 Too Many Requests', 503: '503 Service Unavailable',
};
const PRIVATE: Headers = { 'Cache-Control': 'no-store' };
/** The panel and the card read recipes from other origins; nothing about a recipe is private. */
const PUBLIC: Headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Expose-Headers': 'ETag' };
const IMMUTABLE = 'public, max-age=31536000, immutable';
/** A starter id is named by content, which a deploy may retune; a saved token can never change meaning. */
const STARTER = 'public, max-age=3600';

function write(res: Response, status: number, headers: Headers, body?: unknown) {
  res.cork(() => {
    res.writeStatus(STATUS[status] ?? '503 Service Unavailable').writeHeader('X-Content-Type-Options', 'nosniff');
    for (const [name, value] of Object.entries(headers)) res.writeHeader(name, value);
    if (body === undefined) { res.end(); return; }
    res.writeHeader('Content-Type', 'application/json; charset=utf-8').end(JSON.stringify(body));
  });
}

/** A uWS response answered at most once, and never after the client has gone. */
function lifetime(res: Response) {
  let open = true;
  res.onAborted(() => { open = false; });
  return {
    live: () => open,
    send(status: number, headers: Headers, body?: unknown) { if (open) { open = false; write(res, status, headers, body); } },
  };
}

/**
 * The look routes on the realm's own HTTP app (the gateway publishes `/api/realm/looks/…`). The recipe read is public
 * and immutable; `me` reads and writes only the signed-in session's person, and a write must carry that session's
 * CSRF token. uWS request objects are read synchronously and never escape their callback.
 */
export function mountLookRoutes(app: App, input: {
  readonly store: LookStore;
  readonly sessions: LookSessions;
  /** The card's facts, added to `GET /me` when a kingdom is asked; a failure leaves them out and never fails the reply. */
  readonly citizen?: CitizenFacts;
  readonly log?: (line: string) => void;
}): void {
  const { store, sessions, citizen } = input, log = input.log ?? (() => {});

  /** The session's own facts, or null: they are a courtesy on the reply, so trouble reading them is only logged. */
  const factsOf = async (personId: PersonId, kingdomId: KingdomId | null): Promise<RealmCitizenFacts | null> => {
    if (!citizen || !kingdomId) return null;
    try {
      const facts = await citizen.facts(personId, kingdomId);
      if (facts === null) return null;
      const checked = RealmCitizenFactsSchema.safeParse(facts);
      if (!checked.success) { log('citizen facts left out: they did not fit the contract'); return null; }
      return checked.data;
    } catch (error) { log(`citizen facts unavailable: ${(error as Error).name}`); return null; }
  };

  app.get(REALM_LOOK_ROUTES.recipe, (res, req) => {
    const token = req.getParameter(0) ?? '';
    if (token === 'me') { readMine(res, req.getHeader('cookie'), req.getQuery('kingdom')); return; }
    const etagAsked = req.getHeader('if-none-match'), life = lifetime(res);
    void store.recipe(token).then(outcome => {
      const send = life.send;
      if (outcome.status === 'malformed') { send(400, { ...PUBLIC, 'Cache-Control': 'no-store' }, { version: 1, status: 'refused', message: 'That is not a look token.' }); return; }
      if (outcome.status === 'missing') { send(404, { ...PUBLIC, 'Cache-Control': 'no-store' }, { version: 1, status: 'missing', message: 'No one has saved that look.' }); return; }
      const etag = `"${isSavedLookToken(token) ? token : `${token}.${lookTokenOf(canonicalJson(outcome.reply.look)).slice(3)}`}"`;
      const headers = { ...PUBLIC, 'Cache-Control': outcome.immutable ? IMMUTABLE : STARTER, ETag: etag };
      if (etagAsked.split(',').map(tag => tag.trim()).includes(etag)) send(304, headers);
      else send(200, headers, outcome.reply);
    }, error => {
      log(`look recipe read failed: ${(error as Error).name}`);
      life.send(503, { ...PUBLIC, 'Cache-Control': 'no-store' }, { version: 1, status: 'unavailable', message: LOOK_REASONS.unavailable });
    });
  });

  function readMine(res: Response, cookie: string, rawKingdom: string | undefined) {
    const life = lifetime(res);
    let kingdomId: KingdomId | null = null;
    if (rawKingdom !== undefined && rawKingdom !== '') {
      const parsed = KingdomIdSchema.safeParse(rawKingdom);
      if (!parsed.success) { life.send(400, PRIVATE, { version: 1, status: 'refused', message: 'That is not a kingdom.' }); return; }
      kingdomId = parsed.data;
    }
    void (async () => {
      const session = await sessions.resolve(cookie);
      if (!session) return { version: 1, status: 'anonymous' } as const;
      const [reply, facts] = await Promise.all([store.mine(session.personId, kingdomId), factsOf(session.personId, kingdomId)]);
      return facts && reply.status !== 'anonymous' ? { ...reply, citizen: facts } : reply;
    })().then(body => life.send(200, PRIVATE, body), error => {
      log(`look read failed: ${(error as Error).name}`);
      life.send(503, PRIVATE, { version: 1, status: 'unavailable', message: LOOK_REASONS.unavailable });
    });
  }

  app.put(REALM_LOOK_ROUTES.mine, (res, req) => {
    const cookie = req.getHeader('cookie'), csrf = req.getHeader('x-csrf-token');
    const contentType = req.getHeader('content-type'), length = Number(req.getHeader('content-length') || '0');
    const life = lifetime(res);
    const answer = (outcome: LookSaveOutcome) => life.send(outcome.status, outcome.status === 429 ? { ...PRIVATE, 'Retry-After': '60' } : PRIVATE, outcome.reply);
    if (!(length <= LOOK_LIMITS.bodyBytes)) { answer({ ...refusal('malformed', 'That look is larger than any look can be, so your look was left as it was.'), status: 413 }); return; }
    let bytes = 0;
    const chunks: Buffer[] = [];
    res.onData((chunk, last) => {
      if (!life.live()) return;
      bytes += chunk.byteLength;
      if (bytes > LOOK_LIMITS.bodyBytes) { answer({ ...refusal('malformed', 'That look is larger than any look can be, so your look was left as it was.'), status: 413 }); return; }
      chunks.push(Buffer.from(chunk.slice(0)));
      if (!last) return;
      const text = Buffer.concat(chunks).toString('utf8');
      void save(text).then(answer, error => { log(`look save failed: ${(error as Error).name}`); answer(refusal('unavailable')); });
    });

    async function save(text: string): Promise<LookSaveOutcome> {
      const session = await sessions.resolve(cookie);
      if (!session) return refusal('unauthenticated');
      if (!csrf || !sameSecret(csrf, session.csrfToken)) return refusal('forbidden');
      if (!/^application\/json(?:\s*;|$)/i.test(contentType)) return refusal('malformed', 'Send your look as JSON; your look was left as it was.');
      let body: unknown;
      try { body = JSON.parse(text); } catch { return refusal('malformed'); }
      return store.save(session.personId, body);
    }
  });
}
