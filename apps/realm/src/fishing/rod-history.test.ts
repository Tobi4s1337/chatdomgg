import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { fishingRodHistory, KingdomIdSchema, PersonIdSchema, ROD_MAX_REACH_M, type FishingChannelReply, type FishingPierSite,
  type FishingRodHistory, type FishSpecies, type ItemRecord } from '@chatdom/shared';
import type { RealmChannelRoom, RealmChannelSender } from '../room-channels';
import { aimFishingCast } from './cast-site';
import { createFishingCasts } from './cast';
import { createFishingRoomChannel } from './channel';
import type { FishingCatchResult } from './catches';
import { createFishingSpecies } from './species';

describe('the rod’s history', () => {
  it('carves a notch per ten catches, ties a ribbon after the first legend, and reaches a little further by doing', () => {
    expect(fishingRodHistory(0)).toEqual({ catches: 0, notches: 0, legend: null, reachM: 0 });
    expect(fishingRodHistory(9)).toMatchObject({ notches: 0, reachM: 0 });
    expect(fishingRodHistory(10)).toMatchObject({ notches: 1, reachM: 0 });
    expect(fishingRodHistory(25)).toMatchObject({ notches: 2, reachM: .25 });
    expect(fishingRodHistory(119)).toMatchObject({ notches: 11, reachM: 1 });
    expect(fishingRodHistory(5000)).toMatchObject({ notches: 12, reachM: ROD_MAX_REACH_M });
    expect(fishingRodHistory(-4)).toMatchObject({ catches: 0, notches: 0 });
    expect(fishingRodHistory(Number.NaN)).toMatchObject({ catches: 0 });
    expect(fishingRodHistory(3, { speciesId: 'fish:stormcrown-sturgeon', at: 99 }).legend).toEqual({ speciesId: 'fish:stormcrown-sturgeon', at: 99 });
  });

  it('reach only lengthens a full cast, and never past its bound', () => {
    const site: FishingPierSite = { version: 1, id: 'pier:lake', root: [0, 0, 0], turn: 0, deckY: 1, waterY: 0, walk: 20, water: 'lake', biome: 'unknown', depth: [] };
    const pose = { position: [0, 1, 23.4] as const, yaw: 0, grounded: true, collisionRevision: 7 };
    const sample = () => ({ waterY: 0, groundY: -3 });
    const distance = (charge: number, reach?: number) => {
      const aim = aimFishingCast(site, pose, 7, charge, sample, reach);
      if (!aim.ok) throw new Error(aim.message);
      return aim.float[2] - pose.position[2];
    };
    expect(distance(1600, 1) - distance(1600)).toBeCloseTo(1, 6);
    expect(distance(1600, 99) - distance(1600)).toBeCloseTo(ROD_MAX_REACH_M, 6);
    expect(distance(1600, -5)).toBeCloseTo(distance(1600), 6);
    expect(distance(200, 1.5)).toBeCloseTo(distance(200), 6);
    expect(distance(900, 1) - distance(900)).toBeCloseTo(.5, 6);
  });
});

