import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { MATERIALS } from '@chatdom/content';
import { createVoxelMaterial } from '@chatdom/render';
import type { Vec3 } from '@chatdom/shared';
import { footprintCorners } from '../ground-dressing/plan';
import { pieceMatrix } from '../ground-dressing/mount';
import { attachCanopy, canopyOffset, canopyVertexShader, createCanopyMaterial, CANOPY_VERTEX_ANCHOR } from './canopy';
import { ELDER_SHARE, groveBatches, plantGrove, plantTree, siteSpecies, toGroundPiece, TREE_SINK, type TreeSite, type TreeZone } from './plant';

const site = (id: string, zone: TreeZone, position: Vec3 = [12.5, 3.25, -40], yaw = 0.7, style: TreeSite['style'] = 'hearth'): TreeSite =>
  ({ id, zone, position, yaw, style, seed: 'willowmere' });
const sites = (zone: TreeZone, n: number, style: TreeSite['style'] = 'hearth') => Array.from({ length: n }, (_, i) => site(`${zone}-${i}`, zone, [i * 3.1, 0, -i * 1.7], i * 0.37, style));

describe('planting the grove on existing sites', () => {
  it('stands every trunk exactly on its site through the GroundPiece transform, at any yaw', () => {
    for (const yaw of [0, 0.7, Math.PI / 2, 2.4, -1.3]) for (const zone of ['court', 'grove', 'water'] as const) {
      const tree = plantTree(site(`s-${zone}-${yaw}`, zone, [12.5, 3.25, -40], yaw));
      const root = new THREE.Vector3(tree.blueprint.size[0] * 0.0625, 0, tree.blueprint.size[2] * 0.0625).applyMatrix4(pieceMatrix(toGroundPiece(tree), 1));
      expect(root.x).toBeCloseTo(12.5, 9);
      expect(root.z).toBeCloseTo(-40, 9);
      expect(root.y).toBeCloseTo(3.25 - TREE_SINK, 9);
      expect(tree.root).toEqual([12.5, 3.25 - TREE_SINK, -40]);
      // The footprint the ground-dressing plan computes is centred on the site too.
      const corners = footprintCorners(tree.blueprint, tree.position, tree.yaw);
      expect(corners.reduce((n, c) => n + c[0], 0) / 4).toBeCloseTo(12.5, 9);
      expect(corners.reduce((n, c) => n + c[1], 0) / 4).toBeCloseTo(-40, 9);
    }
  });

  it('converts to a GroundPiece without moving its origin, yaw or blueprint', () => {
    const tree = plantTree(site('a', 'grove'));
    expect(toGroundPiece(tree)).toEqual({ id: 'tree:a', blueprint: tree.blueprint, position: tree.position, yaw: tree.yaw });
    expect(toGroundPiece(tree).blueprint).toBe(tree.blueprint);
  });

  it('keeps each site its identity, species and transform across rebuilds and around other sites', () => {
    const all = [...sites('court', 40), ...sites('grove', 120), ...sites('water', 30)];
    const once = plantGrove(all), again = plantGrove([...all].reverse()).reverse(), alone = plantTree(all[77]!);
    expect(again.map(t => [t.id, t.blueprint.id, t.position, t.yaw])).toEqual(once.map(t => [t.id, t.blueprint.id, t.position, t.yaw]));
    expect(once[77]).toEqual(alone);
    expect(once.map(t => t.id)).toEqual(all.map(s => `tree:${s.id}`));
    expect(() => plantGrove([site('x', 'grove'), site('x', 'court')])).toThrow(/twice/);
    expect(() => plantTree({ ...site('y', 'grove'), zone: 'meadow' as never })).toThrow(/zone/);
    expect(() => plantTree(site('z', 'grove', [Number.NaN, 0, 0]))).toThrow(/finite/);
  });

  it('puts willows only by water, elders only and rarely in the woods, and every species somewhere', () => {
    const grown = plantGrove([...sites('court', 300), ...sites('grove', 1000), ...sites('water', 200)]);
    const count = (zone: TreeZone, species: string) => grown.filter(t => t.zone === zone && t.species === species).length;
    expect(count('court', 'willow') + count('grove', 'willow')).toBe(0);
    expect(count('court', 'elder') + count('water', 'elder')).toBe(0);
    expect(count('water', 'willow')).toBeGreaterThan(90);
    const elders = count('grove', 'elder');
    expect(elders).toBeGreaterThan(1000 * ELDER_SHARE * 0.4);
    expect(elders).toBeLessThan(1000 * ELDER_SHARE * 1.8);
    for (const species of ['oak', 'pine', 'birch', 'willow', 'elder']) expect(grown.some(t => t.species === species), species).toBe(true);
    // Kits lean differently: tide woods run to pine.
    const tide = plantGrove(sites('grove', 600, 'tide')), hearth = plantGrove(sites('grove', 600));
    expect(tide.filter(t => t.species === 'pine').length).toBeGreaterThan(hearth.filter(t => t.species === 'pine').length);
    expect(new Set(tide.map(t => t.blueprint.styleId))).toEqual(new Set(['tide']));
  });

  it('never grows a crown wider than the room the caller gives a site', () => {
    for (const room of [2.5, 4.5, 6]) for (const tree of plantGrove(sites('grove', 300).map(s => ({ ...s, room })))) {
      expect(tree.reach, `${tree.id} at room ${room}`).toBeLessThanOrEqual(room);
    }
    // With no room limit the site's own species stands; the chosen species is a pure function of the site.
    expect(plantTree(site('free', 'grove')).species).toBe(siteSpecies(site('free', 'grove')));
  });

  it('batches placements by blueprint in first-appearance order for instancing', () => {
    const grown = plantGrove(sites('grove', 80)), batches = groveBatches(grown);
    expect(batches.reduce((n, b) => n + b.placements.length, 0)).toBe(80);
    expect(new Set(batches.map(b => b.blueprint)).size).toBe(batches.length);
    for (const batch of batches) for (const p of batch.placements) {
      const tree = grown.find(t => t.id === p.id)!;
      expect(tree.blueprint).toBe(batch.blueprint);
      expect(p.position).toBe(tree.position);
    }
  });
});

