import { describe, expect, it } from 'vitest';
import { VoxelBlueprintSchema, type VoxelAsset, type VoxelBlueprint } from '@chatdom/shared';
// The production rasterizer and mesher; the content package holds no second box interpreter.
import { meshVoxelChunk, prepareAssetChunks, rasterizeBlueprint } from '../../../voxel/src/index';
import { MAT, MATERIALS, STYLES } from '../materials';
import {
  BLUEPRINTS, CIVIC_FORMS, CIVIC_MANIFEST, FOOTBRIDGE, GATEWAY, GIFT_CART, MARKET_STORES, createCivicProp, footbridgeDeckTop,
  type CivicForm, type CivicStyle,
} from './index';
import { CIVIC_KITS } from './kit';

const STYLE_ORDER: readonly CivicStyle[] = ['hearth', 'tide'];
const ROWS: readonly [CivicForm, number, number, number][] = [
  ['footbridge', 64, 24, 32], ['ceremonial-gateway', 48, 64, 16], ['gift-cart', 32, 32, 24], ['banner-standard', 16, 64, 16],
  ['crest-plinth', 24, 40, 16], ['noticeboard', 32, 32, 12], ['direction-sign', 16, 32, 8], ['bench', 32, 16, 16],
  ['lantern-post', 12, 40, 12], ['market-stores', 24, 16, 16],
];

const voxels = (b: VoxelBlueprint) => {
  const asset = rasterizeBlueprint(b);
  const [sx, sy, sz] = asset.size;
  const at = (x: number, y: number, z: number) =>
    x < 0 || y < 0 || z < 0 || x >= sx || y >= sy || z >= sz ? 0 : asset.voxels[x + sx * (y + sy * z)]!;
  return { asset, at };
};

/** Face-connected flood from every ground cell; returns the cells it could not reach. */
function floating(asset: VoxelAsset): number {
  const [sx, sy, sz] = asset.size;
  const seen = new Uint8Array(asset.voxels.length), queue: number[] = [];
  let occupied = 0;
  asset.voxels.forEach((m, i) => { if (m) occupied++; if (m && Math.floor(i / sx) % sy === 0) { seen[i] = 1; queue.push(i); } });
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head]!, x = i % sx, y = Math.floor(i / sx) % sy, z = Math.floor(i / (sx * sy));
    for (const n of [x > 0 ? i - 1 : -1, x + 1 < sx ? i + 1 : -1, y > 0 ? i - sx : -1, y + 1 < sy ? i + sx : -1,
      z > 0 ? i - sx * sy : -1, z + 1 < sz ? i + sx * sy : -1]) {
      if (n >= 0 && !seen[n] && asset.voxels[n]) { seen[n] = 1; queue.push(n); }
    }
  }
  return occupied - queue.length;
}

describe('civic collection contract', () => {
  it('lists ten manifest rows in form order with exact sizes and cost ceilings', () => {
    expect(CIVIC_FORMS).toEqual(ROWS.map(([form]) => form));
    expect(CIVIC_MANIFEST.map(row => [row.form, ...row.size])).toEqual(ROWS);
    for (const row of CIVIC_MANIFEST) expect(row).toMatchObject({ maxBoxes: 1024, maxOccupiedCells: 120_000, maxTriangles: 120_000 });
  });

  it('exports only finished models, Hearth then Tide in form order, each exactly its factory output', () => {
    const expected = STYLE_ORDER.flatMap(style => CIVIC_FORMS.map(form => `civic-${style}-${form}`));
    const ids = BLUEPRINTS.map(b => b.id);
    expect(ids.length).toBeGreaterThan(0);
    expect(ids).toEqual(expected.filter(id => ids.includes(id)));
    for (const style of STYLE_ORDER) for (const form of CIVIC_FORMS) {
      const id = `civic-${style}-${form}`;
      if (ids.includes(id)) expect(JSON.stringify(createCivicProp(form, style))).toBe(JSON.stringify(BLUEPRINTS.find(b => b.id === id)));
      // A form is finished in both kits or in neither; unfinished forms refuse rather than stand in.
      else expect(() => createCivicProp(form, style)).toThrow(/not built yet/);
    }
    expect(ids.filter(id => id.startsWith('civic-hearth-')).map(id => id.slice(13)))
      .toEqual(ids.filter(id => id.startsWith('civic-tide-')).map(id => id.slice(11)));
  });

  it('fails explicitly on unknown forms and kits', () => {
    expect(() => createCivicProp('gazebo' as CivicForm, 'hearth')).toThrow(/Unknown civic form/);
    expect(() => createCivicProp('footbridge', 'grove' as CivicStyle)).toThrow(/hearth and tide/);
    expect(() => createCivicProp('footbridge', undefined as unknown as CivicStyle)).toThrow(/hearth and tide/);
  });
});

