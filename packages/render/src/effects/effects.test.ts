import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { ForgePhase, ForgeRitualFrame, KingdomPresenceFrame, Vec3 } from '@chatdom/shared';
import {
  createEffects, createFlightRecorder, EFFECTS_BUDGET, EFFECTS_QUALITIES, fireEmbers, forgeFlightCue, forgeSparks, glowCapacity,
  maxCoveragePixels, presenceChimneySmoke, smokeCapacity, SPARK_SECONDS,
  type EffectsFrame, type EffectsQuality, type EffectSource, type FlightCue, type ShaftSource, type SparkBurst,
} from './index';
import { emberPose, emptyPose, fireflyPose } from './ambient';
import { emptySmoke, smokePose } from './smoke';
import { sparkPose } from './cues';

function fixture(quality: EffectsQuality = 'balanced', seed = 7) {
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(43, 16 / 9, .15, 2200);
  camera.position.set(0, 2.2, 14); camera.lookAt(0, 1.5, 0);
  const effects = createEffects({ scene, camera, seed, quality });
  return { scene, camera, effects };
}

type Layer = THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
const glowMesh = (scene: THREE.Scene) => scene.getObjectByName('Chatdom effects glow') as Layer | undefined;
const smokeMesh = (scene: THREE.Scene) => scene.getObjectByName('Chatdom effects smoke') as Layer | undefined;
/** Every drawn value of a layer, attribute by attribute (only the drawn instances). */
function values(mesh: Layer | undefined, names: readonly string[]): number[] {
  if (!mesh || !mesh.visible) return [];
  const n = mesh.geometry.instanceCount;
  return names.flatMap(name => { const a = mesh.geometry.getAttribute(name) as THREE.InstancedBufferAttribute; return [...(a.array as Float32Array).slice(0, n * a.itemSize)]; });
}
const drawn = (scene: THREE.Scene) => values(glowMesh(scene), ['aPose', 'aColour', 'aStreak']);
const puffs = (scene: THREE.Scene) => values(smokeMesh(scene), ['aPuff', 'aLook']);
const everything = (scene: THREE.Scene) => [...drawn(scene), ...puffs(scene)];
/** One string per drawn glint: position, size, colour, alpha and streak. */
function glints(scene: THREE.Scene): string[] {
  const v = drawn(scene), n = v.length / 11;
  return Array.from({ length: n }, (_, i) => [...v.slice(i * 4, i * 4 + 4), ...v.slice(n * 4 + i * 4, n * 4 + i * 4 + 4), ...v.slice(n * 8 + i * 3, n * 8 + i * 3 + 3)].map(x => x.toFixed(5)).join(','));
}
function glintPositions(scene: THREE.Scene): Vec3[] {
  const v = drawn(scene), n = v.length / 11;
  return Array.from({ length: n }, (_, i) => [v[i * 4]!, v[i * 4 + 1]!, v[i * 4 + 2]!]);
}
function puffList(scene: THREE.Scene): { x: number; y: number; z: number; size: number; alpha: number; key: string }[] {
  const v = puffs(scene), n = v.length / 8;
  return Array.from({ length: n }, (_, i) => ({ x: v[i * 4]!, y: v[i * 4 + 1]!, z: v[i * 4 + 2]!, size: v[i * 4 + 3]!, alpha: v[n * 4 + i * 4 + 2]!,
    key: [...v.slice(i * 4, i * 4 + 4), ...v.slice(n * 4 + i * 4, n * 4 + i * 4 + 4)].map(x => x.toFixed(5)).join(',') }));
}

const fires: EffectSource[] = [{ id: 'forge:hearth', position: [0, 1, 0] }, { id: 'gate:brazier:west', position: [-3, 2, 1] }, { id: 'gate:brazier:east', position: [3, 2, 1] }];
const hedge: EffectSource[] = Array.from({ length: 5 }, (_, i) => ({ id: `hedge:${i}`, position: [-6 + i * 3, .5, -2] as const }));
const chimneys: EffectSource[] = [{ id: 'home:1:chimney:0', position: [-4, 4.2, -6] }, { id: 'home:2:chimney:0', position: [4, 3.8, -8] }];
const shafts: ShaftSource[] = [{ id: 'home:1:window', position: [-2, 2.4, -3], direction: [.3, -.55, 1], length: 3.2, radius: .45 }];
const sparks: SparkBurst[] = [{ id: 'forge:anvil', position: [0, 1.4, 2], burstId: 'forge:r1:strike', startedAt: 12.2 }];
function flightAt(time: number, active = true): FlightCue {
  const path = (t: number): Vec3 => [-2 + 1.6 * (t - 15.5), 1.5 + 3 * Math.sin(Math.min(1, (t - 15.5) / 3) * Math.PI), 1 - .8 * (t - 15.5)];
  const history = [];
  for (let t = 15.5; t < time; t += 1 / 30) history.push({ time: t, position: path(t) });
  return { id: 'forge:r1:flight', position: path(time), startedAt: 15.5, active, history };
}
const frame = (time: number, extra: Partial<EffectsFrame> = {}): EffectsFrame =>
  ({ time, wind: [.6, 0, .25], fireflies: hedge, embers: fires, smoke: chimneys, dust: shafts, sparks, ...extra });

