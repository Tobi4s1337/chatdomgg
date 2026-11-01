import { describe, expect, it } from 'vitest';
import { VoxelBlueprintSchema, type VoxelBlueprint } from '@chatdom/shared';
// The production rasterizer; geometry is checked against the cells the renderer actually meshes.
import { rasterizeBlueprint } from '../../../voxel/src/index';
import { MAT, STYLES } from '../materials';
import { BLUEPRINTS, COURT_FLOOR_SIZE, COURT_WAY, COURT_WELL, createCastleCourtPlace, createCourtFloor, createCourtWell, type CourtSite } from './index';

function cells(b: VoxelBlueprint) {
  const asset = rasterizeBlueprint(VoxelBlueprintSchema.parse(b));
  const [sx, sy, sz] = asset.size;
  const at = (x: number, y: number, z: number) => x < 0 || y < 0 || z < 0 || x >= sx || y >= sy || z >= sz ? 0 : asset.voxels[x + sx * (y + sy * z)]!;
  return { asset, at, size: asset.size };
}

/** Occupied cells with no face-connected path to a y = 0 cell. */
function floating(b: VoxelBlueprint): number {
  const { asset } = cells(b), [sx, sy, sz] = asset.size, seen = new Uint8Array(asset.voxels.length), queue: number[] = [];
  let occupied = 0;
  asset.voxels.forEach((m, i) => { if (m) occupied++; if (m && Math.floor(i / sx) % sy === 0) { seen[i] = 1; queue.push(i); } });
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head]!, x = i % sx, y = Math.floor(i / sx) % sy, z = Math.floor(i / (sx * sy));
    for (const n of [x > 0 ? i - 1 : -1, x + 1 < sx ? i + 1 : -1, y > 0 ? i - sx : -1, y + 1 < sy ? i + sx : -1, z > 0 ? i - sx * sy : -1, z + 1 < sz ? i + sx * sy : -1]) {
      if (n >= 0 && asset.voxels[n] && !seen[n]) { seen[n] = 1; queue.push(n); }
    }
  }
  return occupied - queue.length;
}

/** The founded court as `LandPlaces['court']` delivers it (spec 27); the web test reads the real generator. */
const FOUNDED_COURT: CourtSite = { boundary: [[-20, -60], [20, -60], [20, -36], [-20, -36]], elevation: 20, keepDoor: [0, 21.625, -70.875], gate: [0, 20, -36] };

describe('places-high collection', () => {
  it('lists strict, reproducible, unique, supported models in the place palette', () => {
    expect(BLUEPRINTS.map(b => b.id)).toEqual(['hearth', 'tide', 'grove'].flatMap(style => [
      `court-floor-west-${style}-160x192`, `court-floor-east-${style}-160x192`, `court-well-${style}`]));
    expect(JSON.stringify(BLUEPRINTS)).toBe(JSON.stringify(BLUEPRINTS.map(b => {
      const [, kind, half] = b.id.split('-');
      const style = b.styleId as keyof typeof STYLES;
      return kind === 'floor' ? createCourtFloor(half as 'west' | 'east', style).blueprint : createCourtWell(style).blueprint;
    })));
    const place = new Set<number>([MAT.air, MAT.glass, MAT.earth, MAT.bark, MAT.leaf, MAT.moss, MAT.petal, MAT.blueFlower,
      MAT.brass, MAT.cloth, MAT.cream, MAT.darkStone, MAT.thatch, MAT.goldLeaf, MAT.terracotta, MAT.forgeCopper]);
    for (const b of BLUEPRINTS) {
      const kit = STYLES[b.styleId as keyof typeof STYLES];
      const allowed = new Set([...place, kit.wall, kit.roof, kit.trim, kit.stone]);
      expect(b.boxes.every(box => allowed.has(box.material)), b.id).toBe(true);
      expect(b.size.every(n => n >= 1 && n <= 256), b.id).toBe(true);
      expect(b.boxes.length, b.id).toBeLessThanOrEqual(1024);
      expect(floating(b), b.id).toBe(0);
    }
  });
});