describe.each(BLUEPRINTS.map(b => [b.id, b] as const))('%s', (_, b) => {
  const style = b.styleId as CivicStyle;
  const row = CIVIC_MANIFEST.find(r => b.id === `civic-${style}-${r.form}`)!;

  it('is a strict passive civic blueprint in its own kit palette', () => {
    expect(() => VoxelBlueprintSchema.parse(b)).not.toThrow();
    expect(b).toMatchObject({ version: 1, kind: 'civic', lattice: 'build', windows: [], size: [...row.size] });
    const kit = STYLES[style];
    const allowed = new Set<number>([MAT.air, kit.wall, kit.roof, kit.trim, kit.stone, MAT.bark, MAT.brass, MAT.cloth,
      MAT.cream, MAT.darkStone, MAT.earth, MAT.leaf, MAT.moss, MAT.thatch, MAT.glass, MAT.petal, MAT.blueFlower]);
    expect(b.boxes.filter(box => !allowed.has(box.material))).toEqual([]);
    const solids = b.boxes.filter(box => box.material !== MAT.air).map(box => JSON.stringify(box));
    expect(new Set(solids).size).toBe(solids.length);
  });

  it('stands on the ground as one structure within its rasterized and meshed cost', () => {
    const { asset } = voxels(b);
    const occupied = asset.voxels.reduce((n, m) => n + (m ? 1 : 0), 0);
    expect(floating(asset)).toBe(0);
    let triangles = 0;
    for (const chunk of prepareAssetChunks(asset, MATERIALS.materials, MATERIALS.revision)) triangles += meshVoxelChunk(chunk).indices.length / 3;
    expect(b.boxes.length).toBeLessThanOrEqual(row.maxBoxes);
    expect(occupied).toBeGreaterThan(0);
    expect(occupied).toBeLessThanOrEqual(row.maxOccupiedCells);
    expect(triangles).toBeGreaterThan(0);
    expect(triangles).toBeLessThanOrEqual(row.maxTriangles);
  });
});

