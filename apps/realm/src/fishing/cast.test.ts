import { expect, it } from 'vitest';
import { fishingHash, KingdomIdSchema, PersonIdSchema, type FishSpecies, type FishingPierSite } from '@chatdom/shared';
import { createFishingCasts, type FishingInstallation, type FishingSeat } from './cast';
import { createFishingSpecies } from './species';
import { createFight, stepFight } from './fight';

const kingdomId = KingdomIdSchema.parse('200'), person = PersonIdSchema.parse('100');
const site: FishingPierSite = { version: 1, id: 'pier:lake', root: [0, 0, 0], turn: 0, deckY: 1, waterY: 0, walk: 20, water: 'lake', biome: 'meadow', depth: [] };
const fish: FishSpecies = { id: 'fish:perch', name: 'Perch', lore: 'A copper fish.', riddle: 'A flash.', rarity: 'common', weight: 1,
  waters: ['lake'], biomes: ['*'], hours: ['dawn', 'day', 'dusk', 'night'], moods: ['clear', 'breeze', 'mist', 'rain'], minDepthM: 1,
  lengthMm: [100, 200], weightG: [100, 500], fight: 'steady' };
function setup(seed = 1, definitions: readonly FishSpecies[] = [fish]) {
  let now = 1_000_000, number = 0;
  let seat: FishingSeat | null = { token: 'seat', ownsRod: true, pose: { position: [0, 1, 23.4], yaw: 0, grounded: true, collisionRevision: 7 } };
  let installation: FishingInstallation | null = { site, biome: 'meadow', revision: 7, sample: () => ({ waterY: 0, groundY: -2 }) };
  const options = { kingdomId, clock: () => now, species: createFishingSpecies(definitions), seat: () => seat, installation: () => installation,
    makeId: () => `123e4567-e89b-42d3-a456-${String(++number).padStart(12, '0')}`, seed: () => seed };
  const domain = createFishingCasts(options);
  const setTime = (at: number) => { now = at; };
  const draw = (who = person) => domain.act(who, { type: 'pier.draw', id: `draw-${who}` });
  const start = () => {
    const drawn = draw(); expect(drawn.ok).toBe(true);
    const id = drawn.cast!.id;
    setTime(1_000_200);
    expect(domain.act(person, { type: 'pier.release', id: 'release', castId: id, seq: 1 }).cast?.phase).toBe('flying');
    const landed = 1_000_850, bite = landed + 4000 + fishingHash(`wait:1:${seed}`) % 7001;
    return { id, landed, bite };
  };
  return { domain, options, setTime, draw, start, setSeat: (next: FishingSeat | null) => { seat = next; }, getSeat: () => seat!, setInstallation: (next: FishingInstallation | null) => { installation = next; }, getInstallation: () => installation! };
}

it('honours the inclusive opening and exclusive closing of the bite window', () => {
  for (const moment of ['early', 'open', 'last', 'close'] as const) {
    const s = setup(), { id, landed, bite } = s.start();
    s.setTime(landed); expect(s.domain.tick().map(b => b.kind)).toEqual(['float']);
    s.setTime(moment === 'early' ? bite - 1 : moment === 'open' ? bite : moment === 'last' ? bite + 1199 : bite + 1200);
    const result = s.domain.act(person, { type: 'pier.strike', id: 'strike', castId: id, seq: 2 });
    expect(result.ok, moment).toBe(moment === 'open' || moment === 'last');
    expect(result.cast?.phase ?? null).toBe(moment === 'open' || moment === 'last' ? 'fighting' : null);
    if (moment !== 'early') expect(result.beats.some(b => b.kind === 'bite')).toBe(true);
  }
});

it('accepts draw and sequence retries without replaying actions; coalesces reel changes in one tick', () => {
  const s = setup(), drawn = s.draw(), id = drawn.cast!.id;
  expect(s.draw()).toMatchObject({ ok: true, cast: { id }, beats: [] });
  s.setTime(1_000_200);
  const release = { type: 'pier.release', id: 'r', castId: id, seq: 1 };
  expect(s.domain.act(person, release).cast?.phase).toBe('flying');
  expect(s.domain.act(person, release)).toMatchObject({ ok: true, cast: { phase: 'flying' }, beats: [] });
  const bite = 1_000_850 + 4000 + fishingHash('wait:1:1') % 7001;
  s.setTime(bite); expect(s.domain.act(person, { type: 'pier.strike', id: 's', castId: id, seq: 2 }).cast?.phase).toBe('fighting');
  for (const [seq, on] of [[3, false], [4, true], [5, false]] as const) expect(s.domain.act(person, { type: 'pier.reel', id: `r${seq}`, castId: id, seq, on }).ok).toBe(true);
  s.setTime(bite + 50); const view = s.domain.tick();
  expect(view.every(beat => beat.kind !== 'ended')).toBe(true);
  const expected = stepFight(createFight(fishingHash('fight:1:1'), 'steady'), false);
  expect(s.domain.views()[0]?.fight).toMatchObject({ tick: 1, tension: expected.tension, progress: expected.progress });
  expect(s.domain.act(person, { type: 'pier.reel', id: 'old', castId: id, seq: 3, on: true }).beats).toEqual([]);
  s.setTime(bite + 100); s.domain.tick();
  const second = stepFight(expected, false);
  expect(s.domain.views()[0]?.fight).toMatchObject({ tick: 2, tension: second.tension, progress: second.progress });
});

