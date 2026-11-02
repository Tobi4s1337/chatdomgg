import { beforeAll, describe, expect, it } from 'vitest';
import { KingdomIdSchema, PersonIdSchema, type FishSpecies, type PersonId, type PierFeedEvent } from '@chatdom/shared';
import type { RealmHeraldChat } from '@chatdom/shared/realm';
import { generateSettlementPlan, type RealmFoundedScene } from '@chatdom/world';
import { createRealmState } from '@chatdom/world/realm';
import { assembleFoundedScene } from '../founded/scene';
import type { DurableKingdom } from '../persistence';
import { assembleAlmanac, type AlmanacRows, type PierAlmanacStore } from './almanac';
import type { ChatCatchCandidate } from './chat';
import { createRealmPier, isFishCommand } from './pier';
import { createFishingSpecies } from './species';

const kingdomId = KingdomIdSchema.parse('900000011');
const base = { lore: 'A fish of the lake.', riddle: 'A glint under the reeds.', weight: 1, biomes: ['*'],
  hours: ['dawn', 'day', 'dusk', 'night'] as const, moods: ['clear', 'breeze', 'mist', 'rain'] as const, minDepthM: 1,
  lengthMm: [100, 200] as const, weightG: [100, 500] as const, fight: 'steady' as const };
const perch: FishSpecies = { ...base, id: 'fish:perch', name: 'Perch', rarity: 'common', waters: ['lake'] };
const tench: FishSpecies = { ...base, id: 'fish:tench', name: 'Tench', rarity: 'uncommon', waters: ['lake'], share: .5 };
const herring: FishSpecies = { ...base, id: 'fish:herring', name: 'Herring', rarity: 'common', waters: ['sea'] };
const species = createFishingSpecies([perch, tench, herring]);
const viewer = PersonIdSchema.parse('5001'), quiet = PersonIdSchema.parse('5002');
const text = (value: string): RealmHeraldChat['parts'] => [{ kind: 'text', text: value }] as RealmHeraldChat['parts'];

let scene: RealmFoundedScene;
beforeAll(async () => {
  const plan = generateSettlementPlan({ seed: 'founded-scene-test', tier: 'hamlet', firstYear: 2025, year: 2026 });
  scene = (await assembleFoundedScene({ kingdomId, plan, state: createRealmState(kingdomId, 'simulated'), collisionRevision: 4 })).scene;
}, 120_000);

it('hears !fish as the first word only', () => {
  expect(isFishCommand(text('!fish'))).toBe(true);
  expect(isFishCommand(text('  !FISH  for the big one'))).toBe(true);
  expect(isFishCommand(text('!fishing'))).toBe(false);
  expect(isFishCommand(text('let us !fish'))).toBe(false);
  expect(isFishCommand([{ kind: 'emote', id: '25', name: 'Kappa' }] as unknown as RealmHeraldChat['parts'])).toBe(false);
  expect(isFishCommand([])).toBe(false);
});

