import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { forgeRitualFrame } from '@chatdom/forge';
import type { ForgePhase, ForgeRitualFrame } from '@chatdom/shared';
import { createForgePresentation } from './index';
import { createForgeStage, MOTE_BUDGET, type StageEnvironment } from './stage';
import { traceSilhouette } from './silhouette';

function environment(reduced = false) {
  const listeners = new Set<() => void>();
  const env: StageEnvironment & { listeners: Set<() => void>; reduced: boolean } = {
    reduced, listeners, phone: false,
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
  root.traverse(object => {
    state.push(object.name, object.visible, object.matrix.toArray());
    const mesh = object as THREE.Mesh;
    if (mesh.material instanceof THREE.ShaderMaterial) {
      for (const [key, uniform] of Object.entries(mesh.material.uniforms)) {
        const value = uniform.value as unknown;
        if (typeof value === 'number') state.push(key, value);
        else if (Array.isArray(value)) state.push(key, value.map(v => (v as THREE.Vector4).toArray()));
      }
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
      expect((h.root.getObjectByName('forge-motes') as THREE.Points).geometry.drawRange.count).toBeLessThanOrEqual(MOTE_BUDGET.full);
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
    for (const t of [.4, 1.7, 2.9, 3.4, 4.2, 4.95]) {
      for (let s = 0; s <= t; s += 1 / 60) one.update(forgeRitualFrame('ritual-a', s));
      one.update(forgeRitualFrame('ritual-a', t));
      two.update(forgeRitualFrame('ritual-a', 4.8)); two.update(null); two.update(forgeRitualFrame('ritual-a', t)); two.update(forgeRitualFrame('ritual-a', t));
      expect(snapshot(b.root, b.piece)).toEqual(snapshot(a.root, a.piece));
    }
    // The runes truly move between those samples; equality is not two empty scenes.
    one.update(forgeRitualFrame('ritual-a', 1.2)); const early = snapshot(a.root, a.piece);
    one.update(forgeRitualFrame('ritual-a', 2.2)); expect(snapshot(a.root, a.piece)).not.toEqual(early);
    expect(shown(a.root)).toContain('forge-runes');
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
    const root = new THREE.Group(), stage = createForgePresentation({ root, anvil: [0, 1.45, 0], landing: [4, 0, 0], piece });
    stage.update(forgeRitualFrame('ritual-b', 4.6));
    expect(shown(root)).toContain('forge-blueprint');
    stage.dispose(); expect(root.children).toEqual([]);
  });
});