describe('effects library: determinism and identity', () => {
  it('draws the same frame for the same inputs regardless of frame rate, seek or update order', () => {
    for (const time of [12.5, 16.4]) {
      const extra = time > 16 ? { flight: flightAt(time) } : {};
      const direct = fixture(), stepped = fixture(), seeked = fixture();
      direct.effects.update(frame(time, extra));
      for (let t = 0; t <= time; t += 1 / 30) stepped.effects.update(frame(t, t > 15.5 ? { flight: flightAt(t) } : {}));
      stepped.effects.update(frame(time, extra));
      seeked.effects.update(frame(400)); seeked.effects.update(frame(-3)); seeked.effects.update(frame(time, extra));
      const expected = everything(direct.scene);
      expect(drawn(direct.scene).length).toBeGreaterThan(0);
      expect(puffs(direct.scene).length).toBeGreaterThan(0);
      expect(everything(stepped.scene)).toEqual(expected);
      expect(everything(seeked.scene)).toEqual(expected);
    }
  });

  it('input order and duplicate ids never change the picture, whichever duplicate comes first', () => {
    const direct = fixture();
    direct.effects.update(frame(12.5));
    const expected = everything(direct.scene);
    const stray = (s: EffectSource) => ({ ...s, position: [s.position[0] + 40, s.position[1], s.position[2]] as Vec3 });
    for (const strayFirst of [false, true]) {
      const shuffled = fixture();
      const twice = <T extends EffectSource>(list: readonly T[], extra: (s: T) => T) => strayFirst ? [...list.map(extra), ...[...list].reverse()] : [...[...list].reverse(), ...list.map(extra)];
      shuffled.effects.update(frame(12.5, {
        fireflies: twice(hedge, stray), embers: twice(fires, stray), smoke: twice(chimneys, stray),
        dust: twice(shafts, s => ({ ...s, length: s.length + 1 })), sparks: twice(sparks, s => ({ ...s, startedAt: s.startedAt + .3 })),
      }));
      expect(everything(shuffled.scene)).toEqual(expected);
    }
  });

  it('is seeded: another seed gives another frame, the same seed after reset gives this one again', () => {
    const a = fixture('balanced', 7), b = fixture('balanced', 8);
    a.effects.update(frame(12.4)); b.effects.update(frame(12.4));
    expect(everything(a.scene)).not.toEqual(everything(b.scene));
    const before = everything(a.scene);
    a.effects.reset();
    expect(everything(a.scene)).toEqual([]);
    expect(a.effects.diagnostics()).toMatchObject({ glow: { count: 0 }, smoke: { count: 0 }, rememberedBursts: 0 });
    a.effects.update(frame(12.4));
    expect(everything(a.scene)).toEqual(before);
  });
});

