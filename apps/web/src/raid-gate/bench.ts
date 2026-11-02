/**
 * The gate's labelled bench: the real Raid Gate application, run in the page against the transactional memory
 * repository, a controlled policy and a stand-in for the Atlas finder. Everything it produces is SIMULATED and the
 * pane says so. It exists to exercise the gate before main binds authenticated transports; it is never the default.
 */
import { AtlasChannelSchema, AtlasRaidSchema, type AtlasChannel, type AtlasRaid, type RaidPartyPublicFrame } from '@chatdom/shared';
import { buildRaidPartyFrame } from '../../../realm/src/raid-gate/raid-party-frame';
import { createRaidGateApplication, createRaidMarchCheck } from '../../../api/src/raid-gate/application';
import { createMemoryItemTransfers, type MemoryItemTransfers } from '../../../api/src/raid-gate/gift-memory';
import { createVisitorGifts, type GiftHosts, type GiftItem } from '../../../api/src/raid-gate/gifts';
import { createArrivalWitness } from '../../../realm/src/raid-gate/arrivals';
import { createRaidTravelCoordinator } from '../../../realm/src/raid-gate/coordinator';
import { createMemoryTravelRepository } from '../../../realm/src/raid-gate/memory-repository';
import { createSimulatedRooms, type SimulatedRooms } from '../../../realm/src/raid-gate/simulated-rooms';
import type { GateAuthority, GateContext, GatePrincipal, GateReply, KingdomId, PersonId } from '../../../api/src/raid-gate/contracts';
import { createMemoryRaidGateRepository } from '../../../api/src/raid-gate/memory-repository';
import type { AtlasRoadIngress, AuthorizedRaidTransport, RaidObservationReceipt, RaidWriteOutcome, SourceStanding, TargetVerdict } from '../../../api/src/raid-gate/ports';
import type { AtlasGateEvent, AtlasGateHost, GateKingdom, GateLand, RaidGateApi } from './ports';

const WILLOWMERE = { kingdomId: '41000001' as KingdomId, name: 'Willowmere', login: 'willowmere' } satisfies GateKingdom;

/** SIMULATED channels. None of these is a real Twitch channel's data. */
export type BenchDestination = Readonly<{ channel: AtlasChannel; land: GateLand; live: boolean; group: 'road' | 'realm' }>;
const WILLOWMERE_DESTINATIONS: readonly BenchDestination[] = [
  { channel: AtlasChannelSchema.parse({ kingdomId: '41000002', login: 'fernhollow', displayName: 'Fernhollow', language: 'en', founded: true, kingdomName: 'Fernhollow', contentClassification: 'general' }), land: 'founded', live: true, group: 'road' },
  { channel: AtlasChannelSchema.parse({ kingdomId: '41000003', login: 'oakenfold_plays', displayName: 'oakenfold_plays', language: 'en', founded: false, kingdomName: null, contentClassification: 'general' }), land: 'waiting', live: true, group: 'realm' },
  { channel: AtlasChannelSchema.parse({ kingdomId: '41000005', login: 'saltmarsh', displayName: 'Saltmarsh', language: 'en', founded: true, kingdomName: 'Saltmarsh Reach', contentClassification: 'general' }), land: 'founded', live: true, group: 'realm' },
  { channel: AtlasChannelSchema.parse({ kingdomId: '41000004', login: 'quietharbor', displayName: 'QuietHarbor', language: 'en', founded: true, kingdomName: 'Quiet Harbor', contentClassification: 'general' }), land: 'founded', live: false, group: 'realm' },
];

const STANDINGS: Readonly<Record<GateAuthority, Partial<SourceStanding>>> = {
  ready: {}, offline: { live: false }, 'not-connected': { raids: 'missing' }, revoked: { raids: 'revoked' }, disabled: { actions: 'disabled' }, unavailable: { raids: 'unknown' },
};

/** SIMULATED walkers of Willowmere, so the bench can show a real count growing through real join commands. */
const WALKERS = ['52000001', '52000002', '52000003', '52000004', '52000005', '52000006', '52000007'];

/** SIMULATED Fernhollow: its monarch (the channel's own ID) and one citizen with a deed, there to welcome guests. */
const FERNHOLLOW = '41000002' as KingdomId;
const ASH = '53000001' as PersonId;
const WILLOWMERE_NAMES: Readonly<Record<string, string>> = {
  [FERNHOLLOW]: 'Queen Hazel', [ASH]: 'Ash of the Mill', [WILLOWMERE.kingdomId]: 'King Alder', '52000001': 'Wren', '52000002': 'Tamsin',
};

