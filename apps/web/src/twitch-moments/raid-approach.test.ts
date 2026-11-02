import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { RAID_APPROACH, RAID_BEAT, approachLead, raidRoadFade, raidScaleProfile, raidUnits, wagonElapsed, wagonPose, type RaidFrame } from './raid-beat';
import { createRaidLayer, raidApproachPoints, type RaidChatGround, type RaidLayerHost } from './raid-view';

/** A straight street running +z from a gate at z 20; open land lies out to -z in front of the gate. */
function layer(ground?: RaidChatGround) {
  const root = new THREE.Group();
  const host: RaidLayerHost = {
    kit: 'hearth', material: new THREE.MeshBasicMaterial(),
    mesh: () => new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1)),
    place: () => ({ position: [10, 0, 20], facing: [0, 0, 1] }),
    route: () => ({ inbound: [[10, 0, 20], [10, 0, 60]], outbound: [[10, 0, 60], [10, 0, 100]] }),
    ...(ground ? { ground } : {}),
  };
  return { view: createRaidLayer(root, host), dispose: () => host.material.dispose() };
}

const frame = (viewers: number, t: number): RaidFrame => {
  const units = raidUnits(viewers), timing = raidScaleProfile(viewers), key = `raid.k${viewers}`;
  const hold = Math.max(RAID_BEAT.minHold, RAID_BEAT.arrive + (units - 1) * timing.pitch + timing.pass + RAID_BEAT.holdAfter);
  return { id: key, key, t, from: { kingdomId: '31337', name: 'Mossbrook' } as RaidFrame['from'], founded: false, viewers, units, timing, seed: 7, hold, sleep: hold + RAID_BEAT.sleep };
};

const gate = { position: new THREE.Vector3(10, 0, 20), tangent: new THREE.Vector3(0, 0, 1) };
const meadow: RaidChatGround = () => 0.2;

