import { describe, expect, it } from 'vitest';
import { VoxelBlueprintSchema, type VoxelBlueprint } from '@chatdom/shared';
// The frozen recipe compiler and observed fixtures, and the production rasterizer.
import { compileChannelGenesis } from '../../../../../world/src/genesis/index';
import { OBSERVED_GENESIS_FIXTURES } from '../../../../../world/src/genesis/observed-fixtures';
import { rasterizeBlueprint } from '../../../../../voxel/src/index';
import { MAT } from '../../../materials';
import { clothArms, composeGenesisHeraldry } from '../../../genesis-heraldry/index';
import { PROFILE_TARGETS, selectLandscape } from '../../../genesis-heraldry/fixtures';
import { aggmanPieceFailures, PROP_BUDGET } from '../checks';
import { meshCost, unsupported } from '../../../places/water/piece-checks';
import { AGGMAN_LIVERY, type Livery } from '../piece';
import {
  BUNTING, COLOUR_PIECES, createAwning, createBannerFrame, createBuntingRun, createFishStall, createHarbourPennant,
  createQuayBanner, createWallBanner, liveryColours, resampleArms, wallBannerBoxes, wallBannerExtent,
} from './index';
import { BENCH_SET } from './bench-set';

const ARMS = clothArms('forked', 'wave');
/** A deliberately different livery: every dye moved, so any hard-coded colour would show. */
const SWAPPED: Livery = { red: MAT.fabricBlue, gold: MAT.fabricOrange, cream: MAT.fabricGold, blue: MAT.fabricGreen, brass: MAT.goldLeaf };

const materials = (b: VoxelBlueprint) => new Set(b.boxes.map(box => box.material));
/** How many cells of each material the production rasterizer carves. */
function cellCounts(b: VoxelBlueprint): Map<number, number> {
  const asset = rasterizeBlueprint(VoxelBlueprintSchema.parse(b)), counts = new Map<number, number>();
  for (const m of asset.voxels) if (m) counts.set(m, (counts.get(m) ?? 0) + 1);
  return counts;
}