describe('court floor', () => {
  it('lays every column on its bed, with joints one cell deep and no hole through to the ground', () => {
    for (const half of ['west', 'east'] as const) {
      const { at } = cells(createCourtFloor(half, 'tide').blueprint);
      let flags = 0;
      for (let z = 0; z < COURT_FLOOR_SIZE.depth; z++) for (let x = 0; x < COURT_FLOOR_SIZE.width; x++) {
        expect(at(x, 0, z), `${half} bed ${x},${z}`).not.toBe(0);
        if (at(x, 1, z)) flags++;
      }
      // Mostly stone: the joints and the frayed margin are recesses, not the floor.
      expect(flags / (COURT_FLOOR_SIZE.width * COURT_FLOOR_SIZE.depth)).toBeGreaterThan(.72);
    }
  });

  it('meets its mirror on the axis: every course joint and the stone spanning the axis match across both halves', () => {
    const west = cells(createCourtFloor('west', 'tide').blueprint), east = cells(createCourtFloor('east', 'tide').blueprint);
    const W = COURT_FLOOR_SIZE.width;
    for (let z = 0; z < COURT_FLOOR_SIZE.depth; z++) {
      expect(west.at(W - 1, 1, z) !== 0, `axis row ${z}`).toBe(east.at(0, 1, z) !== 0);
      expect(west.at(W - 1, 1, z), `axis stone ${z}`).toBe(east.at(0, 1, z));
    }
  });

  it('keeps the processional way continuous: worn slabs across its width in every course', () => {
    const { at } = cells(createCourtFloor('east', 'hearth').blueprint);
    let courses = 0;
    for (let z = 0; z < COURT_FLOOR_SIZE.depth; z++) {
      if (!at(0, 1, z)) continue;
      courses++;
      let open = 0;
      for (let u = COURT_WAY.slabs[0]; u < COURT_WAY.slabs[1]; u++) if (!at(u, 1, z)) open++;
      // At most one joint crosses a slab course on each side of the axis.
      expect(open, `course row ${z}`).toBeLessThanOrEqual(1);
    }
    expect(courses).toBeGreaterThan(150);
  });
});

describe('court well', () => {
  const well = createCourtWell('tide');
  const { at, size } = cells(well.blueprint);
  const [cx, cz] = COURT_WELL.centre;

  it('stands a lean-height coping over an open shaft with dark water below', () => {
    expect(at(cx, 0, cz)).toBe(STYLES.tide.stone);
    expect(at(cx, 1, cz)).toBe(MAT.darkStone);
    // Coping: pale, its top 0.875 m above the step.
    expect(at(cx + 6, COURT_WELL.copingTop - 1, cz)).toBe(MAT.cream);
    expect(at(cx + 6, COURT_WELL.copingTop, cz)).toBe(0);
    expect((COURT_WELL.copingTop - COURT_WELL.stepTop) * .125).toBe(.875);
    // The shaft is open from the water to the hanging bucket.
    for (let y = 2; y < 8; y++) expect(at(cx, y, cz), `shaft ${y}`).toBe(0);
  });

  it('carries its canopy on posts: every cell is supported and the eaves leave a person standing room', () => {
    expect(floating(well.blueprint)).toBe(0);
    // Under the eave at the draw side there is head room for a 1.5 m citizen leaning on the coping.
    for (let y = COURT_WELL.stepTop; y < 22; y++) expect(at(cx, y, size[2] - 1), `eave ${y}`).toBe(0);
    expect(at(cx + 1, 22, size[2] - 1)).toBe(MAT.terracotta);
  });

  it('offers a draw point on open court ground outside the step, facing the coping', () => {
    const [anchor] = well.interactions;
    expect(anchor?.kind).toBe('draw-water');
    expect(anchor!.stand[2]).toBeGreaterThanOrEqual(size[2]);
    expect(anchor!.stand[1]).toBe(0);
    expect(anchor!.look).toEqual([cx, COURT_WELL.copingTop, cz]);
  });
});

describe('court assembly', () => {
  const place = createCastleCourtPlace(FOUNDED_COURT, 'tide');

  it('lays both halves edge to edge across the court and seats the pieces on the flags', () => {
    const [west, east, well, crest] = place.placements;
    expect(west!.position).toEqual([-20, 19.875, -60]);
    expect(east!.position).toEqual([0, 19.875, -60]);
    expect(place.floorTop).toBe(20.125);
    expect(well!.position[1]).toBe(20.125);
    expect(crest!.blueprint.id).toBe('civic-tide-crest-plinth');
    for (const p of place.placements) expect(p.position.every(v => Number.isInteger(v * 8)), p.id).toBe(true);
  });

  it('keeps its own reservations clear and refuses courts it cannot lay honestly', () => {
    for (const p of place.placements.filter(p => p.blocker)) {
      const [x, , z] = p.position, X = x + p.blueprint.size[0] / 8, Z = z + p.blueprint.size[2] / 8;
      for (const clear of place.keepClear) expect(x >= clear.maxX || X <= clear.minX || z >= clear.maxZ || Z <= clear.minZ, `${p.id} in ${clear.id}`).toBe(true);
    }
    expect(() => createCastleCourtPlace({ ...FOUNDED_COURT, gate: [1, 20, -36] }, 'tide')).toThrow(/axis/);
    expect(() => createCastleCourtPlace({ ...FOUNDED_COURT, boundary: [[-20, -60], [20, -60], [20, -36]] }, 'tide')).toThrow(/rectangle/);
    expect(() => createCastleCourtPlace({ ...FOUNDED_COURT, elevation: 20.1 }, 'tide')).toThrow(/lattice/);
  });
});
