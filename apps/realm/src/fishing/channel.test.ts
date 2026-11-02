import { expect, it } from 'vitest';
import { FishingChannelRequestSchema } from '@chatdom/shared';

it('refuses client-selected owner, clock, proof and outcome fields', () => {
  const draw = { type: 'pier.draw', id: 'request' };
  expect(FishingChannelRequestSchema.safeParse(draw).success).toBe(true);
  for (const [key, value] of Object.entries({ ownerId: '101', time: 1, seed: 42, pose: [0, 0, 0], tape: [], candidate: {}, caught: true, fish: 'fish:perch' })) {
    expect(FishingChannelRequestSchema.safeParse({ ...draw, [key]: value }).success, key).toBe(false);
  }
  expect(FishingChannelRequestSchema.safeParse({ type: 'pier.keep', id: 'x', castId: 'not-a-uuid' }).success).toBe(false);
  expect(FishingChannelRequestSchema.safeParse({ type: 'pier.equip', id: 'x', itemId: 'not-a-uuid' }).success).toBe(false);
});

import { randomUUID } from 'node:crypto';
import { fishingHash, KingdomIdSchema, PersonIdSchema, type FishSpecies, type FishingChannelReply, type FishingPierSite, type ItemRecord } from '@chatdom/shared';
import type { RealmChannelRoom, RealmChannelSender } from '../room-channels';
import { createFishingCasts } from './cast';
import { createFishingSpecies } from './species';
import { createFishingRoomChannel } from './channel';
import type { FishingCatchResult } from './catches';

const kingdomId = KingdomIdSchema.parse('200'), owner = PersonIdSchema.parse('100'), observer = PersonIdSchema.parse('101');
const site: FishingPierSite = { version: 1, id: 'pier:lake', root: [0, 0, 0], turn: 0, deckY: 1, waterY: 0, walk: 20, water: 'lake', biome: 'unknown', depth: [] };
const fish: FishSpecies = { id: 'fish:perch', name: 'Perch', lore: 'A fish.', riddle: 'A glint.', rarity: 'common', weight: 1,
  waters: ['lake'], biomes: ['*'], hours: ['dawn', 'day', 'dusk', 'night'], moods: ['clear', 'breeze', 'mist', 'rain'], minDepthM: 1,
  lengthMm: [100, 200], weightG: [100, 500], fight: 'steady' };