it.each(['move', 'revision', 'seat', 'rod', 'disconnect', 'installation'] as const)('cancels when %s authority is lost', what => {
  const s = setup(); s.start();
  const seat = s.getSeat(), installation = s.getInstallation();
  if (what === 'move') s.setSeat({ ...seat, pose: { ...seat.pose, position: [.81, 1, 23.4] } });
  if (what === 'revision') s.setInstallation({ ...installation, revision: 8 });
  if (what === 'seat') s.setSeat({ ...seat, token: 'replacement' });
  if (what === 'rod') s.setSeat({ ...seat, ownsRod: false });
  if (what === 'disconnect') s.setSeat(null);
  if (what === 'installation') s.setInstallation(null);
  expect(s.domain.tick()).toMatchObject([{ kind: 'ended' }]);
  expect(s.domain.views()).toEqual([]);
});

it('caps active casts, handles expiry and clock rewind, and a restart starts empty', () => {
  const s = setup();
  for (let i = 0; i < 48; i++) expect(s.draw(PersonIdSchema.parse(String(1000 + i))).ok).toBe(true);
  expect(s.draw(person)).toMatchObject({ ok: false, message: 'The pier is full just now.' });
  expect(s.domain.views()).toHaveLength(48);
  s.setTime(999_000); expect(s.domain.tick()).toEqual([]);
  s.setTime(1_005_000); expect(s.domain.tick().filter(beat => beat.kind === 'ended')).toHaveLength(48);
  expect(s.domain.views()).toEqual([]); expect(s.draw(person).ok).toBe(true);
  expect(createFishingCasts(s.options).views()).toEqual([]);
  s.setTime(Number.MAX_SAFE_INTEGER); expect(s.domain.tick().filter(beat => beat.kind === 'ended')).toHaveLength(1);
});

it('treats a repeated strike on a hooked fish as the reel, and a strike while landing as nothing', () => {
  const s = setup(), { id, bite } = s.start();
  s.setTime(bite); expect(s.domain.act(person, { type: 'pier.strike', id: 's1', castId: id, seq: 2 }).cast?.phase).toBe('fighting');
  expect(s.domain.act(person, { type: 'pier.reel', id: 'off', castId: id, seq: 3, on: false }).ok).toBe(true);
  const again = s.domain.act(person, { type: 'pier.strike', id: 's2', castId: id, seq: 4 });
  expect(again).toMatchObject({ ok: true, cast: { phase: 'fighting' } });
  expect(again.beats.some(beat => beat.kind === 'ended')).toBe(false);
  // The second strike is a reel edge on the same next tick, so the last word (reel on) holds.
  s.setTime(bite + 50); s.domain.tick();
  const expected = stepFight(createFight(fishingHash('fight:1:1'), 'steady'), true);
  expect(s.domain.views()[0]?.fight).toMatchObject({ tick: 1, tension: expected.tension, progress: expected.progress });
});

it('keeps a landing fish when the strike is pressed again', () => {
  const { s, id } = winFight();
  expect(s.domain.views()[0]?.phase).toBe('landing');
  const result = s.domain.act(person, { type: 'pier.strike', id: 'late', castId: id, seq: 9_000 });
  expect(result).toMatchObject({ ok: true, cast: { phase: 'landing' } });
  expect(s.domain.candidate(person)).not.toBeNull();
});

function winFight() {
  const s = setup(), { id, bite } = s.start();
  s.setTime(bite); expect(s.domain.act(person, { type: 'pier.strike', id: 's', castId: id, seq: 2 }).ok).toBe(true);
  let seq = 2, held = true;
  const beats: string[] = [];
  for (let tick = 0; tick < 600 && s.domain.views()[0]?.phase === 'fighting'; tick++) {
    const fight = s.domain.views()[0]!.fight!;
    const desired = fight.phase === 'rest' && fight.tension < 6000;
    if (desired !== held) {
      held = desired;
      const result = s.domain.act(person, { type: 'pier.reel', id: `edge-${seq}`, castId: id, seq: ++seq, on: desired });
      expect(result.ok).toBe(true); beats.push(...result.beats.map(b => b.kind));
    }
    s.setTime(bite + (tick + 1) * 50); beats.push(...s.domain.tick().map(b => b.kind));
  }
  expect(beats).toContain('landing');
  return { s, id, beats };
}

