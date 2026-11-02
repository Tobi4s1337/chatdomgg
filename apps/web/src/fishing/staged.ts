import { FISHING_CHANNEL, fishingRodHistory, type FishingPierSite, type ItemRecord, type KingdomId, type PersonId, type Vec3 } from '@chatdom/shared';
import type { RealmChannelPose, RealmChannelRoom, RealmChannelSender } from '../../../realm/src/room-channels';
import { createFishingCasts } from '../../../realm/src/fishing/cast';
import type { FishingWaterSampler } from '../../../realm/src/fishing/cast-site';
import { createFishingRoomChannel } from '../../../realm/src/fishing/channel';
import type { FishingCatchRecord, FishingCatchResult } from '../../../realm/src/fishing/catches';
import { createFishingSpecies } from '../../../realm/src/fishing/species';
import { FISH_SPECIES } from '../../../../packages/content/src/fish';
import type { ChannelRoom } from './link';

/**
 * The review bench's own pier: the real room channel, cast, bite, fight and replay rules, run in this page with an
 * in-memory rack and keeper. It is never a kingdom: nothing here reaches a realm, a bag on a server or a public page.
 */
export interface StagedFisher {
  readonly personId: string; readonly walkerId: string; readonly name: string;
  pose(): RealmChannelPose | null;
}
export interface StagedPierOptions {
  readonly kingdomId: string;
  readonly site: FishingPierSite;
  readonly rack: Vec3;
  /** Where the staged Almanac lectern stands. */
  readonly almanac?: Vec3;
  readonly revision: number;
  readonly sample: FishingWaterSampler;
  readonly where: string;
  readonly people: readonly StagedFisher[];
  readonly clock?: () => number;
  /** Deterministic cast seeds for a recorded review; random otherwise. */
  readonly seeds?: readonly number[];
  readonly onGrant?: (record: ItemRecord) => void;
  /** A staged rod's earlier history per person: fish it has landed and the legend it once held. */
  readonly rods?: Readonly<Record<string, { readonly catches: number; readonly legend?: string }>>;
}

const uuid = () => crypto.randomUUID();
const HOURS = { dawn: 'at dawn', day: 'by day', dusk: 'at dusk', night: 'at night' } as const;
const MOODS = { clear: 'clear weather', breeze: 'a light breeze', mist: 'the mist', rain: 'the rain' } as const;