describe('the fishing channel carries the rod’s history', () => {
  const kingdomId = KingdomIdSchema.parse('200'), owner = PersonIdSchema.parse('100'), watcher = PersonIdSchema.parse('101');
  const site: FishingPierSite = { version: 1, id: 'pier:lake', root: [0, 0, 0], turn: 0, deckY: 1, waterY: 0, walk: 20, water: 'lake', biome: 'unknown', depth: [] };
  const fish: FishSpecies = { id: 'fish:perch', name: 'Perch', lore: 'A fish.', riddle: 'A glint.', rarity: 'common', weight: 1,
    waters: ['lake'], biomes: ['*'], hours: ['dawn', 'day', 'dusk', 'night'], moods: ['clear', 'breeze', 'mist', 'rain'], minDepthM: 1,
    lengthMm: [100, 200], weightG: [100, 500], fight: 'steady' };
  const rodRecord = (): ItemRecord => ({ version: 1, id: randomUUID(), defId: 'tool:rod.willow', branch: 'held', ownerId: owner, kingdomId, origin: 'simulated',
    place: 'hotbar', slot: 0, count: 1, storied: true, number: null, story: { by: null, kingdomId, where: 'pier', at: 1, line: 'Taken from the rack.' },
    source: { kind: 'pier', ref: 'rack' }, detail: {}, createdAt: 1, revision: 0 });

  it('in the owner’s state, on the rod others see, and after a kept catch; reach reaches the cast', async () => {
    let listener!: Parameters<RealmChannelRoom['onMessage']>[0];
    const publicMessages: FishingChannelReply[] = [], privateMessages: FishingChannelReply[] = [];
    const senders = new Map<string, RealmChannelSender>();
    const sender = (personId: typeof owner, walkerId: string): RealmChannelSender => {
      const value: RealmChannelSender = { principal: { personId, kingdomId, origin: 'simulated', sessionId: randomUUID(), expiresAt: 9e12, publicName: 'Juniper', look: 'look' },
        walkerId, pose: () => ({ position: [0, 1, 23.4], yaw: 0, grounded: true, collisionRevision: 7 }), present: () => true, current: async () => true };
      senders.set(personId, value); return value;
    };
    const from = sender(owner, 'seat'); sender(watcher, 'other');
    const room: RealmChannelRoom = { kingdomId, origin: 'simulated', onMessage(fn) { listener = fn; },
      broadcast(message) { publicMessages.push(message as FishingChannelReply); }, toPerson(_person, message) { privateMessages.push(message as FishingChannelReply); },
      person: personId => senders.get(personId) ?? null, world: () => { throw new Error('unused'); } };
    const installation = { site, biome: 'meadow', revision: 7, rack: [0, 1, 23.4] as const, sample: () => ({ waterY: 0, groundY: -2 }) };
    const owned = rodRecord();
    let catches = 29, reads = 0, seenReach = -1;
    const history = (): FishingRodHistory => fishingRodHistory(catches, catches >= 30 ? { speciesId: 'fish:frostking-char', at: 5 } : null);
    const channel = createFishingRoomChannel({
      schedule: () => () => {},
      bind(_room, selected) {
        const casts = createFishingCasts({ kingdomId, clock: () => 1_000_000, species: createFishingSpecies([fish]),
          seat: personId => { const s = senders.get(personId), pose = s?.pose(); seenReach = history().reachM;
            return s && pose ? { token: s.walkerId, pose, ownsRod: !!selected(personId, s.walkerId), reachM: history().reachM } : null; },
          installation: () => installation, makeId: randomUUID, seed: () => 1 });
        return { casts, now: () => 1_000_000, installation: () => installation,
          refreshRod: async (_s, id) => id === owned.id ? owned : null,
          takeRod: async () => ({ status: 'taken' as const, item: owned }),
          rodHistory: async () => { reads++; return history(); },
          keep: async (): Promise<FishingCatchResult> => {
            catches++;
            const item = { ...rodRecord(), id: randomUUID(), defId: fish.id, branch: 'gathered' as const, place: 'bag' as const, slot: null };
            return { status: 'kept', replayed: false, item, keepsake: null, catch: { version: 1, id: castId, kingdomId, origin: 'simulated', ownerId: owner,
              speciesId: fish.id, itemId: item.id, grantKey: `fishing:catch:1:${castId}`, caughtAt: 1_000_000, personalFirst: false, kingdomFirst: false,
              rarity: 'common', fish: { speciesId: fish.id, lengthMm: 150, weightG: 300 } } as never };
          },
          onRodChange: () => () => {}, dispose: () => casts.dispose() };
      },
    });
    const castId = randomUUID();
    const dispose = channel.attach(room);
    await listener(from, { type: 'pier.equip', id: 'equip', itemId: owned.id });
    const state = privateMessages.at(-1);
    expect(state).toMatchObject({ type: 'pier.state', self: { history: { catches: 29, notches: 2, legend: null, reachM: .25 } } });
    expect(state?.type === 'pier.state' && state.rods).toEqual([{ walkerId: 'seat', model: 'tool:rod.willow', notches: 2, ribbon: false }]);
    expect(publicMessages.find(message => message.type === 'pier.rod')).toMatchObject({ walkerId: 'seat', equipped: true, notches: 2, ribbon: false });
    expect(JSON.stringify(publicMessages)).not.toContain('catches');
    // The history is read once for a seat, not on every sync.
    await listener(from, { type: 'pier.sync', id: 'again' });
    expect(reads).toBe(1);
    // A draw reads the earned reach from the seat.
    await listener(from, { type: 'pier.draw', id: 'draw' });
    expect(seenReach).toBe(.25);
    // The thirtieth fish: a third notch and (here) a legend's ribbon, told to the owner and shown to everyone.
    publicMessages.length = 0;
    await listener(from, { type: 'pier.keep', id: 'keep', castId });
    expect(privateMessages.find(message => message.type === 'pier.kept')).toMatchObject({ history: { catches: 30, notches: 3, legend: { speciesId: 'fish:frostking-char' } } });
    expect(publicMessages.find(message => message.type === 'pier.rod')).toMatchObject({ equipped: true, notches: 3, ribbon: true });
    dispose();
  });
});