function rod(personId = owner): ItemRecord {
  return { version: 1, id: randomUUID(), defId: 'tool:rod.willow', branch: 'held', ownerId: personId, kingdomId, origin: 'simulated', place: 'hotbar', slot: 0,
    count: 1, storied: true, number: null, story: { by: null, kingdomId, where: 'pier', at: 1, line: 'Taken from the rack.' }, source: { kind: 'pier', ref: 'rack' }, detail: {}, createdAt: 1, revision: 0 };
}
function fixture() {
  let now = 1_000_000, serial = 0;
  const active = true;
  let listener!: Parameters<RealmChannelRoom['onMessage']>[0];
  const publicMessages: FishingChannelReply[] = [], privateMessages: { personId: typeof owner; message: FishingChannelReply }[] = [];
  const timers = new Map<number, () => void>(), delays: number[] = []; let timerId = 0;
  const records = new Map<string, ItemRecord>(), senders = new Map<string, RealmChannelSender>();
  let refreshRod = async (_sender: RealmChannelSender, id: string): Promise<ItemRecord | null> => records.get(id) ?? null;
  type Keep = (sender: RealmChannelSender, id: string) => Promise<FishingCatchResult>;
  let keep: Keep = async () => ({ status: 'refused', message: 'Not kept.' });
  const state = new Map<string, { present: boolean; current: boolean }>();
  const makeSender = (personId: typeof owner, walkerId: string): RealmChannelSender => {
    const flags = { present: true, current: true }; state.set(walkerId, flags);
    const sender: RealmChannelSender = { principal: { personId, kingdomId, origin: 'simulated', sessionId: randomUUID(), expiresAt: 9_000_000, publicName: 'Private name', look: 'look' }, walkerId,
      pose: () => ({ position: [0, 1, 23.4], yaw: 0, grounded: true, collisionRevision: 7 }), present: () => active && flags.present,
      current: async () => active && flags.current && flags.present };
    senders.set(personId, sender); return sender;
  };
  const from = makeSender(owner, 'owner-seat'), other = makeSender(observer, 'other-seat');
  const room: RealmChannelRoom = { kingdomId, origin: 'simulated', onMessage(fn) { listener = fn; },
    broadcast(message) { publicMessages.push(message as FishingChannelReply); }, toPerson(personId, message) { privateMessages.push({ personId, message: message as FishingChannelReply }); },
    person: personId => senders.get(personId) ?? null, world: () => { throw new Error('not used'); } };
  const installation = { site, biome: 'meadow', revision: 7, rack: [0, 1, 23.4] as const, sample: () => ({ waterY: 0, groundY: -2 }) };
  let casts!: ReturnType<typeof createFishingCasts>;
  const channel = createFishingRoomChannel({
    schedule(callback, delay) { delays.push(delay); const id = ++timerId; timers.set(id, callback); return () => { timers.delete(id); }; },
    bind(_room, selected) {
      casts = createFishingCasts({ kingdomId, clock: () => now, species: createFishingSpecies([fish]),
        seat: personId => { const sender = senders.get(personId); const pose = sender?.pose(); return sender && pose && sender.present() ? { token: sender.walkerId, pose, ownsRod: !!selected(personId, sender.walkerId) } : null; },
        installation: () => installation, makeId: () => `123e4567-e89b-42d3-a456-${String(++serial).padStart(12, '0')}`, seed: () => 1 });
      return { casts, now: () => now, installation: () => installation,
        refreshRod: (sender, id) => refreshRod(sender, id),
        takeRod: async sender => { const item = rod(sender.principal.personId); records.set(item.id, item); return { status: 'taken' as const, item }; },
        keep: (sender, id) => keep(sender, id), onRodChange: () => () => {}, dispose: () => casts.dispose() };
    },
  });
  const dispose = channel.attach(room);
  return { from, other, room, records, publicMessages, privateMessages, timers, delays, state, makeSender, dispose,
    act: async (sender: RealmChannelSender, request: unknown) => { await listener(sender, request); },
    setRefresh: (next: typeof refreshRod) => { refreshRod = next; }, setKeep: (next: typeof keep) => { keep = next; },
    now: () => now, setTime: (value: number) => { now = value; }, casts: () => casts,
    fire: async () => { const callbacks = [...timers.values()]; timers.clear(); for (const callback of callbacks) callback(); await new Promise(resolve => setImmediate(resolve)); } };
}

it('syncs the trusted installation and equips only the current owner’s actual rod', async () => {
  const f = fixture(), owned = rod(), foreign = rod(observer);
  f.records.set(owned.id, owned); f.records.set(foreign.id, foreign);
  await f.act(f.from, { type: 'pier.sync', id: 'initial' });
  expect(f.privateMessages.at(-1)).toMatchObject({ personId: owner, message: { type: 'pier.state', id: 'initial', revision: 7, self: { rod: null, cast: null } } });
  await f.act(f.from, { type: 'pier.equip', id: 'foreign', itemId: foreign.id });
  expect(f.privateMessages.at(-1)?.message).toMatchObject({ type: 'pier.refused', id: 'foreign' });
  await f.act(f.from, { type: 'pier.equip', id: 'mine', itemId: owned.id });
  await f.act(f.from, { type: 'pier.sync', id: 'equipped' });
  expect(f.privateMessages.at(-1)).toMatchObject({ personId: owner, message: { type: 'pier.state', id: 'equipped', self: { rod: { id: owned.id } } } });
  expect(f.publicMessages).toEqual(expect.arrayContaining([expect.objectContaining({ type: 'pier.rod', walkerId: f.from.walkerId, equipped: true })]));
  expect(JSON.stringify(f.publicMessages)).not.toContain(owned.id);
  f.dispose();
});