describe('the Almanac page', () => {
  const rows: AlmanacRows = {
    counts: new Map([['fish:perch', 3]]),
    firsts: [{ speciesId: 'fish:perch', ownerId: viewer, at: 10, via: 'chat', name: 'saoirse_k', hidden: false }],
    biggest: [{ speciesId: 'fish:perch', ownerId: quiet, at: 20, via: 'pier', name: 'Quiet One', hidden: true, weightG: 480, lengthMm: 190 }],
    mounts: new Map([['keepsake:mount.perch', 1]]),
  };
  it('carries approved names only and never a person id', () => {
    const almanac = assembleAlmanac({ kingdomId, kingdom: 'Willowmere', asOf: 30, species, water: { water: 'lake', biome: null }, rows });
    const perchPage = almanac.entries.find(entry => entry.speciesId === 'fish:perch')!;
    expect(perchPage).toMatchObject({ status: 'caught', count: 3, mounts: 1, first: { name: 'saoirse_k', via: 'chat', at: 10 },
      biggest: { name: null, weightG: 480, lengthMm: 190 } });
    const json = JSON.stringify(almanac);
    expect(json).not.toContain(viewer); expect(json).not.toContain(quiet);
    expect(json).not.toContain('ownerId'); expect(json).not.toContain('Quiet One');
    expect(almanac).toMatchObject({ caught: 1, catches: 3, water: 'lake' });
  });
  it('marks fish this water holds as waiting and the rest as elsewhere', () => {
    const empty: AlmanacRows = { counts: new Map(), firsts: [], biggest: [], mounts: new Map() };
    const page = (water: Parameters<typeof assembleAlmanac>[0]['water'], id: string) =>
      assembleAlmanac({ kingdomId, kingdom: 'K', asOf: 1, species, water, rows: empty }).entries.find(entry => entry.speciesId === id)!;
    expect(page({ water: 'lake', biome: null }, 'fish:perch')).toMatchObject({ status: 'waiting', first: null, biggest: null, count: 0 });
    expect(page({ water: 'lake', biome: null }, 'fish:herring').status).toBe('elsewhere');
    expect(page({ water: 'sea', biome: null }, 'fish:herring').status).toBe('waiting');
    expect(page(null, 'fish:perch').status).toBe('elsewhere');
    // A shared fish lives in some kingdoms' lakes, fixed per kingdom.
    const holds = new Set(Array.from({ length: 40 }, (_, n) => assembleAlmanac({ kingdomId: KingdomIdSchema.parse(String(800 + n)), kingdom: 'K', asOf: 1,
      species, water: { water: 'lake', biome: null }, rows: empty }).entries.find(entry => entry.speciesId === 'fish:tench')!.status));
    expect(holds).toEqual(new Set(['waiting', 'elsewhere']));
  });
});

function harness() {
  let closed: (() => void) | null = null;
  const windows = [{ slot: 2, present: true, publicName: 'saoirse_k', since: 0 }, { slot: 3, present: true, publicName: 'Quiet One', since: 0 }];
  let now = 1_700_000_000_000;
  const kingdom = {
    kingdomId, origin: 'simulated', current: true, world: { revision: 4 }, databaseNow: () => now,
    publicCheckpoint: () => ({ current: [{ type: 'presence', frame: { windows } }] }),
    onClosed: (fn: () => void) => { closed = fn; return () => {}; },
  } as unknown as DurableKingdom;
  const hidden = new Set<string>(), hides: string[] = [];
  const almanacStore: PierAlmanacStore = {
    rows: async () => ({ counts: new Map(), firsts: [], biggest: [], mounts: new Map() }),
    marks: async () => [],
    hidden: async (_k, person) => hidden.has(person),
    hide: async (_k, person) => { hidden.add(person); hides.push(person); },
  };
  const timers: { at: number; fn: () => void }[] = [];
  const kept: { candidate: ChatCatchCandidate; name: string | null }[] = [];
  let serial = 0;
  const pier = createRealmPier({ pool: {} as never, origin: 'simulated', store: {} as never, items: {} as never, catalogue: {} as never,
    species, visible: () => true, scene: () => scene, authority: () => kingdom as never, where: () => 'Willowmere pier', kingdomName: () => 'Willowmere',
    almanacStore, clock: () => now, seed: () => 104_729 * ++serial, makeId: () => `123e4567-e89b-42d3-a456-${String(++serial).padStart(12, '0')}`,
    schedule: (fn, delay) => { const timer = { at: now + delay, fn }; timers.push(timer); return () => { timers.splice(timers.indexOf(timer), 1); }; },
    keep: async (_kingdom, candidate, name) => { kept.push({ candidate, name }); return { status: 'kept', kingdomFirst: kept.length === 1, keepsake: kept.length === 1 ? 1 : null, replayed: false }; } });
  const events: PierFeedEvent[] = [];
  const stop = pier.watch(kingdomId, event => events.push(event));
  const settle = async () => { for (let i = 0; i < 6; i++) await new Promise(resolve => setImmediate(resolve)); };
  const advance = async (ms: number) => {
    const until = now + ms;
    for (;;) {
      timers.sort((a, b) => a.at - b.at);
      const next = timers[0];
      if (!next || next.at > until) break;
      timers.shift(); now = Math.max(now, next.at); next.fn(); await settle();
    }
    now = until;
  };
  const chat = (personId: PersonId, slot: number, value: string, id = `msg-${++serial}`) =>
    pier.chatCommands.chat({ id, kingdomId, personId, parts: text(value) } as unknown as RealmHeraldChat, kingdom, slot);
  return { pier, kingdom, events, kept, hides, hidden, advance, settle, chat, stop, close: () => closed?.() };
}