describe('the column comes down the road to the gate', () => {
  it('walks the approach straight out from the gate over cleared ground, nearest the gate last', () => {
    const points = raidApproachPoints(gate, meadow);
    expect(points).toHaveLength(RAID_APPROACH.reach / RAID_APPROACH.step);
    expect(points[0]).toEqual([10, 0.2, 20 - RAID_APPROACH.reach]);
    expect(points.at(-1)).toEqual([10, 0.2, 20 - RAID_APPROACH.step]);
    // A lot 30 m out ends the road short of it; nothing is laid past a refused stride.
    const short = raidApproachPoints(gate, (_x, z) => (z < -10 && z > -14 ? null : 0.2));
    expect(Math.min(...short.map(p => p[2]))).toBe(-10);
    // A bank steeper than a wagon climbs ends it too.
    expect(raidApproachPoints(gate, (_x, z) => (z < 0 ? 3 : 0.2)).map(p => p[2])).toEqual([0, 2, 4, 6, 8, 10, 12, 14, 16, 18]);
  });

  it('bends the road away from the standard so the column is seen across the land, or the other way when that side is taken', () => {
    // The standard stands at +x (the gate's side); the road leaves straight, then eases round towards -x.
    const side = new THREE.Vector3(1, 0, 0);
    const bent = raidApproachPoints(gate, meadow, side);
    expect(bent).toHaveLength(RAID_APPROACH.reach / RAID_APPROACH.step);
    const nearest = bent.slice(-RAID_APPROACH.bend.from / RAID_APPROACH.step);
    expect(nearest.every(p => Math.abs(p[0] - 10) < 1e-9)).toBe(true);
    expect(bent[0]![0]).toBeLessThan(10 - 8);
    const strides = bent.slice(1).map((p, i) => Math.hypot(p[0] - bent[i]![0], p[2] - bent[i]![2]));
    expect(strides.every(d => Math.abs(d - RAID_APPROACH.step) < 1e-9)).toBe(true);
    // Land taken to the -x side turns it the other way; both sides taken leaves it straight.
    const other = raidApproachPoints(gate, (x) => (x < 7 ? null : 0.2), side);
    expect(other[0]![0]).toBeGreaterThan(10 + 8);
    const straight = raidApproachPoints(gate, (x) => (x < 9 || x > 11 ? null : 0.2), side);
    expect(straight.map(p => p[0])).toEqual(straight.map(() => 10));
  });

  it('keeps no approach where the open land is too short to read as a road, or the host offers none', () => {
    expect(raidApproachPoints(gate, (_x, z) => (z < 20 - RAID_APPROACH.min + 1 ? null : 0.2))).toEqual([]);
    expect(raidApproachPoints(gate, undefined)).toEqual([]);
    expect(approachLead(RAID_APPROACH.min - 1, 2)).toBe(0);
  });

  it('brings each unit in out of the dusk at the far end of the road and keeps its gate time', () => {
    const length = 110, approach = 48, speed = wagonPose(0, length).speed, lead = approachLead(approach, speed);
    expect(lead).toBeCloseTo((approach - 3) / speed * 1000);
    // Far out it is not yet there; it rises over the first stretch and is whole long before the gate.
    expect(wagonPose(-lead, length, RAID_BEAT, approach)).toMatchObject({ presence: 0 });
    expect(wagonPose(-lead, length, RAID_BEAT, approach).distance).toBeCloseTo(-approach);
    expect(wagonPose(-lead / 2, length, RAID_BEAT, approach).presence).toBe(1);
    // At its gate time it is exactly where it always was, a little outside the gate line.
    expect(wagonPose(0, length, RAID_BEAT, approach).distance).toBe(wagonPose(0, length).distance);
    expect(wagonPose(0, length, RAID_BEAT, approach).presence).toBe(1);
    expect(wagonElapsed({ t: RAID_BEAT.arrive - lead / 2 }, 0, lead)).toBeCloseTo(-lead / 2);
    expect(wagonElapsed({ t: RAID_BEAT.arrive - lead - 1 }, 0, lead)).toBeNull();
    // Without an approach nothing changes: a unit gathers out of the gate's light.
    expect(wagonPose(-1000, length).presence).toBe(0);
    expect(raidRoadFade(0)).toBe(0);
    expect(raidRoadFade(RAID_BEAT.emerge)).toBe(1);
  });

  it('shows a long column by its length on the road before the gate, and a single wagon alone', () => {
    const before = (viewers: number, ground?: RaidChatGround) => {
      const { view, dispose } = layer(ground);
      if (ground) view.approachGround(ground);
      const timing = raidScaleProfile(viewers);
      // Just before the third unit reaches the gate.
      view.apply([frame(viewers, RAID_BEAT.arrive + 2 * timing.pitch - 200)], 0);
      const stats = view.stats();
      view.dispose(); dispose();
      return stats;
    };
    const gathering = before(10_000), road = before(10_000, meadow);
    expect(gathering.approach).toBe(0);
    expect(road.approach).toBeCloseTo(RAID_APPROACH.reach, 1);
    expect(gathering.wagons).toBe(2);
    expect(road.wagons).toBeGreaterThanOrEqual(4);
    expect(road.ponies).toBeGreaterThan(gathering.ponies);
    // A single wagon has no column behind it to show.
    expect(before(3, meadow).wagons).toBe(1);
  });

  it('never draws the road before the gate wakes, and lets the host take the approach away', () => {
    const { view, dispose } = layer(meadow);
    view.approachGround(meadow);
    view.apply([frame(10_000, 0)], 0);
    expect(view.stats().wagons).toBe(0);
    view.apply([frame(10_000, RAID_BEAT.emerge)], 0);
    expect(view.stats().wagons).toBeGreaterThan(0);
    view.approachGround(undefined);
    view.apply([frame(10_000, RAID_BEAT.emerge)], 0);
    expect(view.stats()).toMatchObject({ approach: 0, wagons: 0 });
    view.dispose(); dispose();
  });
});
