import {
  EpochMsSchema, KingdomIdSchema, PersonIdSchema, PresenceInputSchema, TokenSchema, UIntSchema,
  PRESENCE_LEASE_MS, PRESENCE_MINUTE_MS, STREAM_LEASE_MS,
  type KingdomId, type KingdomPresenceFrame, type PersonId, type PresenceInput, type PresenceSource,
} from '@chatdom/shared';

const SOURCES: readonly PresenceSource[] = ['chatters', 'chat', 'panel', 'walker'];
const SHARDS = 256;
const DEDUPE_BLOCK_SIZE = 64;
export const PRESENCE_DEDUPE_CAPACITY = 4096;
const MAX_EPOCH_MS = 8_640_000_000_000_000;
type Origin = 'live' | 'simulated';
type ShardedMap<K, V> = readonly ReadonlyMap<K, V>[];

interface Lease {
  readonly observedAt: number;
  readonly expiresAt: number;
}

interface PersonPresence {
  readonly leases: Readonly<Partial<Record<PresenceSource, Lease>>>;
  /** Survives expiry so reordered source input cannot recreate a newer lease. */
  readonly sourceTimes: Readonly<Partial<Record<PresenceSource, number>>>;
  readonly publicName: string | null;
  readonly disclosureAt: number;
  readonly since: number;
  /** Remove/restore is ordered independently from activity. */
  readonly controlAt: number;
  readonly restoredAt: number;
  readonly restriction: Restriction | null;
}

interface Restriction {
  readonly reason: 'timeout' | 'moderated' | 'ban' | 'forget';
  readonly until: number | null;
}

interface StreamPresence {
  readonly live: boolean;
  readonly sessionId: string | null;
  readonly observedAt: number;
  readonly expiresAt: number;
  readonly startedAt: number;
}

interface RecentInputs {
  readonly ids: ShardedMap<string, true>;
  readonly blocks: readonly (readonly (string | null)[])[];
  readonly cursor: number;
  readonly size: number;
}

/**
 * PRIVATE server state, never a wire payload or a citizen/history store. Use
 * projectPresence at the browser boundary. Maps are immutable by convention and
 * readonly in the API; transitions copy only the shards they change.
 */
export interface PresenceState {
  readonly kingdomId: KingdomId;
  readonly origin: Origin;
  readonly asOf: number;
  readonly stream: StreamPresence | null;
  readonly people: ShardedMap<PersonId, PersonPresence>;
  readonly rosterThrough: number;
  readonly recentInputs: RecentInputs;
  readonly lastMinuteAt: number;
}

export interface PresenceBinding {
  readonly personId: PersonId;
  readonly slot: number;
}

/**
 * PRIVATE eligibility sampled at a minute boundary, not a persisted award or
 * proof of sixty seconds watched. Settlement must own durable idempotency and
 * reject simulated origin. This module never mints anything.
 */
export interface PresenceMinuteCredit {
  readonly kingdomId: KingdomId;
  readonly origin: Origin;
  readonly sessionId: string;
  readonly minuteAt: number;
  readonly personIds: readonly PersonId[];
}

function shard(key: string): number {
  let hash = 2166136261;
  for (let i = 0; i < key.length; i++) hash = Math.imul(hash ^ key.charCodeAt(i), 16777619);
  return (hash >>> 0) % SHARDS;
}

function emptyShards<K, V>(): ShardedMap<K, V> {
  return Array.from({ length: SHARDS }, () => new Map<K, V>());
}

function getPerson(state: PresenceState, personId: PersonId): PersonPresence | undefined {
  return state.people[shard(personId)]!.get(personId);
}

class PeopleEdit {
  private readonly changed = new Map<number, Map<PersonId, PersonPresence>>();

  constructor(private readonly base: ShardedMap<PersonId, PersonPresence>) {}

  get(id: PersonId): PersonPresence | undefined {
    const bucket = shard(id);
    return (this.changed.get(bucket) ?? this.base[bucket]!).get(id);
  }

  set(id: PersonId, person: PersonPresence): void {
    const bucket = shard(id);
    let changed = this.changed.get(bucket);
    if (!changed) {
      changed = new Map(this.base[bucket]!);
      this.changed.set(bucket, changed);
    }
    changed.set(id, person);
  }

  finish(): ShardedMap<PersonId, PersonPresence> {
    if (!this.changed.size) return this.base;
    const buckets = this.base.slice();
    for (const [index, bucket] of this.changed) buckets[index] = bucket;
    return buckets;
  }
}