it('lands a fair fight as an immutable candidate without publishing a catch or granting an item', () => {
  const { s, id, beats } = winFight();
  expect(beats).not.toContain('caught');
  const candidate = s.domain.candidate(person);
  expect(candidate).toMatchObject({ castId: id, personId: person, kingdomId, fish: { speciesId: fish.id }, result: { outcome: 'landed' } });
  expect(candidate).toMatchObject({ castSeed: 1, anchor: [0, 1, 23.4], collisionRevision: 7 });
  expect(s.domain.views()[0]).not.toHaveProperty('castSeed');
  expect(s.domain.views()[0]?.fight).not.toHaveProperty('seed');
  expect(Object.isFrozen(candidate)).toBe(true); expect(Object.isFrozen(candidate!.inputs)).toBe(true);
  expect(candidate!.inputs.every(Object.isFrozen)).toBe(true);
  expect(s.domain.finish(person, id)).toBe(true);
  expect(s.domain.candidate(person)).toBeNull();
});


it('takes biome from the trusted installation, never the site or Genesis character hint', () => {
  const restricted = { ...fish, biomes: ['meadow'] };
  for (const [trusted, hint, shouldBite] of [[null, 'meadow', false], ['meadow', 'marsh', true], ['marsh', 'meadow', false]] as const) {
    const s = setup(1, [restricted]), installation = s.getInstallation();
    s.setInstallation({ ...installation, biome: trusted, site: { ...site, biome: hint } });
    const { landed } = s.start(); s.setTime(landed);
    const beats = s.domain.tick();
    expect(beats.some(beat => beat.kind === 'float')).toBe(shouldBite);
    if (shouldBite) expect(s.domain.views()[0]?.environment?.biome).toBe('meadow');
    else expect(s.domain.views()).toEqual([]);
  }
  const wildcard = setup(), installation = wildcard.getInstallation();
  wildcard.setInstallation({ ...installation, biome: null });
  const { landed } = wildcard.start(); wildcard.setTime(landed);
  expect(wildcard.domain.tick().some(beat => beat.kind === 'float')).toBe(true);
  expect(wildcard.domain.views()[0]?.environment?.biome).toBe('unknown');
});

it('cancels an active cast when trusted biome changes', () => {
  const s = setup(); s.start();
  s.setInstallation({ ...s.getInstallation(), biome: 'marsh' });
  expect(s.domain.tick()).toMatchObject([{ kind: 'ended' }]);
  expect(s.domain.views()).toEqual([]);
});


it.each(['seat', 'rod', 'revision', 'disconnect'] as const)('rechecks %s before returning a won candidate', failure => {
  const { s } = winFight();
  expect(s.domain.candidate(person)).not.toBeNull();
  const seat = s.getSeat(), installation = s.getInstallation();
  if (failure === 'seat') s.setSeat({ ...seat, token: 'replacement' });
  if (failure === 'rod') s.setSeat({ ...seat, ownsRod: false });
  if (failure === 'revision') s.setInstallation({ ...installation, revision: 8 });
  if (failure === 'disconnect') s.setSeat(null);
  expect(s.domain.candidate(person)).toBeNull();
  expect(s.domain.candidate(person)).toBeNull();
});

it('refuses a candidate at the exact five-second landing expiry', () => {
  const { s } = winFight();
  const candidate = s.domain.candidate(person)!;
  expect(candidate.result.outcome).toBe('landed');
  s.setTime(candidate.at + 4999); expect(s.domain.candidate(person)).not.toBeNull();
  s.setTime(candidate.at + 5000); expect(s.domain.candidate(person)).toBeNull();
  expect(s.domain.candidate(person)).toBeNull();
});

it('reaches the same wait and bite state whether clock ticks are frequent or batched', () => {
  const frequent = setup(), batched = setup();
  const f = frequent.start(), b = batched.start();
  expect(f.bite).toBe(b.bite);
  const frequentBeats = [];
  for (let time = f.landed; time < f.bite; time += 100) {
    frequent.setTime(time); frequentBeats.push(...frequent.domain.tick());
  }
  frequent.setTime(f.bite); frequentBeats.push(...frequent.domain.tick());
  batched.setTime(b.bite); const batchedBeats = batched.domain.tick();
  expect(frequent.domain.views()).toEqual(batched.domain.views());
  expect(frequentBeats).toEqual(batchedBeats);
  expect(batchedBeats.map(beat => beat.kind)).toEqual(['float', 'nibble', 'nibble', 'bite']);
});
