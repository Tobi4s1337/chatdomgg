import { KingdomIdSchema, PersonIdSchema, type PersonId } from '@chatdom/shared';
import { describe, expect, it } from 'vitest';
import { createMemoryMomentRecords } from '../../../herald/src/twitch-moments/memory';
import type { ClaimedSummon } from '../../../herald/src/twitch-moments/normalizer';
import { momentRepository } from '../../../herald/src/twitch-moments/records';
import { advanceDragon, DRAGON_FIGHT_MS, DRAGON_WAKE_MS, dragonHealthPermille, dragonVitality, readDragon, summonDragon } from './battle';
import { DRAGON_FIGHTER_MEMORY, DragonRecordSchema, type DragonRecord } from './dragon-record';

const K = KingdomIdSchema.parse('424242');
const NOW = Date.UTC(2026, 9, 30, 20, 0);
const STARTS = NOW + DRAGON_WAKE_MS, ENDS = STARTS + DRAGON_FIGHT_MS;
const p = (n: number) => PersonIdSchema.parse(String(81_000_000 + n));
const ASH = p(1), BRAM = p(2), CORA = p(3);

const dragon = (overrides: Partial<DragonRecord> = {}): DragonRecord => DragonRecordSchema.parse({
  version: 1, battleKey: 'ht.train-1', source: 'hype', trainKey: 'ht.train-1', form: 'young', phase: 'active', startsAt: STARTS, endsAt: ENDS,
  acceptedStrikes: 0, fighters: 0, fighterIds: [], sharedSessionKey: null, revision: 3, ...overrides,
});
const took = (strikes: number, fighters: readonly PersonId[]) => ({ strikes, fighters });

describe('dragon health', () => {
  it('grows the dragon with the crowd and counts down from a full thousand to zero, never past either end', () => {
    expect(dragonVitality(0)).toBe(40);
    expect(dragonVitality(1)).toBe(48);
    expect(dragonVitality(10)).toBe(120);
    expect(dragonHealthPermille({ acceptedStrikes: 0, fighters: 0 })).toBe(1000);
    expect(dragonHealthPermille({ acceptedStrikes: 24, fighters: 1 })).toBe(500);
    expect(dragonHealthPermille({ acceptedStrikes: 47, fighters: 1 })).toBe(21);
    expect(dragonHealthPermille({ acceptedStrikes: 48, fighters: 1 })).toBe(0);
    expect(dragonHealthPermille({ acceptedStrikes: 10_000, fighters: 1 })).toBe(0);
    // More fighters make the same tally a smaller wound.
    expect(dragonHealthPermille({ acceptedStrikes: 24, fighters: 10 })).toBe(800);
  });
});