function emptyPerson(at: number): PersonPresence {
  return { leases: {}, sourceTimes: {}, publicName: null, disclosureAt: -1, since: at, controlAt: -1, restoredAt: -1, restriction: null };
}

/** Removes only strengthen a hold; arrival order must never shorten a timeout. */
function mergeRestriction(prior: Restriction | null, incoming: Restriction): Restriction {
  if (!prior) return incoming;
  const until = prior.until === null || incoming.until === null ? null : Math.max(prior.until, incoming.until);
  const rank = { timeout: 0, moderated: 1, ban: 2, forget: 3 } as const;
  return { reason: rank[prior.reason] >= rank[incoming.reason] ? prior.reason : incoming.reason, until };
}

function checkTime(now: number, state?: PresenceState): void {
  EpochMsSchema.parse(now);
  if (state && now < state.asOf) throw new RangeError('Presence clock cannot move backwards');
}

function expiry(at: number, duration: number): number {
  return Math.min(MAX_EPOCH_MS, at + duration);
}

function restricted(person: PersonPresence, at: number): boolean {
  return person.restriction !== null && (person.restriction.until === null || at < person.restriction.until);
}

function activeLeases(person: PersonPresence, now: number, since = 0, sources: readonly PresenceSource[] = SOURCES): Lease[] {
  return sources.flatMap(source => {
    const lease = person.leases[source];
    return lease && lease.observedAt <= now && lease.observedAt >= since && lease.expiresAt > now ? [lease] : [];
  });
}

function streamConnection(state: PresenceState, now: number): KingdomPresenceFrame['connection'] {
  if (!state.stream) return 'stale';
  if (state.stream.expiresAt <= now) return 'stale';
  return state.stream.live ? 'fresh' : 'offline';
}

function personPresent(state: PresenceState, person: PersonPresence, now: number): boolean {
  const connection = streamConnection(state, now);
  if (connection === 'stale' || restricted(person, now)) return false;
  // The castle follows the broadcast. A direct visit/message can still keep a home warm after it rests.
  const sources = connection === 'offline' ? SOURCES.filter(source => source !== 'chatters') : SOURCES;
  return activeLeases(person, now, state.stream!.startedAt, sources).length > 0;
}

function remember(recent: RecentInputs, id: string): RecentInputs {
  const blockIndex = Math.floor(recent.cursor / DEDUPE_BLOCK_SIZE);
  const offset = recent.cursor % DEDUPE_BLOCK_SIZE;
  const block = recent.blocks[blockIndex]!.slice();
  const evicted = block[offset];
  block[offset] = id;
  const blocks = recent.blocks.slice();
  blocks[blockIndex] = block;
  const ids = recent.ids.slice();
  const incomingShard = shard(id);
  const incoming = new Map(ids[incomingShard]!);
  if (evicted !== null && evicted !== undefined) {
    const outgoingShard = shard(evicted);
    const outgoing = outgoingShard === incomingShard ? incoming : new Map(ids[outgoingShard]!);
    outgoing.delete(evicted);
    ids[outgoingShard] = outgoing;
  }
  incoming.set(id, true);
  ids[incomingShard] = incoming;
  return {
    ids, blocks, cursor: (recent.cursor + 1) % PRESENCE_DEDUPE_CAPACITY,
    size: Math.min(PRESENCE_DEDUPE_CAPACITY, recent.size + 1),
  };
}

export function createPresenceState(kingdomId: KingdomId, origin: Origin): PresenceState {
  KingdomIdSchema.parse(kingdomId);
  if (origin !== 'live' && origin !== 'simulated') throw new TypeError('Presence needs a live or simulated origin');
  return {
    kingdomId, origin, asOf: 0, stream: null, people: emptyShards(), rosterThrough: -1, lastMinuteAt: -1,
    recentInputs: {
      ids: emptyShards(), cursor: 0, size: 0,
      blocks: Array.from({ length: PRESENCE_DEDUPE_CAPACITY / DEDUPE_BLOCK_SIZE }, () => Array<string | null>(DEDUPE_BLOCK_SIZE).fill(null)),
    },
  };
}

/**
 * Validate trusted private ingress again at this boundary. Unknown fields (such
 * as raw chat text) fail validation. IDs and clocks remain private. Future and
 * recovered observations are ignored, never clamped into fresh evidence.
 */
