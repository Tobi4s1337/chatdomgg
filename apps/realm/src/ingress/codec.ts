import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { PersonIdSchema, type KingdomId, type PersonId, type PresenceSource } from '@chatdom/shared';
import type { RealmIngressCheckpoint } from '@chatdom/shared/realm';
import { PRESENCE_DEDUPE_CAPACITY, applyPresence, createPresenceState, type PresenceState } from '@chatdom/world';
import { canonicalJson } from '../persistence/codec';
import { RealmRecoveryError } from '../persistence/database';

type Person = PresenceState['people'][number] extends ReadonlyMap<PersonId, infer P> ? P : never;

/**
 * One evidence run: the last time this source actually saw this person during this stream night, under this writer.
 * An interval is only ever closed between two real observations, so a run never covers time nobody observed.
 */
export interface EvidenceRun { readonly source: PresenceSource; readonly personId: PersonId; readonly sessionId: string; readonly last: number }

/** What the `presence-v1` checkpoint holds: the world presence reducer's private state and the open evidence runs. */
export interface IngressCheckpointState {
  readonly presence: PresenceState;
  /** Runs belong to the writer epoch that observed them. A new epoch reads none: a restart never extends coverage. */
  readonly writerEpoch: string;
  readonly runs: readonly EvidenceRun[];
}

/** Bytes are private: person IDs, approved public names and timings. The presence schema has no field for chat text. */
export function encodeIngressCheckpoint(state: IngressCheckpointState): Uint8Array {
  verifyShardLayout();
  const p = state.presence;
  const people: [string, Person][] = [];
  for (const bucket of p.people) for (const [id, person] of bucket) people.push([id, person]);
  people.sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
  const body = {
    v: 1, kingdomId: p.kingdomId, origin: p.origin, asOf: p.asOf, stream: p.stream, rosterThrough: p.rosterThrough, lastMinuteAt: p.lastMinuteAt,
    people, recent: { cursor: p.recentInputs.cursor, size: p.recentInputs.size, blocks: p.recentInputs.blocks },
    writerEpoch: state.writerEpoch,
    runs: [...state.runs].sort(runOrder).map(r => [r.source, r.personId, r.sessionId, r.last]),
  };
  return new Uint8Array(deflateRawSync(Buffer.from(canonicalJson(body), 'utf8')));
}

/** Fails closed with `RealmRecoveryError`: a checkpoint that cannot be read never becomes an empty crowd. */
export function decodeIngressCheckpoint(checkpoint: RealmIngressCheckpoint, kingdomId: KingdomId, origin: 'live' | 'simulated'): IngressCheckpointState {
  verifyShardLayout();
  if (checkpoint.version !== 1 || checkpoint.codec !== 'presence-v1') throw new RealmRecoveryError(kingdomId, 'unsupported ingress checkpoint');
  let body: Encoded;
  try { body = JSON.parse(inflateRawSync(checkpoint.data).toString('utf8')) as Encoded; }
  catch { throw new RealmRecoveryError(kingdomId, `ingress checkpoint ${checkpoint.revision} cannot be read`); }
  if (body.v !== 1 || body.kingdomId !== kingdomId || body.origin !== origin) throw new RealmRecoveryError(kingdomId, `ingress checkpoint ${checkpoint.revision} belongs elsewhere`);
  const blank = createPresenceState(kingdomId, origin);
  const people = blank.people.map(() => new Map<PersonId, Person>());
  for (const [id, person] of body.people) people[shardOf(id)]!.set(PersonIdSchema.parse(id), person);
  const ids = blank.recentInputs.ids.map(() => new Map<string, true>());
  if (body.recent.blocks.length !== blank.recentInputs.blocks.length) throw new RealmRecoveryError(kingdomId, 'ingress checkpoint dedupe window has the wrong size');
  for (const block of body.recent.blocks) for (const id of block) if (id !== null) ids[shardOf(id)]!.set(id, true);
  const presence: PresenceState = {
    kingdomId, origin, asOf: body.asOf, stream: body.stream, people, rosterThrough: body.rosterThrough, lastMinuteAt: body.lastMinuteAt,
    recentInputs: { ids, blocks: body.recent.blocks, cursor: body.recent.cursor, size: body.recent.size },
  };
  const runs = body.runs.map(([source, personId, sessionId, last]) => ({ source, personId: PersonIdSchema.parse(personId), sessionId, last }));
  return { presence, writerEpoch: body.writerEpoch, runs };
}

interface Encoded {
  readonly v: number; readonly kingdomId: string; readonly origin: string;
  readonly asOf: number; readonly stream: PresenceState['stream']; readonly rosterThrough: number; readonly lastMinuteAt: number;
  readonly people: readonly [string, Person][];
  readonly recent: { readonly cursor: number; readonly size: number; readonly blocks: readonly (readonly (string | null)[])[] };
  readonly writerEpoch: string;
  readonly runs: readonly [PresenceSource, string, string, number][];
}

const runOrder = (a: EvidenceRun, b: EvidenceRun) => a.personId < b.personId ? -1 : a.personId > b.personId ? 1 : a.source < b.source ? -1 : a.source > b.source ? 1 : 0;

/**
 * The presence reducer shards its maps with FNV-1a over 256 buckets, which it does not export. The codec rebuilds the
 * same buckets, and proves the layout against the reducer itself before the first use: if world ever changes its
 * hashing, decoding stops loudly instead of filing people where the reducer will never look.
 */
function shardOf(key: string): number {
  let hash = 2166136261;
  for (let i = 0; i < key.length; i++) hash = Math.imul(hash ^ key.charCodeAt(i), 16777619);
  return (hash >>> 0) % 256;
}

/** The reducer's private record of one person, if it has one. */
export function presencePerson(presence: PresenceState, personId: PersonId): Person | undefined {
  verifyShardLayout();
  return presence.people[shardOf(personId)]!.get(personId);
}

let verified = false;
function verifyShardLayout() {
  if (verified) return;
  const kingdomId = '1' as KingdomId, blank = createPresenceState(kingdomId, 'simulated');
  const probe = applyPresence(blank, { version: 1, id: 'codec:probe.7', kingdomId, observedAt: 1_000, origin: 'simulated', kind: 'observe', source: 'walker',
    coverage: 'activity', people: [{ personId: PersonIdSchema.parse('424242'), disclosure: 'anonymous' }] }, 1_000);
  const ok = blank.people.length === 256 && blank.recentInputs.ids.length === 256
    && blank.recentInputs.blocks.length * blank.recentInputs.blocks[0]!.length === PRESENCE_DEDUPE_CAPACITY
    && probe.people[shardOf('424242')]!.has(PersonIdSchema.parse('424242'))
    && probe.recentInputs.ids[shardOf('codec:probe.7')]!.has('codec:probe.7');
  if (!ok) throw new RealmRecoveryError(kingdomId, 'the presence reducer changed its private layout; presence-v1 cannot be read safely');
  verified = true;
}