export function createStagedPier(options: StagedPierOptions) {
  const clock = options.clock ?? (() => Date.now());
  const kingdomId = options.kingdomId as KingdomId;
  const species = createFishingSpecies(FISH_SPECIES);
  const rooms = new Map<string, { listeners: Set<(message: unknown) => void> }>();
  for (const person of options.people) rooms.set(person.personId, { listeners: new Set() });
  const senders = new Map<string, RealmChannelSender>(options.people.map(person => [person.personId, {
    principal: { personId: person.personId as PersonId, kingdomId, origin: 'simulated', sessionId: uuid(), expiresAt: Number.MAX_SAFE_INTEGER,
      publicName: person.name, look: 'staged' } as RealmChannelSender['principal'],
    walkerId: person.walkerId, pose: person.pose, present: () => true, current: async () => true,
  }]));
  const deliver = (personId: string, message: unknown) => {
    const room = rooms.get(personId);
    // Delivered on a microtask, as a socket would, so no reply re-enters the sender's own call.
    if (room) queueMicrotask(() => { for (const listener of [...room.listeners]) listener(structuredClone(message)); });
  };
  let receive!: Parameters<RealmChannelRoom['onMessage']>[0];
  const room: RealmChannelRoom = {
    kingdomId, origin: 'simulated', onMessage(listener) { receive = listener; },
    broadcast(message) { for (const personId of rooms.keys()) deliver(personId, message); },
    toPerson(personId, message) { deliver(personId, message); },
    person: personId => senders.get(personId) ?? null,
    world: () => { throw new Error('The staged pier has no collision world.'); },
  };
  const installation = { site: options.site, revision: options.revision, rack: options.rack, sample: options.sample, biome: null,
    ...(options.almanac ? { almanac: options.almanac } : {}) };
  const records = new Map<string, ItemRecord>(), firsts = new Set<string>(), personal = new Set<string>();
  // The rod's history: staged earlier catches (`rods`) plus what is landed here.
  const rodCatches = new Map<string, number>(Object.entries(options.rods ?? {}).map(([person, rod]) => [person, rod.catches]));
  const rodLegends = new Map<string, { speciesId: string; at: number }>(Object.entries(options.rods ?? {})
    .flatMap(([person, rod]) => rod.legend ? [[person, { speciesId: rod.legend, at: clock() - 86_400_000 }] as const] : []));
  const historyOf = (owner: string) => fishingRodHistory(rodCatches.get(owner) ?? 0, rodLegends.get(owner) ?? null);
  let seedIndex = 0;
  const makeRecord = (owner: string, defId: string, place: ItemRecord['place'], storied: boolean, story: ItemRecord['story'],
    source: ItemRecord['source'], detail: ItemRecord['detail'], slot: number | null): ItemRecord => ({
    version: 1, id: uuid(), defId, branch: defId.startsWith('tool:') ? 'held' : 'gathered', ownerId: owner as PersonId, kingdomId,
    origin: 'simulated', place, slot, count: 1, storied, number: null, story, source, detail, createdAt: clock(), revision: 0,
  });
  let casts!: ReturnType<typeof createFishingCasts>;
  const channel = createFishingRoomChannel({
    bind(_room, selected) {
      casts = createFishingCasts({ kingdomId, clock, species,
        seat: personId => {
          const sender = senders.get(personId), pose = sender?.pose();
          return sender && pose ? { token: sender.walkerId, pose, ownsRod: !!selected(personId, sender.walkerId), reachM: historyOf(personId).reachM } : null;
        },
        installation: () => installation, makeId: uuid,
        seed: () => options.seeds?.length ? options.seeds[seedIndex++ % options.seeds.length]! : crypto.getRandomValues(new Uint32Array(1))[0]! });
      return {
        casts, now: clock, installation: () => installation,
        async refreshRod(_from, itemId) { return records.get(itemId) ?? null; },
        async takeRod(from) {
          const owner = from.principal.personId;
          const existing = [...records.values()].find(item => item.ownerId === owner && item.defId === 'tool:rod.willow');
          if (existing) return { status: 'taken' as const, item: existing };
          const person = options.people.find(entry => entry.personId === owner)!;
          const item = makeRecord(owner, 'tool:rod.willow', 'hotbar', true,
            { by: { personId: owner, name: person.name }, kingdomId, where: options.where, at: clock(), line: 'Taken from the rod rack.' },
            { kind: 'pier', ref: `rack:${owner}` }, {}, 0);
          records.set(item.id, item); options.onGrant?.(item);
          return { status: 'taken' as const, item };
        },
        async keep(from, castId): Promise<FishingCatchResult> {
          const owner = from.principal.personId, candidate = casts.candidate(owner);
          if (!candidate || candidate.castId !== castId) return { status: 'refused', message: 'That catch cannot be kept here. Cast again when you are ready.' };
          const fish = species.get(candidate.fish.speciesId)!;
          const kingdomFirst = !firsts.has(fish.id), personalFirst = !personal.has(`${owner}:${fish.id}`);
          firsts.add(fish.id); personal.add(`${owner}:${fish.id}`);
          const person = options.people.find(entry => entry.personId === owner)!;
          const item = makeRecord(owner, fish.id, 'bag', personalFirst || fish.rarity === 'rare',
            { by: { personId: owner, name: person.name }, kingdomId, where: options.where, at: candidate.at,
              line: `Caught ${HOURS[candidate.environment.hour]} in ${MOODS[candidate.environment.mood]}.` },
            { kind: 'fishing', ref: castId }, { lengthMm: candidate.fish.lengthMm, weightG: candidate.fish.weightG,
              hour: candidate.environment.hour, mood: candidate.environment.mood, water: candidate.environment.water }, null);
          records.set(item.id, item); options.onGrant?.(item);
          const record: FishingCatchRecord = { version: 1, id: castId, kingdomId, origin: 'simulated', ownerId: owner, speciesId: fish.id,
            itemId: item.id, grantKey: `fishing:catch:1:${castId}`, caughtAt: candidate.at, personalFirst, kingdomFirst, rarity: fish.rarity,
            fish: candidate.fish, environment: candidate.environment, float: candidate.float, anchor: candidate.anchor,
            collisionRevision: candidate.collisionRevision,
            proof: { version: 1, castSeed: candidate.castSeed, fightSeed: candidate.fightSeed, inputs: candidate.inputs, result: candidate.result } };
          casts.finish(owner, castId);
          rodCatches.set(owner, (rodCatches.get(owner) ?? 0) + 1);
          if (fish.legend && !rodLegends.has(owner)) rodLegends.set(owner, { speciesId: fish.id, at: candidate.at });
          return { status: 'kept', catch: record, item, keepsake: null, replayed: false };
        },
        async rodHistory(from) { return historyOf(from.principal.personId); },
        onRodChange: () => () => {},
        dispose: () => casts.dispose(),
      };
    },
  });
  const detach = channel.attach(room);
  return {
    /** The person's side of the walking room, as the client's fishing link sees it. */
    room(personId: string): ChannelRoom {
      const entry = rooms.get(personId), sender = senders.get(personId);
      if (!entry || !sender) throw new Error('That person is not at the staged pier.');
      return {
        onMessage(type, listener) {
          if (type !== FISHING_CHANNEL) return () => {};
          entry.listeners.add(listener); return () => { entry.listeners.delete(listener); };
        },
        send(type, payload) { if (type === FISHING_CHANNEL) queueMicrotask(() => { void receive(sender, structuredClone(payload)); }); },
      };
    },
    records: (): readonly ItemRecord[] => [...records.values()],
    views: () => casts.views(),
    dispose() { detach(); for (const entry of rooms.values()) entry.listeners.clear(); },
  };
}
export type StagedPier = ReturnType<typeof createStagedPier>;