/**
 * Who stands where on a bench: the kingdom whose gate it is, the destinations its stand-in finder offers, the founded
 * kingdoms with worlds to enter, the kingdom whose hosts welcome the party (its monarch is the channel itself, and one
 * SIMULATED citizen keeps a gift ready) and every name the SIMULATED hosts directory answers with.
 */
export type BenchCast = Readonly<{
  source: GateKingdom;
  destinations: readonly BenchDestination[];
  rooms: readonly KingdomId[];
  welcome: Readonly<{ kingdomId: KingdomId; name: string; host: PersonId; things: Readonly<{ hostGift: string; monarchGift: string }> }>;
  names: Readonly<Record<string, string>>;
  /** What the viewer (the first SIMULATED walker) carries from home. */
  carried: Readonly<{ crafted: string; forged: string }>;
}>;

/** The default bench: Willowmere's gate, Fernhollow's welcome. All SIMULATED. */
export const WILLOWMERE_CAST: BenchCast = {
  source: WILLOWMERE, destinations: WILLOWMERE_DESTINATIONS, rooms: [WILLOWMERE.kingdomId, FERNHOLLOW, '41000005' as KingdomId],
  welcome: { kingdomId: FERNHOLLOW, name: 'Fernhollow', host: ASH, things: { hostGift: 'Lantern of the sleeping fox', monarchGift: 'Fern-sprig welcome loaf' } },
  names: WILLOWMERE_NAMES, carried: { crafted: 'A copper acorn', forged: 'Willow-bark lantern' },
};

/** SIMULATED things in the SIMULATED item store: what the viewer carries from home, and what the hosts may give. */
function benchItems(cast: BenchCast): GiftItem[] {
  const home = cast.source.kingdomId, away = cast.welcome.kingdomId;
  const thing = (itemId: string, ownerId: string, kind: GiftItem['kind'], title: string, makerId: string, originKingdomId: KingdomId): GiftItem => ({
    itemId, revision: 1, ownerId: ownerId as PersonId, kind, title, makerId: makerId as PersonId, makerName: cast.names[makerId] ?? null,
    originKingdomId, originName: originKingdomId === away ? cast.welcome.name : cast.source.name, transferable: kind !== 'light' && kind !== 'keepsake', paid: false, origin: 'simulated',
  });
  return [
    thing('home-crafted', '52000001', 'crafted', cast.carried.crafted, '52000001', home),
    thing('home-forged', '52000001', 'forged', cast.carried.forged, '52000002', home),
    // Bound things never show on a shelf: a light and a keepsake stay with their holder.
    thing('home-hearth', '52000001', 'light', 'Hearth light', '52000001', home),
    thing('home-medal', '52000001', 'keepsake', 'First-snow keepsake', '52000001', home),
    thing('host-forged', cast.welcome.host, 'forged', cast.welcome.things.hostGift, cast.welcome.host, away),
    thing('host-offering', away as unknown as PersonId, 'welcome-offering', cast.welcome.things.monarchGift, away, away),
  ];
}

/**
 * How the SIMULATED Twitch answers a start: accept it, accept it but lose the reply on the way back (the gate must
 * check rather than press again), or refuse it.
 */
export type BenchTwitch = 'accept' | 'lose' | 'refuse';
/**
 * How the SIMULATED rooms answer a journey: ready after a short drawing, slow (an overrun), never ready (`hold`), the
 * arrival's answer lost on the way back (`lose`), or refused at the door (`deny`).
 */
export type BenchRooms = 'ready' | 'slow' | 'hold' | 'lose' | 'deny';
export type GateBenchOptions = Readonly<{ viewer: 'monarch' | 'walker'; authority: GateAuthority; clock: () => number; twitch?: BenchTwitch; rooms?: BenchRooms; cast?: BenchCast }>;

