import type { uWebSocketsTransport } from '@colyseus/uwebsockets-transport';
import { KingdomIdSchema, PersonIdSchema, RaidPennantFrameSchema } from '@chatdom/shared';
import { RaidObservationEnvelopeSchema, RAID_OBSERVATION_ROUTE, RAID_ROADS_ROUTE, RAID_PENNANTS_ROUTE } from '../../../api/src/raid-gate/observations';
import { IngressGate, type IngressCredentials } from '../ingress/gate';
import { RaidObservationError, RaidObservationLedger, type RaidObservationLedgerOptions } from './observations';
import { RaidPartyReader, type RaidPartyReaderOptions } from './raid-party';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { RealmTravelTransport, TravelTicketRef } from './ports';
import { REALM_ROOM_DOOR_BODY_LIMIT, REALM_ROOM_DOOR_ROUTE, RoomDoorReplySchema, RoomDoorRequestSchema, roomDoorSubject, type RoomDoorRequest } from './room-door-contracts';

export const RAID_OBSERVATION_BODY_LIMIT = 16 * 1024;
export interface RaidShowServiceOptions extends RaidObservationLedgerOptions {
  readonly credentials: IngressCredentials;
  /** Zero is useful for an explicitly driven recording/test stack; production polls once a second. */
  readonly recoverEveryMs?: number;
  /** The marcher's current public walker ID here, so the gate party draws each walking body once. */
  readonly walkers?: RaidPartyReaderOptions['walkers'];
  /**
   * The rooms' travel door (`room-door.ts`) for the API's coordinator, behind `REALM_INTERNAL_SECRET`. Without both the
   * route answers 503, and the API keeps travel unavailable.
   */
  readonly door?: Readonly<{ transport: RealmTravelTransport; secret: string | undefined }>;
}
export const RAID_PARTY_ROUTE = '/realm/raid-party/:kingdomId';
const json = (status: number, value: unknown) => new Response(JSON.stringify(value), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
});
const refused = (status: number) => json(status, { version: 1, status: status === 503 ? 'unavailable' : 'refused' });

