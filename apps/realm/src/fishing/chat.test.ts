import { describe, expect, it } from 'vitest';
import { KingdomIdSchema, PersonIdSchema, pierLightColour, type FishSpecies, type FishingPierSite, type PersonId, type PierFeedEvent } from '@chatdom/shared';
import type { FishingInstallation } from './cast';
import { CHAT_CAP, CHAT_COOLDOWN_MS, CHAT_FULL_GAP_MS, chatFight, createChatFishing, type ChatCatchCandidate, type ChatKeepResult } from './chat';
import { verifyFight } from './fight';
import { createFishingSpecies } from './species';

const kingdomId = KingdomIdSchema.parse('300');
const site: FishingPierSite = { version: 1, id: 'pier:lake', root: [0, 0, 0], turn: 0, deckY: 1, waterY: 0, walk: 20, water: 'lake', biome: 'unknown', depth: [] };
const base = { lore: 'A fish of the lake.', riddle: 'A glint.', weight: 1, waters: ['lake'] as const, biomes: ['*'],
  hours: ['dawn', 'day', 'dusk', 'night'] as const, moods: ['clear', 'breeze', 'mist', 'rain'] as const, minDepthM: 1,
  lengthMm: [100, 200] as const, weightG: [100, 500] as const };
const perch: FishSpecies = { ...base, id: 'fish:perch', name: 'Perch', rarity: 'common', fight: 'steady' };
const legend: FishSpecies = { ...base, id: 'fish:stormcrown-sturgeon', name: 'Stormcrown Sturgeon', rarity: 'rare', legend: true, fight: 'surge' };
const person = (n: number) => PersonIdSchema.parse(String(1000 + n));

