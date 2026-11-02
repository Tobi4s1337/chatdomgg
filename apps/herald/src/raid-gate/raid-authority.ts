import type { KingdomId } from '@chatdom/shared';
import type { HelixReader, Secret } from '@chatdom/twitch';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { RAID_AUTHORITY_BODY_LIMIT, RaidAuthorityLiveReplySchema, RaidAuthorityRequestSchema, RaidAuthorityStandingReplySchema,
  RaidAuthorityWriteReplySchema } from '../../../api/src/raid-gate/raid-authority-contracts';
import type { RaidWrites } from './raids';
import { type RaidGrantState, type RaidUserSession } from './user-token';

/** `HERALD_RAID_GATE_SECRET`: the API's bearer for the private raid route. */
export const RAID_GATE_SECRET_PATTERN = /^[\x21-\x7e]{32,512}$/u;
const LIVE_READ_TIMEOUT_MS = 8_000;

/** What the private route answers from. One per Herald: its origin, its kingdom, its broadcaster's grant. */
export interface RaidAuthority {
  readonly origin: 'live' | 'simulated';
  readonly kingdomId: KingdomId;
  readonly writes: RaidWrites;
  standing(): Promise<{ readonly grant: RaidGrantState; readonly consent: 'enabled' | 'disabled' }>;
  /** Live state for each ID; throws when any part of the read failed. */
  live(kingdomIds: readonly KingdomId[]): Promise<Record<string, boolean>>;
}

/** The live Herald's authority: the sealed grant through its user session, live state through Get Streams (app token). */
export function liveRaidAuthority(options: { readonly kingdomId: KingdomId; readonly session: RaidUserSession; readonly writes: RaidWrites; readonly helix: HelixReader;
  readonly now?: () => number }): RaidAuthority {
  const now = options.now ?? Date.now;
  return {
    origin: 'live', kingdomId: options.kingdomId, writes: options.writes,
    async standing() {
      const grant = await options.session.standing();
      // The monarch's consent is the stored grant itself: running `authorize` with the key set hands Herald the raid
      // control on purpose; a revocation takes it back.
      let consent: 'enabled' | 'disabled' = 'disabled';
      if (grant === 'granted') consent = 'enabled';
      else if (grant === 'missing') {
        const record = await options.session.record().catch(() => null);
        if (record?.state === 'held' && record.userId === options.kingdomId) consent = 'enabled';
      }
      return { grant, consent };
    },
    async live(kingdomIds) {
      const streams = await options.helix.getStreams(kingdomIds, { signal: AbortSignal.timeout(LIVE_READ_TIMEOUT_MS), deadline: now() + LIVE_READ_TIMEOUT_MS });
      const live = new Set(streams.filter(stream => stream.type === 'live').map(stream => stream.userId));
      return Object.fromEntries(kingdomIds.map(id => [id, live.has(id)]));
    },
  };
}

export interface RaidAuthorityRouteOptions {
  /** Null while the authority is not bound (no secret, unresolved kingdom, unusable ledger): the route answers 503. */
  readonly authority: () => RaidAuthority | null;
  /** Null when `HERALD_RAID_GATE_SECRET` is not set: every request is refused. */
  readonly secret: Secret | null;
}

type Refusal = 'unauthorized' | 'method' | 'media-type' | 'too-large' | 'malformed' | 'origin' | 'kingdom' | 'unavailable' | 'unconfigured';
const STATUS: Readonly<Record<Refusal, number>> = { unauthorized: 401, method: 405, 'media-type': 415, 'too-large': 413, malformed: 400,
  origin: 409, kingdom: 409, unavailable: 503, unconfigured: 503 };

/**
 * `POST RAID_AUTHORITY_ROUTE`: the API's one way to Herald's raid authority. Bearer-authenticated (timing-safe),
 * strict JSON within the body limit, for this Herald's origin and kingdom only. Replies are exactly the contract's
 * reply schemas; refusals are a short code with no detail.
 */
export function createRaidAuthorityRoute(options: RaidAuthorityRouteOptions): (request: IncomingMessage, response: ServerResponse) => Promise<void> {
  const expected = options.secret ? digest(`Bearer ${options.secret.reveal()}`) : null;
  return async (request, response) => {
    const refuse = (code: Refusal) => json(response, STATUS[code], { error: code }, code === 'too-large');
    if (request.method !== 'POST') { request.resume(); return refuse('method'); }
    if (!expected) { request.resume(); return refuse('unconfigured'); }
    const presented = request.headers.authorization;
    if (typeof presented !== 'string' || !timingSafeEqual(digest(presented), expected)) { request.resume(); return refuse('unauthorized'); }
    const type = request.headers['content-type'];
    if (typeof type !== 'string' || type.split(';')[0]!.trim().toLowerCase() !== 'application/json') { request.resume(); return refuse('media-type'); }
    const body = await readBody(request);
    if (body === 'too-large') return refuse('too-large');
    let raw: unknown;
    try { raw = JSON.parse(body); } catch { return refuse('malformed'); }
    const parsed = RaidAuthorityRequestSchema.safeParse(raw);
    if (!parsed.success) return refuse('malformed');
    const command = parsed.data;
    const authority = options.authority();
    if (!authority) return refuse('unavailable');
    if (command.origin !== authority.origin) return refuse('origin');
    try {
      if (command.op === 'standing') {
        if (command.kingdomId !== authority.kingdomId) return refuse('kingdom');
        const standing = await authority.standing();
        return json(response, 200, RaidAuthorityStandingReplySchema.parse({ version: 1, origin: authority.origin, kingdomId: command.kingdomId, ...standing }));
      }
      if (command.op === 'live') {
        const live = await authority.live(command.kingdomIds);
        return json(response, 200, RaidAuthorityLiveReplySchema.parse({ version: 1, origin: authority.origin, live }));
      }
      if (command.op !== 'reconcile' && !command.write.key.endsWith(`/${command.op}`)) return refuse('malformed');
      const outcome = command.op === 'start' ? await authority.writes.start(command.write)
        : command.op === 'cancel' ? await authority.writes.cancel(command.write) : await authority.writes.reconcile(command.write);
      return json(response, 200, RaidAuthorityWriteReplySchema.parse({ version: 1, origin: authority.origin, key: command.write.key, outcome }));
    } catch (error) {
      // An unusable ledger, an unreadable store or a failed live read: the authority cannot answer now.
      if (!response.headersSent) return refuse('unavailable');
      throw error;
    }
  };
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

function readBody(request: IncomingMessage): Promise<string | 'too-large'> {
  const declared = Number(request.headers['content-length']);
  if (Number.isFinite(declared) && declared > RAID_AUTHORITY_BODY_LIMIT) { request.resume(); return Promise.resolve('too-large'); }
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0, over = false;
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > RAID_AUTHORITY_BODY_LIMIT) over = true;
      else chunks.push(chunk);
    });
    request.on('end', () => resolve(over ? 'too-large' : Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

function json(response: ServerResponse, status: number, body: unknown, close = false): void {
  const text = JSON.stringify(body);
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'content-length': Buffer.byteLength(text),
    ...(close ? { connection: 'close' } : {}) });
  response.end(text);
}
