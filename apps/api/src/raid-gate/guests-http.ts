import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Pool } from 'pg';
import { KingdomIdSchema } from '../../../../packages/shared/src/identity';
import { RaidGuestAuthority } from '../../../realm/src/raid-gate/guests';
import { dockMutationAllowed, dockPrincipal } from '../dock/auth';
import type { RealmAuthConfig } from '../realm-auth/config';
import { RAID_GUEST_BODY_BYTES, RAID_GUEST_PREFIX, RaidGuestBeginBodySchema, RaidGuestBeginReplySchema, RaidGuestReadReplySchema } from './guest-contracts';

interface GuestHttpOptions {
  readonly pool: Pool;
  readonly config: RealmAuthConfig;
  readonly authority?: Pick<RaidGuestAuthority, 'begin' | 'guest'>;
}
const HEADERS = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', Vary: 'Cookie' };
const reply = (response: ServerResponse, status: number, body: unknown) => { response.writeHead(status, HEADERS).end(JSON.stringify(body)); };
const refused = (response: ServerResponse, status: number) => reply(response, status, { version: 1,
  status: status === 401 ? 'unauthenticated' : status === 503 ? 'unavailable' : 'refused',
  message: status === 401 ? 'Sign in with Twitch to walk in with this raid.' : status === 503 ? 'The raid welcome could not be confirmed. Try the gate again.' : 'The raid welcome request was refused.' });

/** Cookie-owned intent and current guest projection. No HTTP route can acknowledge a room arrival. */
export async function handleRaidGuest(request: IncomingMessage, response: ServerResponse, options: GuestHttpOptions): Promise<boolean> {
  const url = new URL(request.url ?? '/', options.config.publicOrigin);
  if (!url.pathname.startsWith(`${RAID_GUEST_PREFIX}/`)) return false;
  const kingdom = KingdomIdSchema.safeParse(url.pathname.slice(RAID_GUEST_PREFIX.length + 1));
  if (!kingdom.success || url.search) { refused(response, 400); return true; }
  if (request.method !== 'GET' && request.method !== 'POST') { refused(response, 405); return true; }
  const { config, pool } = options;
  try {
    const session = await dockPrincipal(pool, config.mode, config.secureCookies, request.headers.cookie);
    if (!session) { refused(response, 401); return true; }
    const authority = options.authority ?? new RaidGuestAuthority({ pool, origin: config.mode, clock: Date.now });
    const identity = { version: 1 as const, origin: config.mode, kingdomId: kingdom.data,
      personId: session.principal.personId, sessionId: session.principal.sessionId };
    if (request.method === 'GET') {
      reply(response, 200, RaidGuestReadReplySchema.parse({ version: 1, guest: await authority.guest(identity) }));
      return true;
    }
    if (!dockMutationAllowed(request.headers, config.publicOrigin, session.handle)) { refused(response, 403); return true; }
    if (!/^application\/json(?:;|$)/iu.test(String(request.headers['content-type'] ?? ''))) { refused(response, 415); return true; }
    if (Number(request.headers['content-length'] ?? 0) > RAID_GUEST_BODY_BYTES) { refused(response, 413); return true; }
    const chunks: Buffer[] = []; let size = 0;
    for await (const chunk of request) {
      const bytes = Buffer.from(chunk); size += bytes.byteLength;
      if (size > RAID_GUEST_BODY_BYTES) { refused(response, 413); return true; }
      chunks.push(bytes);
    }
    let raw: unknown;
    try { raw = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { refused(response, 400); return true; }
    const body = RaidGuestBeginBodySchema.safeParse(raw);
    if (!body.success) { refused(response, 400); return true; }
    reply(response, 200, RaidGuestBeginReplySchema.parse(await authority.begin({ ...identity, raidId: body.data.raidId })));
  } catch { refused(response, 503); }
  return true;
}