it('advances a real cast through the autonomous float and bite without leaking private audit data', async () => {
  const f = fixture(), owned = rod(); f.records.set(owned.id, owned);
  await f.act(f.from, { type: 'pier.equip', id: 'equip', itemId: owned.id });
  await f.act(f.from, { type: 'pier.draw', id: 'draw' });
  const id = f.casts().views()[0]!.id;
  f.setTime(1_000_200); await f.act(f.from, { type: 'pier.release', id: 'release', castId: id, seq: 1 });
  expect(f.timers.size).toBe(1);
  expect(f.delays.every(delay => delay === 50)).toBe(true);
  f.setTime(1_000_850); await f.fire();
  expect(f.casts().views()[0]?.phase).toBe('waiting');
  const bite = 1_000_850 + 4000 + fishingHash('wait:1:1') % 7001;
  f.setTime(bite); await f.fire();
  expect(f.casts().views()[0]?.phase).toBe('bite');
  expect(f.publicMessages.some(message => message.type === 'pier.beats' && message.beats.some(beat => beat.kind === 'bite'))).toBe(true);
  const publicJSON = JSON.stringify(f.publicMessages);
  for (const secret of [owned.id, 'Private name', 'castSeed', 'fightSeed', 'inputs', 'biteClosesAt', 'personId']) expect(publicJSON).not.toContain(secret);
  f.dispose(); expect(f.timers.size).toBe(0);
});

it('drops stale and disposed responses and refuses forged control fields', async () => {
  const f = fixture();
  await f.act(f.from, { type: 'pier.draw', id: 'forged', seed: 1 });
  expect(f.privateMessages.at(-1)?.message).toMatchObject({ type: 'pier.refused', id: 'fishing' });
  expect(f.casts().views()).toEqual([]);
  f.privateMessages.length = 0;
  f.state.get(f.from.walkerId)!.current = false;
  await f.act(f.from, { type: 'pier.sync', id: 'stale' });
  expect(f.privateMessages).toEqual([]);
  f.dispose();
  await f.act(f.from, { type: 'pier.sync', id: 'disposed' });
  expect(f.privateMessages).toEqual([]);
});


async function land(f: ReturnType<typeof fixture>) {
  const item = rod(); f.records.set(item.id, item);
  await f.act(f.from, { type: 'pier.equip', id: 'equip', itemId: item.id });
  await f.act(f.from, { type: 'pier.draw', id: 'draw' });
  const castId = f.casts().views()[0]!.id;
  f.setTime(1_000_200); await f.act(f.from, { type: 'pier.release', id: 'release', castId, seq: 1 });
  const bite = 1_000_850 + 4000 + fishingHash('wait:1:1') % 7001;
  f.setTime(bite); await f.fire();
  await f.act(f.from, { type: 'pier.strike', id: 'strike', castId, seq: 2 });
  let seq = 2, held = true;
  for (let tick = 0; tick < 600 && f.casts().views()[0]?.phase === 'fighting'; tick++) {
    const fight = f.casts().views()[0]!.fight!, desired = fight.phase === 'rest' && fight.tension < 6000;
    if (desired !== held) { held = desired; await f.act(f.from, { type: 'pier.reel', id: `edge-${seq}`, castId, seq: ++seq, on: held }); }
    f.setTime(bite + (tick + 1) * 50); await f.fire();
  }
  expect(f.casts().views()[0]?.phase).toBe('landing');
  return castId;
}

it('publishes catch success only after the writer confirms it, with private evidence kept private', async () => {
  const f = fixture();
  let finish!: (result: FishingCatchResult) => void, calls = 0;
  f.setKeep(async () => { calls++; return new Promise<FishingCatchResult>(resolve => { finish = resolve; }); });
  const castId = await land(f);
  expect(calls).toBe(1);
  expect(f.privateMessages.some(entry => entry.message.type === 'pier.pending')).toBe(true);
  expect(f.publicMessages.some(message => message.type === 'pier.caught')).toBe(false);
  const candidate = f.casts().candidate(owner)!;
  const item = { ...rod(), defId: fish.id, branch: 'gathered' as const, place: 'bag' as const, slot: null };
  finish({ status: 'kept', replayed: false, item, keepsake: null, catch: { version: 1, id: castId, kingdomId, origin: 'simulated', ownerId: owner, speciesId: fish.id,
    itemId: item.id, grantKey: 'private grant', caughtAt: candidate.at, personalFirst: true, kingdomFirst: true, rarity: 'common', fish: candidate.fish,
    environment: candidate.environment, float: candidate.float, anchor: candidate.anchor, collisionRevision: 7,
    proof: { version: 1, castSeed: candidate.castSeed, fightSeed: candidate.fightSeed, inputs: candidate.inputs, result: candidate.result } } });
  await new Promise(resolve => setImmediate(resolve));
  expect(f.privateMessages.some(entry => entry.personId === owner && entry.message.type === 'pier.kept' && entry.message.castId === castId)).toBe(true);
  expect(f.publicMessages.filter(message => message.type === 'pier.caught')).toHaveLength(1);
  const publicJSON = JSON.stringify(f.publicMessages);
  for (const privateValue of [item.id, 'private grant', 'castSeed', 'fightSeed', 'inputs', 'ownerId']) expect(publicJSON).not.toContain(privateValue);
  f.dispose();
});