describe('The_AGGman colours', () => {
  it('takes the device and colours the real heraldry composes for The_AGGman on the coastal harbour', () => {
    const facts = OBSERVED_GENESIS_FIXTURES.find(f => f.broadcasterId === '63920635')!;
    const recipe = compileChannelGenesis({ ...facts, profileColours: [...PROFILE_TARGETS[facts.broadcasterId]!] });
    const heraldry = composeGenesisHeraldry(recipe, selectLandscape(recipe.landscapes, 'coastal-harbour'));
    expect(heraldry.device).toMatchObject({ charge: 'wave', cut: 'forked' });
    expect(heraldry.standard.arms).toEqual(ARMS);
    expect(heraldry.colours).toEqual(liveryColours(AGGMAN_LIVERY));
    // The pieces built from the composed arms are the bench pieces, byte for byte.
    expect(COLOUR_PIECES(AGGMAN_LIVERY, heraldry.standard.arms)).toEqual(COLOUR_PIECES(AGGMAN_LIVERY, ARMS));
  });

  it('every piece meets the shared bar: schema, registry, ≤ 1,500 boxes, ≤ 60k triangles, grounded', () => {
    const pieces = [
      ...COLOUR_PIECES(AGGMAN_LIVERY, ARMS),
      createBuntingRun(AGGMAN_LIVERY, 64, 0), createBuntingRun(AGGMAN_LIVERY, 200, 16), createBuntingRun(AGGMAN_LIVERY, 137, 5),
      createWallBanner(AGGMAN_LIVERY, ARMS, 24), createWallBanner(AGGMAN_LIVERY, ARMS, 96),
      createAwning(AGGMAN_LIVERY, 16), createAwning(AGGMAN_LIVERY, 64),
    ];
    const ids = new Set<string>();
    for (const piece of pieces) {
      expect(aggmanPieceFailures(piece), piece.blueprint.id).toEqual([]);
      expect(piece.blueprint.id).toMatch(/^genesis-aggman-[a-z0-9-]+$/);
      expect(piece.blueprint.styleId).toBe('tide');
      ids.add(piece.blueprint.id);
    }
    expect(ids.size).toBe(pieces.length);
  });

  it('is deterministic for the same arguments', () => {
    expect(COLOUR_PIECES(AGGMAN_LIVERY, ARMS)).toEqual(COLOUR_PIECES(AGGMAN_LIVERY, ARMS));
    expect(createBuntingRun(AGGMAN_LIVERY, 150, 11)).toEqual(createBuntingRun(AGGMAN_LIVERY, 150, 11));
    expect(wallBannerBoxes(AGGMAN_LIVERY, ARMS, 40)).toEqual(wallBannerBoxes(AGGMAN_LIVERY, ARMS, 40));
  });

  it('the pennants and banners carry the arms: red field, cream charge, brass border, gold fly and tassels', () => {
    const colours = liveryColours(AGGMAN_LIVERY);
    for (const piece of [createHarbourPennant(AGGMAN_LIVERY, ARMS, 0), createHarbourPennant(AGGMAN_LIVERY, ARMS, 1), createQuayBanner(AGGMAN_LIVERY, ARMS), createBannerFrame(AGGMAN_LIVERY, ARMS), createWallBanner(AGGMAN_LIVERY, ARMS, 48)]) {
      const counts = cellCounts(piece.blueprint);
      for (const m of [colours.field, colours.charge, colours.border, AGGMAN_LIVERY.gold]) expect(counts.get(m) ?? 0, `${piece.blueprint.id} material ${m}`).toBeGreaterThan(0);
      // The field dominates the cloth and the charge is a real presence on it (three bars, not a stray cell).
      expect(counts.get(colours.field)!).toBeGreaterThan(counts.get(colours.charge)!);
      expect(counts.get(colours.charge)!).toBeGreaterThan(40);
    }
  });

  it('a smaller cloth keeps the device: one-cell border round the fork, the charge in three bars', () => {
    const grid = resampleArms(ARMS, 16, 28);
    expect(grid).toHaveLength(28);
    expect(grid.every(row => row.length === 16)).toBe(true);
    expect(grid[0]).toBe('B'.repeat(16));
    // The fork: the hem has two tails with a gap between them.
    expect(grid[27]!.match(/[^.]+/g)).toHaveLength(2);
    // Down the middle column the charge appears as three separate bars.
    const middle = grid.map(row => (row[8] === 'C' ? 'C' : '-')).join('');
    expect(middle.match(/C+/g)).toHaveLength(3);
  });

  it('a different livery changes every cloth and keeps nothing of the old dyes', () => {
    const own = COLOUR_PIECES(AGGMAN_LIVERY, ARMS), swapped = COLOUR_PIECES(SWAPPED, ARMS);
    own.forEach((piece, i) => {
      const other = swapped[i]!;
      expect(other.blueprint.id).not.toBe(piece.blueprint.id);
      expect(other.blueprint.boxes).not.toEqual(piece.blueprint.boxes);
      const used = materials(other.blueprint);
      for (const dye of [MAT.fabricRed, MAT.cream]) expect(used.has(dye), `${other.blueprint.id} still uses ${dye}`).toBe(false);
      expect(used.has(SWAPPED.red), other.blueprint.id).toBe(true);
      expect(aggmanPieceFailures(other)).toEqual([]);
    });
  });

  it('variant 1 pennant streams the other way with its own ripple', () => {
    const [a, b] = [createHarbourPennant(AGGMAN_LIVERY, ARMS, 0), createHarbourPennant(AGGMAN_LIVERY, ARMS, 1)];
    const centreX = (p: typeof a) => {
      let sum = 0, n = 0;
      for (const box of p.blueprint.boxes) if (box.material === MAT.fabricGold) { sum += (box.from[0] + box.to[0]) / 2; n++; }
      return sum / n;
    };
    // The gold fly lies far from the mast in each: right of it for variant 0, left for variant 1.
    expect(centreX(a)).toBeGreaterThan(a.blueprint.size[0] / 2);
    expect(centreX(b)).toBeLessThan(b.blueprint.size[0] / 2);
    expect(a.footprint.from[0]).toBe(0);
    expect(b.footprint.to[0]).toBe(b.blueprint.size[0]);
    // Not a plain mirror: the ripples fall differently.
    const mirrored = (p: typeof a) => JSON.stringify(p.blueprint.boxes.map(box => [p.blueprint.size[0] - box.to[0], box.from[1], box.from[2], box.material]).sort());
    expect(mirrored(a)).not.toBe(JSON.stringify(b.blueprint.boxes.map(box => [box.from[0], box.from[1], box.from[2], box.material]).sort()));
  });

  it('the wall banner boxes sit inside their extent, hang from their wall plate and carry the arms', () => {
    for (const height of [24, 48, 96]) {
      const boxes = wallBannerBoxes(AGGMAN_LIVERY, ARMS, height), size = wallBannerExtent(height);
      const blueprint: VoxelBlueprint = { version: 1, id: 'genesis-aggman-wall-banner-probe', styleId: 'tide' as VoxelBlueprint['styleId'], kind: 'prop', lattice: 'build', size, boxes, windows: [] };
      expect(VoxelBlueprintSchema.safeParse(blueprint).success).toBe(true);
      expect(boxes.length).toBeLessThanOrEqual(PROP_BUDGET.boxes);
      expect(meshCost(blueprint).triangles).toBeLessThanOrEqual(PROP_BUDGET.triangles);
      // Everything hangs from the iron plate on the wall face (z = 0).
      const plate = boxes.filter(box => box.from[2] === 0).flatMap(box => [[box.from[0], box.from[1], 0] as [number, number, number]]);
      expect(plate.length).toBeGreaterThan(0);
      expect(unsupported(blueprint, plate)).toBe(0);
      expect(Math.max(...boxes.map(box => box.to[1]))).toBe(height);
      expect(Math.min(...boxes.map(box => box.from[1]))).toBe(0);
      const used = materials(blueprint);
      for (const m of [AGGMAN_LIVERY.red, AGGMAN_LIVERY.cream, AGGMAN_LIVERY.brass]) expect(used.has(m)).toBe(true);
    }
  });

  it('bunting hangs low at the middle, alternates its four colours and refuses impossible runs', () => {
    const run = createBuntingRun(AGGMAN_LIVERY, 120, 10), counts = cellCounts(run.blueprint);
    for (const m of [AGGMAN_LIVERY.red, AGGMAN_LIVERY.gold, AGGMAN_LIVERY.blue, AGGMAN_LIVERY.cream]) expect(counts.get(m) ?? 0).toBeGreaterThan(40);
    // The rope's lowest cell in each column, read from the carved cells.
    const rope = (b: VoxelBlueprint, x: number) => {
      const asset = rasterizeBlueprint(b), [sx, sy, sz] = asset.size;
      let low = Infinity;
      for (let z = 0; z < sz; z++) for (let y = 12; y < sy; y++) if (asset.voxels[x + sx * (y + sy * z)] === MAT.thatch) low = Math.min(low, y);
      return low;
    };
    expect(Math.min(rope(run.blueprint, 59), rope(run.blueprint, 60))).toBe(BUNTING.tie - 10);
    expect(rope(run.blueprint, 20)).toBeGreaterThan(BUNTING.tie - 10);
    expect(rope(createBuntingRun(AGGMAN_LIVERY, 120, 0).blueprint, 60)).toBe(BUNTING.tie);
    expect(() => createBuntingRun(AGGMAN_LIVERY, 63, 4)).toThrow(/64 to 200/);
    expect(() => createBuntingRun(AGGMAN_LIVERY, 201, 4)).toThrow(/64 to 200/);
    expect(() => createBuntingRun(AGGMAN_LIVERY, 100, 17)).toThrow(/0 to 16/);
  });

  it('the awning stripes its canvas red and cream and the stall carries fish, a scale, a bell and a lantern', () => {
    const awning = createAwning(AGGMAN_LIVERY, 32), counts = cellCounts(awning.blueprint);
    expect(counts.get(AGGMAN_LIVERY.red)!).toBeGreaterThan(200);
    expect(counts.get(AGGMAN_LIVERY.cream)!).toBeGreaterThan(150);
    expect(awning.blueprint.size[1]).toBeLessThanOrEqual(22);
    const stall = createFishStall(AGGMAN_LIVERY), stallCounts = cellCounts(stall.blueprint);
    expect(stall.blueprint.size[0]).toBeGreaterThanOrEqual(24);
    for (const m of [MAT.hairSilver, MAT.slate, AGGMAN_LIVERY.brass, AGGMAN_LIVERY.blue, MAT.glass]) expect(stallCounts.get(m) ?? 0).toBeGreaterThan(0);
    expect(stall.lanterns).toHaveLength(1);
    const [x, y, z] = stall.lanterns[0]!;
    expect(rasterizeBlueprint(stall.blueprint).voxels[x + stall.blueprint.size[0] * (y + stall.blueprint.size[1] * z)]).toBe(MAT.glass);
  });

  it('every lantern is a glass cell and the bench set lays out every piece', () => {
    for (const piece of COLOUR_PIECES(AGGMAN_LIVERY, ARMS)) {
      const asset = rasterizeBlueprint(piece.blueprint), [sx, sy] = asset.size;
      for (const [x, y, z] of piece.lanterns) expect(asset.voxels[x + sx * (y + sy * z)], piece.blueprint.id).toBe(MAT.glass);
    }
    expect(BENCH_SET.name).toBe('colours');
    expect(BENCH_SET.pieces.map(p => p.piece.blueprint.id).sort()).toEqual(COLOUR_PIECES(AGGMAN_LIVERY, ARMS).map(p => p.blueprint.id).sort());
  });

  it('rejects heights and widths outside their ranges', () => {
    expect(() => createWallBanner(AGGMAN_LIVERY, ARMS, 23)).toThrow(/24 to 96/);
    expect(() => wallBannerBoxes(AGGMAN_LIVERY, ARMS, 97)).toThrow(/24 to 96/);
    expect(() => createAwning(AGGMAN_LIVERY, 15)).toThrow(/16 to 64/);
  });
});
