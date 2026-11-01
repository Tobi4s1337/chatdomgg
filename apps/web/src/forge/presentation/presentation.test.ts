import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { forgeRitualFrame } from '@chatdom/forge';
import type { ForgePhase, ForgeRitualFrame } from '@chatdom/shared';
import { createForgePresentation } from './index';
import { CONTACT, createForgeStage, DRAW_BUDGET, IMPACT, MOTE_BUDGET, type StageEnvironment } from './stage';
import { traceSilhouette } from './silhouette';

function environment(reduced = false, phone = false) {
  const listeners = new Set<() => void>();
  const env: StageEnvironment & { listeners: Set<() => void>; reduced: boolean } = {
    reduced, listeners, phone,
    reducedMotion: () => env.reduced,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
  };
  return env;
}

/** A minimal real host: a clone under a moved, rotated parent, and an empty effect root. */
function host() {
  const scene = new THREE.Scene(), root = new THREE.Group(), parent = new THREE.Group();
  parent.position.set(3, 0, -2); parent.rotation.y = .4; scene.add(root, parent);
  const geometry = new THREE.BoxGeometry(1, 2, .75, 8, 16, 6), material = new THREE.MeshBasicMaterial({ color: '#a85b47' });
  const piece = new THREE.Mesh(geometry, material);
  piece.position.set(1, 6, 2); piece.rotation.y = .3; parent.add(piece); scene.updateMatrixWorld(true);
  const landing = piece.getWorldPosition(new THREE.Vector3()).toArray();
  const callerDisposals: string[] = [];
  geometry.addEventListener('dispose', () => callerDisposals.push('geometry'));
  material.addEventListener('dispose', () => callerDisposals.push('material'));
  return { scene, root, piece, geometry, material, landing, callerDisposals, anvil: [11, 1.45, 15.5] as [number, number, number] };
}

const frame = (phase: ForgePhase, phaseProgress: number, elapsed: number, ritualId = 'ritual-a'): ForgeRitualFrame =>
  ({ ritualId, phase, phaseProgress, elapsed, duration: 21, source: 'live' });

/** Everything this adapter draws, read back from the scene graph and its GPU inputs. */
function snapshot(root: THREE.Object3D, piece: THREE.Object3D) {
  const state: unknown[] = [piece.visible, piece.position.toArray(), piece.quaternion.toArray(), piece.scale.toArray()];
  const value = (v: unknown): unknown => typeof v === 'number' || typeof v === 'boolean' ? v
    : Array.isArray(v) ? v.map(value) : v && typeof (v as { toArray?: unknown }).toArray === 'function' ? (v as THREE.Vector3).toArray() : null;
  root.traverse(object => {
    state.push(object.name, object.visible, object.matrix.toArray(), object.position.toArray(), object.rotation.toArray(), object.scale.toArray());
    const mesh = object as THREE.Mesh;
    if (mesh.material instanceof THREE.ShaderMaterial) for (const [key, uniform] of Object.entries(mesh.material.uniforms)) state.push(key, value(uniform.value));
    else if (mesh.material instanceof THREE.Material) state.push(mesh.material.name, mesh.material.opacity);
    if ((object as THREE.InstancedMesh).isInstancedMesh) {
      const instanced = object as THREE.InstancedMesh;
      state.push(instanced.count, Array.from(instanced.instanceMatrix.array.slice(0, instanced.count * 16)), Array.from(instanced.instanceColor!.array.slice(0, instanced.count * 3)));
    }
    if ((object as THREE.Points).isPoints) {
      const { geometry } = object as THREE.Points, count = geometry.drawRange.count;
      state.push(count, Array.from((geometry.getAttribute('position').array as Float32Array).slice(0, count * 3)), Array.from((geometry.getAttribute('color').array as Float32Array).slice(0, count * 4)));
    }
  });
  return state;
}
const shown = (root: THREE.Object3D) => root.children.filter(o => o.visible).map(o => o.name);
const uniform = (root: THREE.Object3D, mesh: string, name: string) => ((root.getObjectByName(mesh) as THREE.Mesh).material as THREE.ShaderMaterial).uniforms[name]!.value as number;