describe('effects library: ambient air', () => {
  it('fireflies are sparse slow glints, embers rise, cool and go out', () => {
    const pose = emptyPose();
    let lit = 0, total = 0;
    for (let key = 1; key < 200; key++) for (let t = 0; t < 30; t += .5) { total++; if (fireflyPose(key * 7919, 0, 0, 0, t, 0, 0, pose)) lit++; }
    expect(lit / total).toBeGreaterThan(.08); expect(lit / total).toBeLessThan(.3);
    for (let t = 0; t < 120; t += .37) if (fireflyPose(4242, 10, 0, 10, t, 0, 0, pose)) {
      expect(Math.hypot(pose.x - 10, pose.z - 10)).toBeLessThan(3.4); expect(pose.y).toBeGreaterThan(-.2); expect(pose.y).toBeLessThan(1.8);
    }
    for (const key of [1234567, 7654321, 99991]) {
      let lastY = -Infinity, rising = 0, samples = 0, firstLevel = 0, lastLevel = 0;
      for (let t = 0; t < 40; t += .02) {
        if (!emberPose(key, 0, 0, 0, t, 0, 0, pose)) { lastY = -Infinity; continue; }
        const level = pose.r + pose.g + pose.b;
        if (lastY === -Infinity) firstLevel = level;
        else { samples++; if (pose.y >= lastY - 1e-9) rising++; }
        lastY = pose.y; lastLevel = level;
        expect(pose.y).toBeLessThan(3); expect(pose.size).toBeLessThanOrEqual(.06);
      }
      expect(rising / samples).toBeGreaterThan(.99);
      expect(firstLevel).toBeGreaterThan(lastLevel);
    }
  });

  it('embers scatter: lives differ in lean and brightness instead of forming one column', () => {
    const pose = emptyPose(), leans: number[] = [], levels: number[] = [];
    for (let key = 1; key < 400; key++) if (emberPose(key * 131, 0, 0, 0, 1.1, 0, 0, pose) && pose.y > .35) {
      leans.push(Math.hypot(pose.x, pose.z) / pose.y); levels.push((pose.r + pose.g + pose.b) / Math.max(pose.alpha, .01));
    }
    expect(leans.length).toBeGreaterThan(40);
    const spread = (list: number[]) => { const s = [...list].sort((a, b) => a - b); return s[Math.floor(s.length * .9)]! / Math.max(1e-3, s[Math.floor(s.length * .1)]!); };
    expect(spread(leans)).toBeGreaterThan(3);
    expect(spread(levels)).toBeGreaterThan(1.6);
  });

  it('wind carries embers and smoke downwind', () => {
    const calm = emptyPose(), windy = emptyPose();
    let pushed = 0, compared = 0;
    for (let key = 1; key < 60; key++) for (const t of [1.1, 2.3, 3.7]) {
      if (!emberPose(key * 31, 0, 0, 0, t, 0, 0, calm) || !emberPose(key * 31, 0, 0, 0, t, 3, 0, windy)) continue;
      compared++; if (windy.x > calm.x) pushed++;
    }
    expect(compared).toBeGreaterThan(20); expect(pushed).toBe(compared);
    const still = emptySmoke(), blown = emptySmoke();
    let leaned = 0, puffsCompared = 0;
    for (let key = 1; key < 60; key++) for (const t of [.9, 1.8, 2.7]) {
      if (!smokePose(key * 17, 0, 0, 0, t, 0, 0, still) || !smokePose(key * 17, 0, 0, 0, t, 0, 2, blown)) continue;
      puffsCompared++; if (blown.z > still.z) leaned++;
    }
    expect(puffsCompared).toBeGreaterThan(20); expect(leaned).toBe(puffsCompared);
  });

  it('chimney smoke is short, soft and grey: small voxels that rise a couple of metres, grow and thin out', () => {
    const puff = emptySmoke();
    let shown = 0;
    for (let key = 1; key < 300; key++) for (let t = 0; t < 20; t += .41) {
      if (!smokePose(key * 977, 0, 4, 0, t, .6, .2, puff)) continue;
      shown++;
      expect(puff.y - 4).toBeGreaterThan(0); expect(puff.y - 4).toBeLessThan(2.6);
      expect(Math.hypot(puff.x, puff.z)).toBeLessThan(2.2);
      expect(puff.size).toBeGreaterThan(.09); expect(puff.size).toBeLessThan(.65);
      expect(puff.alpha).toBeLessThanOrEqual(.6);
    }
    expect(shown).toBeGreaterThan(1000);
    const { scene, effects } = fixture();
    effects.update(frame(9));
    const material = smokeMesh(scene)!.material;
    expect(material.blending).toBe(THREE.NormalBlending); expect(material.depthWrite).toBe(false); expect(material.depthTest).toBe(true);
    // Grey and non-emissive: no channel near the bloom threshold, no hue cast.
    const grey = material.uniforms.uSmoke!.value as THREE.Color;
    expect(Math.max(grey.r, grey.g, grey.b)).toBeLessThan(.5);
    expect(Math.max(grey.r, grey.g, grey.b) - Math.min(grey.r, grey.g, grey.b)).toBeLessThan(.05);
    for (const p of puffList(scene)) {
      const mouth = chimneys.find(c => Math.hypot(p.x - c.position[0], p.z - c.position[2]) < 2.5);
      expect(mouth).toBeDefined();
      expect(p.y).toBeGreaterThan(mouth!.position[1]);
    }
  });

  it('dust lives only inside the supplied shaft, faint and below the bloom threshold', () => {
    const { scene, effects } = fixture('high');
    const shaft = shafts[0]!, [dx, dy, dz] = shaft.direction, n = Math.hypot(dx, dy, dz);
    let seen = 0;
    for (let t = 0; t < 60; t += .73) {
      effects.update({ time: t, wind: [3, 0, 0], dust: shafts });
      expect(effects.diagnostics().glow.dustShafts).toBe(1);
      const v = drawn(scene), count = v.length / 11;
      for (let i = 0; i < count; i++) {
        const p = [v[i * 4]! - shaft.position[0], v[i * 4 + 1]! - shaft.position[1], v[i * 4 + 2]! - shaft.position[2]];
        const along = (p[0]! * dx + p[1]! * dy + p[2]! * dz) / n;
        const across = Math.hypot(p[0]! - along * dx / n, p[1]! - along * dy / n, p[2]! - along * dz / n);
        expect(along).toBeGreaterThan(-.15); expect(along).toBeLessThan(shaft.length + .15);
        expect(across).toBeLessThan(shaft.radius + .15);
        const [r, g, b] = v.slice(count * 4 + i * 4, count * 4 + i * 4 + 3);
        expect(.2126 * r! + .7152 * g! + .0722 * b!).toBeLessThan(.8);
        seen++;
      }
    }
    expect(seen).toBeGreaterThan(40);
    effects.update({ time: 3, wind: [0, 0, 0] });
    expect(drawn(scene)).toEqual([]);
  });
});