export function applyPresence(state: PresenceState, input: PresenceInput, now: number): PresenceState {
  const event = PresenceInputSchema.parse(input);
  checkTime(now, state);
  if (event.kingdomId !== state.kingdomId) throw new TypeError('Presence kingdom mismatch');
  if (event.origin !== 'recovered' && event.origin !== state.origin) throw new TypeError('Presence origin mismatch');
  if (event.origin === 'recovered' || event.observedAt > now) return state;
  if (state.recentInputs.ids[shard(event.id)]!.has(event.id)) return state;

  const next = { ...state, asOf: now, recentInputs: remember(state.recentInputs, event.id) };
  if (event.kind === 'stream') {
    const prior = state.stream;
    if (prior && (event.observedAt < prior.observedAt || (event.observedAt === prior.observedAt && (event.live || !prior.live)))) return next;
    const sameSession = prior !== null && prior.live === event.live && prior.sessionId === event.sessionId;
    return {
      ...next,
      stream: {
        live: event.live, sessionId: event.sessionId, observedAt: event.observedAt,
        expiresAt: expiry(event.observedAt, STREAM_LEASE_MS),
        startedAt: sameSession ? prior.startedAt : event.observedAt,
      },
    };
  }

  const people = new PeopleEdit(state.people);
  if (event.kind === 'remove' || event.kind === 'restore') {
    const person = people.get(event.personId) ?? emptyPerson(event.observedAt);
    // This restore is a moderation release, never renewed privacy consent.
    // A delayed forget also survives a newer moderation restore in either order.
    if (event.kind === 'restore' && person.restriction?.reason === 'forget') return next;
    if (event.kind === 'restore' ? event.observedAt <= person.controlAt : event.reason !== 'forget' && event.observedAt < person.restoredAt) return next;
    const restriction = event.kind === 'restore' ? null : mergeRestriction(person.restriction, { reason: event.reason, until: event.until });
    if (event.kind === 'remove' && event.observedAt <= person.controlAt
      && restriction?.reason === person.restriction?.reason && restriction?.until === person.restriction?.until) return next;
    people.set(event.personId, {
      ...person, leases: {}, publicName: null, disclosureAt: Math.max(person.disclosureAt, event.observedAt),
      since: event.observedAt, controlAt: Math.max(person.controlAt, event.observedAt),
      restoredAt: event.kind === 'restore' ? event.observedAt : person.restoredAt, restriction,
    });
    return { ...next, people: people.finish() };
  }

  if (expiry(event.observedAt, PRESENCE_LEASE_MS) <= now) return next;
  if (event.source === 'chatters' && event.observedAt <= state.rosterThrough) return next;
  if (event.coverage === 'complete') {
    const members = new Set(event.people.map(person => person.personId));
    for (const bucket of state.people) {
      for (const [id, person] of bucket) {
        const lease = person.leases.chatters;
        if (!lease || lease.observedAt > event.observedAt || members.has(id)) continue;
        const leases = { ...person.leases };
        delete leases.chatters;
        const updated = { ...person, leases };
        people.set(id, { ...updated, since: activeLeases(updated, event.observedAt).length ? person.since : event.observedAt });
      }
    }
  }
  for (const observed of event.people) {
    const person = people.get(observed.personId) ?? emptyPerson(event.observedAt);
    const sourceAt = person.sourceTimes[event.source] ?? -1;
    if (event.observedAt <= person.controlAt || restricted(person, event.observedAt)) continue;
    if (event.observedAt <= sourceAt) {
      // Same-millisecond withdrawals win without refreshing the source lease.
      if (event.observedAt === sourceAt && event.observedAt === person.disclosureAt
        && event.source !== 'chatters' && observed.disclosure === 'anonymous' && person.publicName !== null) {
        people.set(observed.personId, { ...person, publicName: null });
      }
      continue;
    }
    // Explicit non-roster anonymity withdraws a previous disclosure. A roster
    // never grants or withdraws one; it cannot speak for a quiet viewer.
    const updatesDisclosure = event.source !== 'chatters'
      && (event.observedAt > person.disclosureAt || (event.observedAt === person.disclosureAt && observed.disclosure === 'anonymous'));
    people.set(observed.personId, {
      ...person,
      leases: { ...person.leases, [event.source]: { observedAt: event.observedAt, expiresAt: expiry(event.observedAt, PRESENCE_LEASE_MS) } },
      sourceTimes: { ...person.sourceTimes, [event.source]: event.observedAt },
      publicName: updatesDisclosure ? (observed.disclosure === 'named' ? observed.displayName : null) : person.publicName,
      disclosureAt: updatesDisclosure ? event.observedAt : person.disclosureAt,
      since: personPresent(state, person, event.observedAt) ? person.since : event.observedAt,
    });
  }
  return { ...next, people: people.finish(), rosterThrough: event.coverage === 'complete' ? event.observedAt : state.rosterThrough };
}

