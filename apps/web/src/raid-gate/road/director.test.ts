import { describe, expect, it } from 'vitest';
import { mapFrame, momentAt, ROAD_TIMING, schedule, type RoadFacts } from './director';

const none: RoadFacts = { departedAt: null, mapReadyAt: null, arrivedAt: null, welcomedAt: null };
const T = { ...ROAD_TIMING, ride: 16 };

describe('the raid road director', () => {
  it('keeps the party at the gate until Twitch’s raid is witnessed, however long that takes', () => {
    expect(momentAt(none, T, 60)).toMatchObject({ act: 'gather', holding: true });
    expect(schedule(none, T).map(span => span.act)).toEqual(['gather']);
    const early = momentAt({ ...none, departedAt: 2, mapReadyAt: 1 }, T, T.gather + 0.1);
    expect(early.act).toBe('setout');
    expect(momentAt({ ...none, departedAt: 30, mapReadyAt: 1 }, T, 30.1).act).toBe('setout');
  });

  it('rises into the map only once its drawing is ready', () => {
    const facts = { ...none, departedAt: 8 };
    expect(momentAt(facts, T, 40)).toMatchObject({ act: 'setout', holding: true });
    expect(momentAt({ ...facts, mapReadyAt: 40 }, T, 40.5).act).toBe('rise');
  });

  it('holds the column at the destination until its arrival is acknowledged, then wakes and welcomes', () => {
    const facts = { ...none, departedAt: 8, mapReadyAt: 3 };
    const spans = schedule(facts, T);
    const ride = spans.find(span => span.act === 'ride')!;
    const rideEnd = ride.start + ride.length;
    expect(momentAt(facts, T, rideEnd + 5).act).toBe('hold');
    expect(mapFrame(momentAt(facts, T, rideEnd + 5))).toMatchObject({ travel: 1, file: 0, marching: true });
    const arrived = { ...facts, arrivedAt: rideEnd + 5 };
    expect(momentAt(arrived, T, rideEnd + 5.5).act).toBe('wake');
    // The welcome waits for the authority's answer, not for the animation.
    expect(momentAt(arrived, T, rideEnd + 30).act).toBe('wake');
    expect(momentAt({ ...arrived, welcomedAt: rideEnd + 30 }, T, rideEnd + 30.1).act).toBe('welcome');
  });

  it('never holds when the destination is ready before the column gets there', () => {
    const facts = { departedAt: 8, mapReadyAt: 3, arrivedAt: 12, welcomedAt: 12 };
    expect(schedule(facts, T).map(span => span.act)).toEqual(['gather', 'setout', 'rise', 'ride', 'wake', 'welcome']);
  });

  it('is a pure function of the clock: the same facts and time give the same frame', () => {
    const facts = { departedAt: 8, mapReadyAt: 3, arrivedAt: 12, welcomedAt: 12 };
    for (const t of [0, 5, 11, 14, 20, 33, 40]) expect(momentAt(facts, T, t)).toEqual(momentAt(facts, T, t));
    const ride = schedule(facts, T).find(span => span.act === 'ride')!;
    const mid = mapFrame(momentAt(facts, T, ride.start + ride.length / 2));
    expect(mid.travel).toBeCloseTo(0.5, 6);
  });
});
