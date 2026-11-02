import { KingdomIdSchema } from '@chatdom/shared';
import { describe, expect, it } from 'vitest';
import type { MomentBodyOf } from './contracts';
import { RAID_BEAT, RAID_LIMITS, planRaid, raidCues, raidFrame, raidScaleProfile, raidUnits, wagonElapsed, wagonKind, wagonPose } from './raid-beat';

const START = Date.UTC(2026, 10, 1, 19);
const body = (viewers: number): MomentBodyOf<'raid'> => ({ kind: 'raid', key: 'raid.motion', displayUntil: START + 60_000,
  raidKey: 'motion', from: { kingdomId: KingdomIdSchema.parse('31337'), displayName: 'Mossbrook', crestKey: null }, viewers, founded: true });
const plan = (viewers: number, start = START) => planRaid('motion', body(viewers), start, name => name);

describe('Raid column pacing', () => {
  it('gives each authored size its own count and passage while bounding the complete show', () => {
    const counts = [3, 140, 10_000, 70_000];
    expect(counts.map(raidUnits)).toEqual([1, 4, 9, 12]);
    const beats = counts.map(viewers => plan(viewers));
    const passage = beats.map(beat => (beat.units - 1) * beat.timing.pitch + beat.timing.pass);
    expect(passage).toEqual([6000, 22_400, 58_000, 74_000]);
    expect(beats[0]!.holdUntil - START).toBe(14_000);
    expect(beats[2]!.holdUntil - START).toBeGreaterThan(60_000);
    for (const beat of beats) {
      expect(beat.units).toBeLessThanOrEqual(RAID_LIMITS.units);
      expect(beat.endAt - START).toBeLessThanOrEqual(120_000);
      expect(beat.holdUntil).toBeLessThan(beat.sleepAt);
      expect(beat.sleepAt + RAID_BEAT.sleepFade).toBeLessThan(beat.endAt);
    }
    expect(raidScaleProfile(1)).toEqual(raidScaleProfile(3));
    expect(raidScaleProfile(1_000_000)).toEqual(raidScaleProfile(70_000));
    for (let viewers = 1; viewers <= 1_000_000; viewers = Math.ceil(viewers * 1.2)) {
      const beat = plan(viewers);
      expect(beat.endAt - START).toBeLessThanOrEqual(120_000);
      expect(beat.timing.pitch).toBeGreaterThanOrEqual(3600);
      expect(beat.timing.travel).toBeGreaterThanOrEqual(46_000);
    }
  });

  it('uses the original absolute start for all poses and rolling cues at different sample intervals', () => {
    const beat = plan(10_000), seekAt = START + 41_375;
    const sample = (step: number) => {
      for (let at = START; at < seekAt; at += step) raidFrame(beat, at);
      const frame = raidFrame(beat, seekAt);
      return Array.from({ length: beat.units }, (_, index) => {
        const elapsed = wagonElapsed(frame, index);
        return elapsed === null ? null : wagonPose(elapsed, 110, frame.timing);
      });
    };
    expect(sample(16)).toEqual(sample(117));
    expect(sample(117)).toEqual(sample(3000));
    const shifted = plan(10_000, START + 17_000);
    expect(raidFrame(beat, seekAt).t).toBe(raidFrame(shifted, seekAt + 17_000).t);
    const rolls = raidCues(beat).filter(cue => cue.cue === 'cart-roll');
    expect(rolls.length).toBeLessThanOrEqual(RAID_LIMITS.rolls);
    expect(rolls.map(cue => cue.atMs)).toEqual([0, 3, 6].map(index => START + RAID_BEAT.arrive + index * beat.timing.pitch));
    expect(raidCues(shifted).map(cue => cue.atMs - 17_000)).toEqual(raidCues(beat).map(cue => cue.atMs));
  });

  it('keeps wagon clocks on their own profile and permits legacy frames', () => {
    const timing = raidScaleProfile(10_000);
    expect(wagonElapsed({ t: RAID_BEAT.arrive + timing.pitch - 1, timing }, 1)).toBeNull();
    expect(wagonElapsed({ t: RAID_BEAT.arrive + timing.pitch + 100, timing }, 1)).toBe(100);
    expect(wagonElapsed({ t: RAID_BEAT.arrive + timing.pitch + timing.travel, timing }, 1)).toBeNull();
    expect(wagonElapsed({ t: RAID_BEAT.arrive + RAID_BEAT.pitch + 100 }, 1)).toBe(100);
    expect([0, 1, 2, 3, 4].map(wagonKind)).toEqual(['lead', 'covered', 'lantern', 'covered', 'lantern']);
  });

  it('moves forward with weight, without road overshoot, and fades before removal', () => {
    for (const viewers of [3, 140, 10_000, 70_000]) {
      const timing = raidScaleProfile(viewers);
      for (const length of [18, 110, 220]) {
        let prior = -3;
        expect(wagonPose(-100, length, timing)).toMatchObject({ distance: -3, presence: 0 });
        expect(wagonPose(0, length, timing).presence).toBe(0);
        expect(wagonPose(RAID_BEAT.emerge, length, timing).presence).toBe(1);
        for (let elapsed = 0; elapsed <= timing.travel + 5000; elapsed += 83) {
          const pose = wagonPose(elapsed, length, timing);
          expect(pose.distance).toBeGreaterThanOrEqual(prior);
          expect(pose.distance).toBeLessThanOrEqual(length - 0.5);
          expect(pose.presence).toBeGreaterThanOrEqual(0);
          expect(pose.presence).toBeLessThanOrEqual(1);
          expect(pose.speed).toBeGreaterThanOrEqual(1.6);
          expect(pose.speed).toBeLessThanOrEqual(3);
          prior = pose.distance;
        }
        expect(wagonPose(timing.travel - 1, length, timing).presence).toBeLessThan(0.01);
        expect(wagonPose(timing.travel, length, timing).presence).toBe(0);
      }
      // A wagon spends seconds in the near street; consecutive wagons never blink into the same place.
      const lead = wagonPose(timing.pitch + 2000, 110, timing);
      const following = wagonPose(2000, 110, timing);
      expect(lead.distance - following.distance).toBeGreaterThan(7);
      expect(following.presence).toBe(1);
    }
  });
});
