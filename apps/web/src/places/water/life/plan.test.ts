import { describe, expect, it } from 'vitest';
import { createPeopleLight } from '../../../kingdom/lights/people-light';
import { RING_CAP, ringsAt, soundsBetween } from './events';
import { FLOATER_CAP, FLOATER_LIFE, floaterAt, floaterTrack, liveFloaters, type FloaterAction } from './floaters';
import { contactGap, onWalk } from './habitat';
import { PLACE_LAMP_PILOT, placeLampLight } from './lamps';
import { millHabitat } from './fixture.test-helpers';
import { DUCK_DEPTH, planWaterLife } from './plan';
import {
  boatSway, dragonflyPose, duckPose, duckTravel, FISH_JITTER, FISH_SLOT, fishInAir, fishJump, fishLanding, flight, FLIGHT_SLOT,
  heronPose, kingfisherPose, restingPose, wheelAngle,
} from './poses';

const { habitat, reeds, anchors } = millHabitat();
const plan = planWaterLife(habitat, reeds, 7);
const pose = restingPose();

describe('water life plan on the SIMULATED millrace', () => {
  it('puts a pair of ducks on the millpond and on the bridge pool, never under the deck or against a stone', () => {
    const waters = plan.ducks.map(p => p.loop.water);
    expect(waters).toContain('millpond');
    expect(waters.some(w => w.startsWith('mill-stream:pool'))).toBe(true);
    for (const pair of plan.ducks) {
      let last = duckTravel(pair, 0);
      for (let t = 0; t <= 600; t += 0.5) {
        const travel = duckTravel(pair, t);
        // The surges never make a duck back up.
        expect((travel - last) * pair.direction).toBeGreaterThanOrEqual(-1e-9);
        last = travel;
        const lead = { ...duckPose(plan, pair, 0, t, pose) }, follow = { ...duckPose(plan, pair, 1, t, pose) };
        for (const bird of [lead, follow]) {
          const water = habitat.waterAt(bird.x, bird.z);
          expect(water && water.depth).toBeGreaterThan(DUCK_DEPTH - 0.08);
          expect(onWalk(habitat.walks, [bird.x, bird.y, bird.z])).toBe(false);
          for (const contact of habitat.obstacles) expect(contactGap(contact, bird.x, bird.z)).toBeGreaterThan(0.35);
        }
        const gap = Math.hypot(lead.x - follow.x, lead.z - follow.z);
        expect(gap).toBeGreaterThan(0.5); expect(gap).toBeLessThan(1.25);
      }
    }
  });

  it('stands the heron on the real bed in reed shallows, facing deeper water', () => {
    expect(plan.heron).not.toBeNull();
    const [x, y, z] = plan.heron!.position, water = habitat.waterAt(x, z)!;
    expect(y).toBeCloseTo(water.level - water.depth, 6);
    expect(water.depth).toBeGreaterThan(0.03); expect(water.depth).toBeLessThan(0.31);
    expect(Math.min(...reeds.map(r => Math.hypot(r[0] - x, r[2] - z)))).toBeLessThan(2.2);
    expect(onWalk(habitat.walks, [x, y + 0.5, z])).toBe(false);
    const ahead = habitat.waterAt(x + Math.cos(plan.heron!.facing), z + Math.sin(plan.heron!.facing));
    expect(ahead!.depth).toBeGreaterThan(water.depth);
    for (let t = 0; t < 300; t += 7) expect(heronPose(plan, plan.heron!, t, pose).y).toBe(y);
  });

  it('jumps a fish on a seeded 20–40 s schedule, only from deep open water', () => {
    const jumps = Array.from({ length: 120 }, (_, k) => fishJump(plan, habitat, k + 1)).filter(j => j !== null);
    expect(jumps.length).toBeGreaterThan(100);
    for (let i = 1; i < jumps.length; i++) {
      if (jumps[i]!.slot !== jumps[i - 1]!.slot + 1) continue;
      const gap = jumps[i]!.start - jumps[i - 1]!.start;
      expect(gap).toBeGreaterThanOrEqual(FISH_SLOT - 2 * FISH_JITTER); expect(gap).toBeLessThanOrEqual(FISH_SLOT + 2 * FISH_JITTER);
    }
    for (const j of jumps) {
      expect(habitat.waterAt(j.x, j.z)!.depth).toBeGreaterThanOrEqual(0.45);
      const [ex, ez] = fishLanding(j);
      expect(habitat.waterAt(ex, ez)).not.toBeNull();
      expect(fishJump(plan, habitat, j.slot)).toEqual(j);
    }
    const j = jumps[3]!;
    expect(fishInAir(plan, habitat, j.start + 0.4)?.slot).toBe(j.slot);
    expect(fishInAir(plan, habitat, j.start + 2)).toBeNull();
  });

  it('flashes the kingfisher along the stream by day only, clear of the bridge deck', () => {
    let flights = 0;
    for (let slot = 0; slot < 80; slot++) {
      const f = flight(plan, habitat, slot);
      if (!f) continue;
      flights++;
      for (let t = f.start; t < f.start + f.duration; t += 0.1) {
        const p = { ...kingfisherPose(plan, habitat, t, 12, pose) };
        expect(p.visible).toBe(true);
        expect(onWalk(habitat.walks, [p.x, p.y, p.z])).toBe(false);
        expect(p.y - habitat.waterAt(p.x, p.z)!.level).toBeGreaterThan(0.3);
        expect(kingfisherPose(plan, habitat, t, 23, pose).visible).toBe(false);
      }
    }
    expect(flights).toBeGreaterThan(30);
    expect(flights).toBeLessThan(80);
    expect(FLIGHT_SLOT).toBeGreaterThan(20);
  });

  it('keeps dragonflies to noon and fireflies beside real reeds, none on a walk', () => {
    expect(plan.dragonflies.length).toBe(3);
    expect(plan.fireflies.length).toBeGreaterThan(20);
    for (const f of plan.fireflies) expect(onWalk(habitat.walks, f)).toBe(false);
    plan.dragonflies.forEach((home, i) => {
      for (let t = 0; t < 60; t += 0.3) {
        const p = { ...dragonflyPose(plan, habitat, home, i, t, 13, pose) };
        expect(p.visible).toBe(true);
        expect(Math.hypot(p.x - home.anchor[0], p.z - home.anchor[2])).toBeLessThan(1.7);
        expect(onWalk(habitat.walks, [p.x, p.y, p.z])).toBe(false);
      }
      expect(dragonflyPose(plan, habitat, home, i, 10, 21, pose).visible).toBe(false);
    });
  });

  it('draws at most eight rings, the fish landing first', () => {
    for (let t = 0; t < 400; t += 0.25) expect(ringsAt(plan, habitat, [], t).rings.length).toBeLessThanOrEqual(RING_CAP);
    const j = fishJump(plan, habitat, 5)!;
    const { rings } = ringsAt(plan, habitat, [], j.start + 0.9);
    const [ex, ez] = fishLanding(j);
    expect(rings[0]).toMatchObject({ priority: 3 });
    expect(Math.hypot(rings[0]!.x - ex, rings[0]!.z - ez)).toBeLessThan(1e-9);
  });

  it('hands the audio mix one-shots in order, and nothing for a seek', () => {
    const heard: string[] = [];
    for (let t = 0; t < 400; t += 1 / 30) for (const s of soundsBetween(plan, habitat, [], t, t + 1 / 30, 12)) heard.push(`${s.kind}@${s.time.toFixed(4)}`);
    expect(new Set(heard).size).toBe(heard.length);
    const splashes = heard.filter(h => h.startsWith('fish-splash')).length;
    expect(splashes).toBeGreaterThanOrEqual(11); expect(splashes).toBeLessThanOrEqual(15);
    expect(heard.some(h => h.startsWith('kingfisher'))).toBe(true);
    expect(heard.some(h => h.startsWith('duck'))).toBe(true);
    expect(soundsBetween(plan, habitat, [], 100, 90, 12)).toEqual([]);
    expect(soundsBetween(plan, habitat, [], 100, 160, 12)).toEqual([]);
    const night: string[] = [];
    for (let t = 0; t < 400; t += 1) night.push(...soundsBetween(plan, habitat, [], t, t + 1, 23).map(s => s.kind));
    expect(night).not.toContain('kingfisher');
  });

  it('is the same plan and the same poses for the same seed, and a different one for another', () => {
    const again = planWaterLife(habitat, reeds, 7), other = planWaterLife(habitat, reeds, 8);
    expect(again.ducks.map(d => [d.phase, d.speed])).toEqual(plan.ducks.map(d => [d.phase, d.speed]));
    expect(other.ducks.map(d => d.phase)).not.toEqual(plan.ducks.map(d => d.phase));
    const pair = plan.ducks[0]!, at = { ...duckPose(plan, pair, 0, 321.5, pose) };
    duckPose(plan, pair, 0, 900, pose);
    expect({ ...duckPose(plan, pair, 0, 321.5, pose) }).toEqual(at);
  });
});

