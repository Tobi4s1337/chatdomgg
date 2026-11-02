import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { generateSettlementPlan, type SettlementPlan } from '@chatdom/world';
import { RAID_SHOT_FOREGROUND, RAID_SHOT_SOLIDS, raidShotClearOf, sceneTreeCrowns, treeCrownGrid } from './raid-shot-clear';

const generated = generateSettlementPlan({ seed: 'raid-shot-clear', tier: 'hamlet', firstYear: 2026, year: 2026 });
function site(): SettlementPlan {
  const home = generated.homes[0] ?? { ...generated.reservations[0]!, slot: 0, tier: 'cottage', allowedDepth: 1, style: 'hearth', variant: 0 } as SettlementPlan['homes'][number];
  return { ...generated, homes: [{ ...home, lot: { ...home.lot, minX: 20, maxX: 28, minZ: 20, maxZ: 36 } }],
    castle: { ...generated.castle, bounds: { minX: -90, maxX: -70, minZ: -90, maxZ: -70 } } };
}

describe('the gate shot standing check from the adopted plan', () => {
  const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const clear = raidShotClearOf(site(), () => 2);

  it('keeps an eye over open street with a clear line to the gate', () => {
    expect(clear(v(0, 14, 40), v(0, 3, 0))).toBe(true);
  });

  it('refuses an eye inside or just beside a built home, under the ground or over the castle', () => {
    expect(clear(v(24, 8, 28), v(0, 3, 0))).toBe(false);
    expect(clear(v(28 + RAID_SHOT_SOLIDS.pad - 0.1, 8, 28), v(0, 3, 0))).toBe(false);
    expect(clear(v(0, 3, 40), v(0, 3, 0))).toBe(false);
    expect(clear(v(-80, 30, -80), v(-60, 3, -60))).toBe(false);
  });

  it('refuses a line of sight through a home below its conservative height, and allows one well over it', () => {
    expect(clear(v(40, 6, 28), v(0, 3, 28))).toBe(false);
    expect(clear(v(40, 40, 28), v(0, 30, 28))).toBe(true);
  });

  it('never stands where the adopted surface cannot be read', () => {
    const missing = raidShotClearOf(site(), () => { throw new Error('no terrain'); });
    expect(missing(v(0, 14, 40), v(0, 3, 0))).toBe(false);
    expect(clear(v(Number.NaN, 14, 40), v(0, 3, 0))).toBe(false);
  });

  it('refuses, only when asked about the picture, a view whose side is filled by a roof beside the eye', () => {
    const frame = { fov: 50, aspect: 16 / 9 };
    // Standing beside the home's lot, looking up the street past it: the roof fills the left of the picture.
    const beside = [v(17.5, 9, 10), v(17.5, 3, 60)] as const;
    expect(clear(...beside)).toBe(true);
    expect(clear(...beside, frame)).toBe(false);
    // The same street from well clear of the home keeps an open foreground.
    expect(clear(v(0, 14, 40), v(0, 3, 0), frame)).toBe(true);
    expect(RAID_SHOT_FOREGROUND.roof).toBeLessThan(RAID_SHOT_SOLIDS.home);
  });

  it('counts a big roof to one side by its depth in the view, not by how far along its slanted ray it lies', () => {
    const frame = { fov: 50, aspect: 16 / 9 };
    // A high wide view whose lower left is the home's roof, some 20 m out along those rays: the stream's own case.
    const roofed = [v(34, 22, 56), v(-12, 3, 0)] as const;
    expect(roofed[0].distanceTo(new THREE.Vector3(28, 22, 36))).toBeGreaterThan(16);
    expect(clear(...roofed)).toBe(true);
    expect(clear(...roofed, frame)).toBe(false);
    // The mirrored view, with the home behind the eye's shoulder and out of the picture, stays open.
    expect(clear(v(-30, 22, 56), v(-12, 3, 0), frame)).toBe(true);
  });

  it('counts the scene’s planted tree crowns as solid: never an eye in a canopy, never a crown across the picture', () => {
    const crowns = treeCrownGrid([{ x: 0, y: 8, z: 40, r: 4 }, { x: 3, y: 7, z: 30, r: 3.5 }]);
    const wooded = raidShotClearOf(site(), () => 2, () => crowns);
    expect(clear(v(0, 9, 40), v(0, 3, 0))).toBe(true);
    expect(wooded(v(0, 9, 40), v(0, 3, 0))).toBe(false);
    expect(wooded(v(0, 9, 48), v(0, 3, 0))).toBe(false);
    expect(wooded(v(-14, 9, 40), v(-14, 3, 0))).toBe(true);
    expect(wooded(v(0, 30, 48), v(0, 3, 0))).toBe(true);
  });

  it('reads crowns from the scene’s instanced tree meshes once per change, one ball per tree', () => {
    const scene = new THREE.Scene(), geometry = new THREE.BoxGeometry(4, 8, 4).translate(0, 4, 0);
    const near = new THREE.InstancedMesh(geometry, new THREE.MeshBasicMaterial(), 2), far = new THREE.InstancedMesh(geometry, new THREE.MeshBasicMaterial(), 1);
    near.name = 'tree-oak-hearth-0'; far.name = 'tree-oak-hearth-0';
    near.setMatrixAt(0, new THREE.Matrix4().makeTranslation(10, 2, 10)); near.setMatrixAt(1, new THREE.Matrix4().makeTranslation(-10, 2, 10));
    far.setMatrixAt(0, new THREE.Matrix4().makeTranslation(10, 2, 10));
    const house = new THREE.InstancedMesh(geometry, new THREE.MeshBasicMaterial(), 1); house.name = 'home-hearth-0';
    scene.add(near, far, house);
    const read = sceneTreeCrowns(scene), grid = read();
    expect(read()).toBe(grid);
    const at = grid.near(10, 10);
    expect(at).toHaveLength(1);
    // The crown sits at the top of the tree, as wide as its narrower half; the trunk below stays open.
    expect(at[0]).toMatchObject({ x: 10, y: 8, z: 10 });
    expect(at[0]!.r).toBeCloseTo(1.6, 5);
    expect(grid.near(-10, 10)).toHaveLength(1);
    near.count = 1;
    expect(read().near(-10, 10)).toHaveLength(0);
  });
});
