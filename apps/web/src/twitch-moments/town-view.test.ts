import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { Vec3 } from '@chatdom/shared';
import type { DoorAnchor, PlaceAnchor } from './gift-view';
import { TAG_VARIANTS, TREE_CELLS, standardRuns, tagVariant, townParts } from './town-art';
import { EMPTY_TOWN, TOWN_BEAT, type GateFrame, type PlantingFrame, type TownFrame, type TownLayerHost } from './town';
import { NIGHT_GATE, PLANTING_SPOT, TREE_GARDEN, createTownLayer, type TownLayer } from './town-view';

/** Half the doorstep's depth: the host puts the doorstep 3 cells out from the door's face. */
const DOORSTEP_OUT = 0.375;

interface Home { readonly door: DoorAnchor | null; readonly window: { centre: Vec3; normal: Vec3; right: Vec3; width: number; height: number } | null }

/** A street of homes facing +z along x (slot 1 at x 0, then 8 m apart), with a castle crown and a gate. */
function street(options: { homes?: Map<number, Home>; gate?: PlaceAnchor | null; castle?: boolean } = {}) {
  const homes = options.homes ?? new Map<number, Home>(Array.from({ length: 6 }, (_, i) => {
    const x = i * 8;
    return [i + 1, { door: { doorstep: [x, 0, DOORSTEP_OUT], normal: [0, 0, 1], right: [1, 0, 0] }, window: { centre: [x + 2, 2, 0.006], normal: [0, 0, 1], right: [1, 0, 0], width: 1, height: 1 } }];
  }));
  const root = new THREE.Group();
  const host: TownLayerHost = {
    kit: 'hearth', material: new THREE.MeshBasicMaterial(),
    places: {
      sky: () => null, castle: () => (options.castle === false ? null : { crown: [20, 28, -40], walls: [] }), plaza: () => null, lair: () => null,
      track: () => null, bunting: () => [], roof: slot => (homes.has(slot) ? [0, 6, 0] : null), homes: () => [...homes.keys()],
    },
    mesh: () => new THREE.Mesh(new THREE.BoxGeometry(0.125, 0.125, 0.125)),
    meshAsync: async () => new THREE.BoxGeometry(0.125, 0.125, 0.125),
    door: slot => homes.get(slot)?.door ?? null,
    window: slot => homes.get(slot)?.window ?? null,
    gate: () => (options.gate === undefined ? { position: [-30, 0, 20], facing: [1, 0, 0] } : options.gate),
  };
  return { root, host, layer: createTownLayer(root, host) };
}

const frame = (patch: Partial<TownFrame>): TownFrame => ({ ...EMPTY_TOWN, ...patch });
const planting = (slot: number, kind: PlantingFrame['kind'], patch: Partial<PlantingFrame> = {}): PlantingFrame =>
  ({ slot, kind, name: 'Wren', grow: 1, tag: 0, t: null, ...patch });
const night = (patch: Partial<GateFrame> = {}): GateFrame => ({ number: 3, colour: 'gold', t: null, braziers: 1, standard: 1, beacon: 1, ...patch });

function instances(root: THREE.Object3D, name: string): THREE.Matrix4[] {
  const mesh = root.getObjectByName(name) as THREE.InstancedMesh | undefined;
  if (!mesh || !mesh.visible) return [];
  return Array.from({ length: mesh.count }, (_, i) => { const m = new THREE.Matrix4(); mesh.getMatrixAt(i, m); return m; });
}
const positionOf = (m: THREE.Matrix4) => new THREE.Vector3().setFromMatrixPosition(m);
const scaleOf = (m: THREE.Matrix4) => new THREE.Vector3().setFromMatrixScale(m);
/** A part's ground point: its instance matrix applied to the part's pivot (the view offsets each part by its pivot). */
const pivotOf = (m: THREE.Matrix4, pivot: readonly [number, number, number]) => new THREE.Vector3(pivot[0] * 0.125, pivot[1] * 0.125, pivot[2] * 0.125).applyMatrix4(m);
const stats = (layer: TownLayer) => layer.stats() as Record<string, number>;

