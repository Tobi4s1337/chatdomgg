import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { createAnvilHero, MARK_SCALE } from './index';
import { ANVIL_FACE_HEIGHT, BLOCK, CHEEK_Z, FACE_ROW, FEET, FOOT_ARCH_HALF_Z, FOOT_ARCH_X, GRID_MIN, GRID_SIZE, H, HARDY, MARK_WINDOW, PLATE, sculptAnvilStage, Y_OFFSET } from './sculpt';

const sculpt = sculptAnvilStage();
const [nx, ny, nz] = GRID_SIZE;
const material = (x: number, row: number, z: number) => {
  const i = x - GRID_MIN[0], j = row - GRID_MIN[1], k = z - GRID_MIN[2];
  return i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz ? 0 : sculpt.voxels[i + nx * (j + ny * k)]!;
};
const solids: [number, number, number][] = [];
for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) if (sculpt.voxels[i + nx * (j + ny * k)]) solids.push([i + GRID_MIN[0], j + GRID_MIN[1], k + GRID_MIN[2]]);

describe('the anvil stage', () => {
  it('keeps the old envelope: working face at 1.43 m, nothing above it, inside the 1.5 m radius', () => {
    let top = -Infinity;
    for (const [x, row, z] of solids) {
      top = Math.max(top, (row + 1) * H + Y_OFFSET);
      for (const cx of [x, x + 1]) for (const cz of [z, z + 1]) expect(Math.hypot(cx * H, cz * H)).toBeLessThanOrEqual(1.5);
    }
    expect(top).toBeCloseTo(ANVIL_FACE_HEIGHT, 6);
    expect(top).toBeLessThanOrEqual(1.5);
    // The block is sunk one course under the street, and nothing else is.
    for (const [, row] of solids) if (row < 0) expect(row).toBe(BLOCK.rows[0]);
    expect(BLOCK.rows[0] * H + Y_OFFSET).toBeGreaterThan(-.08);
  });

  it('opens the hardy hole right through the heel, with iron walls on every side', () => {
    for (let row = PLATE.rows[0] - 1; row <= FACE_ROW; row++) for (let x = HARDY.x[0]; x < HARDY.x[1]; x++) for (let z = HARDY.z[0]; z < HARDY.z[1]; z++) expect(material(x, row, z)).toBe(0);
    for (let row = PLATE.rows[0]; row <= FACE_ROW; row++) {
      for (let z = HARDY.z[0]; z < HARDY.z[1]; z++) { expect(material(HARDY.x[0] - 1, row, z)).not.toBe(0); expect(material(HARDY.x[1], row, z)).not.toBe(0); }
      for (let x = HARDY.x[0]; x < HARDY.x[1]; x++) { expect(material(x, row, HARDY.z[0] - 1)).not.toBe(0); expect(material(x, row, HARDY.z[1])).not.toBe(0); }
    }
  });

  it('stands on four feet, with the arches open right through from the side and the end', () => {
    for (let row = FEET.rows[0]; row < FEET.rows[0] + 2; row++) {
      for (let x = FOOT_ARCH_X[0]; x < FOOT_ARCH_X[1]; x++) for (let z = FEET.z[0] - 1; z <= FEET.z[1]; z++) expect(material(x, row, z)).toBe(0);
      for (let z = -FOOT_ARCH_HALF_Z; z < FOOT_ARCH_HALF_Z; z++) for (let x = FEET.x[0] - 1; x <= FEET.x[1]; x++) expect(material(x, row, z)).toBe(0);
      for (const x of [FEET.x[0], FEET.x[1] - 1]) for (const z of [FEET.z[0], FEET.z[1] - 1]) expect(material(x, row, z)).not.toBe(0);
    }
  });

  it('carries every cell of iron down to the block: no floating chips or loose horn', () => {
    const key = (x: number, row: number, z: number) => `${x},${row},${z}`;
    const todo = solids.filter(([, row]) => row === BLOCK.rows[0]);
    const seen = new Set(todo.map(p => key(...p)));
    while (todo.length) {
      const [x, row, z] = todo.pop()!;
      for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as const) {
        const p: [number, number, number] = [x + dx, row + dy, z + dz];
        if (material(...p) && !seen.has(key(...p))) { seen.add(key(...p)); todo.push(p); }
      }
    }
    expect(seen.size).toBe(solids.length);
  });
});