/** Expire evidence explicitly. No homes, citizen records or earned things exist here to erase. */
export function advancePresence(state: PresenceState, now: number): PresenceState {
  checkTime(now, state);
  const people = new PeopleEdit(state.people);
  for (const bucket of state.people) {
    for (const [id, person] of bucket) {
      let leases: Partial<Record<PresenceSource, Lease>> | undefined;
      let expiredAt = person.since;
      for (const source of SOURCES) {
        const lease = person.leases[source];
        if (lease && lease.expiresAt <= now) {
          leases ??= { ...person.leases };
          delete leases[source];
          expiredAt = Math.max(expiredAt, lease.expiresAt);
        }
      }
      if (leases) people.set(id, { ...person, leases, since: Object.keys(leases).length ? person.since : expiredAt });
    }
  }
  const updated = people.finish();
  return now === state.asOf && updated === state.people ? state : { ...state, asOf: now, people: updated };
}

/** A monotone sampler, deliberately without historical catch-up or a persistent reward ledger. */
export function presenceTick(state: PresenceState, minuteAt: number): { readonly state: PresenceState; readonly credit: PresenceMinuteCredit | null } {
  EpochMsSchema.parse(minuteAt);
  if (minuteAt % PRESENCE_MINUTE_MS !== 0) throw new RangeError('Presence tick needs an exact minute boundary');
  if (minuteAt <= state.lastMinuteAt || minuteAt < state.asOf) return { state, credit: null };
  const next = { ...advancePresence(state, minuteAt), lastMinuteAt: minuteAt };
  if (streamConnection(next, minuteAt) !== 'fresh') return { state: next, credit: null };
  const personIds: PersonId[] = [];
  for (const bucket of next.people) for (const [id, person] of bucket) if (personPresent(next, person, minuteAt)) personIds.push(id);
  if (!personIds.length) return { state: next, credit: null };
  personIds.sort();
  return {
    state: next,
    credit: { kingdomId: next.kingdomId, origin: next.origin, sessionId: next.stream!.sessionId!, minuteAt, personIds },
  };
}

/** The sole public projection: no person IDs, sessions, sources, restrictions, or input IDs. */
export function projectPresence(state: PresenceState, bindings: readonly PresenceBinding[], now: number, sequence: number, epoch = 'initial'): KingdomPresenceFrame {
  checkTime(now, state);
  UIntSchema.parse(sequence);
  TokenSchema.parse(epoch);
  if (bindings.length > 65535) throw new RangeError('Too many presence bindings');
  const slots = new Set<number>();
  const persons = new Set<PersonId>();
  const connection = streamConnection(state, now);
  const windows = bindings.map(binding => {
    PersonIdSchema.parse(binding.personId);
    if (!Number.isSafeInteger(binding.slot) || binding.slot < 0 || binding.slot > 65534 || slots.has(binding.slot) || persons.has(binding.personId)) {
      throw new TypeError('Presence bindings need unique people and unique valid slots');
    }
    slots.add(binding.slot);
    persons.add(binding.personId);
    const person = getPerson(state, binding.personId);
    const present = person !== undefined && personPresent(state, person, now);
    let since = person?.since ?? 0;
    if (present) since = Math.max(since, state.stream!.startedAt);
    else if (person) {
      const end = Math.max(since, ...SOURCES.map(source => person.leases[source]?.expiresAt ?? 0));
      if (end <= now) since = end;
      if (connection !== 'fresh' && state.stream) since = Math.min(now, state.stream.live ? state.stream.expiresAt : state.stream.observedAt);
    }
    return { slot: binding.slot, present, publicName: present ? person.publicName : null, since };
  }).sort((a, b) => a.slot - b.slot);
  return { version: 1, kingdomId: state.kingdomId, epoch, sequence, asOf: now, origin: state.origin, streamLive: connection === 'fresh', connection, windows };
}