describe('the canopy wind', () => {
  const tree = plantTree(site('wind', 'grove', [30, 2, -60], 1.1));
  const rootLocal = [tree.blueprint.size[0] * 0.0625, tree.blueprint.size[2] * 0.0625] as const;
  const wind = [0.8, 0.6] as const;

  it('holds roots and bole fixed and keeps the crown offset under a voxel', () => {
    for (const time of [0, 1.3, 7.9, 40.2]) {
      for (let y = 0; y < tree.canopy.pivot; y += 0.25) for (const dx of [-1.5, 0, 1.2]) {
        expect(Math.hypot(...canopyOffset(tree.canopy, rootLocal, [rootLocal[0] + dx, y, rootLocal[1]], tree.position, time, wind))).toBeLessThan(0.002);
      }
      for (let y = 0; y < tree.canopy.top; y += 0.5) for (let x = 0; x < tree.blueprint.size[0] * 0.125; x += 0.5) {
        expect(Math.hypot(...canopyOffset(tree.canopy, rootLocal, [x, y, rootLocal[1]], tree.position, time, wind))).toBeLessThanOrEqual(0.125);
      }
    }
    expect(Math.hypot(...canopyOffset(tree.canopy, rootLocal, [rootLocal[0], tree.canopy.top, rootLocal[1]], tree.position, 3, [0, 0]))).toBe(0);
  });

  it('moves the crown smoothly: neighbouring cells stay joined', () => {
    for (const time of [0.4, 2.2, 9.1]) for (let y = tree.canopy.pivot; y < tree.canopy.top; y += 0.375) {
      const a = canopyOffset(tree.canopy, rootLocal, [rootLocal[0] + 2, y, rootLocal[1]], tree.position, time, wind);
      const b = canopyOffset(tree.canopy, rootLocal, [rootLocal[0] + 2.125, y + 0.125, rootLocal[1] + 0.125], tree.position, time, wind);
      expect(Math.hypot(a[0] - b[0], a[1] - b[1])).toBeLessThan(0.02);
    }
  });

  it('gives each tree its own moment, so the woods never sway in step', () => {
    const top = [rootLocal[0], tree.canopy.top, rootLocal[1]] as const;
    const others = [[30, 2, -60], [41, 2, -63], [18, 2, -51], [64, 2, -90]] as const;
    const at = (origin: readonly [number, number, number], time: number) => canopyOffset(tree.canopy, rootLocal, top, origin, time, wind)[0];
    const series = others.map(o => Array.from({ length: 40 }, (_, i) => at(o, i * 0.25)));
    for (let i = 1; i < series.length; i++) expect(series[i]).not.toEqual(series[0]);
    // And it does move: a quiet but visible range at the crown top.
    const range = Math.max(...series[0]!) - Math.min(...series[0]!);
    expect(range).toBeGreaterThan(tree.canopy.sway * 0.5);
  });

  it('derives from the production clay on its one instancing anchor, sharing its uniforms', () => {
    const clay = createVoxelMaterial(MATERIALS, 'build');
    const canopy = createCanopyMaterial(clay.material);
    expect(canopy.material.uniforms).toBe(clay.material.uniforms);
    expect(canopy.material.fragmentShader).toBe(clay.material.fragmentShader);
    expect(canopy.material.vertexShader.split(CANOPY_VERTEX_ANCHOR)).toHaveLength(2);
    expect(canopy.material.vertexShader.indexOf('local.xz+=canopyOffset')).toBeGreaterThan(canopy.material.vertexShader.indexOf(CANOPY_VERTEX_ANCHOR));
    canopy.setWind(12.5, [3, 4], 0.5);
    expect(clay.material.uniforms.uCanopyTime!.value).toBe(12.5);
    const w = clay.material.uniforms.uCanopyWind!.value as THREE.Vector3;
    expect(w.x).toBeCloseTo(0.3, 12); expect(w.y).toBe(0); expect(w.z).toBeCloseTo(0.4, 12);
    // A later receiver injection on the clay is followed, as ground dressing follows it.
    clay.material.fragmentShader = `// receiver\n${clay.material.fragmentShader}`;
    canopy.sync();
    expect(canopy.material.fragmentShader).toBe(clay.material.fragmentShader);
    expect(() => canopyVertexShader('void main(){}')).toThrow(/anchor/);
    const geometry = new THREE.BufferGeometry();
    attachCanopy(geometry, tree.canopy, [tree.blueprint.size[0] / 2, 0, tree.blueprint.size[2] / 2]);
    const attribute = geometry.getAttribute('aCanopy') as THREE.InstancedBufferAttribute;
    expect(attribute.meshPerAttribute).toBe(0x40000000);
    expect([...attribute.array]).toEqual([...new Float32Array([tree.canopy.pivot, tree.canopy.top, tree.canopy.reach, tree.canopy.hang])]);
    canopy.dispose(); clay.dispose();
  });
});