describe('the town layer: parts', () => {
  it('prepares every part once, each a real voxel piece', () => {
    const { layer } = street();
    const parts = layer.blueprints();
    expect(new Set(parts.map(p => p.id)).size).toBe(parts.length);
    for (const part of parts) {
      expect(part.boxes.length, part.id).toBeGreaterThan(0);
      for (const b of part.boxes) for (let axis = 0; axis < 3; axis++) {
        expect(b.from[axis]!).toBeGreaterThanOrEqual(0);
        expect(b.to[axis]!).toBeLessThanOrEqual(part.size[axis]!);
      }
    }
    expect(parts.map(p => p.id)).toEqual(townParts('hearth').map(p => p.id));
    // The tree is a real little tree: 3–4 m tall, its crown two-tone, the trunk in bark.
    const tall = TREE_CELLS.height * 0.125;
    expect(tall).toBeGreaterThanOrEqual(3);
    expect(tall).toBeLessThanOrEqual(4);
  });

  it('writes on a tag only when there is a name, and weaves the standard in the town\'s dyes', () => {
    expect(tagVariant(null)).toBe('blank');
    expect(tagVariant('  ')).toBe('blank');
    expect(TAG_VARIANTS).toContain(tagVariant('Wren'));
    expect(tagVariant('Wren')).not.toBe(tagVariant('Bartholomew the Bold'));
    for (const colour of ['gold', 'night', 'tide'] as const) {
      const rows = standardRuns(colour);
      expect(rows).toHaveLength(22);
      // Every row is covered edge to edge except where the swallowtail is cut.
      expect(rows[5]!.reduce((n, r) => n + r.x1 - r.x0, 0)).toBe(13);
      expect(rows[21]!.reduce((n, r) => n + r.x1 - r.x0, 0)).toBe(8);
    }
  });
});

