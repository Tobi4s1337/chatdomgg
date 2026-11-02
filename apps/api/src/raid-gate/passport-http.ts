import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Pool } from 'pg';
import { dockMutationAllowed, dockPrincipal } from '../dock/auth';
import type { RealmAuthConfig } from '../realm-auth/config';
import type { PersonId } from './contracts';
import { createPostgresGatePassportStore, type GatePassportStore } from './passport';
import { RAID_PASSPORT_TRAVELS_ROUTE, TravelsBodySchema, TravelsReplySchema } from './passport-contracts';

/**
 * "Hide my travels" for the signed-in holder (RS12). The person is the session's, never the body's or the URL's.
 *
 * - `GET /api/raid-gate/passport/travels`: the choice as it stands.
 * - `POST` the same path with `{ version: 1, travels: 'shown' | 'hidden' }`, same Origin and the session's CSRF token.
 *
 * Both answer the passport disclosure the card's surfaces follow, `{ origin, travels, revision }`, where the revision
 * is the moment of the last change. A POST answers only once the choice is committed, so the clasp moves on an
 * acknowledgement and never on the ask. Every public projection reads the choice afresh (the stamps port and the card
 * source), so nothing has to be invalidated by hand: the next read, page or picture is already closed.
 */
const BODY_BYTES = 256;

interface PassportHttpOptions {
  readonly pool: Pool;
  readonly config: RealmAuthConfig;
  readonly store?: GatePassportStore;
  readonly clock?: () => number;
}
const HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', Vary: 'Cookie' };
const reply = (response: ServerResponse, status: number, body: unknown) => { response.writeHead(status, HEADERS).end(JSON.stringify(body)); };
const refused = (response: ServerResponse, status: number) => reply(response, status, { version: 1,
  status: status === 401 ? 'unauthenticated' : status === 503 ? 'unavailable' : 'refused',
  message: status === 401 ? 'Sign in with Twitch to choose who reads your travels.'
    : status === 503 ? 'Nothing changed: Chatdom could not answer just now.' : 'The change to your travels was refused.' });

export async function handleRaidPassport(request: IncomingMessage, response: ServerResponse, options: PassportHttpOptions): Promise<boolean> {
  const url = new URL(request.url ?? '/', options.config.publicOrigin);
  if (url.pathname !== RAID_PASSPORT_TRAVELS_ROUTE) return false;
  if (url.search) { refused(response, 400); return true; }
  if (request.method !== 'GET' && request.method !== 'POST') { refused(response, 405); return true; }
  const { config, pool } = options;
  try {
    const session = await dockPrincipal(pool, config.mode, config.secureCookies, request.headers.cookie);
    if (!session) { refused(response, 401); return true; }
    const store = options.store ?? createPostgresGatePassportStore({ pool, origin: config.mode });
    const person = session.principal.personId as PersonId;
    const answer = (choice: { hidden: boolean; changedAt: number }) => reply(response, 200, TravelsReplySchema.parse({
      version: 1, origin: config.mode, travels: choice.hidden ? 'hidden' : 'shown', revision: choice.changedAt }));
    if (request.method === 'GET') { answer(await store.choice(person)); return true; }
    if (!dockMutationAllowed(request.headers, config.publicOrigin, session.handle)) { refused(response, 403); return true; }
    if (!/^application\/json(?:;|$)/iu.test(String(request.headers['content-type'] ?? ''))) { refused(response, 415); return true; }
    if (Number(request.headers['content-length'] ?? 0) > BODY_BYTES) { refused(response, 413); return true; }
    const chunks: Buffer[] = []; let size = 0;
    for await (const chunk of request) {
      const bytes = Buffer.from(chunk); size += bytes.byteLength;
      if (size > BODY_BYTES) { refused(response, 413); return true; }
      chunks.push(bytes);
    }
    let raw: unknown;
    try { raw = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { refused(response, 400); return true; }
    const body = TravelsBodySchema.safeParse(raw);
    if (!body.success) { refused(response, 400); return true; }
    answer(await store.choose(person, body.data.travels === 'hidden', (options.clock ?? Date.now)()));
  } catch { refused(response, 503); }
  return true;
}