export type GateBench = Readonly<{
  source: GateKingdom;
  api: RaidGateApi;
  atlas: AtlasGateHost;
  /** The stand-in finder's state, for the bench view to draw. */
  finder: Readonly<{ open: () => boolean; entries: readonly BenchDestination[]; pick: (kingdomId: KingdomId) => void; close: () => void; onChange: (listener: () => void) => void }>;
  /** Runs the monarch's own preview as the monarch, for a walker bench. */
  monarchPreview(target: KingdomId): Promise<GateReply>;
  /** Runs the monarch's own close as the monarch, for a walker bench. */
  monarchClose(requestId: string): Promise<GateReply>;
  /** SIMULATED: the monarch renews the raid grant, as the throne's Twitch connection would. */
  reconnect(): void;
  /** SIMULATED walkers send their own join commands. */
  walkersJoin(count: number, requestId: string): Promise<void>;
  /** The monarch chooses to march at the head of their own party. */
  monarchJoin(requestId: string): Promise<GateReply>;
  /**
   * The public gate party now, built by the realm's own rule from this bench's gate records: who joined, in their
   * starter looks, the monarch first. Null when the gate holds no party.
   */
  partyFrame(): Promise<RaidPartyPublicFrame | null>;
  /** Runs the monarch's own start as the monarch, with the token their last bench preview received. */
  monarchStart(requestId: string): Promise<GateReply>;
  /** SIMULATED: Twitch's `channel.raid` for this request arrives through the verified-ingress path. */
  witness(requestId: string, viewers?: number): Promise<RaidObservationReceipt>;
  /** SIMULATED Twitch writes, in order, and the roads handed to the stand-in Atlas ledger. */
  readonly log: Readonly<{ writes: readonly string[]; roads: readonly AtlasRaid[]; followed: readonly string[]; travel: readonly string[] }>;
  /** The SIMULATED room transport behind journeys. */
  readonly rooms: SimulatedRooms;
  /** The SIMULATED item store behind gifts. */
  readonly items: MemoryItemTransfers;
  /** SIMULATED: these marchers (after the viewer) follow the witnessed raid through the gate themselves. */
  partyTravel(requestId: string, raidId: string, count: number): Promise<number>;
  /** SIMULATED: a Fernhollow host greets the viewer's arrival and offers the first thing on their shelf. */
  hostOffer(host: 'monarch' | 'ash'): Promise<GateReply>;
}>;

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

/** A stable 24-hex key for the bench's marchers (the realm uses SHA-256; any stable opaque key serves a bench). */
function hex24(text: string): string {
  let out = '';
  for (let round = 0; round < 3; round++) {
    let h = 2166136261 ^ round;
    for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
    out += (h >>> 0).toString(16).padStart(8, '0');
  }
  return out;
}