describe('the grove', () => {
  it('plants a sapling beside the door: off the doorstep, out of the doorway, never inside the wall', () => {
    const { root, layer } = street();
    layer.apply(frame({ plantings: [planting(1, 'sapling')] }), 1000);
    expect(stats(layer)).toMatchObject({ plantings: 1, saplings: 1, trees: 0 });
    const [stem] = instances(root, 'moment-town-sapling-stem-hearth');
    const foot = pivotOf(stem!, [0.5, 0, 0.5]);
    // Door at x 0, facing +z, its wall 0.375 m behind the doorstep.
    expect(Math.abs(foot.x)).toBeGreaterThanOrEqual(1.2);
    expect(Math.abs(foot.x)).toBeLessThanOrEqual(1.6);
    expect(foot.x).toBeGreaterThan(0);
    const fromWall = foot.z - 0;
    expect(fromWall).toBeGreaterThanOrEqual(0.3);
    expect(fromWall).toBeLessThanOrEqual(0.6);
    expect(foot.y).toBeCloseTo(0, 5);
    // Restored, it stands fully grown, its tag on its peg.
    expect(scaleOf(stem!).y).toBeCloseTo(1, 5);
    expect(scaleOf(instances(root, 'moment-town-sapling-tuft-hearth')[0]!).x).toBeCloseTo(1, 5);
    expect(instances(root, 'moment-town-sapling-leaf-hearth')).toHaveLength(3);
    expect(instances(root, 'moment-town-tag-peg-hearth')).toHaveLength(1);
    expect(instances(root, `moment-town-tag-${tagVariant('Wren')}-hearth`)).toHaveLength(1);
  });

  it('plants a tree out on the plot on the other side, its crown clear of the house', () => {
    const { root, layer } = street();
    layer.apply(frame({ plantings: [planting(1, 'tree'), planting(1, 'sapling')] }), 1000);
    expect(stats(layer)).toMatchObject({ plantings: 2, saplings: 1, trees: 1 });
    const [trunk] = instances(root, 'moment-town-tree-trunk-hearth');
    const foot = pivotOf(trunk!, [6, 0, 6]);
    expect(foot.x).toBeLessThanOrEqual(-2.5);
    expect(foot.x).toBeGreaterThanOrEqual(-3.5);
    // The crown reaches 1.45 m from the bole: the wall (z 0) and the doorway (|x| < 0.6) stay clear of it.
    expect(foot.z - TREE_CELLS.reach).toBeGreaterThan(0.3);
    expect(Math.abs(foot.x) - TREE_CELLS.reach).toBeGreaterThan(0.6);
    expect(scaleOf(trunk!).y).toBeCloseTo(1, 5);
    expect(instances(root, 'moment-town-tree-crown-east-hearth')).toHaveLength(1);
    expect(instances(root, 'moment-town-tree-crown-west-hearth')).toHaveLength(1);
    const hearts = instances(root, 'moment-town-tree-crown-heart-rose-hearth').length + instances(root, 'moment-town-tree-crown-heart-cream-hearth').length;
    expect(hearts).toBe(1);
  });

  it('keeps the tree\'s crown off the window when the window sits where the tree would', () => {
    const homes = new Map<number, Home>([
      [1, { door: { doorstep: [0, 0, DOORSTEP_OUT], normal: [0, 0, 1], right: [1, 0, 0] }, window: { centre: [-2, 2, 0.006], normal: [0, 0, 1], right: [1, 0, 0], width: 1, height: 1.75 } }],
      [2, { door: { doorstep: [20, 0, DOORSTEP_OUT], normal: [0, 0, 1], right: [1, 0, 0] }, window: { centre: [17, 2, 0.006], normal: [0, 0, 1], right: [1, 0, 0], width: 2.4, height: 1.2 } }],
    ]);
    const { root, layer } = street({ homes });
    layer.apply(frame({ plantings: [planting(1, 'tree'), planting(2, 'tree')] }), 1000);
    const feet = instances(root, 'moment-town-tree-trunk-hearth').map(m => pivotOf(m, [6, 0, 6]));
    expect(feet).toHaveLength(2);
    // Both windows sit where the tree would: each tree stands out in its front garden, never further along the wall
    // where it would read as the neighbour's.
    for (const [foot, door] of [[feet[0]!, 0], [feet[1]!, 20]] as const) {
      expect(foot.z - DOORSTEP_OUT).toBeCloseTo(TREE_GARDEN.out, 5);
      expect(foot.x - door).toBeCloseTo(TREE_GARDEN.aside, 5);
      expect(foot.z - TREE_CELLS.reach).toBeGreaterThan(2);
    }
  });

  it('follows the host\'s door frame wherever the house faces', () => {
    const homes = new Map<number, Home>([[4, { door: { doorstep: [10, 1, 10], normal: [1, 0, 0], right: [0, 0, -1] }, window: null }]]);
    const { root, layer } = street({ homes });
    layer.apply(frame({ plantings: [planting(4, 'sapling'), planting(4, 'tree')] }), 1000);
    const sapling = pivotOf(instances(root, 'moment-town-sapling-stem-hearth')[0]!, [0.5, 0, 0.5]);
    const tree = pivotOf(instances(root, 'moment-town-tree-trunk-hearth')[0]!, [6, 0, 6]);
    // Out along +x from the doorstep (the wall at x 9.625), to the right (−z) for the sapling, left for the tree.
    expect(sapling.z).toBeCloseTo(10 - PLANTING_SPOT.sapling.aside, 5);
    expect(sapling.x).toBeCloseTo(10 + PLANTING_SPOT.sapling.out, 5);
    expect(tree.z).toBeCloseTo(10 - PLANTING_SPOT.tree.aside, 5);
    expect(tree.x).toBeCloseTo(10 + PLANTING_SPOT.tree.out, 5);
    expect(sapling.y).toBeCloseTo(1, 5);
  });

  it('grows live plantings and stands restored ones at full size', () => {
    const { root, layer } = street();
    layer.apply(frame({ plantings: [planting(1, 'sapling', { grow: 0.2, t: 1000 }), planting(2, 'tree', { grow: 0.2, t: 1500 })] }), 1000);
    expect(stats(layer)).toMatchObject({ plantings: 2, growing: 2 });
    expect(scaleOf(instances(root, 'moment-town-sapling-stem-hearth')[0]!).y).toBeLessThan(0.6);
    expect(scaleOf(instances(root, 'moment-town-tree-trunk-hearth')[0]!).y).toBeLessThan(0.9);
    // The soil has broken: crumbs are in the air.
    expect(instances(root, 'moment-town-crumb-hearth').length).toBeGreaterThan(0);
    // Before its beat the tag is not yet on its peg.
    expect(instances(root, 'moment-town-tag-peg-hearth')).toHaveLength(0);
    layer.apply(frame({ plantings: [planting(1, 'sapling'), planting(2, 'tree')] }), 1200);
    expect(stats(layer)).toMatchObject({ plantings: 2, growing: 0 });
    expect(scaleOf(instances(root, 'moment-town-sapling-stem-hearth')[0]!).y).toBeCloseTo(1, 5);
    expect(scaleOf(instances(root, 'moment-town-tree-trunk-hearth')[0]!).y).toBeCloseTo(1, 5);
    expect(instances(root, 'moment-town-crumb-hearth')).toHaveLength(0);
    expect(instances(root, 'moment-town-tag-peg-hearth')).toHaveLength(2);
  });

  it('keeps the standing grove between frames and draws a growing planting on top of it', () => {
    const { root, layer } = street();
    const standing = [1, 2, 3, 4, 5, 6].map(slot => planting(slot, slot % 2 ? 'sapling' : 'tree'));
    layer.apply(frame({ plantings: standing }), 1000);
    const before = stats(layer).instances;
    layer.apply(frame({ plantings: standing }), 1016);
    expect(stats(layer).instances).toBe(before);
    expect(stats(layer)).toMatchObject({ plantings: 6, saplings: 3, trees: 3 });
    layer.apply(frame({ plantings: [...standing, planting(1, 'tree', { grow: 0.5, t: 3000 })] }), 1032);
    expect(stats(layer)).toMatchObject({ plantings: 7, growing: 1 });
    expect(instances(root, 'moment-town-tree-trunk-hearth')).toHaveLength(4);
    layer.apply(frame({ plantings: standing }), 1048);
    expect(stats(layer).instances).toBe(before);
    expect(instances(root, 'moment-town-tree-trunk-hearth')).toHaveLength(3);
  });

  it('draws nothing for a home with no supplied doorstep', () => {
    const { root, layer } = street();
    layer.apply(frame({ plantings: [planting(99, 'sapling'), planting(98, 'tree', { grow: 0.4, t: 2000 })] }), 1000);
    expect(stats(layer)).toMatchObject({ plantings: 0, instances: 0 });
    expect(instances(root, 'moment-town-sapling-stem-hearth')).toHaveLength(0);
  });

  it('bounds the grove at TOWN_LIMITS.plantings', () => {
    const homes = new Map<number, Home>(Array.from({ length: 600 }, (_, i) =>
      [i, { door: { doorstep: [(i % 30) * 9, 0, Math.floor(i / 30) * 12], normal: [0, 0, 1], right: [1, 0, 0] }, window: null }]));
    const { layer } = street({ homes });
    layer.apply(frame({ plantings: [...homes.keys()].map(slot => planting(slot, slot % 3 ? 'sapling' : 'tree')) }), 1000);
    expect(stats(layer).plantings).toBe(512);
  });
});