it('holds at most four real pending rod checks and does not create hidden extra work', async () => {
  const f = fixture(); let calls = 0;
  const unblock: (() => void)[] = [];
  f.setRefresh(async (_sender, id) => { calls++; await new Promise<void>(resolve => { unblock.push(resolve); }); return f.records.get(id) ?? null; });
  const requests: Promise<void>[] = [];
  for (let i = 0; i < 5; i++) {
    const personId = PersonIdSchema.parse(String(1000 + i)), sender = f.makeSender(personId, `seat-${i}`), item = rod(personId);
    f.records.set(item.id, item);
    requests.push(f.act(sender, { type: 'pier.equip', id: `equip-${i}`, itemId: item.id }));
  }
  await new Promise(resolve => setImmediate(resolve));
  expect(calls).toBe(4);
  expect(f.privateMessages.some(entry => entry.personId === PersonIdSchema.parse('1004') && entry.message.type === 'pier.refused')).toBe(true);
  for (const release of unblock) release();
  await Promise.all(requests);
  expect(calls).toBe(4);
  f.dispose();
});

it('does not transfer an in-flight keep to a replacement seat; explicit retry recovers only the same receipt', async () => {
  const f = fixture();
  let finish!: (result: FishingCatchResult) => void, calls = 0;
  f.setKeep(async (_sender, id) => {
    calls++;
    if (calls === 1) return new Promise<FishingCatchResult>(resolve => { finish = resolve; });
    expect(id).toBe((committed as Extract<FishingCatchResult, { status: 'kept' }>).catch.id);
    return { ...committed, replayed: true } as FishingCatchResult;
  });
  const castId = await land(f), candidate = f.casts().candidate(owner)!;
  const item = { ...rod(), defId: fish.id, branch: 'gathered' as const, place: 'bag' as const, slot: null };
  const committed: FishingCatchResult = { status: 'kept', replayed: false, item, keepsake: null, catch: { version: 1, id: castId, kingdomId, origin: 'simulated', ownerId: owner, speciesId: fish.id,
    itemId: item.id, grantKey: 'private grant', caughtAt: candidate.at, personalFirst: true, kingdomFirst: true, rarity: 'common', fish: candidate.fish,
    environment: candidate.environment, float: candidate.float, anchor: candidate.anchor, collisionRevision: 7,
    proof: { version: 1, castSeed: candidate.castSeed, fightSeed: candidate.fightSeed, inputs: candidate.inputs, result: candidate.result } } };
  const replacement = f.makeSender(owner, 'replacement-seat');
  f.privateMessages.length = 0; f.publicMessages.length = 0;
  finish(committed); await new Promise(resolve => setImmediate(resolve));
  expect(f.privateMessages.some(entry => entry.message.type === 'pier.kept')).toBe(false);
  expect(f.publicMessages.some(message => message.type === 'pier.caught')).toBe(false);
  await f.act(replacement, { type: 'pier.sync', id: 'resume' });
  expect(calls).toBe(1);
  expect(f.privateMessages.at(-1)?.message).toMatchObject({ type: 'pier.state', self: { pendingCastId: null, rod: null } });
  await f.act(replacement, { type: 'pier.keep', id: 'retry', castId });
  expect(calls).toBe(2);
  expect(f.privateMessages.at(-1)?.message).toMatchObject({ type: 'pier.kept', id: 'retry', castId, replayed: true, item: { id: item.id } });
  expect(f.publicMessages.some(message => message.type === 'pier.caught')).toBe(false);
  f.dispose();
});