describe('effects library: cues', () => {
  it('a spark burst plays once from its start: re-sending it cannot restart it, and it is gone within a second', () => {
    const fixed = fixture(), drifting = fixture();
    for (let t = 12; t < 14; t += 1 / 30) {
      fixed.effects.update(frame(t, { fireflies: [], embers: [], smoke: [], dust: [] }));
      // A careless caller re-stamps the same burst with the current clock every frame.
      drifting.effects.update(frame(t, { fireflies: [], embers: [], smoke: [], dust: [], sparks: [{ ...sparks[0]!, startedAt: Math.max(12.2, t) }] }));
      expect(drawn(drifting.scene)).toEqual(drawn(fixed.scene));
      const d = fixed.effects.diagnostics();
      if (t < 12.2 || t > 12.2 + SPARK_SECONDS) expect(d.glow.sparkBursts).toBe(0);
      else expect(d.glow.sparkBursts).toBe(1);
    }
    expect(fixed.effects.diagnostics().rememberedBursts).toBe(1);
    // After reset the burst is forgotten, so a replay from its start is exact.
    const replay = fixture();
    replay.effects.update(frame(12.4, { fireflies: [], embers: [], smoke: [], dust: [] }));
    fixed.effects.reset();
    fixed.effects.update(frame(12.4, { fireflies: [], embers: [], smoke: [], dust: [] }));
    expect(drawn(fixed.scene)).toEqual(drawn(replay.scene));
  });

  it('sparks fly up and out from the impact, streak along their motion, cool and fall', () => {
    const pose = emptyPose();
    expect(sparkPose(1, 0, 0, 0, 0, .05, 0, 0, pose)).toBe(true);
    expect(pose.size).toBeGreaterThan(.1);
    expect(sparkPose(1, 0, 0, 0, 0, .2, 0, 0, pose)).toBe(false);
    let streaked = 0, total = 0, upward = 0;
    for (let key = 1; key < 200; key++) {
      if (!sparkPose(key * 4099, 1 + key, 0, 0, 0, .12, 0, 0, pose)) continue;
      total++;
      if (Math.hypot(pose.sx, pose.sy, pose.sz) > .02) streaked++;
      if (pose.y > 0) upward++;
      expect(Math.hypot(pose.x, pose.z)).toBeLessThan(1.2);
      expect(sparkPose(key * 4099, 1 + key, 0, 0, 0, SPARK_SECONDS + .01, 0, 0, pose)).toBe(false);
    }
    expect(total).toBeGreaterThan(150); expect(streaked / total).toBeGreaterThan(.9); expect(upward / total).toBeGreaterThan(.9);
    const ids = fixture(), other = fixture();
    ids.effects.update({ time: 12.4, wind: [0, 0, 0], sparks });
    other.effects.update({ time: 12.4, wind: [0, 0, 0], sparks: [{ ...sparks[0]!, burstId: 'forge:r2:strike' }] });
    expect(drawn(ids.scene)).not.toEqual(drawn(other.scene));
  });

  it('the flight glints at the piece and trails only along the recorded path, never ahead of the clock', () => {
    const { scene, effects } = fixture('high');
    // No history: only the piece's glint and its motes, all at the piece.
    const full = flightAt(16.6), bare: FlightCue = { id: full.id, position: full.position, startedAt: full.startedAt, active: true };
    effects.update({ time: 16.6, wind: [0, 0, 0], flight: bare });
    const alone = glintPositions(scene);
    expect(alone.length).toBe(1 + EFFECTS_BUDGET.high.flight.motes);
    for (const p of alone) expect(Math.hypot(p[0] - bare.position[0], p[1] - bare.position[1], p[2] - bare.position[2])).toBeLessThan(.4);
    // With history: every trail glint sits near a recorded position from the last trail window.
    const cue = flightAt(16.6);
    effects.update({ time: 16.6, wind: [0, 0, 0], flight: cue });
    const trail = glintPositions(scene);
    expect(effects.diagnostics().glow.flightGlints).toBe(trail.length);
    expect(trail.length).toBeGreaterThan(alone.length + 10);
    const path = [...cue.history!.map(s => s.position), cue.position];
    for (const p of trail) expect(Math.min(...path.map(q => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2])))).toBeLessThan(.45);
    // A recorded future (after a seek back) and junk samples change nothing; nor does the history's order.
    const future = { time: 17.2, position: [40, 40, 40] as Vec3 };
    const junk = [{ time: NaN, position: [0, 0, 0] }, { time: 16, position: [0, NaN, 0] }, null] as unknown as typeof cue.history;
    const before = drawn(scene);
    effects.update({ time: 16.6, wind: [0, 0, 0], flight: { ...cue, history: [future, ...[...cue.history!].reverse(), ...junk!] } });
    expect(drawn(scene)).toEqual(before);
    // Landed: the piece no longer glints; what it laid down fades where it is, then the cue draws nothing.
    effects.update({ time: 16.9, wind: [0, 0, 0], flight: { ...cue, active: false } });
    const fading = glintPositions(scene);
    expect(fading.length).toBeGreaterThan(0);
    expect(fading.length).toBeLessThan(trail.length);
    effects.update({ time: 18, wind: [0, 0, 0], flight: { ...cue, active: false } });
    expect(drawn(scene)).toEqual([]);
    effects.update({ time: 15, wind: [0, 0, 0], flight: cue });
    expect(drawn(scene)).toEqual([]);
  });
});

