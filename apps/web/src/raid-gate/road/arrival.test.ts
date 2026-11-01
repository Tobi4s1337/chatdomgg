import { describe, expect, it } from 'vitest';
import { KingdomIdSchema } from '@chatdom/shared';
import { createTwitchMoments } from '../../twitch-moments/controller';
import { arrivalFact, createRoadArrivalFeed, type RoadRaid } from './arrival-feed';
import { along, gateShotOf } from './gate-shot';
import { ROAD_PAIR } from './lands';

const AT = Date.UTC(2026, 10, 1, 19, 48);
const raid: RoadRaid = {
  raidId: 'simulated-raid-6f1c2a9e-77b0-4c3e-9a51-0d2f1b7c8e44', kingdomId: ROAD_PAIR.to,
  from: { kingdomId: ROAD_PAIR.from, name: 'MashaD4' }, viewers: 612, founded: true,
};

describe('the guests arrive in the destination world', () => {
  it('hands the kingdom one SIMULATED raid fact under the shared contract, sized by Twitch’s count', () => {
    const fact = arrivalFact(raid, AT);
    expect(fact).toMatchObject({ kingdomId: ROAD_PAIR.to, origin: 'simulated', occurredAt: AT, actor: null,
      body: { kind: 'raid', viewers: 612, founded: true, from: { kingdomId: ROAD_PAIR.from, displayName: 'MashaD4', crestKey: null } } });
    expect(fact.body.kind === 'raid' && fact.body.raidKey).toMatch(/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/);
    expect(fact.body.displayUntil - fact.occurredAt).toBeLessThanOrEqual(5 * 60_000);
  });

  it('wakes the destination’s gate once per raid, and a late subscriber still sees it', () => {
    let now = AT - 4000;
    const moments = createTwitchMoments({ kingdomId: KingdomIdSchema.parse(ROAD_PAIR.to), expectedOrigin: 'simulated', clock: { now: () => now } });
    const feed = createRoadArrivalFeed();
    const stop = moments.connect(feed);
    expect(moments.sample(now).raids).toEqual([]);
    now = AT;
    expect(feed.arrive(raid, AT)).toBe(true);
    expect(feed.arrive({ ...raid, viewers: 3 }, AT + 500)).toBe(false);
    now = AT + 4000;
    const frame = moments.sample(now);
    expect(frame.raids).toHaveLength(1);
    expect(frame.raids[0]).toMatchObject({ viewers: 612, from: { kingdomId: ROAD_PAIR.from, name: 'MashaD4' } });
    stop();
    moments.dispose();

    const late = createTwitchMoments({ kingdomId: KingdomIdSchema.parse(ROAD_PAIR.to), expectedOrigin: 'simulated', clock: { now: () => now } });
    late.connect(feed);
    expect(late.sample(now).raids).toHaveLength(1);
    late.dispose();
  });

  it('a live kingdom refuses the road’s SIMULATED arrival', () => {
    const moments = createTwitchMoments({ kingdomId: KingdomIdSchema.parse(ROAD_PAIR.to), expectedOrigin: 'live', clock: { now: () => AT } });
    expect(moments.reset({ epoch: 'e', asOf: AT, throughSeq: 0, current: [] })).toEqual({ accepted: true });
    expect(moments.receiveFact('e', arrivalFact(raid, AT))).toEqual({ accepted: false, reason: 'origin' });
    moments.dispose();
  });
});

describe('the leaving kingdom’s camera at its gate', () => {
  const road: [number, number, number][] = [[0, 4, 0], [10, 4, 0], [10, 5, 30], [10, 6, 60]];

  it('walks the road by distance', () => {
    expect(along(road, 5)).toEqual([5, 4, 0]);
    expect(along(road, 25)).toEqual([10, 4.5, 15]);
    expect(along(road, 999)).toEqual([10, 6, 60]);
  });

  it('stands outside the gate, raised and to one side, looking in along the road', () => {
    const shot = gateShotOf(road, false)!;
    const gate = road[0]!;
    const heading = [along(road, 18)[0] - gate[0], along(road, 18)[2] - gate[2]];
    const back = [shot.eye[0] - gate[0], shot.eye[2] - gate[2]];
    // Behind the gate, as seen along the road into town.
    expect(back[0]! * heading[0]! + back[1]! * heading[1]!).toBeLessThan(0);
    expect(shot.eye[1]).toBeGreaterThan(gate[1] + 6);
    const look = [shot.target[0] - shot.eye[0], shot.target[2] - shot.eye[2]];
    expect(look[0]! * heading[0]! + look[1]! * heading[1]!).toBeGreaterThan(0);
    expect(gateShotOf(road, true)!.fov).toBeGreaterThan(shot.fov);
    expect(gateShotOf([[0, 0, 0]], false)).toBeNull();
  });
});