it('bounds resident people to 300 and refuses additional live seats', async () => {
  const f = fixture();
  for (let i = 0; i < 301; i++) {
    const person = PersonIdSchema.parse(String(2000 + i)), sender = f.makeSender(person, `seat-${i}`);
    await f.act(sender, { type: 'pier.sync', id: `sync-${i}` });
  }
  expect(f.privateMessages.filter(entry => entry.message.type === 'pier.state')).toHaveLength(300);
  expect(f.privateMessages.at(-1)).toMatchObject({ personId: PersonIdSchema.parse('2300'), message: { type: 'pier.refused', id: 'sync-300' } });
  f.state.get('seat-0')!.present = false;
  const replacement = f.makeSender(PersonIdSchema.parse('3000'), 'new-seat');
  await f.act(replacement, { type: 'pier.sync', id: 'reclaimed' });
  expect(f.privateMessages.at(-1)).toMatchObject({ personId: PersonIdSchema.parse('3000'), message: { type: 'pier.state', id: 'reclaimed' } });
  f.dispose();
});

it.each(['expired', 'replaced', 'disposed'] as const)('drops an equip reply when the seat is %s during an asynchronous check', async reason => {
  const f = fixture(), item = rod(); f.records.set(item.id, item);
  let finish!: () => void, entered!: () => void;
  const ready = new Promise<void>(resolve => { entered = resolve; });
  f.setRefresh(async () => { entered(); await new Promise<void>(resolve => { finish = resolve; }); return item; });
  const pending = f.act(f.from, { type: 'pier.equip', id: 'late', itemId: item.id });
  await ready;
  if (reason === 'expired') f.state.get(f.from.walkerId)!.current = false;
  if (reason === 'replaced') f.makeSender(owner, 'replacement');
  if (reason === 'disposed') f.dispose();
  finish(); await pending;
  expect(f.privateMessages).toEqual([]);
  expect(f.publicMessages.some(message => message.type === 'pier.rod' && message.equipped)).toBe(false);
  f.dispose();
});


it('does not resurrect an unequipped rod when a background refresh returns late', async () => {
  const f = fixture(), item = rod(); f.records.set(item.id, item);
  await f.act(f.from, { type: 'pier.equip', id: 'equip', itemId: item.id });
  await f.act(f.from, { type: 'pier.draw', id: 'draw' });
  let finish!: () => void, entered!: () => void;
  const ready = new Promise<void>(resolve => { entered = resolve; });
  f.setRefresh(async () => { entered(); await new Promise<void>(resolve => { finish = resolve; }); return item; });
  f.setTime(1_001_000); await f.fire(); await ready;
  await f.act(f.from, { type: 'pier.equip', id: 'unequip', itemId: null });
  f.publicMessages.length = 0;
  finish(); await new Promise(resolve => setImmediate(resolve));
  expect(f.publicMessages.some(message => message.type === 'pier.rod' && message.equipped)).toBe(false);
  await f.act(f.from, { type: 'pier.sync', id: 'check' });
  expect(f.privateMessages.at(-1)?.message).toMatchObject({ type: 'pier.state', self: { rod: null } });
  expect(f.casts().views()).toEqual([]);
  f.dispose();
});

function keptResult(f: ReturnType<typeof fixture>, castId: string, replayed = false): FishingCatchResult {
  const candidate = f.casts().candidate(owner)!;
  const item = { ...rod(), defId: fish.id, branch: 'gathered' as const, place: 'bag' as const, slot: null };
  return { status: 'kept', replayed, item, keepsake: null, catch: { version: 1, id: castId, kingdomId, origin: 'simulated', ownerId: owner, speciesId: fish.id,
    itemId: item.id, grantKey: 'private grant', caughtAt: candidate.at, personalFirst: false, kingdomFirst: false, rarity: 'common', fish: candidate.fish,
    environment: candidate.environment, float: candidate.float, anchor: candidate.anchor, collisionRevision: 7,
    proof: { version: 1, castSeed: candidate.castSeed, fightSeed: candidate.fightSeed, inputs: candidate.inputs, result: candidate.result } } };
}