describe('boats and the wheel', () => {
  it('turns the wheel at five turns a minute', () => {
    expect(wheelAngle(6)).toBeCloseTo(Math.PI, 9);
    expect(wheelAngle(12 * 7 + 3)).toBeCloseTo(Math.PI / 2, 6);
  });
  it('sways moored boats out of step with each other', () => {
    const a: number[] = [], b: number[] = [];
    for (let t = 0; t < 240; t += 0.25) { a.push(boatSway(7, 0, t).yaw); b.push(boatSway(7, 1, t).yaw); }
    const mean = (v: number[]) => v.reduce((s, x) => s + x, 0) / v.length, ma = mean(a), mb = mean(b);
    const cov = a.reduce((s, x, i) => s + (x - ma) * (b[i]! - mb), 0), va = a.reduce((s, x) => s + (x - ma) ** 2, 0), vb = b.reduce((s, x) => s + (x - mb) ** 2, 0);
    expect(Math.abs(cov / Math.sqrt(va * vb))).toBeLessThan(0.5);
    expect(Math.max(...a.map(Math.abs))).toBeLessThan(0.15);
    expect(boatSway(7, 0, 33.3)).toEqual(boatSway(7, 0, 33.3));
  });
});

describe('floaters', () => {
  const action = (i: number, launched: number): FloaterAction => ({ id: `sim-${i}`, label: `SIMULATED ${i}`, launched, from: [-4, 4] });
  it('drift downstream with the real flow and never onto a walk', () => {
    const track = floaterTrack(habitat, 7, action(0, 10))!;
    const at = { position: [0, 0, 0] as [number, number, number], light: 0 };
    expect(floaterAt(track, 0, at)).toBe(true);
    const z0 = at.position[2];
    floaterAt(track, 40, at);
    expect(at.position[2]).toBeGreaterThan(z0 + 2);
    for (let age = 0; age < FLOATER_LIFE; age += 1) {
      floaterAt(track, age, at);
      expect(habitat.waterAt(at.position[0], at.position[2])).not.toBeNull();
      expect(onWalk(habitat.walks, at.position)).toBe(false);
    }
    expect(floaterAt(track, FLOATER_LIFE + 1, at)).toBe(false);
    expect(floaterTrack(habitat, 7, action(0, 10))!.points).toEqual(track.points);
  });
  it('shows only the newest twelve alive and counts the rest', () => {
    const actions = Array.from({ length: 20 }, (_, i) => action(i, i * 2));
    const { live, dropped } = liveFloaters(actions, 45);
    expect(live).toHaveLength(FLOATER_CAP); expect(dropped).toBe(8);
    expect(live[0]!.id).toBe('sim-19');
    expect(liveFloaters(actions, 400).live).toHaveLength(0);
    expect(live.map(l => l.label)).toContain('SIMULATED 19');
  });
});

describe('place lamps through the shared people-light helper', () => {
  it('keep a small pilot empty and warm fully for people on the deck, seekably', () => {
    const emitter = anchors.get('bridge')!.emitters[0]!;
    const light = createPeopleLight(placeLampLight(emitter));
    expect(light.update(0, [])).toBe(PLACE_LAMP_PILOT);
    expect(PLACE_LAMP_PILOT).toBeLessThanOrEqual(0.15);
    const near: [number, number, number] = [emitter.position[0] + 0.5, emitter.position[1] - 1.6, emitter.position[2]];
    expect(light.update(1, [near, near])).toBe(1);
    expect(light.update(1.35, [])).toBeLessThan(1);
    expect(light.update(5, [])).toBe(PLACE_LAMP_PILOT);
    // Backward seek settles at the target for the people given, as the host's history replays.
    expect(light.update(2, [near, near])).toBe(1);
  });
});
