import { describe, expect, it } from 'vitest';
import { GrowthHomeViewSchema, GrowthSceneFrameSchema } from './growth';

const home = { plotId: 'home:juniper', stage: 'cottage', qualifiedDays: 7, qualifiedMinutes: 70,
  currentStreak: 3, bestStreak: 5, nextGoal: { stage: 'house', requiredDays: 30, remainingDays: 23 } } as const;
const frame = { version: 1, kingdomId: '129634568', origin: 'simulated', sequence: 40, asOf: 1_793_530_000_000,
  homes: [home], civic: { tavern: 1, forge: 1, market: 2, bridge: 1, 'castle-court': 1 },
  beats: [{ kind: 'home-grown', plotId: home.plotId, from: 'hut', to: 'cottage', qualifiedDays: 7,
    sourceSeq: 40, at: 1_793_530_000_000 }] } as const;

describe('the first growth presentation contract', () => {
  it('accepts a simulated earned cottage ceremony and preserves its next goal', () => {
    expect(GrowthSceneFrameSchema.parse(frame)).toEqual(frame);
    expect(GrowthHomeViewSchema.parse({ ...home, currentStreak: 0 }).bestStreak).toBe(5);
  });
  it('refuses private evidence, backwards growth and invented future facts', () => {
    expect(GrowthSceneFrameSchema.safeParse({ ...frame, homes: [{ ...home, personId: '123' }] }).success).toBe(false);
    expect(GrowthSceneFrameSchema.safeParse({ ...frame, beats: [{ ...frame.beats[0], from: 'hall' }] }).success).toBe(false);
    expect(GrowthSceneFrameSchema.safeParse({ ...frame, sequence: 39 }).success).toBe(false);
    expect(GrowthSceneFrameSchema.safeParse({ ...frame, beats: [{ ...frame.beats[0], plotId: 'not:here' }] }).success).toBe(false);
  });
  it('keeps streaks and displayed progress bounded by witnessed days', () => {
    for (const invalid of [{ currentStreak: 6 }, { qualifiedMinutes: 7_000 },
      { nextGoal: { stage: 'hut', requiredDays: 3, remainingDays: 0 } }]) {
      expect(GrowthHomeViewSchema.safeParse({ ...home, ...invalid }).success).toBe(false);
    }
  });
});