describe('Forge ritual presentation', () => {
  it('reports the posed clone upper surface and clears the sink on reset', () => {
    const h = host();
    let reported: readonly number[] | null = null, socket: readonly number[] | undefined;
    const stage = createForgeStage({ root: h.root, anvil: h.anvil, landing: h.landing, piece: h.piece,
      onFlight: (_frame, position, landing) => { reported = position; socket = landing; } }, environment());
    stage.update(frame('flight', .45, 18));
    h.piece.updateWorldMatrix(true, false);
    const actual = new THREE.Vector3(0, 1.15, 0).applyMatrix4(h.piece.matrixWorld);
    expect(reported).not.toBeNull();
    expect(socket).toEqual(h.landing);
    expect(new THREE.Vector3(...reported!).distanceTo(actual)).toBeLessThan(1e-6);
    stage.update(null);
    expect(reported).toBeNull();
    stage.dispose();
  });
  it('holds a pending blueprint for thirty seconds without sealing, striking, landing or escalating', () => {
    const h = host(), saved = snapshot(new THREE.Group(), h.piece);
    const stage = createForgeStage({ root: h.root, anvil: h.anvil, landing: h.landing, piece: h.piece }, environment());
    const owned = h.root.children.length;
    let glow = [Infinity, -Infinity];
    // A live gate keeps reporting the finished blueprint while time passes at uneven intervals.
    for (let t = 5, step = 0; t <= 35; t += [.016, .5, .033, 2.7, .1][step++ % 5]!) {
      stage.update(frame('blueprint', 1, t));
      expect(shown(h.root).filter(name => name !== 'forge-motes')).toEqual(['forge-blueprint']);
      expect(h.piece.visible).toBe(false);
      expect(snapshot(new THREE.Group(), h.piece).slice(1)).toEqual(saved.slice(1));
      expect(h.root.children.length).toBe(owned);
      expect((h.root.getObjectByName('forge-motes') as THREE.Points).geometry.drawRange.count).toBeLessThanOrEqual(MOTE_BUDGET.full.sparks);
      const g = uniform(h.root, 'forge-blueprint-body', 'uGlow');
      glow = [Math.min(glow[0]!, g), Math.max(glow[1]!, g)];
      expect(uniform(h.root, 'forge-blueprint-body', 'uReveal')).toBe(1);
    }
    // The held pose breathes within a fixed band; it never grows brighter the longer it waits.
    expect(glow[0]).toBeGreaterThan(.94); expect(glow[1]).toBeLessThan(1.06);
    expect(glow[1]! - glow[0]!).toBeGreaterThan(.05);
    stage.dispose();
  });

  it('draws the same state for any sampling interval, seek or repeated frame', () => {
    const a = host(), b = host();
    const one = createForgeStage({ root: a.root, anvil: a.anvil, landing: a.landing, piece: a.piece }, environment());
    const two = createForgeStage({ root: b.root, anvil: b.anvil, landing: b.landing, piece: b.piece }, environment());
    // One adapter plays through at 60 fps; the other only ever seeks, from a later moment and from cleared.
    let played = 0;
    for (const t of [.4, 1.7, 2.9, 3.4, 4.2, 4.95, 6.3, 9.9, 11.6, 12.3, 12.42, 13.1, 15, 16.2, 18.1, 18.9, 19.2, 20.5]) {
      for (; played <= t; played += 1 / 60) one.update(forgeRitualFrame('ritual-a', played));
      one.update(forgeRitualFrame('ritual-a', t));
      two.update(forgeRitualFrame('ritual-a', 4.8)); two.update(null); two.update(forgeRitualFrame('ritual-a', t)); two.update(forgeRitualFrame('ritual-a', t));
      expect(snapshot(b.root, b.piece)).toEqual(snapshot(a.root, a.piece));
    }
    // The runes truly move between those samples; equality is not two empty scenes.
    one.update(forgeRitualFrame('ritual-a', 1.2)); const early = snapshot(a.root, a.piece);
    one.update(forgeRitualFrame('ritual-a', 2.2)); expect(snapshot(a.root, a.piece)).not.toEqual(early);
    expect(shown(a.root)).toContain('forge-runes');
    one.update(forgeRitualFrame('ritual-a', 12.42)); expect(shown(a.root)).toEqual(expect.arrayContaining(['forge-shell', 'forge-hammer', 'forge-flash', 'forge-seal', 'forge-motes']));
    one.dispose(); two.dispose();
  });

  it('rejects untrustworthy frames by holding the last valid pose', () => {
    const h = host(), stage = createForgeStage({ root: h.root, anvil: h.anvil, landing: h.landing, piece: h.piece }, environment());
    stage.update(frame('words', .6, 1.8)); const held = snapshot(h.root, h.piece);
    for (const bad of [frame('words', Number.NaN, 1.8), frame('words', .7, Number.POSITIVE_INFINITY), { ...frame('words', .7, 2), phase: 'approved' } as unknown as ForgeRitualFrame, { ...frame('words', .7, 2), ritualId: '' }, { ...frame('words', .7, 2), source: 'guess' } as unknown as ForgeRitualFrame]) {
      stage.update(bad);
      expect(snapshot(h.root, h.piece)).toEqual(held);
    }
    stage.dispose();
  });

  it('clears and disposes only what it created, restoring the borrowed clone', () => {
    const h = host(), env = environment(), before = { position: h.piece.position.clone(), quaternion: h.piece.quaternion.clone(), scale: h.piece.scale.clone(), visible: h.piece.visible };
    const stage = createForgeStage({ root: h.root, anvil: h.anvil, landing: h.landing, piece: h.piece }, env);
    const resources = new Set<THREE.BufferGeometry | THREE.Material>();
    h.root.traverse(o => { const m = o as THREE.Mesh; if (m.geometry) resources.add(m.geometry); if (m.material) resources.add(m.material as THREE.Material); });
    let disposed = 0; resources.forEach(r => r.addEventListener('dispose', () => disposed++));
    stage.update(frame('blueprint', .5, 4));
    expect(h.piece.visible).toBe(false);
    stage.update(null);
    expect(shown(h.root)).toEqual([]);
    expect(h.piece.visible).toBe(before.visible); expect(h.piece.position.toArray()).toEqual(before.position.toArray()); expect(h.piece.quaternion.toArray()).toEqual(before.quaternion.toArray()); expect(h.piece.scale.toArray()).toEqual(before.scale.toArray());
    stage.update(frame('words', .8, 2.4));
    env.reduced = true; env.listeners.forEach(l => l());
    stage.dispose();
    expect(h.root.children).toEqual([]);
    expect(disposed).toBe(resources.size);
    expect(env.listeners.size).toBe(0);
    expect(h.callerDisposals).toEqual([]);
    expect(h.piece.material).toBe(h.material); expect(h.piece.geometry).toBe(h.geometry); expect(h.piece.parent).not.toBe(h.root);
    expect(h.piece.visible).toBe(before.visible); expect(h.piece.position.toArray()).toEqual(before.position.toArray());
    stage.update(frame('blueprint', 1, 6));
    expect(h.root.children).toEqual([]); expect(h.piece.visible).toBe(before.visible);
  });

  it('keeps the same truthful stages with reduced motion, without circling runes or snap motes', () => {
    const h = host(), env = environment(true), stage = createForgeStage({ root: h.root, anvil: h.anvil, landing: h.landing, piece: h.piece }, env);
    const runes = () => ((h.root.getObjectByName('forge-runes') as THREE.Mesh).material as THREE.ShaderMaterial).uniforms.uPlace!.value as THREE.Vector4[];
    stage.update(frame('words', .8, 2.4)); const still = runes().map(v => v.toArray().slice(0, 3));
    stage.update(frame('words', .8, 7.9)); expect(runes().map(v => v.toArray().slice(0, 3))).toEqual(still);
    stage.update(frame('blueprint', .5, 4));
    expect(uniform(h.root, 'forge-blueprint-body', 'uDissolve')).toBe(1);
    expect(shown(h.root)).not.toContain('forge-motes');
    stage.dispose();
  });

  it('traces production packed voxel geometry and runs through the device entry point', () => {
    // One 2×3×2-cell box in the packed corner format the voxel shader decodes, placed in chunk (1,0,0).
    const corners: number[] = [], index: number[] = [], chunk = 1 << 16;
    const faces: [number, number[][]][] = [
      [0, [[2, 0, 0], [2, 3, 0], [2, 3, 2], [2, 0, 2]]], [1, [[0, 0, 0], [0, 0, 2], [0, 3, 2], [0, 3, 0]]],
      [2, [[0, 3, 0], [0, 3, 2], [2, 3, 2], [2, 3, 0]]], [3, [[0, 0, 0], [2, 0, 0], [2, 0, 2], [0, 0, 2]]],
      [4, [[0, 0, 2], [2, 0, 2], [2, 3, 2], [0, 3, 2]]], [5, [[0, 0, 0], [0, 3, 0], [2, 3, 0], [2, 0, 0]]],
    ];
    for (const [face, quad] of faces) {
      const at = corners.length;
      for (const [x, y, z] of quad) corners.push(x! | (y! << 6) | (z! << 12) | (face << 18));
      index.push(at, at + 1, at + 2, at, at + 2, at + 3);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('aPacked', new THREE.BufferAttribute(new Uint32Array(corners), 1));
    geometry.setAttribute('aMaterial', new THREE.BufferAttribute(new Uint32Array(corners.map(() => chunk | 8)), 1));
    geometry.setIndex(index);
    const piece = new THREE.Mesh(geometry, new THREE.ShaderMaterial({ uniforms: { uScale: { value: .125 } } }));
    const traced = traceSilhouette(piece, 4);
    expect(traced.cell).toBe(.125);
    expect(traced.bounds.min.toArray()).toEqual([4, 0, 0]);
    expect(traced.bounds.max.toArray()).toEqual([4.25, .375, .25]);
    expect(traced.positions.length).toBe(12 * 9);
    expect(traced.landings.length).toBe(4);
    const root = new THREE.Group(), stage = createForgePresentation({ root, anvil: [0, 1.45, 0], landing: [0, 0, 0], piece });
    stage.update(forgeRitualFrame('ritual-b', 4.6));
    expect(shown(root)).toContain('forge-blueprint');
    stage.dispose(); expect(root.children).toEqual([]);
  });

  it('never seals, strikes or lands while an observed gate holds an earlier stage', () => {
    const h = host(), env = environment(), stage = createForgeStage({ root: h.root, anvil: h.anvil, landing: h.landing, piece: h.piece }, env);
    const hammer = h.root.getObjectByName('forge-hammer')!, landingAt = h.piece.position.toArray();
    for (let t = 11, step = 0; t <= 41; t += [.016, .5, .033, 2.7, .1][step++ % 5]!) {
      // A live run whose pour finished but whose second gate has not answered.
      stage.update(frame('pour', 1, t));
      expect(shown(h.root)).not.toContain('forge-seal'); expect(shown(h.root)).not.toContain('forge-hammer');
      expect(h.piece.visible).toBe(false);
      // The same run, judged and sealed, waiting for the mint: the hammer waits raised; nothing strikes.
      stage.update(frame('seal', 1, t));
      expect(shown(h.root)).toContain('forge-seal'); expect(shown(h.root)).not.toContain('forge-flash');
      expect(hammer.rotation.z).toBeGreaterThan(1.9);
      expect(uniform(h.root, 'forge-shell', 'uFlash')).toBe(0);
      expect(h.piece.visible).toBe(false); expect(h.piece.position.toArray()).toEqual(landingAt);
      expect((h.root.getObjectByName('forge-motes') as THREE.Points).geometry.drawRange.count).toBe(0);
    }
    // Only a live seal may claim the realm; the local simulation never does.
    stage.update(frame('seal', 1, 12)); expect(uniform(h.root, 'forge-seal', 'uLive')).toBe(1);
    stage.update(forgeRitualFrame('ritual-a', 12)); expect(uniform(h.root, 'forge-seal', 'uLive')).toBe(0);
    // The strike happens only when the strike is reported, and the flash only after the impact.
    stage.update(frame('strike', IMPACT * .9, 12.4)); expect(shown(h.root)).not.toContain('forge-flash');
    stage.update(frame('strike', IMPACT + .02, 12.4)); expect(shown(h.root)).toContain('forge-flash');
    stage.dispose();
  });

  it('cools the real clone on the anvil, flies it home and lands it flush on its socket', () => {
    const h = host(), stage = createForgeStage({ root: h.root, anvil: h.anvil, landing: h.landing, piece: h.piece }, environment());
    const saved = { position: h.piece.position.clone(), quaternion: h.piece.quaternion.clone(), scale: h.piece.scale.clone() };
    const world = () => h.piece.getWorldPosition(new THREE.Vector3());
    stage.update(forgeRitualFrame('ritual-a', 13)); h.scene.updateMatrixWorld(true);
    expect(h.piece.visible).toBe(true); expect(world().distanceTo(new THREE.Vector3(...h.landing))).toBeGreaterThan(5);
    // Its world orientation on the anvil is already its socket orientation.
    expect(h.piece.getWorldQuaternion(new THREE.Quaternion()).angleTo(h.piece.parent!.getWorldQuaternion(new THREE.Quaternion()).multiply(saved.quaternion))).toBeLessThan(1e-6);
    let highest = -Infinity;
    for (let t = 15.5; t < 15.5 + 3.5 * CONTACT; t += .05) { stage.update(forgeRitualFrame('ritual-a', t)); h.scene.updateMatrixWorld(true); highest = Math.max(highest, world().y); }
    expect(highest).toBeGreaterThan(Math.max(h.landing[1], h.anvil[1]) + 2);
    // Contact and the planted squash never sink the part's foot below the socket.
    for (let t = 15.5 + 3.5 * CONTACT; t <= 21; t += .01) {
      stage.update(forgeRitualFrame('ritual-a', t)); h.scene.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(h.piece), rest = new THREE.Box3();
      h.piece.position.copy(saved.position); h.piece.quaternion.copy(saved.quaternion); h.piece.scale.copy(saved.scale); h.scene.updateMatrixWorld(true);
      rest.setFromObject(h.piece);
      stage.update(forgeRitualFrame('ritual-a', t));
      expect(box.min.y).toBeGreaterThanOrEqual(rest.min.y - 1e-5);
    }
    stage.update(forgeRitualFrame('ritual-a', 19.5));
    expect(h.piece.position.toArray()).toEqual(saved.position.toArray()); expect(h.piece.quaternion.toArray()).toEqual(saved.quaternion.toArray()); expect(h.piece.scale.toArray()).toEqual(saved.scale.toArray());
    expect(h.piece.visible).toBe(true);
    stage.dispose();
  });

  it('stays inside its particle and draw budgets on every frame, desktop and phone', () => {
    for (const phone of [false, true]) {
      const h = host(), stage = createForgeStage({ root: h.root, anvil: h.anvil, landing: h.landing, piece: h.piece }, environment(false, phone));
      const budget = phone ? MOTE_BUDGET.phone : MOTE_BUDGET.full, cap = phone ? 80 : 192;
      let draws = 0;
      expect(budget.sparks + budget.dust).toBeLessThanOrEqual(cap);
      for (let t = 0; t <= 21; t += 1 / 30) {
        stage.update(forgeRitualFrame('ritual-a', t));
        let meshes = 0;
        h.root.traverseVisible(o => { if ((o as THREE.Mesh).isMesh || (o as THREE.Points).isPoints) meshes++; });
        draws = Math.max(draws, meshes);
        expect((h.root.getObjectByName('forge-motes') as THREE.Points).geometry.drawRange.count).toBeLessThanOrEqual(budget.sparks);
        expect((h.root.getObjectByName('forge-dust') as THREE.Points).geometry.drawRange.count).toBeLessThanOrEqual(budget.dust);
      }
      expect(draws).toBeLessThanOrEqual(phone ? DRAW_BUDGET.phone : 12);
      let owned = 0; h.root.traverse(o => { if ((o as THREE.Mesh).isMesh || (o as THREE.Points).isPoints) owned++; });
      expect(owned).toBe(DRAW_BUDGET.owned);
      stage.dispose();
    }
  });

  it('dissolves home without a streak or flash when motion is reduced', () => {
    const h = host(), stage = createForgeStage({ root: h.root, anvil: h.anvil, landing: h.landing, piece: h.piece }, environment(true));
    const saved = h.piece.position.toArray();
    for (let t = 12.2; t <= 21; t += 1 / 30) {
      stage.update(forgeRitualFrame('ritual-a', t));
      expect(shown(h.root)).not.toContain('forge-flash');
      if (t >= 15.5) expect(shown(h.root)).not.toContain('forge-motes');
      // Between the anvil and home the part is never in the air: it is at one or the other, or in light.
      if (h.piece.visible && t >= 15.5 + 3.5 * .5) expect(h.piece.position.toArray()).toEqual(saved);
    }
    stage.update(forgeRitualFrame('ritual-a', 15.5 + 3.5 * .2)); expect(uniform(h.root, 'forge-shell', 'uMode')).toBe(2);
    stage.dispose();
  });
});
