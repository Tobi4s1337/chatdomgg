/**
 * The travel coordinator's room transport in the API process (RS11): every question goes to the realm's private door
 * (`apps/realm/src/raid-gate/room-door.ts`), which answers from its actual rooms, writers and seats. The API keeps no
 * copy of where anyone stands. Any reply the realm cannot vouch for (a refusal status, another operation, ticket or
 * origin, an unreadable body, a lost connection) throws, and the coordinator counts it as unknown.
 */
import type { KingdomId, PersonId } from '../../../../packages/shared/src/identity';
import type { RealmTravelTransport, TravelTicketRef } from '../../../realm/src/raid-gate/ports';
import { REALM_ROOM_DOOR_ROUTE, RoomDoorReplySchema, roomDoorSubject, type RoomDoorRequest } from '../../../realm/src/raid-gate/room-door-contracts';
import type { RecordOrigin } from './repository';

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;
const REPLY_LIMIT = 16 * 1024;

export type RealmRoomsClientOptions = Readonly<{
  /** The realm's private base URL, for example `http://127.0.0.1:5197`. Plain HTTP only on loopback. */
  url: string;
  /** `REALM_INTERNAL_SECRET`, shared with the realm. Never logged. */
  secret: string;
  origin: RecordOrigin;
  fetch?: FetchLike;
}>;

export class RealmRoomsError extends Error {
  constructor(message: string) { super(message); this.name = 'RealmRoomsError'; }
}

/** The realm URL travel uses: `REALM_TRAVEL_URL`, else the dock bridge's realm target. */
export function realmRoomsUrl(env: NodeJS.ProcessEnv): string | null {
  const raw = (env.REALM_TRAVEL_URL ?? env.DOCK_REALM_URL ?? env.CHATDOM_REALM_TARGET)?.trim();
  if (!raw) return null;
  let url: URL;
  try { url = new URL(raw); } catch { return null; }
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  return url.protocol === 'https:' || (url.protocol === 'http:' && loopback) ? url.origin : null;
}

export function createRealmRoomsClient(options: RealmRoomsClientOptions): RealmTravelTransport {
  if (options.secret.length < 32) throw new Error('REALM_INTERNAL_SECRET must be at least 32 characters');
  const send = options.fetch ?? ((input, init) => fetch(input, init));
  const endpoint = new URL(REALM_ROOM_DOOR_ROUTE, options.url).toString();

  async function ask(request: RoomDoorRequest, signal: AbortSignal): Promise<unknown> {
    const response = await send(endpoint, {
      method: 'POST', redirect: 'error', signal,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${options.secret}` },
      body: JSON.stringify(request),
    });
    if (response.status !== 200) { await response.body?.cancel(); throw new RealmRoomsError(`The realm's door answered ${response.status}.`); }
    const reader = response.body?.getReader();
    if (!reader) throw new RealmRoomsError('The realm\'s door answered without a body.');
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > REPLY_LIMIT) { await reader.cancel(); throw new RealmRoomsError('The realm\'s door answered with too much.'); }
      chunks.push(value);
    }
    const reply = RoomDoorReplySchema.safeParse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    if (!reply.success || reply.data.origin !== options.origin || reply.data.op !== request.op || reply.data.subject !== roomDoorSubject(request)) {
      throw new RealmRoomsError('The realm\'s door answered another question.');
    }
    return reply.data.outcome;
  }
  const head = { version: 1 as const, origin: options.origin };
  const ref = (value: TravelTicketRef) => ({ ticket: value.ticket, personId: value.personId, sessionId: value.sessionId, from: value.from,
    to: value.to, generation: value.generation, kind: value.kind });
  // The coordinator re-reads every outcome with its own strict readers; these casts only carry the shape across.
  return {
    origin: options.origin,
    checkAdmission: (personId: PersonId, kingdomId: KingdomId, signal) => ask({ ...head, op: 'admission', personId, kingdomId }, signal) as never,
    reserve: (value, signal) => ask({ ...head, op: 'reserve', ref: ref(value) }, signal) as never,
    prepare: (value, signal) => ask({ ...head, op: 'prepare', ref: ref(value) }, signal) as never,
    commit: (value, signal) => ask({ ...head, op: 'commit', ref: ref(value) }, signal) as never,
    reconcile: (value, signal) => ask({ ...head, op: 'reconcile', ref: ref(value) }, signal) as never,
    release: (value, side, signal) => ask({ ...head, op: 'release', ref: ref(value), side }, signal) as never,
  };
}