function parameters(url: URL, keys: readonly string[]): boolean {
  return [...url.searchParams.keys()].every(key => keys.includes(key) && url.searchParams.getAll(key).length === 1);
}
function count(value: string | null, fallback: number, maximum: number): number | null {
  if (value === null) return fallback;
  if (!/^[1-9][0-9]{0,2}$/u.test(value)) return null;
  const parsed = Number(value);
  return parsed <= maximum ? parsed : null;
}
async function body(request: Request): Promise<unknown> {
  const reader = request.body?.getReader();
  if (!reader) throw new RaidObservationError('invalid', 'Missing raid body.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const item = await reader.read();
      if (item.done) break;
      size += item.value.length;
      if (size > RAID_OBSERVATION_BODY_LIMIT) { await reader.cancel(); throw new RaidObservationError('invalid', 'Raid body is too large.'); }
      chunks.push(item.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } finally { reader.releaseLock(); }
}

/** Authenticated evidence ingress and public channel-level history; neither endpoint accepts rider assertions. */
export function createRaidShowService(options: RaidShowServiceOptions) {
  const ledger = new RaidObservationLedger(options), gate = new IngressGate(options.credentials, options.origin);
  const party = new RaidPartyReader({ pool: options.pool, origin: options.origin, clock: options.clock, ...(options.walkers ? { walkers: options.walkers } : {}) });
  let closed = false, pending = 0;
  let recovering: Promise<unknown> | null = null;
  const wake = () => {
    if (closed || recovering) return;
    const run = ledger.recover().catch(() => undefined).finally(() => { if (recovering === run) recovering = null; });
    recovering = run;
  };
  const cadence = options.recoverEveryMs ?? 1_000;
  const timer = cadence > 0 ? setInterval(wake, cadence) : null;
  timer?.unref();
  if (cadence > 0) wake();

  const doorKey = options.door?.secret && options.door.secret.length >= 32 ? createHash('sha256').update(options.door.secret).digest() : null;
  /** One travel operation on the actual rooms. A lost HTTP answer never aborts the durable work behind it. */
  const travel = async (request: RoomDoorRequest): Promise<unknown> => {
    const rooms = options.door!.transport, signal = new AbortController().signal;
    if (request.op === 'admission') return rooms.checkAdmission(PersonIdSchema.parse(request.personId), KingdomIdSchema.parse(request.kingdomId), signal);
    const ref: TravelTicketRef = { ...request.ref, personId: PersonIdSchema.parse(request.ref.personId),
      from: KingdomIdSchema.parse(request.ref.from), to: KingdomIdSchema.parse(request.ref.to) };
    switch (request.op) {
      case 'reserve': return rooms.reserve(ref, signal);
      case 'prepare': return rooms.prepare(ref, signal);
      case 'commit': return rooms.commit(ref, signal);
      case 'reconcile': return rooms.reconcile(ref, signal);
      case 'release': return rooms.release(ref, request.side, signal);
    }
  };
  const active = new Set<Promise<Response>>();
  const accept = async (request: Request): Promise<Response> => {
      const url = new URL(request.url);
      try {
        if (url.pathname === REALM_ROOM_DOOR_ROUTE) {
          if (request.method !== 'POST') return refused(405);
          if (!doorKey || !options.door) return refused(503);
          const bearer = /^Bearer ([\x21-\x7e]{1,512})$/u.exec(request.headers.get('authorization') ?? '');
          if (!timingSafeEqual(doorKey, createHash('sha256').update(bearer?.[1] ?? '').digest()) || !bearer) return refused(401);
          if (url.search) return refused(400);
          if (!/^application\/json\b/iu.test(request.headers.get('content-type') ?? '')) return refused(415);
          if (Number(request.headers.get('content-length') ?? 0) > REALM_ROOM_DOOR_BODY_LIMIT) return refused(413);
          const parsed = RoomDoorRequestSchema.safeParse(await body(request));
          if (!parsed.success) return refused(400);
          if (parsed.data.origin !== options.origin) return refused(403);
          const outcome = await travel(parsed.data);
          return json(200, RoomDoorReplySchema.parse({ version: 1, origin: options.origin, op: parsed.data.op, subject: roomDoorSubject(parsed.data), outcome }));
        }
        if (url.pathname === RAID_ROADS_ROUTE) {
          if (request.method !== 'GET') return refused(405);
          const limit = count(url.searchParams.get('limit'), 200, 200);
          if (!parameters(url, ['after', 'limit']) || limit === null) return refused(400);
          return json(200, await ledger.page(url.searchParams.get('after'), limit));
        }
        const pennant = /^\/realm\/raid-pennants\/([1-9][0-9]{0,31})$/u.exec(url.pathname);
        if (pennant) {
          if (request.method !== 'GET') return refused(405);
          const archive = url.searchParams.get('archive');
          const limit = count(url.searchParams.get('limit'), archive === '1' ? 12 : 24, 64);
          if (!parameters(url, ['limit', 'archive', 'before']) || limit === null || (archive !== null && archive !== '1')
            || (url.searchParams.has('before') && archive !== '1')) return refused(400);
          const kingdomId = KingdomIdSchema.parse(pennant[1]);
          if (archive === '1') return json(200, await ledger.pennantArchive(kingdomId, url.searchParams.get('before'), limit));
          const items = await ledger.pennants(kingdomId, limit);
          return json(200, RaidPennantFrameSchema.parse({ version: 1, origin: options.origin, kingdomId, asOf: options.clock(), items }));
        }
        const gathering = /^\/realm\/raid-party\/([1-9][0-9]{0,31})$/u.exec(url.pathname);
        if (gathering) {
          if (request.method !== 'GET') return refused(405);
          if (url.search) return refused(400);
          return json(200, await party.read(gathering[1]!));
        }
        if (url.pathname !== RAID_OBSERVATION_ROUTE) return refused(404);
        if (request.method !== 'POST') return refused(405);
        if (gate.authenticate(request.headers.get('authorization') ?? undefined) !== 'herald') return refused(401);
        if (url.search) return refused(400);
        if (!/^application\/json\b/iu.test(request.headers.get('content-type') ?? '')) return refused(415);
        if (Number(request.headers.get('content-length') ?? 0) > RAID_OBSERVATION_BODY_LIMIT) return refused(413);
        if (pending >= 32) return refused(503);
        pending++;
        try {
          const envelope = RaidObservationEnvelopeSchema.safeParse(await body(request));
          if (!envelope.success) return refused(400);
          const result = await ledger.record(envelope.data.raid);
          wake();
          return json(202, { version: 1, status: result.status });
        } finally { pending--; }
      } catch (error) {
        if (error instanceof SyntaxError) return refused(400);
        if (error instanceof RaidObservationError) return refused(error.kind === 'origin' ? 403 : error.kind === 'conflict' ? 409 : error.kind === 'invalid' ? 400 : 503);
        return refused(503);
      }
  };
  return {
    ledger,
    handle(request: Request): Promise<Response> {
      if (closed) return Promise.resolve(refused(503));
      const run = accept(request).finally(() => { active.delete(run); });
      active.add(run);
      return run;
    },
    async close() {
      closed = true;
      if (timer) clearInterval(timer);
      await Promise.allSettled([...active]);
      await recovering;
    },
  };
}

/** Mount on the realm's existing listener. A lost HTTP answer cannot abort a durable evidence transaction. */
export function mountRaidShowRoutes(app: uWebSocketsTransport['app'], options: RaidShowServiceOptions) {
  const service = createRaidShowService(options);
  const mount = (method: 'get' | 'post', path: string) => app[method](path, (res, req) => {
    const query = req.getQuery(), url = `http://realm.internal${req.getUrl()}${query ? `?${query}` : ''}`;
    const headers = new Headers();
    for (const key of ['authorization', 'content-type', 'content-length']) { const value = req.getHeader(key); if (value) headers.set(key, value); }
    let aborted = false, size = 0, finished = false;
    res.onAborted(() => { aborted = true; });
    const reply = async (response: Response) => {
      const text = await response.text();
      if (aborted) return;
      res.cork(() => {
        res.writeStatus(`${response.status} ${STATUS[response.status] ?? 'Error'}`);
        response.headers.forEach((value, key) => res.writeHeader(key, value));
        res.end(text);
      });
    };
    if (method === 'get') { void service.handle(new Request(url, { headers })).then(reply); return; }
    if (Number(headers.get('content-length') ?? 0) > RAID_OBSERVATION_BODY_LIMIT) { void reply(refused(413)); return; }
    const chunks: Buffer[] = [];
    res.onData((chunk, last) => {
      if (finished) return;
      size += chunk.byteLength;
      if (size > RAID_OBSERVATION_BODY_LIMIT) { finished = true; void reply(refused(413)); return; }
      chunks.push(Buffer.from(chunk.slice(0)));
      if (!last) return;
      finished = true;
      void service.handle(new Request(url, { method: 'POST', headers, body: Buffer.concat(chunks).toString('utf8') })).then(reply);
    });
  });
  mount('post', RAID_OBSERVATION_ROUTE);
  mount('get', RAID_ROADS_ROUTE);
  mount('get', RAID_PENNANTS_ROUTE);
  mount('get', RAID_PARTY_ROUTE);
  mount('post', REALM_ROOM_DOOR_ROUTE);
  return service;
}
const STATUS: Readonly<Record<number, string>> = { 200: 'OK', 202: 'Accepted', 400: 'Bad Request', 401: 'Unauthorized',
  403: 'Forbidden', 404: 'Not Found', 405: 'Method Not Allowed', 409: 'Conflict', 413: 'Payload Too Large', 415: 'Unsupported Media Type', 503: 'Service Unavailable' };