describe.each(STYLE_ORDER)('%s crossing and gateway', style => {
  it('footbridge: a continuous walk strip of gentle treads between flat landings, over an open span', () => {
    const { at } = voxels(createCivicProp('footbridge', style));
    const [walkFrom, walkTo] = FOOTBRIDGE.walk;
    expect(walkTo - walkFrom).toBeGreaterThanOrEqual(16);
    const tops: number[] = [];
    for (let x = 0; x < 64; x++) {
      const top = footbridgeDeckTop(x);
      tops.push(top);
      for (let z = walkFrom; z < walkTo; z++) {
        // A solid tread under every foot, and nothing above it: no rail, post or kerb crosses the strip.
        expect(at(x, top - 1, z), `tread ${x},${z}`).not.toBe(0);
        for (let y = top; y < 24; y++) expect(at(x, y, z), `headroom ${x},${y},${z}`).toBe(0);
      }
    }
    // Rises of one cell per tread of at least four, from landings of at least four.
    const runs: { top: number; length: number }[] = [];
    for (const top of tops) {
      if (runs.at(-1)?.top === top) runs.at(-1)!.length++;
      else runs.push({ top, length: 1 });
    }
    expect(runs.every(run => run.length >= 4)).toBe(true);
    for (let i = 1; i < runs.length; i++) expect(Math.abs(runs[i]!.top - runs[i - 1]!.top)).toBe(1);
    expect(runs[0]).toEqual({ top: 1, length: FOOTBRIDGE.landing });
    expect(runs.at(-1)).toEqual({ top: 1, length: FOOTBRIDGE.landing });
    expect(Math.max(...tops)).toBe(FOOTBRIDGE.crownTop);
    // The span between the abutments never touches the ground, and the crown stands clear above it.
    const [openFrom, openTo] = FOOTBRIDGE.open;
    for (let x = openFrom; x < openTo; x++) for (let z = 0; z < 32; z++) expect(at(x, 0, z), `underside ${x},${z}`).toBe(0);
    for (let x = 24; x < 40; x++) for (let z = walkFrom; z < walkTo; z++) for (let y = 0; y < footbridgeDeckTop(x) - 2; y++) {
      expect(at(x, y, z), `under crown ${x},${y},${z}`).toBe(0);
    }
    // Both hand rails are real: timber at railing height on each side of the strip along the span.
    for (const z of [3, 27]) for (const x of [20, 32, 43]) expect(at(x, footbridgeDeckTop(x) + 8, z)).toBe(MAT.timber);
  });

  it('gateway: the whole passage is open air between two grounded feet, under an inset shield on both faces', () => {
    const { at } = voxels(createCivicProp('ceremonial-gateway', style));
    const { from, to } = GATEWAY.passage;
    for (let x = from[0]; x < to[0]; x++) for (let y = from[1]; y < to[1]; y++) for (let z = from[2]; z < to[2]; z++) {
      expect(at(x, y, z), `passage ${x},${y},${z}`).toBe(0);
    }
    for (const [x0, x1] of [[0, 12], [36, 48]] as const) {
      let ground = 0;
      for (let x = x0; x < x1; x++) for (let z = 0; z < 16; z++) if (at(x, 0, z)) ground++;
      expect(ground).toBe((x1 - x0) * 16);
    }
    // The soffit is the arch's own underside, rising to its crown directly over the passage centre.
    expect(at(23, 39, 8)).toBe(0);
    expect(at(23, 40, 8)).not.toBe(0);
    const kit = CIVIC_KITS[style];
    for (const [face, proud] of [[2, 1], [13, 14]] as const) {
      const count = (z: number, material: number) => {
        let n = 0;
        for (let x = 18; x < 30; x++) for (let y = 40; y < 54; y++) if (at(x, y, z) === material) n++;
        return n;
      };
      expect(count(face, kit.field)).toBeGreaterThan(100);
      expect(count(proud, kit.charge)).toBeGreaterThan(20);
      expect(count(proud, kit.border)).toBeGreaterThan(30);
      // The field is recessed: nothing stands in front of it.
      expect(at(24, 52, proud)).toBe(0);
    }
  });
});