describe('effects library: budgets, lifecycle and bad input', () => {
  it('bounds every family and coverage per tier, and lower tiers keep a subset of the same particles', () => {
    const many = Array.from({ length: 80 }, (_, i) => ({ id: `fire:${i}`, position: [(i % 10) - 5, 1, -Math.floor(i / 10) * 2] as Vec3 }));
    const meadow = Array.from({ length: 80 }, (_, i) => ({ id: `meadow:${i}`, position: [(i % 10) * 1.5 - 7, .4, -Math.floor(i / 10) * 2] as Vec3 }));
    const stacks = Array.from({ length: 60 }, (_, i) => ({ id: `chimney:${i}`, position: [(i % 10) * 2 - 9, 4, -4 - Math.floor(i / 10) * 3] as Vec3 }));
    const beams = Array.from({ length: 12 }, (_, i) => ({ id: `shaft:${i}`, position: [i - 6, 3, -2] as Vec3, direction: [0, -1, .4] as Vec3, length: 3, radius: .5 }));
    const bursts = Array.from({ length: 12 }, (_, i) => ({ id: `anvil:${i}`, position: [i - 6, 1, 0] as Vec3, burstId: `burst:${i}`, startedAt: 5.8 + i * .02 }));
    const captured: Partial<Record<EffectsQuality, { glints: Set<string>; puffs: Set<string> }>> = {};
    for (const quality of EFFECTS_QUALITIES) {
      const { scene, effects } = fixture(quality);
      const budget = EFFECTS_BUDGET[quality];
      let peak = 0;
      const crowd = (t: number) => frame(t, { fireflies: meadow, embers: many, smoke: stacks, dust: beams, sparks: bursts, flight: t > 15.5 ? flightAt(t) : null });
      for (let t = 0; t < 20; t += .25) {
        effects.update(crowd(t));
        const d = effects.diagnostics();
        expect(d.glow.count).toBeLessThanOrEqual(glowCapacity(quality));
        expect(d.smoke.count).toBeLessThanOrEqual(smokeCapacity(quality));
        expect(d.glow.fireflySources).toBeLessThanOrEqual(budget.fireflies.sources);
        expect(d.glow.emberSources).toBeLessThanOrEqual(budget.embers.sources);
        expect(d.glow.dustShafts).toBeLessThanOrEqual(budget.dust.sources);
        expect(d.glow.sparkBursts).toBeLessThanOrEqual(budget.sparks.sources);
        expect(d.smoke.sources).toBeLessThanOrEqual(budget.smoke.sources);
        expect(d.glow.flightGlints).toBeLessThanOrEqual(budget.flight.trail + budget.flight.motes + 1);
        expect(d.maxCoveragePixels).toBeLessThanOrEqual(maxCoveragePixels(quality));
        expect(glowMesh(scene)!.geometry.getAttribute('aPose').count).toBe(glowCapacity(quality));
        expect(smokeMesh(scene)!.geometry.getAttribute('aPuff').count).toBe(smokeCapacity(quality));
        peak = Math.max(peak, d.glow.count + d.smoke.count);
      }
      expect(peak).toBeGreaterThan(0);
      effects.update(crowd(6));
      captured[quality] = { glints: new Set(glints(scene)), puffs: new Set(puffList(scene).map(p => p.key)) };
    }
    for (const [lower, higher] of [['low', 'balanced'], ['balanced', 'high']] as const) {
      for (const glint of captured[lower]!.glints) expect(captured[higher]!.glints.has(glint)).toBe(true);
      for (const puff of captured[lower]!.puffs) expect(captured[higher]!.puffs.has(puff)).toBe(true);
      expect(glowCapacity(lower)).toBeLessThan(glowCapacity(higher));
      expect(smokeCapacity(lower)).toBeLessThan(smokeCapacity(higher));
    }
  });

  it('changes tier at runtime without leaking and redraws on the next update', () => {
    const { scene, effects } = fixture('high');
    effects.update(frame(5));
    const released: string[] = [];
    glowMesh(scene)!.geometry.addEventListener('dispose', () => released.push('glow'));
    smokeMesh(scene)!.geometry.addEventListener('dispose', () => released.push('smoke'));
    effects.setQuality('low');
    expect(released.sort()).toEqual(['glow', 'smoke']);
    expect(glowMesh(scene)!.visible).toBe(false); expect(smokeMesh(scene)!.visible).toBe(false);
    effects.update(frame(5));
    expect(effects.diagnostics().quality).toBe('low');
    expect(glowMesh(scene)!.geometry.getAttribute('aPose').count).toBe(glowCapacity('low'));
    expect(smokeMesh(scene)!.geometry.getAttribute('aPuff').count).toBe(smokeCapacity('low'));
    effects.setQuality('nonsense' as EffectsQuality);
    expect(effects.diagnostics().quality).toBe('low');
    expect(scene.children.filter(child => child.name.startsWith('Chatdom effects'))).toHaveLength(2);
  });

  it('removing a source removes its particles and leaves the others exactly where they were', () => {
    const both = fixture(), one = fixture();
    const only = { fireflies: [], dust: [], sparks: [] };
    both.effects.update(frame(8, { ...only, embers: fires, smoke: chimneys }));
    one.effects.update(frame(8, { ...only, embers: [fires[0]!], smoke: [chimneys[1]!] }));
    const all = new Set(glints(both.scene)), kept = glints(one.scene);
    expect(kept.length).toBeGreaterThan(0);
    for (const glint of kept) expect(all.has(glint)).toBe(true);
    const allPuffs = new Set(puffList(both.scene).map(p => p.key)), keptPuffs = puffList(one.scene);
    expect(keptPuffs.length).toBeGreaterThan(0);
    for (const p of keptPuffs) expect(allPuffs.has(p.key)).toBe(true);
    one.effects.update(frame(8, { ...only, embers: [], smoke: [] }));
    expect(everything(one.scene)).toEqual([]);
    expect(one.effects.diagnostics()).toMatchObject({ glow: { count: 0, emberSources: 0 }, smoke: { count: 0, sources: 0 } });
  });

  it('rejects malformed and non-finite inputs without throwing, drawing or inventing sources', () => {
    const { scene, effects } = fixture();
    const bad = [
      null, undefined, 42, {}, { id: '', position: [0, 1, 0] }, { id: 'x'.repeat(300), position: [0, 1, 0] },
      { id: 'nan', position: [NaN, 1, 0] }, { id: 'inf', position: [0, Infinity, 0] }, { id: 'short', position: [0, 1] },
      { id: 7, position: [0, 1, 0] }, { id: 'string-pos', position: '0,1,0' },
    ] as unknown as EffectSource[];
    const badShafts = [...bad, { id: 's0', position: [0, 2, 0], direction: [0, 0, 0], length: 2, radius: .5 }, { id: 's1', position: [0, 2, 0], direction: [0, -1, 0], length: -1, radius: .5 },
      { id: 's2', position: [0, 2, 0], direction: [0, -1, 0], length: 2, radius: 1e9 }, { id: 's3', position: [0, 2, 0], direction: [NaN, -1, 0], length: 2, radius: .5 }] as unknown as ShaftSource[];
    const badBursts = [...bad, { id: 'b0', position: [0, 1, 0], burstId: '', startedAt: 1 }, { id: 'b1', position: [0, 1, 0], burstId: 'x', startedAt: NaN }] as unknown as SparkBurst[];
    for (const time of [NaN, Infinity, -Infinity]) {
      effects.update(frame(time));
      expect(effects.diagnostics()).toMatchObject({ idle: true, glow: { count: 0 }, smoke: { count: 0 } });
      expect(everything(scene)).toEqual([]);
    }
    effects.update(null as unknown as EffectsFrame);
    expect(effects.diagnostics().idle).toBe(true);
    effects.update({ time: 3, wind: [0, 0, 0], fireflies: bad, embers: bad, smoke: bad, dust: badShafts, sparks: badBursts,
      flight: { id: 'f', position: [0, NaN, 0], startedAt: 0, active: true } });
    expect(effects.diagnostics()).toMatchObject({ glow: { count: 0, fireflySources: 0, emberSources: 0, dustShafts: 0, sparkBursts: 0, flightGlints: 0,
      skipped: bad.length * 2 + badShafts.length + badBursts.length + 1 }, smoke: { count: 0, sources: 0, skipped: bad.length } });
    effects.update({ time: 3, wind: [NaN, 0, Infinity] as unknown as EffectsFrame['wind'], embers: [...bad, fires[0]!], fireflies: 'nope' as unknown as EffectSource[],
      smoke: { length: 3 } as unknown as EffectSource[], flight: 'soon' as unknown as FlightCue });
    expect(effects.diagnostics().glow.emberSources).toBe(1);
    expect(everything(scene).every(Number.isFinite)).toBe(true);
    // Extreme wind is capped: embers and smoke stay near their source rather than streaking across the kingdom.
    effects.update(frame(3, { wind: [1e9, 0, 0], fireflies: [] }));
    for (const p of glintPositions(scene)) expect(Math.abs(p[0])).toBeLessThan(40);
    for (const p of puffList(scene)) expect(Math.abs(p.x)).toBeLessThan(40);
  });

  it('culls sources behind the camera or beyond reach', () => {
    const { effects } = fixture();
    effects.update(frame(4, { fireflies: [], dust: [], sparks: [], embers: [{ id: 'behind', position: [0, 1, 40] }, { id: 'far', position: [0, 1, -500] }],
      smoke: [{ id: 'far-chimney', position: [0, 4, -900] }] }));
    expect(effects.diagnostics()).toMatchObject({ glow: { count: 0, emberSources: 0, skipped: 2 }, smoke: { count: 0, skipped: 1 } });
  });

  it('disposes idempotently, detaches only its own objects and ignores later calls', () => {
    const { scene, effects } = fixture();
    const own = new THREE.Object3D(); scene.add(own);
    effects.update(frame(12.4));
    const disposed: string[] = [];
    for (const mesh of [glowMesh(scene)!, smokeMesh(scene)!]) {
      mesh.geometry.addEventListener('dispose', () => disposed.push(`${mesh.name} geometry`));
      mesh.material.addEventListener('dispose', () => disposed.push(`${mesh.name} material`));
    }
    effects.dispose(); effects.dispose();
    expect(disposed).toHaveLength(4);
    expect(scene.children).toEqual([own]);
    expect(() => { effects.update(frame(6)); effects.setQuality('high'); effects.reset(); }).not.toThrow();
    expect(scene.children).toEqual([own]);
    expect(effects.diagnostics().disposed).toBe(true);
  });

  it('draws pixel-clamped, depth-tested, non-additive warm glints', () => {
    const { scene, effects } = fixture('balanced');
    effects.update(frame(5, { sparks: [], dust: [] }));
    const material = glowMesh(scene)!.material;
    expect(material.depthTest).toBe(true); expect(material.depthWrite).toBe(false);
    expect(material.blending).toBe(THREE.NormalBlending); expect(material.transparent).toBe(true);
    expect(material.uniforms.uMaxPixels!.value).toBe(EFFECTS_BUDGET.balanced.glow.max);
    expect(material.uniforms.uMaxStreak!.value).toBe(EFFECTS_BUDGET.balanced.glow.streak);
    const c = drawn(scene), n = c.length / 11;
    for (let i = 0; i < n; i++) {
      const [r, g, b, a] = c.slice(n * 4 + i * 4, n * 4 + i * 4 + 4);
      expect(r).toBeGreaterThanOrEqual(g!); expect(g).toBeGreaterThanOrEqual(b!);
      expect(a).toBeGreaterThan(0); expect(a).toBeLessThanOrEqual(1);
      expect(Math.max(r!, g!, b!)).toBeLessThan(3.5);
    }
  });
});