it('runs one writer call when an explicit keep overlaps the automatic landing keep, and shows one catch', async () => {
  const f = fixture();
  let finish!: (result: FishingCatchResult) => void, calls = 0;
  f.setKeep(async () => { calls++; return new Promise<FishingCatchResult>(resolve => { finish = resolve; }); });
  const castId = await land(f);
  expect(calls).toBe(1);
  // The person presses keep while the landing's own keep is still in the ledger: no second write, no second spectacle.
  await f.act(f.from, { type: 'pier.keep', id: 'early', castId });
  expect(calls).toBe(1);
  expect(f.privateMessages.at(-1)?.message.type === 'pier.refused' || f.privateMessages.at(-1)?.message.type === 'pier.pending').toBe(true);
  finish(keptResult(f, castId)); await new Promise(resolve => setImmediate(resolve));
  expect(f.publicMessages.filter(message => message.type === 'pier.caught')).toHaveLength(1);
  expect(f.privateMessages.filter(entry => entry.message.type === 'pier.kept')).toHaveLength(1);
  f.dispose();
});

it('refuses a keep asked before the landing privately, with no public outcome and the cast untouched', async () => {
  const f = fixture();
  const kept: string[] = [];
  f.setKeep(async (_sender, id) => {
    const landed = f.casts().views().some(view => view.id === id && view.phase === 'landing');
    if (!landed) return { status: 'refused', message: 'That catch is not on the line yet.' };
    kept.push(id); return keptResult(f, id);
  });
  const item = rod(); f.records.set(item.id, item);
  await f.act(f.from, { type: 'pier.equip', id: 'equip', itemId: item.id });
  await f.act(f.from, { type: 'pier.draw', id: 'draw' });
  const castId = f.casts().views()[0]!.id;
  await f.act(f.from, { type: 'pier.keep', id: 'too-early', castId });
  expect(f.privateMessages.at(-1)?.message).toMatchObject({ type: 'pier.refused', id: 'too-early' });
  expect(f.publicMessages.some(message => message.type === 'pier.caught')).toBe(false);
  expect(f.casts().views()[0]?.phase).toBe('drawing');
  f.dispose();
});

it('delivers an in-flight catch to a reconnected socket that keeps the same seat identity', async () => {
  const f = fixture();
  let finish!: (result: FishingCatchResult) => void;
  f.setKeep(async () => new Promise<FishingCatchResult>(resolve => { finish = resolve; }));
  const castId = await land(f);
  // A Colyseus reconnection keeps the walker id: it is the same seat, so the catch is still theirs to see.
  const reconnected = f.makeSender(owner, f.from.walkerId);
  f.privateMessages.length = 0; f.publicMessages.length = 0;
  finish(keptResult(f, castId)); await new Promise(resolve => setImmediate(resolve));
  expect(f.privateMessages.filter(entry => entry.personId === owner && entry.message.type === 'pier.kept')).toHaveLength(1);
  expect(f.publicMessages.filter(message => message.type === 'pier.caught')).toHaveLength(1);
  await f.act(reconnected, { type: 'pier.sync', id: 'after' });
  expect(f.privateMessages.at(-1)?.message).toMatchObject({ type: 'pier.state', id: 'after', self: { pendingCastId: null } });
  f.dispose();
});

it('maps every public ending to an allowlisted outcome and never carries entry, session or person identifiers', async () => {
  const f = fixture(), item = rod(); f.records.set(item.id, item);
  await f.act(f.from, { type: 'pier.equip', id: 'equip', itemId: item.id });
  await f.act(f.from, { type: 'pier.draw', id: 'draw' });
  const castId = f.casts().views()[0]!.id;
  f.setTime(1_000_200); await f.act(f.from, { type: 'pier.release', id: 'release', castId, seq: 1 });
  f.setTime(1_000_850); await f.fire();
  // Lowering the rod reels the line in: the public sees a plain cancelled ending, never the server's words.
  await f.act(f.from, { type: 'pier.equip', id: 'lower', itemId: null });
  await f.fire();
  const ended = f.publicMessages.flatMap(message => message.type === 'pier.beats' ? message.beats : []).filter(beat => beat.kind === 'ended');
  expect(ended.length).toBeGreaterThan(0);
  for (const beat of ended) {
    expect(['snapped', 'escaped', 'missed', 'cancelled', 'unkept']).toContain(beat.outcome);
    expect(Object.keys(beat).sort()).toEqual(['at', 'castId', 'kind', 'outcome', 'walkerId']);
  }
  const publicJSON = JSON.stringify(f.publicMessages);
  for (const secret of [f.from.principal.sessionId, f.other.principal.sessionId, '"personId"', '"ownerId"', '"sessionId"', 'Private name', '"reason"', 'expiresAt'])
    expect(publicJSON).not.toContain(secret);
  f.dispose();
});