describe.each(STYLE_ORDER)('%s market furniture', style => {
  it('gift cart: spoked wheels on the ground, clear of the boards, a level bed and a free grip', () => {
    const { at } = voxels(createCivicProp('gift-cart', style));
    const [ax, ay] = GIFT_CART.axle, r = GIFT_CART.radius;
    for (const [z0] of GIFT_CART.wheels) {
      const z = z0 + 1;
      // The iron-dark tyre carries the wheel on the ground under the axle, and the hub sits on the axle line.
      for (const x of [ax - 2, ax - 1, ax, ax + 1]) expect(at(x, 0, z), `tyre ${x}`).toBe(MAT.darkStone);
      expect(at(ax, ay, z)).not.toBe(0);
      // Between the spokes the wheel is open, inside the felloe.
      for (const [dx, dy] of [[3, 1], [-4, 1], [1, 3], [1, -4], [-4, -2]] as const) expect(at(ax + dx, ay + dy, z), `spoke gap ${dx},${dy}`).toBe(0);
      expect(at(ax + r - 2, ay, z)).not.toBe(0);
    }
    // Above the hub, each wheel turns in open air beside the boards.
    for (const z of [3, 20]) for (let x = ax - r; x < ax + r; x++) for (let y = ay + 2; y < ay + r; y++) {
      expect(at(x, y, z), `wheel clearance ${x},${y},${z}`).toBe(0);
    }
    // The bed floor is one level plane from the handle end to the tail, carried by the axle and the two legs.
    const { from, to } = GIFT_CART.bed;
    for (let x = from[0]; x < to[0]; x++) for (let z = from[2]; z < to[2]; z++) expect(at(x, to[1] - 1, z), `bed ${x},${z}`).not.toBe(0);
    for (const z of [6, 16]) for (let y = 0; y < from[1]; y++) expect(at(GIFT_CART.legs[0], y, z)).not.toBe(0);
    // The grip spans wider than the bed and nothing crowds the hands below or above it.
    const [g0, g1] = GIFT_CART.grip;
    for (let x = g0; x < g1; x++) {
      for (let z = 4; z < 20; z++) expect(at(x, 10, z), `grip ${x},${z}`).not.toBe(0);
      for (let z = 0; z < 24; z++) {
        for (let y = 0; y < 10; y++) expect(at(x, y, z), `under grip ${x},${y},${z}`).toBe(0);
        for (let y = 12; y < 32; y++) expect(at(x, y, z), `over grip ${x},${y},${z}`).toBe(0);
      }
    }
    // A pennant in the kit's field flies above the load.
    let pennant = 0;
    for (let x = 0; x < 32; x++) for (let y = 23; y < 30; y++) for (let z = 0; z < 24; z++) if (at(x, y, z) === CIVIC_KITS[style].field) pennant++;
    expect(pennant).toBeGreaterThan(30);
  });

  it('market stores: a bellied cask, a keg on cradles with a let-in head, and produce heaped over the rim', () => {
    const { at } = voxels(createCivicProp('market-stores', style));
    const { cask, keg, open } = MARKET_STORES;
    const [cx, , cz] = cask.from;
    // Faceted, not cubic: the belly's corners are cut, and the belly stands wider than both chimes.
    expect(at(cx, 5, cz)).toBe(0);
    expect(at(cx, 5, cz + 3)).not.toBe(0);
    expect(at(cx, 0, cz + 3)).toBe(0);
    expect(at(cx, cask.to[1] - 1, cz + 3)).toBe(0);
    expect(at(cx + 3, cask.to[1] - 1, cz + 3)).toBe(0);
    expect(at(cx + 3, cask.to[1] - 2, cz + 3)).not.toBe(0);
    // The keg lies in two cradles with air under its round between them; its head sits one cell inside the chime.
    const [kx, , kz] = keg.from, [KX, KY, KZ] = keg.to, mid = Math.floor((kz + KZ) / 2);
    expect(at(kx + 2, 0, mid)).toBe(0);
    expect(at(kx + 2, 1, mid)).not.toBe(0);
    expect(at(kx, 0, mid)).toBe(0);
    expect(at(kx, 1, mid)).toBe(0);
    expect(at(kx + 3, 3, KZ - 1)).toBe(0);
    expect(at(kx + 3, 3, KZ - 2)).not.toBe(0);
    expect(at(KX - 1, KY - 1, mid)).toBe(0);
    // Produce rises over the open crate's rim, and its joints never open onto the goods inside.
    let crown = 0;
    for (let x = open.from[0]; x < open.to[0]; x++) for (let z = open.from[2]; z < open.to[2]; z++) {
      for (let y = open.to[1]; y < 16; y++) if (at(x, y, z)) crown = Math.max(crown, y + 1);
    }
    expect(crown).toBeGreaterThanOrEqual(open.to[1] + 2);
    const inner = at(open.from[0] + 2, open.from[1] + 2, open.from[2] + 1);
    expect(inner).not.toBe(0);
    expect([MAT.cloth, MAT.leaf]).not.toContain(inner);
  });
});