describe('the realm pier', () => {
  it('claims !fish, floats it on real founded lake water and puts the catch on the public feed', async () => {
    const h = harness();
    expect(h.events[0]).toMatchObject({ kind: 'lines', lines: [], cap: 8 });
    expect(h.chat(viewer, 2, 'hello there')).toBe(false);
    expect(h.chat(viewer, 2, '!fish')).toBe(true);
    await h.settle();
    const line = h.events.find(event => event.kind === 'line');
    expect(line).toMatchObject({ line: { who: { name: 'saoirse_k', slot: 2 }, phase: 'float', via: 'chat' } });
    await h.advance(120_000);
    expect(h.kept).toHaveLength(1);
    expect(h.kept[0]!.name).toBe('saoirse_k');
    expect(h.kept[0]!.candidate.environment).toMatchObject({ water: 'lake', biome: 'unknown' });
    expect(h.events.find(event => event.kind === 'caught')).toMatchObject({ via: 'chat', who: { name: 'saoirse_k' }, kingdomFirst: true, keepsake: 1 });
    expect(JSON.stringify(h.events)).not.toContain(viewer);
    h.pier.dispose();
  }, 60_000);

  it('a timeout clears the line and hides the name from public pages from then on', async () => {
    const h = harness();
    h.chat(quiet, 3, '!fish'); await h.settle();
    h.pier.chatCommands.cleanup(kingdomId, { personId: quiet });
    await h.settle();
    expect(h.events.at(-1)).toMatchObject({ kind: 'gone', reason: 'cleared' });
    expect(h.hides).toEqual([quiet]);
    // Later, a walker catch by the same person is announced without the name.
    await h.pier.announce(kingdomId, { id: 'c1', ownerId: quiet, name: 'Quiet One', fish: { speciesId: 'fish:perch', lengthMm: 150, weightG: 300 },
      kingdomFirst: false, keepsake: null, at: 1 });
    expect(h.events.at(-1)).toMatchObject({ kind: 'caught', via: 'pier', who: { name: null } });
    h.pier.dispose();
  }, 60_000);

  it('a deleted message pulls its float; a cleared chat clears them all', async () => {
    const h = harness();
    h.chat(viewer, 2, '!fish', 'delete-me'); h.chat(quiet, 3, '!fish');
    await h.settle();
    h.pier.chatCommands.cleanup(kingdomId, { messageIds: ['delete-me'] });
    expect(h.events.at(-1)).toMatchObject({ kind: 'gone', reason: 'pulled' });
    h.pier.chatCommands.cleanup(kingdomId, {});
    expect(h.events.at(-1)).toMatchObject({ kind: 'gone', reason: 'cleared' });
    await h.advance(120_000);
    expect(h.kept).toHaveLength(0);
    expect(h.hides).toEqual([]);
    h.pier.dispose();
  }, 60_000);

  it('stops at the gate: no pier shown, no claim', () => {
    const h = harness();
    expect(h.pier.chatCommands.chat({ id: 'x', kingdomId: KingdomIdSchema.parse('1'), personId: viewer, parts: text('!fish') } as unknown as RealmHeraldChat, h.kingdom, 2)).toBe(false);
    h.pier.dispose();
    expect(h.chat(viewer, 2, '!fish')).toBe(false);
  });
});