describe('createAnvilHero', () => {
  it('mounts the unchanged mark flush on the +Z cheek, its cut fully open behind it', () => {
    const parent = new THREE.Group();
    const hero = createAnvilHero(parent);
    const { position, rotation, scale } = hero.engravingMount;
    expect(scale).toBe(MARK_SCALE);
    expect(rotation.order).toBe('YXZ');
    expect([rotation.x, rotation.y, rotation.z]).toEqual([0, 0, 0]);
    // Plate front (its 0.13-unit bevel) sits a hair inside its window, so the cheek's edge hides its rim; never floating.
    const unit = .32 / 24 * scale;
    const front = position.z + .13 * unit;
    expect(CHEEK_Z * H - front).toBeGreaterThan(0);
    expect(CHEEK_Z * H - front).toBeLessThan(.001);
    // Every point of the source paths, placed by the mount, lies in the open window behind the cut.
    const svg = readFileSync(new URL('../engraving/codex.svg', import.meta.url), 'utf8');
    const numbers = [...svg.matchAll(/ d="([^"]+)"/g)].flatMap(m => m[1]!.match(/-?\d+(?:\.\d+)?/g)!.map(Number));
    const xs = numbers.filter((_, i) => i % 2 === 0), ys = numbers.filter((_, i) => i % 2 === 1);
    const left = position.x + (Math.min(...xs) - 12) * unit, right = position.x + (Math.max(...xs) - 12) * unit;
    // SVG y grows down; the engraving reflects it, so its extremes swap.
    const bottom = position.y - (Math.max(...ys) - 12) * unit, top = position.y - (Math.min(...ys) - 12) * unit;
    expect(left).toBeGreaterThan(MARK_WINDOW.x[0] * H);
    expect(right).toBeLessThan(MARK_WINDOW.x[1] * H);
    expect(bottom).toBeGreaterThan(MARK_WINDOW.rows[0] * H + Y_OFFSET);
    expect(top).toBeLessThan(MARK_WINDOW.rows[1] * H + Y_OFFSET);
    // The engraving's plate (57.26 × 31.76 units with bevel) covers that whole window.
    expect(position.x - 28.63 * unit).toBeLessThan(MARK_WINDOW.x[0] * H);
    expect(position.x + 28.63 * unit).toBeGreaterThan(MARK_WINDOW.x[1] * H);
    expect(position.y - 15.88 * unit).toBeLessThan(MARK_WINDOW.rows[0] * H + Y_OFFSET);
    expect(position.y + 15.88 * unit).toBeGreaterThan(MARK_WINDOW.rows[1] * H + Y_OFFSET);
    // The rune origin is just outside the centre of the cut.
    expect(hero.runeOrigin.x).toBeCloseTo(position.x, 6);
    expect(hero.runeOrigin.y).toBeCloseTo(position.y, 6);
    expect(hero.runeOrigin.z - CHEEK_Z * H).toBeGreaterThan(.005);
    expect(hero.runeOrigin.z - front).toBeLessThan(.04);
    hero.dispose();
  });

  it('adds an identity root, seeks heat deterministically and disposes only what it made', () => {
    const parent = new THREE.Group();
    const hero = createAnvilHero(parent);
    expect(hero.root.parent).toBe(parent);
    expect(hero.root.position.toArray()).toEqual([0, 0, 0]);
    expect(hero.root.quaternion.toArray()).toEqual([0, 0, 0, 1]);
    const stage = hero.root.getObjectByName('forge-anvil-hero:stage') as THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
    const uniforms = stage.material.uniforms;
    hero.update({ time: 9, heat: 3, shaping: true });
    expect([uniforms.uAnvilHeat!.value, uniforms.uAnvilTime!.value, uniforms.uAnvilShaping!.value]).toEqual([1, 9, 1]);
    hero.update({ time: 2, heat: -1, shaping: false });
    expect([uniforms.uAnvilHeat!.value, uniforms.uAnvilTime!.value, uniforms.uAnvilShaping!.value]).toEqual([0, 2, 0]);

    // The caller's engraving lives under the hero root and must survive the hero.
    const callerGeometry = new THREE.BufferGeometry(), callerMaterial = new THREE.MeshBasicMaterial();
    const caller = new THREE.Mesh(callerGeometry, callerMaterial);
    hero.root.add(caller);
    const disposed: string[] = [];
    callerGeometry.addEventListener('dispose', () => disposed.push('caller geometry'));
    callerMaterial.addEventListener('dispose', () => disposed.push('caller material'));
    stage.geometry.addEventListener('dispose', () => disposed.push('stage geometry'));
    stage.material.addEventListener('dispose', () => disposed.push('stage material'));
    (uniforms.uAnvilCells!.value as THREE.Texture).addEventListener('dispose', () => disposed.push('occupancy texture'));
    hero.dispose();
    hero.dispose();
    expect(disposed.sort()).toEqual(['occupancy texture', 'stage geometry', 'stage material']);
    expect(parent.children).not.toContain(hero.root);
    expect(caller.parent).toBe(hero.root);
  });
});
