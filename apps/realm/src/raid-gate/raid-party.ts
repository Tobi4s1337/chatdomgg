/**
 * The public gate party (RS11): who chose to march, read from the gate's own durable records, shaped for the stream
 * and the walking view. One read per kingdom at most every 750 ms, whatever the number of viewers.
 *
 * What it tells is what the authority already holds: the open request and its Twitch state, the joined members
 * (names and looks are the same public ones the walker frame shows), and the witnessed departure. Nothing here comes
 * from a count, a chat roster or a browser claim. Names of the two channels come from witnessed raid evidence only.
 */
import { createHash } from 'node:crypto';
import { KingdomIdSchema, RaidPartyReplySchema, type KingdomId, type PersonId, type RaidPartyReply } from '@chatdom/shared';
import { readActionRecord, readGatePointer, readMemberRecord, type RaidActionRecord } from '../../../api/src/raid-gate/repository';
import { RaidObservationSchema } from '../../../api/src/raid-gate/observations';
import type { SqlPool } from '../../../api/src/raid-gate/postgres-repository';
import { buildRaidPartyFrame, partyPhase, type RaidPartyFace } from './raid-party-frame';

export { partyPhase, RAID_PARTY_SETOUT_MS } from './raid-party-frame';

const CACHE_MS = 750;
const NAME = /^[^\p{Cc}\p{Cf}\p{Cs}]{1,64}$/u;
const LOGIN = /^[a-z0-9_]{1,64}$/u;

export interface RaidPartyReaderOptions {
  readonly pool: SqlPool;
  readonly origin: 'live' | 'simulated';
  readonly clock: () => number;
  /** The marcher's current public walker ID in this kingdom's room, when they walk here. */
  readonly walkers?: (kingdomId: KingdomId, personId: PersonId) => string | null;
}

type Row = Record<string, unknown>;
type Face = RaidPartyFace;

export const marcherKey = (requestId: string, personId: PersonId): string =>
  `marcher.${createHash('sha256').update(`${requestId}\u0000${personId}`).digest('hex').slice(0, 24)}`;

export class RaidPartyReader {
  private readonly cache = new Map<KingdomId, { at: number; reply: Promise<RaidPartyReply> }>();
  constructor(private readonly options: RaidPartyReaderOptions) {}

  /** The current party at this kingdom's gate, or `party: null`. Repeated reads within 750 ms share one answer. */
  read(raw: string): Promise<RaidPartyReply> {
    const kingdomId = KingdomIdSchema.parse(raw), now = this.options.clock();
    const cached = this.cache.get(kingdomId);
    if (cached && now - cached.at < CACHE_MS && now >= cached.at) return cached.reply;
    const reply = this.compute(kingdomId, now);
    this.cache.set(kingdomId, { at: now, reply });
    reply.catch(() => { if (this.cache.get(kingdomId)?.reply === reply) this.cache.delete(kingdomId); });
    if (this.cache.size > 256) for (const [key, value] of this.cache) if (now - value.at >= CACHE_MS) this.cache.delete(key);
    return reply;
  }

  private async compute(kingdomId: KingdomId, now: number): Promise<RaidPartyReply> {
    const { origin } = this.options;
    const none: RaidPartyReply = { version: 1, origin, kingdomId, asOf: now, party: null };
    const client = await this.options.pool.connect();
    try {
      const pointerRow = (await client.query('SELECT record FROM realm_raid_gate_pointers WHERE kingdom_id = $1', [kingdomId])).rows[0] as Row | undefined;
      const pointer = pointerRow && readGatePointer(JSON.parse(String(pointerRow.record)));
      if (!pointer?.requestId) return none;
      const actionRow = (await client.query('SELECT record FROM realm_raid_gate_actions WHERE request_id = $1 AND origin = $2', [pointer.requestId, origin])).rows[0] as Row | undefined;
      const action = actionRow && readActionRecord(JSON.parse(String(actionRow.record)));
      if (!action || action.from !== kingdomId || action.origin !== origin) return none;
      if (!partyPhase(action, now)) return none;
      const members = (await client.query(`SELECT m.record, p.public_name FROM realm_raid_gate_members m
        LEFT JOIN realm_persons p ON p.person_id = m.person_id AND p.origin = $2
        WHERE m.request_id = $1 AND m.joined`, [action.requestId, origin])).rows as Row[];
      const records = members.flatMap(row => {
        const record = readMemberRecord(JSON.parse(String(row.record)));
        return record ? [{ record, name: typeof row.public_name === 'string' ? row.public_name : null }] : [];
      });
      const party = buildRaidPartyFrame({ origin, kingdomId, now, action, members: records, faces: await this.faces(client, action),
        key: marcherKey, ...(this.options.walkers ? { walkers: this.options.walkers } : {}) });
      if (!party) return none;
      return RaidPartyReplySchema.parse({ version: 1, origin, kingdomId, asOf: now, party });
    } finally { client.release(); }
  }

  /** Twitch's own login and display name for both channels, from the newest witnessed raid that names each. */
  private async faces(client: Awaited<ReturnType<SqlPool['connect']>>, action: RaidActionRecord): Promise<{ source: Face; destination: Face }> {
    const face = async (kingdomId: KingdomId): Promise<Face> => {
      const row = (await client.query(`SELECT observation FROM realm_raid_observations WHERE origin = $1
        AND (from_kingdom_id = $2 OR to_kingdom_id = $2) ORDER BY sequence DESC LIMIT 1`, [this.options.origin, kingdomId])).rows[0] as Row | undefined;
      if (!row) return { login: null, name: null };
      const parsed = RaidObservationSchema.safeParse(JSON.parse(String(row.observation)));
      if (!parsed.success) return { login: null, name: null };
      const channel = parsed.data.from.kingdomId === kingdomId ? parsed.data.from : parsed.data.to;
      return { login: LOGIN.test(channel.login) ? channel.login : null, name: NAME.test(channel.name) ? channel.name : null };
    };
    return { source: await face(action.from), destination: await face(action.to) };
  }
}