export function createGateBench(options: GateBenchOptions): GateBench {
  const cast = options.cast ?? WILLOWMERE_CAST;
  const SOURCE = cast.source, DESTINATIONS = cast.destinations, FERN = cast.welcome.kingdomId, NAMES = cast.names;
  const FERN_HOSTS = { monarch: FERN as unknown as PersonId, ash: cast.welcome.host } as const;
  const repository = createMemoryRaidGateRepository();
  let authority = options.authority;
  const subscribers = new Set<() => void>();
  const log = { writes: [] as string[], roads: [] as AtlasRaid[], followed: [] as string[], travel: [] as string[] };
  /** SIMULATED Twitch: keeps its own record of each write by key so reconcile can answer for a lost reply. */
  const ledger = new Map<string, RaidWriteOutcome>();
  const accepted: Map<string, number> = new Map();
  const twitch = options.twitch ?? 'accept';
  const raids: AuthorizedRaidTransport = {
    origin: 'simulated',
    async start(write) {
      log.writes.push(`start ${write.requestId}`);
      const outcome: RaidWriteOutcome = twitch === 'refuse' ? { kind: 'rejected', code: 'simulated-refusal' } : { kind: 'accepted', createdAt: options.clock() };
      ledger.set(write.key, outcome);
      if (outcome.kind === 'accepted') accepted.set(write.requestId, outcome.createdAt);
      if (twitch === 'lose') throw new Error('SIMULATED: the reply was lost on the way back');
      return outcome;
    },
    async cancel(write) {
      log.writes.push(`cancel ${write.requestId}`);
      const outcome: RaidWriteOutcome = { kind: 'accepted', createdAt: options.clock() };
      ledger.set(write.key, outcome);
      return outcome;
    },
    async reconcile(write) { return ledger.get(write.key) ?? { kind: 'unknown' }; },
  };
  /** Stand-in for the Atlas road ledger: idempotent by raid ID. */
  const roads: AtlasRoadIngress = {
    origin: 'simulated',
    async observe(raid) { if (!log.roads.some(each => each.id === raid.id)) log.roads.push(raid); },
  };
  const tokens = new Map<string, string>();
  // SIMULATED rooms: the cast's founded kingdoms have worlds to enter; waiting land has none.
  const roomMode = options.rooms ?? 'ready';
  const rooms = createSimulatedRooms({
    clock: options.clock, rooms: [...cast.rooms],
    prepareSteps: roomMode === 'hold' ? Number.MAX_SAFE_INTEGER : roomMode === 'slow' ? 9 : 2,
  });
  if (roomMode === 'lose') rooms.loseNextCommitAnswer();
  if (roomMode === 'deny') rooms.denyNextCommit();
  const journeys = createMemoryTravelRepository();
  const travel = createRaidTravelCoordinator({
    repository: journeys, rooms: rooms.transport, marches: createRaidMarchCheck(repository), origin: 'simulated', clock: options.clock,
  });
  const items = createMemoryItemTransfers('simulated');
  items.seed(benchItems(cast));
  const hosts: GiftHosts = {
    origin: 'simulated',
    async standing(personId, kingdomId) {
      if (String(personId) === String(kingdomId)) return 'monarch';
      return personId === FERN_HOSTS.ash && kingdomId === FERN ? 'citizen' : 'none';
    },
    async names(personIds) { return new Map(personIds.filter(id => NAMES[id]).map(id => [id, NAMES[id]!])); },
  };
  const gifts = createVisitorGifts({ items, arrivals: createArrivalWitness({ repository: journeys, origin: 'simulated' }), hosts, origin: 'simulated' });
  const app = createRaidGateApplication({
    repository, origin: 'simulated', clock: options.clock, raids, roads, travel, gifts,
    policy: {
      async readStanding(principal) {
        return { session: 'current', broadcaster: String(principal.personId) === String(SOURCE.kingdomId), live: true, raids: 'granted', actions: 'enabled', ...STANDINGS[authority] };
      },
      async readTarget(_from, kingdomId): Promise<TargetVerdict | null> {
        const entry = DESTINATIONS.find(each => each.channel.kingdomId === kingdomId);
        return entry ? { target: { kingdomId, founded: entry.channel.founded, live: entry.live, classification: entry.channel.contentClassification }, permitted: true } : null;
      },
    },
    tokens: {
      issue: () => [...crypto.getRandomValues(new Uint8Array(18))].map(byte => byte.toString(16).padStart(2, '0')).join(''),
      hash: sha256Hex,
    },
    // Each subscriber re-reads with its own principal; the change itself carries nothing.
    notifier: { changed: () => queueMicrotask(() => { for (const subscriber of subscribers) subscriber(); }) },
  });
  const principal = (personId: string, kingdomId: KingdomId = SOURCE.kingdomId): GatePrincipal => ({
    personId: personId as GatePrincipal['personId'], sessionId: `bench-${personId}`, sourceKingdomId: kingdomId,
    sourceRole: personId === kingdomId ? 'monarch' : 'citizen',
  });
  const as = (personId: string, command: unknown, kingdomId?: KingdomId) => {
    const context: GateContext = { principal: principal(personId, kingdomId), now: options.clock(), signal: new AbortController().signal };
    return app.handle(context, command);
  };
  const viewerId = options.viewer === 'monarch' ? SOURCE.kingdomId : WALKERS[0]!;

  const api: RaidGateApi = {
    origin: 'simulated',
    request: (command, signal) => { signal.throwIfAborted(); return as(viewerId, command); },
    subscribe(_requestId, onReply, signal) {
      const deliver = () => { if (!signal.aborted) void as(viewerId, { op: 'gate' }).then(onReply); };
      subscribers.add(deliver);
      signal.addEventListener('abort', () => subscribers.delete(deliver), { once: true });
    },
  };

  let open = false;
  const finderListeners = new Set<() => void>();
  const atlasListeners = new Set<(event: AtlasGateEvent) => void>();
  const changed = () => { for (const listener of finderListeners) listener(); };
  const emit = (event: AtlasGateEvent) => { for (const listener of atlasListeners) listener(event); };
  const atlas: AtlasGateHost = {
    origin: 'simulated',
    open() { open = true; changed(); },
    close() { if (open) { open = false; changed(); emit({ kind: 'closed' }); } },
    follow(raid) { log.followed.push(raid.id); },
    travel(stage) { log.travel.push(`${stage.kind} ${stage.state}`); },
    async resolve(kingdomId) {
      const entry = DESTINATIONS.find(each => each.channel.kingdomId === kingdomId);
      return entry ? { channel: entry.channel, land: entry.land } : null;
    },
    subscribe(listener, signal) {
      atlasListeners.add(listener);
      signal.addEventListener('abort', () => atlasListeners.delete(listener), { once: true });
    },
  };

  return {
    source: SOURCE, api, atlas,
    finder: {
      open: () => open, entries: DESTINATIONS,
      pick(kingdomId) {
        const entry = DESTINATIONS.find(each => each.channel.kingdomId === kingdomId);
        if (!entry) return;
        open = false; changed();
        emit({ kind: 'target', channel: entry.channel, land: entry.land });
      },
      close: () => atlas.close(),
      onChange: listener => { finderListeners.add(listener); },
    },
    reconnect() {
      if (authority !== 'not-connected' && authority !== 'revoked') return;
      authority = 'ready';
      for (const subscriber of subscribers) subscriber();
    },
    async monarchPreview(target) {
      const reply = await as(SOURCE.kingdomId, { op: 'preview', requestId: crypto.randomUUID(), target });
      if (reply.kind === 'preview') tokens.set(reply.value.requestId, reply.value.token);
      return reply;
    },
    monarchJoin: requestId => as(SOURCE.kingdomId, { op: 'join', requestId }),
    async partyFrame() {
      const now = options.clock();
      return repository.transaction(async tx => {
        const pointer = await tx.getGate(SOURCE.kingdomId);
        const action = pointer?.requestId ? await tx.getAction(pointer.requestId) : null;
        if (!action) return null;
        const people = [SOURCE.kingdomId as string, ...WALKERS];
        const members = (await Promise.all(people.map(personId => tx.getMember(action.requestId, personId as PersonId))))
          .flatMap(record => record ? [{ record, name: NAMES[record.personId] ?? null }] : []);
        const channel = DESTINATIONS.find(each => each.channel.kingdomId === action.to)?.channel;
        return buildRaidPartyFrame({ origin: 'simulated', kingdomId: SOURCE.kingdomId, now, action, members,
          faces: { source: { login: SOURCE.login, name: SOURCE.name }, destination: { login: channel?.login ?? null, name: channel?.displayName ?? null } },
          key: (requestId, personId) => `marcher.${hex24(`${requestId}\u0000${personId}`)}` });
      }, new AbortController().signal);
    },
    monarchStart: requestId => as(SOURCE.kingdomId, { op: 'start', requestId, previewToken: tokens.get(requestId) ?? 'none' }),
    async witness(requestId, viewers = 23) {
      const action = await as(SOURCE.kingdomId, { op: 'read-action', requestId });
      if (action.kind !== 'action') return { kind: 'ignored', reason: 'unknown-request' };
      const at = options.clock();
      const raid = AtlasRaidSchema.parse({
        version: 1, id: `raid.${await sha256Hex(`bench-raid\u0000${requestId}`)}`, fromKingdomId: action.value.from, toKingdomId: action.value.to, viewers,
        observedAt: at, occurredAt: at, evidence: { kind: 'simulated', asOf: at, label: 'SIMULATED' }, delivery: 'resumable', source: 'simulation',
      });
      // As main's verified ingress would: correlated to the request its transport sent, with an upstream event ID.
      return app.ingestRaid({ raid, upstreamEventId: `simulated-event-${requestId}`, actionRequestId: accepted.has(requestId) ? requestId : null, receivedAt: at });
    },
    log, rooms, items,
    async partyTravel(requestId, raidId, count) {
      let arrived = 0;
      const others = WALKERS.slice(options.viewer === 'walker' ? 1 : 0).slice(0, count);
      for (const personId of others) {
        let reply = await as(personId, { op: 'reserve', requestId: `bench-${personId}-${requestId}`, target: FERN, reason: { kind: 'raid', requestId, raidId } });
        for (let step = 0; step < 16 && reply.kind === 'travel' && reply.value.state !== 'committed'; step++) {
          const { ticket, state } = reply.value;
          if (state !== 'reserved' && state !== 'preparing' && state !== 'ready') break;
          reply = await as(personId, { op: state === 'ready' ? 'commit' : 'prepare', ticket });
        }
        if (reply.kind === 'travel' && reply.value.state === 'committed') arrived++;
      }
      return arrived;
    },
    async hostOffer(host) {
      const hostId = FERN_HOSTS[host];
      const welcome = await as(hostId, { op: 'welcome', arrivalId: null }, FERN);
      if (welcome.kind !== 'welcome') return welcome;
      const guest = welcome.value.guests.find(each => each.personId === viewerId);
      const thing = welcome.value.shelf[0];
      if (!guest || !thing) return { kind: 'denied', code: 'stale' };
      return as(hostId, { op: 'offer-gift', requestId: crypto.randomUUID(), itemId: thing.itemId, recipient: guest.personId, arrivalId: guest.arrivalId }, FERN);
    },
    monarchClose: requestId => as(SOURCE.kingdomId, { op: 'cancel', requestId }),
    async walkersJoin(count, requestId) {
      for (const personId of WALKERS.slice(options.viewer === 'walker' ? 1 : 0, (options.viewer === 'walker' ? 1 : 0) + count)) await as(personId, { op: 'join', requestId });
    },
  };
}
