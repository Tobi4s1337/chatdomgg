import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { createEffects, EFFECTS_BUDGET, EFFECTS_QUALITIES, glowCapacity, type EffectsFrame, type EffectsQuality, type EffectSource } from './index';
import { emberPose, emptyPose, fireflyPose } from './ambient';

function fixture(quality: EffectsQuality = 'balanced', seed = 7) {
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(43, 16 / 9, .15, 2200);
  camera.position.set(0, 2.2, 14); camera.lookAt(0, 1.5, 0);
  const effects = createEffects({ scene, camera, seed, quality });
  return { scene, camera, effects };
}

const glowMesh = (scene: THREE.Scene) => scene.getObjectByName('Chatdom effects glow') as THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial> | undefined;
function drawn(scene: THREE.Scene): number[] {
  const mesh = glowMesh(scene);
  if (!mesh || !mesh.visible) return [];
  const n = mesh.geometry.instanceCount;
  return [...(mesh.geometry.getAttribute('aPose').array as Float32Array).slice(0, n * 4), ...(mesh.geometry.getAttribute('aColour').array as Float32Array).slice(0, n * 4)];
}

const fires: EffectSource[] = [{ id: 'forge:hearth', position: [0, 1, 0] }, { id: 'gate:brazier:west', position: [-3, 2, 1] }, { id: 'gate:brazier:east', position: [3, 2, 1] }];
const hedge: EffectSource[] = Array.from({ length: 5 }, (_, i) => ({ id: `hedge:${i}`, position: [-6 + i * 3, .5, -2] as const }));
const frame = (time: number, extra: Partial<EffectsFrame> = {}): EffectsFrame => ({ time, wind: [.6, 0, .25], fireflies: hedge, embers: fires, ...extra });