describe('the relight', () => {
  /** Homes at chosen distances from slot 1's window, all facing +z. */
  function scattered() {
    const at: Record<number, number> = { 1: 0, 2: 9, 3: -14, 4: 22, 5: -31, 6: 40, 7: 200 };
    return new Map<number, Home>(Object.entries(at).map(([slot, x]) =>
      [Number(slot), { door: { doorstep: [x - 2, 0, DOORSTEP_OUT], normal: [0, 0, 1], right: [1, 0, 0] }, window: { centre: [x, 2, 0.006], normal: [0, 0, 1], right: [1, 0, 0], width: 1, height: 1 } }]));
  }
  const panesAt = (root: THREE.Object3D) => instances(root, 'town-panes').map(m => Math.round(positionOf(m).x));

  it('flares the window and lets the nearest neighbours answer one after another', () => {
    const { root, layer } = street({ homes: scattered() });
    const beat = TOWN_BEAT.relight;
    layer.apply(frame({ relights: [{ id: 'r1', slot: 1, t: 600, flare: 0.8 }] }), 1000);
    expect(stats(layer)).toMatchObject({ relights: 1, answers: 0 });
    expect(panesAt(root)).toEqual([0]);
    // The first to answer is the nearest.
    layer.apply(frame({ relights: [{ id: 'r1', slot: 1, t: beat.answer[0] + 200, flare: 1 }] }), 1300);
    expect(stats(layer).answers).toBe(1);
    expect(panesAt(root)).toEqual([0, 9]);
    // By the end of the answers 2–4 homes have answered, and they are the nearest ones, never the far house.
    layer.apply(frame({ relights: [{ id: 'r1', slot: 1, t: beat.answer[1] + 100, flare: 0.6 }] }), 3000);
    const answered = stats(layer).answers;
    expect(answered).toBeGreaterThanOrEqual(2);
    expect(answered).toBeLessThanOrEqual(4);
    expect(panesAt(root)).toEqual([0, ...[9, -14, 22, -31].slice(0, answered)]);
    expect(instances(root, 'town-flames').length).toBeGreaterThan(0);
    // Settled, the light is gone.
    layer.apply(frame({ relights: [{ id: 'r1', slot: 1, t: beat.end, flare: 0 }] }), 9000);
    expect(panesAt(root)).toEqual([]);
  });

  it('shows nothing for a home without a window', () => {
    const homes = scattered();
    homes.set(1, { ...homes.get(1)!, window: null });
    const { layer } = street({ homes });
    layer.apply(frame({ relights: [{ id: 'r1', slot: 1, t: 2500, flare: 1 }] }), 1000);
    expect(stats(layer)).toMatchObject({ relights: 0, answers: 0, lights: 0 });
  });
});