describe('advanceDragon', () => {
  it('keeps a summoning dragon in the air until its fight begins, then makes it active', () => {
    const summoning = dragon({ phase: 'summoning' });
    expect(advanceDragon(summoning, undefined, STARTS - 1)).toBe(summoning);
    const active = advanceDragon(summoning, undefined, STARTS);
    expect(active).toMatchObject({ phase: 'active', acceptedStrikes: 0, revision: 4 });
    expect(summoning.phase).toBe('summoning');
  });

  it('lands the strikes due at the moment the fight begins in the same step', () => {
    expect(advanceDragon(dragon({ phase: 'summoning' }), took(2, [ASH]), STARTS))
      .toMatchObject({ phase: 'active', acceptedStrikes: 2, fighters: 1, fighterIds: [ASH], revision: 4 });
  });

  it('accumulates strikes and counts each fighter once', () => {
    const first = advanceDragon(dragon(), took(3, [ASH, BRAM]), STARTS + 1_000);
    expect(first).toMatchObject({ acceptedStrikes: 3, fighters: 2, fighterIds: [ASH, BRAM], revision: 4 });
    const second = advanceDragon(first, took(2, [BRAM, CORA]), STARTS + 2_000);
    expect(second).toMatchObject({ phase: 'active', acceptedStrikes: 5, fighters: 3, fighterIds: [ASH, BRAM, CORA], revision: 5 });
  });

  it('returns the very same record when nothing changes', () => {
    const active = dragon();
    expect(advanceDragon(active, undefined, STARTS + 1_000)).toBe(active);
    expect(advanceDragon(active, took(0, []), STARTS + 1_000)).toBe(active);
  });

  it('falls to the crowd once its health reaches zero', () => {
    const wounded = dragon({ acceptedStrikes: 47, fighters: 1, fighterIds: [ASH] });
    expect(dragonHealthPermille(wounded)).toBeGreaterThan(0);
    const fallen = advanceDragon(wounded, took(1, [ASH]), STARTS + 60_000);
    expect(fallen).toMatchObject({ phase: 'victory', acceptedStrikes: 48, fighters: 1, revision: 4 });
    expect(dragonHealthPermille(fallen)).toBe(0);
  });

  it('counts the final blow as a victory even when it is committed after time runs out', () => {
    expect(advanceDragon(dragon({ acceptedStrikes: 47, fighters: 1, fighterIds: [ASH] }), took(1, [ASH]), ENDS + 200))
      .toMatchObject({ phase: 'victory' });
  });

  it('retreats once its fight is over and the crowd has not won', () => {
    const fighting = dragon({ acceptedStrikes: 10, fighters: 1, fighterIds: [ASH] });
    expect(advanceDragon(fighting, undefined, ENDS - 1)).toBe(fighting);
    expect(advanceDragon(fighting, undefined, ENDS)).toMatchObject({ phase: 'retreat', acceptedStrikes: 10, revision: 4 });
    // Late strikes that do not finish it still land in the tally it retreats with.
    expect(advanceDragon(fighting, took(5, [BRAM]), ENDS + 1)).toMatchObject({ phase: 'retreat', acceptedStrikes: 15, fighters: 2 });
  });

  it('moves a dragon that slept through its whole fight straight to retreat with one revision', () => {
    expect(advanceDragon(dragon({ phase: 'summoning' }), undefined, ENDS + 60_000)).toMatchObject({ phase: 'retreat', revision: 4 });
  });

  it('never changes a dragon that has fallen or retreated', () => {
    for (const phase of ['victory', 'retreat'] as const) {
      const finished = dragon({ phase, acceptedStrikes: 12, fighters: 2, fighterIds: [ASH, BRAM] });
      expect(advanceDragon(finished, took(30, [CORA]), STARTS + 1_000)).toBe(finished);
      expect(advanceDragon(finished, undefined, ENDS + 600_000)).toBe(finished);
    }
  });

  it('bumps the revision by exactly one per changed step, however many transitions it takes', () => {
    const fallen = advanceDragon(dragon({ phase: 'summoning', revision: 7 }), took(dragonVitality(1), [ASH]), STARTS);
    expect(fallen).toMatchObject({ phase: 'victory', revision: 8 });
  });

  it('remembers at most its fighter memory, and still counts newcomers beyond it', () => {
    const remembered = Array.from({ length: DRAGON_FIGHTER_MEMORY - 1 }, (_, i) => p(100 + i));
    const crowded = dragon({ fighters: remembered.length, fighterIds: remembered, acceptedStrikes: remembered.length });
    const next = advanceDragon(crowded, took(4, [remembered[0]!, p(90_001), p(90_002), p(90_003)]), STARTS + 1_000);
    expect(next.fighters).toBe(DRAGON_FIGHTER_MEMORY + 2);
    expect(next.fighterIds).toHaveLength(DRAGON_FIGHTER_MEMORY);
    expect(next.fighterIds.at(-1)).toBe(p(90_001));
    expect(() => DragonRecordSchema.parse(next)).not.toThrow();
  });
});

describe('summonDragon', () => {
  const summon = (form: ClaimedSummon['form']): ClaimedSummon => ({ kingdomId: K, source: 'hype', requestKey: `ht.train-1.${form}`, trainKey: 'ht.train-1',
    level: 3, form, sharedSessionKey: null });

  it('wakes one dragon per train, never twice for the same form, and changes the form of the one in the sky', async () => {
    const records = createMemoryMomentRecords({ now: () => NOW });
    const run = (form: ClaimedSummon['form'], at = NOW) => records.port.transact(K, tx => summonDragon(tx, momentRepository(tx), summon(form), at, 'live'));

    const woken = await run('young');
    expect(woken?.record).toMatchObject({ battleKey: 'ht.train-1', phase: 'summoning', form: 'young', startsAt: STARTS, endsAt: ENDS, revision: 1 });
    expect(woken?.facts).toMatchObject({ outcome: 'applied', facts: [{ current: true, body: { kind: 'battle', phase: 'summoning', form: 'young', healthPermille: 1000 } }] });

    expect(await run('young', NOW + 2_000)).toBeNull();

    const upgraded = await run('elder', NOW + 3_000);
    expect(upgraded?.record).toMatchObject({ phase: 'summoning', form: 'elder', startsAt: STARTS, endsAt: ENDS, revision: 2 });
    expect(upgraded?.facts).toMatchObject({ outcome: 'applied', facts: [{ body: { form: 'elder' } }] });
    expect(await records.port.transact(K, tx => readDragon(tx, 'ht.train-1'))).toEqual(upgraded?.record);
  });

  it('never wakes a dragon that has already fallen, whatever form the train reaches', async () => {
    const records = createMemoryMomentRecords({ now: () => NOW });
    await records.port.transact(K, tx => summonDragon(tx, momentRepository(tx), summon('young'), NOW, 'live'));
    const [key, stored] = records.dump(K).find(([, value]) => DragonRecordSchema.safeParse(value).success)!;
    const fallen = advanceDragon(DragonRecordSchema.parse(stored), took(dragonVitality(1), [ASH]), STARTS);
    expect(fallen.phase).toBe('victory');
    await records.port.transact(K, tx => tx.put(key, fallen));
    expect(await records.port.transact(K, tx => summonDragon(tx, momentRepository(tx), summon('golden'), ENDS, 'live'))).toBeNull();
    expect(await records.port.transact(K, tx => readDragon(tx, 'ht.train-1'))).toMatchObject({ phase: 'victory', form: 'young' });
  });
});