describe('effects library: ambient glints', () => {
  it('draws the same frame for the same inputs regardless of frame rate, seek or update order', () => {
    const direct = fixture(), stepped = fixture(), seeked = fixture();
    direct.effects.update(frame(12.5));
    for (let t = 0; t <= 12.5; t += 1 / 30) stepped.effects.update(frame(t));
    stepped.effects.update(frame(12.5));
    seeked.effects.update(frame(400)); seeked.effects.update(frame(-3)); seeked.effects.update(frame(12.5));
    const expected = drawn(direct.scene);
    expect(expected.length).toBeGreaterThan(0);
    expect(drawn(stepped.scene)).toEqual(expected);
    expect(drawn(seeked.scene)).toEqual(expected);
    // Input order and duplicate ids do not change the picture.
    const shuffled = fixture();
    shuffled.effects.update(frame(12.5, { fireflies: [...hedge].reverse(), embers: [fires[2]!, fires[0]!, fires[1]!, { ...fires[0]!, position: [40, 0, 0] }] }));
    expect(drawn(shuffled.scene)).toEqual(expected);
  });

  it('is seeded: another seed gives another frame, the same seed after reset gives this one again', () => {
    const a = fixture('balanced', 7), b = fixture('balanced', 8);
    a.effects.update(frame(9)); b.effects.update(frame(9));
    expect(drawn(a.scene)).not.toEqual(drawn(b.scene));
    const before = drawn(a.scene);
    a.effects.reset();
    expect(drawn(a.scene)).toEqual([]);
    expect(a.effects.diagnostics().glow.count).toBe(0);
    a.effects.update(frame(9));
    expect(drawn(a.scene)).toEqual(before);
  });

  it('fireflies are sparse slow glints, embers rise, cool and go out', () => {
    const pose = emptyPose();
    let lit = 0, total = 0;
    for (let key = 1; key < 200; key++) for (let t = 0; t < 30; t += .5) { total++; if (fireflyPose(key * 7919, 0, 0, 0, t, 0, 0, pose)) lit++; }
    expect(lit / total).toBeGreaterThan(.08); expect(lit / total).toBeLessThan(.3);
    // A firefly never wanders far from its source and stays low.
    for (let t = 0; t < 120; t += .37) if (fireflyPose(4242, 10, 0, 10, t, 0, 0, pose)) {
      expect(Math.hypot(pose.x - 10, pose.z - 10)).toBeLessThan(3.4); expect(pose.y).toBeGreaterThan(-.2); expect(pose.y).toBeLessThan(1.8);
    }
    // Over one ember life, height climbs while heat (colour level) falls.
    const key = 1234567;
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
  });

  it('wind carries embers downwind', () => {
    const calm = emptyPose(), windy = emptyPose();
    let pushed = 0, compared = 0;
    for (let key = 1; key < 60; key++) for (const t of [1.1, 2.3, 3.7]) {
      if (!emberPose(key * 31, 0, 0, 0, t, 0, 0, calm) || !emberPose(key * 31, 0, 0, 0, t, 3, 0, windy)) continue;
      compared++; if (windy.x > calm.x) pushed++;
    }
    expect(compared).toBeGreaterThan(20); expect(pushed).toBe(compared);
  });

  it('bounds counts, sources and coverage per tier and lower tiers keep a subset of the same glints', () => {
    const many = Array.from({ length: 80 }, (_, i) => ({ id: `fire:${i}`, position: [(i % 10) - 5, 1, -Math.floor(i / 10) * 2] as const }));
    const meadow = Array.from({ length: 80 }, (_, i) => ({ id: `meadow:${i}`, position: [(i % 10) * 1.5 - 7, .4, -Math.floor(i / 10) * 2] as const }));
    const captured: Partial<Record<EffectsQuality, Set<string>>> = {};
    for (const quality of EFFECTS_QUALITIES) {
      const { scene, effects } = fixture(quality);
      const budget = EFFECTS_BUDGET[quality];
      let peak = 0;
      for (let t = 0; t < 20; t += .25) {
        effects.update(frame(t, { fireflies: meadow, embers: many }));
        const d = effects.diagnostics();
        expect(d.glow.count).toBeLessThanOrEqual(glowCapacity(quality));
        expect(d.glow.fireflySources).toBeLessThanOrEqual(budget.fireflies.sources);
        expect(d.glow.emberSources).toBeLessThanOrEqual(budget.embers.sources);
        expect(d.glow.maxCoveragePixels).toBeLessThanOrEqual(glowCapacity(quality) * budget.pixels.max ** 2);
        expect(glowMesh(scene)!.geometry.getAttribute('aPose').count).toBe(glowCapacity(quality));
        peak = Math.max(peak, d.glow.count);
      }
      expect(peak).toBeGreaterThan(0);
      effects.update(frame(6, { fireflies: meadow, embers: many }));
      const p = drawn(scene), n = p.length / 8;
      captured[quality] = new Set(Array.from({ length: n }, (_, i) => p.slice(i * 4, i * 4 + 3).map(v => v.toFixed(5)).join(',')));
    }
    for (const glint of captured.low!) expect(captured.balanced!.has(glint)).toBe(true);
    for (const glint of captured.balanced!) expect(captured.high!.has(glint)).toBe(true);
    expect(glowCapacity('low')).toBeLessThan(glowCapacity('balanced'));
    expect(glowCapacity('balanced')).toBeLessThan(glowCapacity('high'));
  });

  it('changes tier at runtime without leaking and redraws on the next update', () => {
    const { scene, effects } = fixture('high');
    effects.update(frame(5));
    const oldGeometry = glowMesh(scene)!.geometry;
    let released = false; oldGeometry.addEventListener('dispose', () => { released = true; });
    effects.setQuality('low');
    expect(released).toBe(true);
    expect(glowMesh(scene)!.visible).toBe(false);
    effects.update(frame(5));
    expect(effects.diagnostics().quality).toBe('low');
    expect(glowMesh(scene)!.geometry.getAttribute('aPose').count).toBe(glowCapacity('low'));
    effects.setQuality('nonsense' as EffectsQuality);
    expect(effects.diagnostics().quality).toBe('low');
    expect(scene.children.filter(child => child.name === 'Chatdom effects glow')).toHaveLength(1);
  });

  it('removing a source removes its glints and leaves the others exactly where they were', () => {
    const both = fixture(), one = fixture();
    both.effects.update(frame(8, { fireflies: [], embers: fires }));
    one.effects.update(frame(8, { fireflies: [], embers: [fires[0]!] }));
    const all = new Set(chunks(drawn(both.scene))), kept = chunks(drawn(one.scene));
    expect(kept.length).toBeGreaterThan(0);
    for (const glint of kept) expect(all.has(glint)).toBe(true);
    one.effects.update(frame(8, { fireflies: [], embers: [] }));
    expect(drawn(one.scene)).toEqual([]);
    expect(one.effects.diagnostics().glow).toMatchObject({ count: 0, emberSources: 0 });
  });

  it('rejects malformed and non-finite inputs without throwing, drawing or inventing sources', () => {
    const { scene, effects } = fixture();
    const bad = [
      null, undefined, 42, {}, { id: '', position: [0, 1, 0] }, { id: 'x'.repeat(300), position: [0, 1, 0] },
      { id: 'nan', position: [NaN, 1, 0] }, { id: 'inf', position: [0, Infinity, 0] }, { id: 'short', position: [0, 1] },
      { id: 7, position: [0, 1, 0] }, { id: 'string-pos', position: '0,1,0' },
    ] as unknown as EffectSource[];
    for (const time of [NaN, Infinity, -Infinity]) {
      effects.update(frame(time));
      expect(effects.diagnostics()).toMatchObject({ idle: true, glow: { count: 0 } });
      expect(drawn(scene)).toEqual([]);
    }
    effects.update(null as unknown as EffectsFrame);
    expect(effects.diagnostics().idle).toBe(true);
    effects.update({ time: 3, wind: [0, 0, 0], fireflies: bad, embers: bad });
    expect(effects.diagnostics().glow).toMatchObject({ count: 0, fireflySources: 0, emberSources: 0, skipped: bad.length * 2 });
    effects.update({ time: 3, wind: [NaN, 0, Infinity] as unknown as EffectsFrame['wind'], embers: [...bad, fires[0]!], fireflies: 'nope' as unknown as EffectSource[] });
    const values = drawn(scene);
    expect(effects.diagnostics().glow.emberSources).toBe(1);
    expect(values.every(Number.isFinite)).toBe(true);
    // Extreme wind is capped: embers stay near their fire rather than streaking across the kingdom.
    effects.update(frame(3, { wind: [1e9, 0, 0], fireflies: [] }));
    const p = drawn(scene), n = p.length / 8;
    for (let i = 0; i < n; i++) expect(Math.abs(p[i * 4]!)).toBeLessThan(40);
  });

  it('culls sources behind the camera or beyond reach, fading near the edge', () => {
    const { effects } = fixture();
    effects.update(frame(4, { fireflies: [], embers: [{ id: 'behind', position: [0, 1, 40] }, { id: 'far', position: [0, 1, -500] }] }));
    expect(effects.diagnostics().glow).toMatchObject({ count: 0, emberSources: 0, skipped: 2 });
  });

  it('disposes idempotently, detaches only its own object and ignores later calls', () => {
    const { scene, effects } = fixture();
    const own = new THREE.Object3D(); scene.add(own);
    effects.update(frame(5));
    const mesh = glowMesh(scene)!;
    let geometry = false, material = false;
    mesh.geometry.addEventListener('dispose', () => { geometry = true; });
    mesh.material.addEventListener('dispose', () => { material = true; });
    effects.dispose(); effects.dispose();
    expect(geometry && material).toBe(true);
    expect(glowMesh(scene)).toBeUndefined();
    expect(scene.children).toEqual([own]);
    expect(() => { effects.update(frame(6)); effects.setQuality('high'); effects.reset(); }).not.toThrow();
    expect(scene.children).toEqual([own]);
    expect(effects.diagnostics().disposed).toBe(true);
  });

  it('draws pixel-clamped, depth-tested, non-additive squares', () => {
    const { scene, effects } = fixture('balanced');
    effects.update(frame(5));
    const material = glowMesh(scene)!.material;
    expect(material.depthTest).toBe(true); expect(material.depthWrite).toBe(false);
    expect(material.blending).toBe(THREE.NormalBlending); expect(material.transparent).toBe(true);
    expect(material.uniforms.uMaxPixels!.value).toBe(EFFECTS_BUDGET.balanced.pixels.max);
    const c = drawn(scene), n = c.length / 8;
    for (let i = 0; i < n; i++) {
      const [r, g, b, a] = c.slice(n * 4 + i * 4, n * 4 + i * 4 + 4);
      expect(r).toBeGreaterThanOrEqual(g!); expect(g).toBeGreaterThanOrEqual(b!); // warm
      expect(a).toBeGreaterThan(0); expect(a).toBeLessThanOrEqual(1);
      expect(Math.max(r!, g!, b!)).toBeLessThan(3.5); // a glint, not a floodlight
    }
  });
});

function chunks(values: number[]): string[] {
  const n = values.length / 8;
  return Array.from({ length: n }, (_, i) => [...values.slice(i * 4, i * 4 + 4), ...values.slice(n * 4 + i * 4, n * 4 + i * 4 + 4)].map(v => v.toFixed(5)).join(','));
}