describe('the night at the gate, the beacon and the bell', () => {
  it('draws nothing while the night is closed', () => {
    const { root, layer } = street();
    layer.apply(frame({ gate: null }), 1000);
    expect(stats(layer)).toMatchObject({ gate: 0, beacon: 0, instances: 0, lights: 0 });
    expect(instances(root, 'moment-raid-brazier-hearth')).toHaveLength(0);
    expect(layer.glow().strength).toBe(0);
  });

  it('burns restored: braziers outside the raid\'s, the standard flying on the far side, the beacon lit', () => {
    const { root, layer } = street();
    layer.apply(frame({ gate: night({ colour: 'tide' }) }), 1000);
    expect(stats(layer)).toMatchObject({ gate: 1, beacon: 1 });
    expect(stats(layer).lights).toBeGreaterThan(8);
    const braziers = instances(root, 'moment-raid-brazier-hearth').map(m => pivotOf(m, [4, 0, 4]));
    expect(braziers).toHaveLength(2);
    // Gate at (−30, 0, 20) facing +x: across the road is z (the raid standard's side is −z), in is +x.
    for (const foot of braziers) {
      expect(Math.abs(foot.z - 20)).toBeCloseTo(NIGHT_GATE.brazierAside, 5);
      expect(foot.x).toBeCloseTo(-30 + NIGHT_GATE.brazierIn, 5);
    }
    const pole = pivotOf(instances(root, 'moment-raid-gate-pole-hearth')[0]!, [8, 0, 3]);
    expect(pole.z).toBeCloseTo(20 - NIGHT_GATE.poleAside, 5);
    expect(pole.z).toBeGreaterThan(20);
    // The whole standard is out, in the tide's blue field and cream trim.
    const blue = instances(root, 'moment-town-dye-hearth-44').length, cream = instances(root, 'moment-town-dye-hearth-18').length;
    expect(blue).toBeGreaterThan(10);
    expect(cream).toBeGreaterThan(10);
    expect(instances(root, 'moment-town-beacon-hearth')).toHaveLength(1);
    // Restored, the town keeps its own light: no flash.
    expect(layer.glow().strength).toBe(0);
  });

  it('wakes live: the braziers catch, the standard climbs furled, the beacon warms the town', () => {
    const { root, layer } = street();
    const beat = TOWN_BEAT.gate;
    layer.apply(frame({ gate: night({ t: 300, braziers: 0, standard: 0, beacon: 0 }) }), 1000);
    expect(stats(layer)).toMatchObject({ gate: 1, beacon: 0 });
    expect(instances(root, 'town-flames')).toHaveLength(0);
    layer.apply(frame({ gate: night({ t: beat.standard[0] + 800, braziers: 1, standard: 0.3, beacon: 0 }) }), 3000);
    expect(instances(root, 'town-flames').length).toBeGreaterThan(8);
    // Climbing: only the furled roll shows, no cloth rows yet.
    expect(instances(root, 'moment-town-dye-hearth-42')).toHaveLength(1);
    layer.apply(frame({ gate: night({ t: beat.beacon[0] + 900, braziers: 1, standard: 1, beacon: 0.9 }) }), 6000);
    expect(layer.glow().strength).toBeGreaterThan(0.03);
    expect(layer.glow().strength).toBeLessThanOrEqual(0.6);
  });

  it('lights the beacon even where no gate is supplied, and nothing at all without a castle', () => {
    const noGate = street({ gate: null });
    noGate.layer.apply(frame({ gate: night() }), 1000);
    expect(stats(noGate.layer)).toMatchObject({ gate: 0, beacon: 1 });
    const nothing = street({ gate: null, castle: false });
    nothing.layer.apply(frame({ gate: night(), bell: { id: 'b', t: 700 } }), 1000);
    expect(stats(nothing.layer)).toMatchObject({ gate: 0, beacon: 0, bell: 0, instances: 0, lights: 0 });
  });

  it('rings three strokes from the crown as spreading rings', () => {
    const { root, layer } = street();
    const strokes = TOWN_BEAT.bell.strokes;
    layer.apply(frame({ bell: { id: 'b', t: strokes[0] + 400 } }), 1000);
    expect(stats(layer).bell).toBe(1);
    const first = instances(root, 'town-bell-rings');
    expect(first.length).toBeGreaterThan(0);
    expect(layer.glow().strength).toBeGreaterThan(0);
    layer.apply(frame({ bell: { id: 'b', t: strokes[0] + 1600 } }), 2200);
    const later = instances(root, 'town-bell-rings');
    expect(scaleOf(later[0]!).x).toBeGreaterThan(scaleOf(first[0]!).x);
    layer.apply(frame({ bell: { id: 'b', t: TOWN_BEAT.bell.end } }), 9000);
    expect(stats(layer)).toMatchObject({ bell: 0, lights: 0 });
  });
});

describe('the town layer lifecycle', () => {
  it('removes everything it made from the root', () => {
    const { root, layer } = street();
    layer.apply(frame({
      plantings: [planting(1, 'sapling'), planting(2, 'tree', { grow: 0.5, t: 3000 })], gate: night({ t: 5000, braziers: 1, standard: 0.8, beacon: 0.7 }),
      relights: [{ id: 'r', slot: 3, t: 2000, flare: 1 }], bell: { id: 'b', t: 600 },
    }), 1000);
    expect(root.children).toHaveLength(1);
    expect(stats(layer).instances).toBeGreaterThan(10);
    layer.dispose();
    expect(root.children).toHaveLength(0);
  });
});