function fixture(options: { fish?: FishSpecies; keep?: (candidate: ChatCatchCandidate) => Promise<ChatKeepResult>; open?: () => boolean } = {}) {
  let now = 1_700_000_000_000, serial = 0, timerId = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const events: PierFeedEvent[] = [], kept: ChatCatchCandidate[] = [];
  const installation: FishingInstallation = { site, biome: null, revision: 3, sample: () => ({ waterY: 0, groundY: -3 }) };
  const fishing = createChatFishing({ kingdomId, species: createFishingSpecies([options.fish ?? perch]), clock: () => now,
    installation: () => options.open?.() === false ? null : installation, seed: () => 7919 * ++serial,
    makeId: () => `123e4567-e89b-42d3-a456-${String(++serial).padStart(12, '0')}`,
    schedule: (fn, delay) => { const id = ++timerId; timers.set(id, { at: now + delay, fn }); return () => { timers.delete(id); }; },
    publish: event => { events.push(event); },
    keep: async candidate => { kept.push(candidate); return options.keep ? options.keep(candidate) : { status: 'kept', kingdomFirst: kept.length === 1, keepsake: kept.length === 1 ? 1 : null, replayed: false }; } });
  /** Advances the kingdom clock, firing every due timer in order and letting its promises settle. */
  const advance = async (ms: number) => {
    const until = now + ms;
    for (;;) {
      const next = [...timers.entries()].filter(([, t]) => t.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      timers.delete(next[0]); now = Math.max(now, next[1].at); next[1].fn();
      for (let i = 0; i < 4; i++) await new Promise(resolve => setImmediate(resolve));
    }
    now = until;
  };
  const cast = (n: number, name: string | null = `viewer_${n}`) => fishing.cast({ personId: person(n), messageId: `m-${n}-${serial}`, slot: n, name });
  return { fishing, events, kept, advance, cast, kinds: () => events.map(event => event.kind), now: () => now, timers };
}

describe('chat !fish', () => {
  it('drops a float in the chatter’s light colour, plays the fight on the server and keeps the catch', async () => {
    const f = fixture();
    expect(f.cast(1, 'saoirse_k')).toBe('cast');
    const first = f.events[0]!;
    expect(first.kind).toBe('line');
    if (first.kind !== 'line') throw new Error('line');
    expect(first.line.who).toEqual({ name: 'saoirse_k', slot: 1, colour: pierLightColour(1) });
    expect(first.line.phase).toBe('float');
    expect(first.line.float[1]).toBe(site.waterY);
    expect(first.line.float[2]).toBeGreaterThan(site.walk + 4);
    await f.advance(120_000);
    const caught = f.events.find(event => event.kind === 'caught' || event.kind === 'gone')!;
    // A steady hand lands this seed; the fight is the server's own and replays exactly.
    expect(caught.kind).toBe('caught');
    if (caught.kind !== 'caught') throw new Error('caught');
    expect(caught).toMatchObject({ via: 'chat', who: { name: 'saoirse_k' }, kingdomFirst: true, keepsake: 1, fish: { speciesId: 'fish:perch' } });
    expect(JSON.stringify(f.events)).not.toContain(person(1));
    const candidate = f.kept[0]!;
    expect(candidate.personId).toBe(person(1));
    expect(verifyFight({ seed: candidate.fightSeed, profile: candidate.fish.fight, inputs: candidate.inputs, throughTick: candidate.result.tick, claimed: candidate.result })).toBe(true);
    expect(f.kinds().slice(0, 3)).toEqual(['line', 'line', 'line']);
    expect(f.fishing.lines()).toHaveLength(0);
  });

  it('holds one line per person, then a gentle cooldown before the next', async () => {
    const f = fixture();
    expect(f.cast(1)).toBe('cast');
    expect(f.cast(1)).toBe('busy');
    while (f.fishing.lines().length) await f.advance(250);
    expect(f.cast(1)).toBe('resting');
    await f.advance(CHAT_COOLDOWN_MS - 1_000);
    expect(f.cast(1)).toBe('resting');
    await f.advance(1_000);
    expect(f.cast(1)).toBe('cast');
  });

  it('caps the floats and says once, honestly, that the pier is full', async () => {
    const f = fixture();
    for (let n = 1; n <= CHAT_CAP; n++) expect(f.cast(n)).toBe('cast');
    // Eight neighbouring homes put eight different lights on the water.
    expect(new Set(f.fishing.lines().map(line => line.who.colour)).size).toBe(CHAT_CAP);
    const floats = f.fishing.lines().map(line => line.float);
    for (const a of floats) for (const b of floats) if (a !== b) expect(Math.hypot(a[0] - b[0], a[2] - b[2])).toBeGreaterThanOrEqual(1.3);
    expect(f.cast(CHAT_CAP + 1)).toBe('full');
    expect(f.cast(CHAT_CAP + 1)).toBe('full');
    expect(f.events.filter(event => event.kind === 'full')).toHaveLength(1);
    expect(f.events.at(-1)).toMatchObject({ kind: 'full', cap: CHAT_CAP, who: { name: `viewer_${CHAT_CAP + 1}` } });
    await f.advance(CHAT_FULL_GAP_MS + 1);
    // Still full of bobbing floats or not, the beat never repeats for one person inside the gap.
    const result = f.cast(CHAT_CAP + 1);
    expect(['cast', 'full']).toContain(result);
  });

  it('pulls a deleted !fish’s float without a cooldown', async () => {
    const f = fixture();
    f.cast(1);
    const line = f.fishing.lines()[0]!;
    const messageId = `m-1-0`;
    f.fishing.remove([messageId]);
    expect(f.fishing.lines()).toHaveLength(0);
    expect(f.events.at(-1)).toMatchObject({ kind: 'gone', id: line.id, reason: 'pulled' });
    await f.advance(60_000);
    expect(f.kept).toHaveLength(0);
    expect(f.cast(1)).toBe('cast');
  });

  it('clears a timed-out or banned person’s line, and every line when chat is cleared', async () => {
    const f = fixture();
    f.cast(1); f.cast(2); f.cast(3);
    f.fishing.clear(person(2));
    expect(f.fishing.lines().map(line => line.who.slot).sort()).toEqual([1, 3]);
    expect(f.events.at(-1)).toMatchObject({ kind: 'gone', reason: 'cleared' });
    expect(f.cast(2)).toBe('resting');
    f.fishing.clear();
    expect(f.fishing.lines()).toHaveLength(0);
    await f.advance(120_000);
    expect(f.kept).toHaveLength(0);
  });

  it('keeps a catch already being written, but hides a moderated person’s name from the stream', async () => {
    let release!: (result: ChatKeepResult) => void;
    const f = fixture({ keep: () => new Promise(resolve => { release = resolve; }) });
    f.cast(1, 'quiet_one');
    await f.advance(120_000);
    expect(f.kept).toHaveLength(1);
    f.fishing.clear(person(1));
    release({ status: 'kept', kingdomFirst: false, keepsake: null, replayed: false });
    await new Promise(resolve => setImmediate(resolve));
    const caught = f.events.find(event => event.kind === 'caught');
    expect(caught).toMatchObject({ who: { name: null, slot: 1 } });
  });

  it('lets a legend break the chat line: only a walker could have held it', async () => {
    const f = fixture({ fish: legend });
    f.cast(1);
    await f.advance(120_000);
    expect(f.kept).toHaveLength(0);
    expect(f.events.at(-1)).toMatchObject({ kind: 'broken', speciesId: legend.id, who: { name: 'viewer_1' } });
    expect(f.fishing.lines()).toHaveLength(0);
  });

  it('retries an uncertain write on the same cast, then lets an unkept catch go', async () => {
    let calls = 0;
    const f = fixture({ keep: async () => (++calls, { status: 'uncertain' }) });
    f.cast(1);
    await f.advance(180_000);
    expect(calls).toBe(4);
    expect(new Set(f.kept.map(candidate => candidate.castId)).size).toBe(1);
    expect(f.events.at(-1)).toMatchObject({ kind: 'gone', reason: 'unkept' });
  });

  it('stays closed where no pier is open, and silent after dispose', () => {
    const closed = fixture({ open: () => false });
    expect(closed.cast(1)).toBe('closed');
    expect(closed.events).toHaveLength(0);
    const f = fixture();
    f.cast(1); f.fishing.dispose();
    expect(f.cast(2)).toBe('closed');
    expect(f.timers.size).toBe(0);
  });

  it('plays a steady hand that lands most fish and loses some, always replayable', () => {
    for (const profile of ['dart', 'steady', 'surge'] as const) {
      let landed = 0;
      for (let seed = 1; seed <= 120; seed++) {
        const fight = chatFight(seed * 104_729, profile);
        expect(chatFight(seed * 104_729, profile)).toEqual(fight);
        if (fight.result.outcome === 'landed') landed++;
      }
      expect(landed, profile).toBeGreaterThan(84);
      expect(landed, profile).toBeLessThan(120);
    }
  });
});