describe('effects adapters: existing cues to effect inputs', () => {
  const presence = (windows: KingdomPresenceFrame['windows'], connection: KingdomPresenceFrame['connection'] = 'fresh'): KingdomPresenceFrame =>
    ({ version: 1, kingdomId: '1' as KingdomPresenceFrame['kingdomId'], epoch: 'e', sequence: 1, asOf: 10_000, origin: 'simulated', streamLive: connection === 'fresh', connection, windows });
  const homes = [{ slot: 1, mouths: [[1, 4, 1], [1.6, 4.2, 1]] as Vec3[] }, { slot: 2, mouths: [[8, 4, 2]] as Vec3[] }, { slot: 3, mouths: [] }];

  it('only present homes smoke, from their real chimney mouths, once their fire is lit', () => {
    const frame = presence([{ slot: 1, present: true, publicName: null, since: 9_000 }, { slot: 2, present: true, publicName: null, since: 9_800 },
      { slot: 3, present: true, publicName: null, since: 0 }, { slot: 9, present: true, publicName: null, since: 0 }]);
    expect(presenceChimneySmoke(homes, frame, 10_000)).toEqual([
      { id: 'home:1:chimney:0', position: [1, 4, 1] }, { id: 'home:1:chimney:1', position: [1.6, 4.2, 1] }]);
    expect(presenceChimneySmoke(homes, frame, 10_600).map(s => s.id)).toContain('home:2:chimney:0');
    expect(presenceChimneySmoke(homes, presence([{ slot: 1, present: false, publicName: null, since: 0 }]), 10_000)).toEqual([]);
    expect(presenceChimneySmoke(homes, presence([], 'stale'), 10_000)).toEqual([]);
    expect(presenceChimneySmoke(homes, undefined, 10_000)).toEqual([]);
    expect(fireEmbers([{ position: [0, 1, 0] }, { position: [2, 1, 0] }], 'gate')).toEqual([{ id: 'gate:0', position: [0, 1.22, 0] }, { id: 'gate:1', position: [2, 1.22, 0] }]);
  });

  const TIMING: readonly [ForgePhase, number, number][] = [['words', 0, 3], ['blueprint', 3, 5], ['pour', 5, 11], ['seal', 11, 12.2], ['strike', 12.2, 12.7], ['cool', 12.7, 15.5], ['flight', 15.5, 19], ['landed', 19, 21]];
  const ritual = (phase: ForgePhase, phaseProgress: number): ForgeRitualFrame => ({ ritualId: 'r1', phase, phaseProgress, elapsed: 0, duration: 21, source: 'simulated' });

  it('the Forge strike and landing become one burst each with a stable start', () => {
    const places = { anvil: [0, 1.4, 8] as Vec3, landing: [6, 5, -2] as Vec3 };
    const strike = forgeSparks(ritual('strike', .4), places, 100, TIMING);
    expect(strike).toEqual([{ id: 'forge:anvil', position: places.anvil, burstId: 'forge:r1:strike', startedAt: 99.8 }]);
    const cooling = forgeSparks(ritual('cool', .1), places, 100.58, TIMING);
    expect(cooling[0]!.burstId).toBe('forge:r1:strike'); expect(cooling[0]!.startedAt).toBeCloseTo(99.8, 6);
    expect(forgeSparks(ritual('flight', .5), places, 50, TIMING, .9)).toEqual([]);
    const contact = forgeSparks(ritual('flight', .95), places, 50, TIMING, .9);
    expect(contact[0]!.burstId).toBe('forge:r1:landing'); expect(contact[0]!.startedAt).toBeCloseTo(50 - .05 * 3.5, 6);
    expect(forgeSparks(ritual('landed', .2), places, 50.575, TIMING, .9)[0]!.startedAt).toBeCloseTo(50 - .05 * 3.5, 6);
    expect(forgeSparks(ritual('pour', .5), places, 50, TIMING)).toEqual([]);
    expect(forgeSparks({ ...ritual('strike', NaN) }, places, 50, TIMING)).toEqual([]);
    expect(forgeSparks(null, places, 50, TIMING)).toEqual([]);
  });

  it('the flight cue follows the real piece and its recorded path; the recorder never holds a future', () => {
    const recorder = createFlightRecorder(4);
    expect(forgeFlightCue(ritual('pour', .5), [0, 0, 0], 10, TIMING)).toBeNull();
    expect(forgeFlightCue(ritual('flight', .5), null, 10, TIMING)).toBeNull();
    for (const t of [10, 10.1, 10.2, 10.3, 10.4, 10.5]) recorder.record('forge:r1:flight', t, [t, 0, 0]);
    expect(recorder.history().map(s => s.time)).toEqual([10.2, 10.3, 10.4, 10.5]);
    recorder.record('forge:r1:flight', 10.35, [9, 9, 9]);
    expect(recorder.history().map(s => s.time)).toEqual([10.2, 10.3, 10.35]);
    recorder.record('forge:r2:flight', 1, [0, 0, 0]);
    expect(recorder.history()).toHaveLength(1);
    const cue = forgeFlightCue(ritual('flight', .5), [1, 2, 3], 10, TIMING, recorder.history())!;
    expect(cue).toMatchObject({ id: 'forge:r1:flight', position: [1, 2, 3], startedAt: 10 - 1.75, active: true });
    expect(cue.history).toBe(recorder.history());
    expect(forgeFlightCue(ritual('landed', .5), [1, 2, 3], 10, TIMING)).toMatchObject({ active: false, startedAt: 10 - 1 - 3.5 });
  });
});
