import { describe, expect, it } from 'vitest';
import { VoxelBlueprintSchema, type VoxelAsset, type VoxelBlueprint } from '@chatdom/shared';
import { meshVoxelChunk, prepareAssetChunks, rasterizeBlueprint } from '../../../../voxel/src/index';
import { createRenderLodAsset } from '../../../../voxel/src/lod';
import { MAT, MATERIALS, STYLES, type StyleKey } from '../../materials';
import { BLUEPRINTS, DRESSING_ROLES, DRESSING_SIZES, createDressing, type DressingForm } from './index';

type Cell = readonly [number, number, number];
const key = (x: number, y: number, z: number) => `${x},${y},${z}`;
const parse = (k: string) => k.split(',').map(Number) as unknown as Cell;
const FLOWERS = { petal: MAT.petal, blue: MAT.blueFlower, gold: MAT.goldLeaf, cream: MAT.cream } as const;
const GREENS = new Set<number>([MAT.leaf, MAT.moss]);
const formOf = (b: VoxelBlueprint) => b.id.slice('dressing-'.length).replace(/^(?:hearth|tide|grove)-/, '') as DressingForm;
const styleOf = (b: VoxelBlueprint) => DRESSING_ROLES[formOf(b)].kit ? b.styleId as StyleKey : undefined;
const KITS = ['hearth', 'tide', 'grove'] as const;
/** The tree, hedge and woodland forms, budgeted as trees (R1). */
const TREES = new Set<DressingForm>(['oak-old-a', 'oak-old-b', 'beech', 'elder-oak', 'pine-windbent', 'fir', 'birch', 'alder', 'sapling-staked', 'bramble-hedge', 'pear-espalier', 'woodland-clump']);
/** The validator's ground-dressing palette: the kit's trim and these, plus a stone (its own for kit forms). */
const PALETTE = [MAT.earth, MAT.bark, MAT.leaf, MAT.moss, MAT.petal, MAT.blueFlower, MAT.grass, MAT.goldLeaf, MAT.cream, MAT.thatch, MAT.terracotta];
const top = (cells: ReadonlyMap<string, number>) => Math.max(...[...cells.keys()].map(k => parse(k)[1]));
/** Cells as one comparable string, so kits and runs can be told apart. */
const signature = (cells: ReadonlyMap<string, number>) => [...cells].sort(([a], [b]) => a.localeCompare(b)).join(';');

/** The final rasterized cells, read from the production rasterizer rather than from the authored boxes. */
function occupancy(asset: VoxelAsset): Map<string, number> {
  const [sx, sy, sz] = asset.size, cells = new Map<string, number>();
  for (let z = 0; z < sz; z++) for (let y = 0; y < sy; y++) for (let x = 0; x < sx; x++) {
    const m = asset.voxels[x + sx * (y + sy * z)]!;
    if (m) cells.set(key(x, y, z), m);
  }
  return cells;
}
const cellsOf = (form: DressingForm, style?: StyleKey) => occupancy(rasterizeBlueprint(createDressing(form, style)));

/** Face-connected groups of the cells that pass `keep`. */
function components(cells: ReadonlyMap<string, number>, keep: (material: number) => boolean = () => true): Cell[][] {
  const todo = new Set([...cells].filter(([, m]) => keep(m)).map(([k]) => k)), groups: Cell[][] = [];
  for (const start of todo) {
    todo.delete(start);
    const group: Cell[] = [], queue = [start];
    while (queue.length) {
      const c = parse(queue.pop()!);
      group.push(c);
      for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as const) {
        const n = key(c[0] + dx, c[1] + dy, c[2] + dz);
        if (todo.delete(n)) queue.push(n);
      }
    }
    groups.push(group);
  }
  return groups;
}

/** The top material of every occupied column of an asset. */
function columnTops(asset: VoxelAsset): number[] {
  const [sx, sy, sz] = asset.size, tops: number[] = [];
  for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) for (let y = sy - 1; y >= 0; y--) {
    const m = asset.voxels[x + sx * (y + sy * z)]!;
    if (m) { tops.push(m); break; }
  }
  return tops;
}

describe('ground-dressing blueprints', () => {
  it('lists the finished forms in R1 order, kit forms Hearth, Tide, Grove', () => {
    expect(BLUEPRINTS.map(b => b.id)).toEqual([
      'dressing-meadow-tufts', 'dressing-wildflowers-petal', 'dressing-wildflowers-blue', 'dressing-wildflowers-gold',
      'dressing-wildflowers-cream', 'dressing-clover-pebbles', 'dressing-seedling-bed', 'dressing-cutting-bed',
      'dressing-hearth-garden-bed', 'dressing-tide-garden-bed', 'dressing-grove-garden-bed',
      'dressing-woodpile', 'dressing-barrels', 'dressing-crates', 'dressing-handcart',
      'dressing-hearth-field-wall', 'dressing-tide-field-wall', 'dressing-grove-field-wall',
      'dressing-hearth-rail-fence', 'dressing-tide-rail-fence', 'dressing-grove-rail-fence',
      'dressing-hearth-back-fence', 'dressing-tide-back-fence', 'dressing-grove-back-fence',
      'dressing-hearth-stepping-stones', 'dressing-tide-stepping-stones', 'dressing-grove-stepping-stones',
      'dressing-oak-old-a', 'dressing-oak-old-b', 'dressing-beech', 'dressing-elder-oak', 'dressing-pine-windbent',
      'dressing-fir', 'dressing-birch', 'dressing-alder', 'dressing-sapling-staked', 'dressing-bramble-hedge',
      'dressing-pear-espalier', 'dressing-woodland-clump',
    ]);
  });

  it.each(BLUEPRINTS.map(b => [b.id, b] as const))('%s is strict, bounded, grounded and cheap', (_, b) => {
    expect(() => VoxelBlueprintSchema.parse(b)).not.toThrow();
    const style = styleOf(b), role = DRESSING_ROLES[formOf(b)], cover = role.band === 'small', kit = STYLES[style ?? 'grove'];
    expect(b).toMatchObject({ version: 1, kind: cover || role.sway === 'canopy' ? 'flora' : 'prop', lattice: 'build', styleId: kit.id, windows: [] });
    const max = DRESSING_SIZES[formOf(b)];
    b.size.forEach((n, axis) => expect(n).toBeLessThanOrEqual(max[axis]!));
    expect(b.boxes.length).toBeLessThanOrEqual(cover ? 400 : 2000);
    const keys = b.boxes.map(box => JSON.stringify(box));
    expect(new Set(keys).size).toBe(keys.length);
    for (const box of b.boxes) {
      expect(box.material).not.toBe(MAT.air);
      box.from.forEach((n, axis) => { expect(n).toBeGreaterThanOrEqual(0); expect(n).toBeLessThan(box.to[axis]!); expect(box.to[axis]!).toBeLessThanOrEqual(b.size[axis]!); });
    }
    const asset = rasterizeBlueprint(b), cells = occupancy(asset);
    // Every cell is written once: the boxes never overlap, so their volumes add up to the occupancy.
    expect(b.boxes.reduce((sum, { from, to }) => sum + (to[0] - from[0]) * (to[1] - from[1]) * (to[2] - from[2]), 0)).toBe(cells.size);
    expect(cells.size).toBeGreaterThan(0);
    for (const group of components(cells)) expect(group.some(c => c[1] === 0), `${b.id} has a floating group`).toBe(true);
    // A one-cell margin of open ground keeps neighbouring cover patches from fusing into a carpet.
    if (cover) for (const k of cells.keys()) { const [x, , z] = parse(k); expect(x > 0 && z > 0 && x < b.size[0] - 1 && z < b.size[2] - 1, k).toBe(true); }
    // Kit forms keep their own kit's stone; natural pieces may use any kit's stone.
    const allowed = new Set<number>([...PALETTE, kit.trim, ...(role.kit ? [kit.stone] : Object.values(STYLES).map(k => k.stone))]);
    for (const m of cells.values()) expect(allowed.has(m)).toBe(true);
    // R1 budgets at the level each form is mounted at: the woodland clump is made for the far hills and is only
    // ever drawn at LOD 4; everything else is measured at full detail.
    const form = formOf(b), far = form === 'woodland-clump';
    let triangles = 0;
    for (const chunk of prepareAssetChunks(far ? createRenderLodAsset(asset, 4, MATERIALS.materials) : asset, MATERIALS.materials, MATERIALS.revision)) triangles += meshVoxelChunk(chunk).indices.length / 3;
    expect(triangles).toBeGreaterThan(0);
    expect(triangles).toBeLessThanOrEqual(cover ? 1500 : far ? 8000 : form === 'elder-oak' ? 40000 : TREES.has(form) ? 24000 : 6000);
    expect(createDressing(formOf(b), style)).toEqual(createDressing(formOf(b), style));
    expect(createDressing(formOf(b), style)).toEqual(b);
  }, 60_000);

  it('fails explicitly for unknown, styled or unfinished forms', () => {
    expect(() => createDressing('dandelions' as DressingForm)).toThrow('Unknown dressing form');
    expect(() => createDressing('meadow-tufts', 'hearth')).toThrow('takes no style');
    expect(() => createDressing('edge-stones', 'hearth')).toThrow('not part of the finished');
    expect(() => createDressing('heather-drift')).toThrow('not part of the finished');
    expect(() => createDressing('garden-bed')).toThrow('kit form');
    expect(() => createDressing('woodpile', 'grove')).toThrow('takes no style');
  });
});

describe('meadow tufts', () => {
  const cells = cellsOf('meadow-tufts');

  it('stays under half a metre so it can stand before a facade', () => {
    expect(Math.max(...[...cells.keys()].map(k => parse(k)[1]))).toBeLessThanOrEqual(3);
  });

  it('is four to seven separate tufts with open ground between them', () => {
    const tufts = components(cells);
    expect(tufts.length).toBeGreaterThanOrEqual(4);
    expect(tufts.length).toBeLessThanOrEqual(7);
    const footprints = tufts.map(t => new Set(t.map(([x, , z]) => `${x},${z}`)).size);
    // Varied sizes, not one stamp repeated.
    expect(Math.max(...footprints)).toBeGreaterThanOrEqual(3 * Math.min(...footprints));
    const ground = [...cells.keys()].filter(k => parse(k)[1] === 0).length;
    expect(ground / (16 * 16)).toBeLessThan(0.45);
  });

  it('uses two greens, with moss only as the lit tips of the taller blades', () => {
    expect(new Set(cells.values())).toEqual(GREENS);
    const moss = [...cells].filter(([, m]) => m === MAT.moss).map(([k]) => parse(k));
    expect(moss.length).toBeLessThan(cells.size * 0.15);
    for (const [x, y, z] of moss) { expect(cells.has(key(x, y + 1, z))).toBe(false); expect(y).toBeGreaterThanOrEqual(2); }
  });
});

describe('wildflowers', () => {
  const colours = Object.keys(FLOWERS) as (keyof typeof FLOWERS)[];

  it('keeps every drift under half a metre, like the tufts', () => {
    for (const colour of colours) expect(Math.max(...[...cellsOf(`wildflowers-${colour}`).keys()].map(k => parse(k)[1]))).toBeLessThanOrEqual(3);
  });

  it('uses one arrangement, recoloured with exactly one flower each', () => {
    const petal = cellsOf('wildflowers-petal');
    for (const colour of colours) {
      const cells = cellsOf(`wildflowers-${colour}`);
      const materials = new Set(cells.values());
      expect([...materials].filter(m => !GREENS.has(m))).toEqual([FLOWERS[colour]]);
      expect([...cells.keys()]).toEqual([...petal.keys()]);
      for (const [k, m] of petal) expect(cells.get(k)).toBe(m === MAT.petal ? FLOWERS[colour] : m);
    }
  });

  it('holds six to twelve 2×2 heads on even cells, each on a leafy stem', () => {
    const cells = cellsOf('wildflowers-petal');
    const flowers = [...cells].filter(([, m]) => m === MAT.petal).map(([k]) => parse(k));
    const heads = components(cells, m => m === MAT.petal);
    for (const cell of flowers) expect(cell[1] === 2 || cell[1] === 3, `${cell.join(',')}`).toBe(true);
    // Heads may touch corner to corner but never share a face, so each is its own component.
    expect(heads.length).toBeGreaterThanOrEqual(6);
    expect(heads.length).toBeLessThanOrEqual(12);
    for (const head of heads) {
      const xs = head.map(c => c[0]), zs = head.map(c => c[2]);
      const [x0, z0] = [Math.min(...xs), Math.min(...zs)];
      expect([x0 % 2, z0 % 2, Math.max(...xs) - x0, Math.max(...zs) - z0]).toEqual([0, 0, 1, 1]);
      // Its whole lower course is present, at most one top corner is open, and a stem holds it up.
      expect(head.filter(c => c[1] === 2).length).toBe(4);
      expect(head.length).toBeGreaterThanOrEqual(7);
      expect(head.filter(c => c[1] === 2).some(([x, , z]) => cells.get(key(x, 1, z)) === MAT.leaf)).toBe(true);
    }
    expect(flowers.length / cells.size).toBeLessThan(0.3);
  });

  it.each(colours)('%s heads survive both render LODs as the top of the drift', colour => {
    const asset = rasterizeBlueprint(createDressing(`wildflowers-${colour}`));
    const flower = FLOWERS[colour];
    const heads = components(occupancy(asset), m => m === flower).length;
    // At LOD 2 each head fills its own coarse cell, so every one of them still shows.
    expect(columnTops(createRenderLodAsset(asset, 2, MATERIALS.materials)).filter(m => m === flower).length).toBe(heads);
    // At LOD 4 the two paired hearts of the drift outvote their leaves.
    expect(columnTops(createRenderLodAsset(asset, 4, MATERIALS.materials)).filter(m => m === flower).length).toBeGreaterThanOrEqual(2);
  });
});

describe('clover and pebbles', () => {
  const cells = cellsOf('clover-pebbles');

  it('lies two cells low at most, with clover in both greens', () => {
    expect(Math.max(...[...cells.keys()].map(k => parse(k)[1]))).toBeLessThanOrEqual(1);
    expect(new Set(cells.values())).toEqual(new Set([MAT.leaf, MAT.moss, MAT.stone]));
    const raised = [...cells].filter(([k, m]) => m !== MAT.stone && parse(k)[1] === 1);
    expect(raised.length).toBeGreaterThanOrEqual(3);
    expect(raised.length).toBeLessThan(10);
  });

  it('beds three or four pebbles of at least 2×2 cells into the lawn', () => {
    const pebbles = components(cells, m => m === MAT.stone);
    expect(pebbles.length).toBeGreaterThanOrEqual(3);
    expect(pebbles.length).toBeLessThanOrEqual(4);
    for (const pebble of pebbles) {
      const ground = pebble.filter(c => c[1] === 0);
      const has = (x: number, z: number) => ground.some(c => c[0] === x && c[2] === z);
      expect(ground.some(([x, , z]) => has(x + 1, z) && has(x, z + 1) && has(x + 1, z + 1))).toBe(true);
    }
  });

  it('keeps the lawn calm: a couple of mats rather than a scatter', () => {
    const mats = components(cells, m => GREENS.has(m));
    expect(mats.length).toBeLessThanOrEqual(3);
    for (const mat of mats) expect(mat.length).toBeGreaterThanOrEqual(8);
  });
});

describe('seedling bed', () => {
  const cells = cellsOf('seedling-bed');
  const seedlings = components(cells, m => m === MAT.leaf || m === MAT.moss);

  it('lies flush: turned earth one course deep, seedlings above it, nothing over three cells', () => {
    expect(Math.max(...[...cells.keys()].map(k => parse(k)[1]))).toBeLessThanOrEqual(2);
    expect(new Set(cells.values())).toEqual(new Set([MAT.earth, MAT.leaf, MAT.moss]));
    for (const [k, m] of cells) if (m !== MAT.earth) expect(parse(k)[1], k).toBeGreaterThanOrEqual(1);
    // One continuous bed of soil under every seedling.
    expect(components(cells, m => m === MAT.earth)).toHaveLength(1);
  });

  it('is part planted: a full back row, a short front row and the heaped soil at its end', () => {
    const rows = new Map<number, number>();
    for (const seedling of seedlings) { const z = Math.round(seedling.reduce((n, c) => n + c[2], 0) / seedling.length); rows.set(z, (rows.get(z) ?? 0) + 1); }
    const [back, front] = [...rows.values()].sort((a, b) => b - a);
    expect(back).toBeGreaterThanOrEqual(5);
    expect(front).toBeLessThan(back!);
    // Every grown seedling is a cross of leaves around a lit heart; one has only just been set.
    expect(seedlings.filter(s => s.some(c => cells.get(key(...c)) === MAT.moss) && s.length === 6).length).toBeGreaterThanOrEqual(7);
    expect(seedlings.filter(s => s.length === 1)).toHaveLength(1);
    expect([...cells].filter(([k, m]) => m === MAT.earth && parse(k)[1] === 1).length).toBeGreaterThanOrEqual(4);
  });
});

describe('cutting bed', () => {
  const cells = cellsOf('cutting-bed');
  const blooms = [MAT.petal, MAT.cream, MAT.goldLeaf] as const;

  it('stands half a metre at most inside one continuous edge of turned earth', () => {
    expect(Math.max(...[...cells.keys()].map(k => parse(k)[1]))).toBeLessThanOrEqual(3);
    expect(new Set(cells.values())).toEqual(new Set([MAT.earth, MAT.leaf, MAT.moss, ...blooms]));
    // One soil edge runs round the whole bed; the rest shows between the plants.
    const [edge] = components(cells, m => m === MAT.earth).sort((a, b) => b.length - a.length);
    expect(Math.min(...edge!.map(c => c[2]))).toBe(1);
    expect(Math.max(...edge!.map(c => c[2]))).toBe(8);
    expect(Math.max(...edge!.map(c => c[0])) - Math.min(...edge!.map(c => c[0]))).toBeGreaterThanOrEqual(20);
    // Every bloom sits on its head courses, held by its stem and leaves.
    for (const [k, m] of cells) if ((blooms as readonly number[]).includes(m)) expect(parse(k)[1], k).toBeGreaterThanOrEqual(2);
  });

  it('is planted in three blocks of one colour, pink then cream then gold, never mixed', () => {
    const heads = blooms.map(m => components(cells, n => n === m).filter(c => c.length >= 6));
    expect(heads.map(list => list.length)).toEqual([5, 4, 5]);
    const spans = heads.map(list => list.flat().map(c => c[0]));
    // Each block keeps to its own run along the bed.
    expect(Math.max(...spans[0]!)).toBeLessThan(Math.min(...spans[1]!));
    expect(Math.max(...spans[1]!)).toBeLessThan(Math.min(...spans[2]!));
  });

  it('shows one head cut for the stall: bare stems with a cut end, and heaped soil', () => {
    const cut = [...cells].filter(([k, m]) => m === MAT.moss && parse(k)[0] >= 13 && parse(k)[0] <= 16);
    expect(cut.length).toBeGreaterThanOrEqual(2);
    expect([...cells].filter(([k, m]) => m === MAT.earth && parse(k)[1] === 1)).toHaveLength(1);
  });
});

describe('stepping stones', () => {
  it.each(['hearth', 'tide', 'grove'] as const)('%s lays three flush stones of its own kit stone with worn joints', style => {
    const cells = cellsOf('stepping-stones', style), stone = STYLES[style].stone;
    // Two courses deep, every column full height, so a bedded stone shows one even top.
    expect(Math.max(...[...cells.keys()].map(k => parse(k)[1]))).toBe(1);
    for (const k of cells.keys()) { const [x, y, z] = parse(k); expect(cells.has(key(x, 1 - y, z)), k).toBe(true); }
    expect(new Set(cells.values())).toEqual(new Set([stone, MAT.earth, MAT.moss]));
    const stones = components(cells, m => m === stone);
    expect(stones).toHaveLength(3);
    // Each is a broad stone of its own shape, not one stamp repeated.
    for (const s of stones) expect(s.length).toBeGreaterThanOrEqual(40);
    expect(new Set(stones.map(s => s.length)).size).toBe(3);
    expect([...cells.values()].filter(m => m !== stone).length).toBeLessThan(24);
  });
});

describe('garden bed', () => {
  const beds = KITS.map(style => cellsOf('garden-bed', style));

  it.each(KITS.map((style, i) => [style, beds[i]!] as const))('%s is a raised bed: a kit edge round soil two courses deep', (style, cells) => {
    const kit = STYLES[style];
    expect(top(cells)).toBeLessThanOrEqual(4);
    // The edge runs right round, two to four cells high, and the soil inside stays below its top.
    for (let x = 0; x < 24; x++) for (let z = 0; z < 12; z++) {
      if (x > 0 && z > 0 && x < 23 && z < 11) continue;
      const h = [0, 1, 2, 3, 4].filter(y => cells.has(key(x, y, z))).length;
      expect(h, `${x},${z}`).toBeGreaterThanOrEqual(2);
      expect(cells.get(key(x, 0, z)), `${x},${z}`).not.toBe(MAT.earth);
    }
    const soil = [...cells].filter(([, m]) => m === MAT.earth).map(([k]) => parse(k));
    expect(soil.filter(c => c[1] === 1).length).toBeGreaterThanOrEqual(100);
    expect(Math.max(...soil.map(c => c[1]))).toBeLessThanOrEqual(2);
    expect([...cells.values()]).toContain(kit.stone);
    if (style !== 'tide') expect([...cells.values()]).toContain(kit.trim);
  });

  it('holds mixed leafy planting with exactly two flower heads and nothing to harvest', () => {
    const flowers = [MAT.petal, MAT.blueFlower, MAT.cream];
    beds.forEach((cells, i) => {
      const leafy = [...cells].filter(([k, m]) => GREENS.has(m) && parse(k)[1] >= 2);
      expect(new Set(leafy.map(([k]) => parse(k)[1])).size).toBe(3);
      expect(leafy.length).toBeGreaterThanOrEqual(60);
      const heads = components(cells, m => m === flowers[i]);
      expect(heads).toHaveLength(2);
      for (const head of heads) { expect(head.length).toBeGreaterThanOrEqual(7); expect(Math.min(...head.map(c => c[1]))).toBe(3); }
      expect([...cells.values()]).not.toContain(MAT.terracotta);
      expect([...cells.values()]).not.toContain(MAT.goldLeaf);
    });
  });

  it('looks different in every kit', () => {
    expect(new Set(beds.map(signature)).size).toBe(3);
    expect(new Set(beds.map(cells => [...cells.keys()].sort().join(';'))).size).toBe(3);
  });
});

describe('woodpile', () => {
  const cells = cellsOf('woodpile');

  it('shows a dozen or more round log ends in end grain on the garden face, some proud and one set back', () => {
    const face = [...cells].filter(([k, m]) => {
      const [x, y, z] = parse(k);
      return (m === MAT.thatch || m === MAT.cream) && z >= 4 && !cells.has(key(x, y, z + 1));
    }).map(([k]) => parse(k));
    const grain = new Set(face.map(c => key(...c)));
    // A log end is a round plus of end grain: its heart has end grain on all four sides at the same depth.
    const hearts = face.filter(([x, y, z]) => [[1, 0], [-1, 0], [0, 1], [0, -1]].every(([dx, dy]) => grain.has(key(x + dx!, y + dy!, z))));
    expect(hearts.length).toBeGreaterThanOrEqual(12);
    expect(new Set(hearts.map(c => c[2])).size).toBe(3);
    expect(face.some(c => cells.get(key(...c)) === MAT.cream)).toBe(true);
  });

  it('sits under a bark lean-to that falls from posts against the wall to an eave at the garden', () => {
    const roofAt = (z: number) => Math.max(...[...cells.keys()].map(parse).filter(c => c[2] === z).map(c => c[1]));
    expect(roofAt(0)).toBe(11);
    expect(roofAt(6)).toBeLessThan(roofAt(0) - 1);
    for (const x of [0, 19]) for (let y = 0; y <= 10; y++) expect(cells.get(key(x, y, 0)), `${x},${y}`).toBe(MAT.bark);
    expect([...cells].filter(([k]) => parse(k)[1] === 11).every(([k, m]) => parse(k)[2] <= 2 && (m === MAT.bark || m === MAT.moss))).toBe(true);
  });
});

describe('barrels', () => {
  const cells = cellsOf('barrels');
  const barrels = components(cells);

  it('is two separate closed barrels with iron hoops and a bulging belly', () => {
    expect(barrels).toHaveLength(2);
    expect(new Set(cells.values())).toEqual(new Set([MAT.thatch, MAT.bark, MAT.darkStone]));
    for (const barrel of barrels) {
      const hoops = new Set(barrel.filter(c => cells.get(key(...c)) === MAT.darkStone).map(c => c[1]));
      expect(hoops.size).toBeGreaterThanOrEqual(3);
      const layer = (y: number) => barrel.filter(c => c[1] === y);
      const ys = barrel.map(c => c[1]), [y0, y1] = [Math.min(...ys), Math.max(...ys)];
      const width = (y: number) => new Set(layer(y).map(c => c[0])).size;
      expect(width(Math.round((y0 + y1) / 2))).toBeGreaterThan(width(y1));
      expect(width(Math.round((y0 + y1) / 2))).toBeGreaterThan(width(y0));
      // The lid is whole and flush: its rows and columns run unbroken, and it lies on solid barrel.
      const lid = layer(y1);
      for (const axis of [0, 2] as const) {
        const lines = new Map<number, number[]>();
        for (const c of lid) { const across = axis ? c[0] : c[2]; lines.set(across, [...(lines.get(across) ?? []), c[axis]]); }
        for (const line of lines.values()) expect(Math.max(...line) - Math.min(...line) + 1).toBe(line.length);
      }
      for (const [x, y, z] of lid) expect(cells.has(key(x, y - 1, z))).toBe(true);
    }
    // One is shorter and set forward of the other.
    const heights = barrels.map(b => Math.max(...b.map(c => c[1])));
    const fronts = barrels.map(b => Math.min(...b.map(c => c[2])));
    expect(heights[0]).not.toBe(heights[1]);
    expect(fronts[0]).not.toBe(fronts[1]);
  });
});

describe('crates', () => {
  const cells = cellsOf('crates');

  it('stacks two closed, battened crates, the top one smaller and offset', () => {
    const lid = (y: number) => [...cells.keys()].map(parse).filter(c => c[1] === y && cells.get(key(...c)) !== MAT.cream);
    const [bottom, upper] = [lid(5), lid(10)];
    const span = (list: readonly Cell[], axis: 0 | 2) => [Math.min(...list.map(c => c[axis])), Math.max(...list.map(c => c[axis]))];
    // Both lids are whole rectangles.
    for (const list of [bottom, upper]) {
      const [[x0, x1], [z0, z1]] = [span(list, 0), span(list, 2)];
      expect(list.length).toBe((x1! - x0! + 1) * (z1! - z0! + 1));
    }
    expect(span(upper, 0)).not.toEqual(span(bottom, 0));
    expect(span(upper, 2)).not.toEqual(span(bottom, 2));
    expect([...cells.values()].filter(m => m === MAT.bark).length).toBeGreaterThanOrEqual(60);
  });

  it('has a tied sack slumped on the ground beside them', () => {
    // The sack and its tie are one piece: body, straw cord, then the tuft of the neck above it.
    const sacks = components(new Map([...cells].filter(([k, m]) => parse(k)[0] >= 7 && (m === MAT.cream || m === MAT.thatch))));
    expect(sacks).toHaveLength(1);
    expect(sacks[0]!.some(c => c[1] === 0)).toBe(true);
    expect(sacks[0]!.length).toBeGreaterThanOrEqual(40);
    const tie = [...cells].filter(([, m]) => m === MAT.thatch).map(([k]) => parse(k)).filter(c => c[0] >= 7);
    expect(tie.length).toBeGreaterThanOrEqual(2);
    expect(tie.every(([x, y, z]) => y >= 3 && [[0, 1, 0], [0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]].some(([dx, dy, dz]) => cells.get(key(x + dx!, y + dy!, z + dz!)) === MAT.cream))).toBe(true);
  });
});

describe('handcart', () => {
  const cells = cellsOf('handcart');

  it('stands on two iron-tyred wheels at its sides, its legs and its shafts', () => {
    for (const side of [[0, 1], [10, 11]]) {
      const wheel = components(new Map([...cells].filter(([k]) => side.includes(parse(k)[2]))));
      expect(wheel).toHaveLength(1);
      expect(wheel[0]!.length).toBeGreaterThanOrEqual(40);
      const ground = wheel[0]!.filter(c => c[1] === 0);
      expect(ground.length).toBeGreaterThanOrEqual(3);
      for (const c of ground) expect(cells.get(key(...c))).toBe(MAT.darkStone);
    }
    // The shafts run down to the ground at the front, and two legs hold the box.
    for (const z of [3, 8]) {
      expect(cells.has(key(23, 0, z))).toBe(true);
      expect(Math.max(...[...cells.keys()].map(parse).filter(c => c[2] === z && c[0] === 23).map(c => c[1]))).toBeLessThanOrEqual(1);
      expect(cells.has(key(13, 0, z))).toBe(true);
    }
  });

  it('is empty except for one sack', () => {
    // Everything in the box above its floor is one tied sack.
    const inside = new Map([...cells].filter(([k]) => { const [x, y, z] = parse(k); return x > 1 && x < 14 && z > 3 && z < 8 && y >= 7; }));
    expect(components(inside)).toHaveLength(1);
    expect(new Set(inside.values())).toEqual(new Set([MAT.cream, MAT.thatch]));
    expect([...cells.values()].filter(m => m === MAT.cream).length).toBeGreaterThanOrEqual(20);
  });
});

/** Whether a cell of a run's left end is buried in the run before it: occupied there, its open faces covered. */
function buried(cells: ReadonlyMap<string, number>, pitch: number) {
  const bad: string[] = [];
  for (const k of cells.keys()) {
    const [x, y, z] = parse(k);
    if (x >= 2) continue;
    if (!cells.has(key(x + pitch, y, z))) { bad.push(`${k} outside`); continue; }
    for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as const) {
      if (y + dy < 0 || cells.has(key(x + dx, y + dy, z + dz))) continue;
      if (x + dx + pitch >= 32 || !cells.has(key(x + dx + pitch, y + dy, z + dz))) bad.push(`${k} face ${dx},${dy},${dz}`);
    }
  }
  return bad;
}

describe('field wall', () => {
  const walls = KITS.map(style => cellsOf('field-wall', style));

  it.each(KITS.map((style, i) => [style, walls[i]!] as const))('%s hides its left end inside the run before it, face for face', (_, cells) => {
    expect(buried(cells, 30)).toEqual([]);
    expect([...cells.keys()].some(k => parse(k)[0] < 2)).toBe(true);
  });

  it.each(KITS.map((style, i) => [style, walls[i]!] as const))('%s is battered, uneven on top and mossy', (style, cells) => {
    const at = (y: number, x: number) => [0, 1, 2, 3, 4].filter(z => cells.has(key(x, y, z))).length;
    const heights = new Set<number>();
    for (let x = 4; x < 28; x++) {
      expect(at(0, x)).toBe(5);
      expect(at(5, x)).toBeLessThanOrEqual(3);
      heights.add(Math.max(...[0, 1, 2, 3, 4].map(z => [0, 1, 2, 3, 4, 5, 6].filter(y => cells.has(key(x, y, z))).length).map((h, z) => h * 10 + z)));
    }
    expect(heights.size).toBeGreaterThanOrEqual(2);
    // Rounded ends: both ends are lower and narrower than the body.
    expect(at(0, 0)).toBeLessThan(5);
    expect(at(4, 31)).toBeLessThan(at(4, 15) + 1);
    const moss = [...cells].filter(([, m]) => m === MAT.moss).map(([k]) => parse(k));
    expect(moss.length).toBeGreaterThanOrEqual(style === 'grove' ? 40 : 6);
    for (const [x, y, z] of moss) expect(cells.has(key(x, y + 1, z)), `${x},${y},${z}`).toBe(false);
    expect([...cells.values()].filter(m => m === STYLES[style].stone).length).toBeGreaterThan(cells.size * 0.8);
  });

  it('wears a different top in every kit', () => {
    expect(new Set(walls.map(signature)).size).toBe(3);
    expect(new Set(walls.map(cells => [...cells.keys()].sort().join(';'))).size).toBe(3);
  });
});

describe('rail fence', () => {
  const fences = KITS.map(style => cellsOf('rail-fence', style));

  it.each(KITS.map((style, i) => [style, fences[i]!] as const))('%s stacks its left rail ends on the run before it', (_, cells) => {
    const ends = [...cells.keys()].map(parse).filter(c => c[0] < 2);
    expect(ends.length).toBeGreaterThan(0);
    for (const [x, y, z] of ends) {
      expect(cells.has(key(x + 30, y, z)), `${x},${y},${z}`).toBe(false);
      expect(cells.has(key(x + 30, y - 1, z)), `${x},${y},${z} rests`).toBe(true);
    }
    // The run before ends against its post, so the stacked ends rest beside it.
    for (const [, y, z] of ends) expect([...cells.keys()].map(parse).some(c => c[0] === 29 && c[2] === z && c[1] >= y - 1)).toBe(true);
  });

  it.each(KITS.map((style, i) => [style, fences[i]!] as const))('%s has two or three rails on leaning posts', (style, cells) => {
    const rails = [...cells.keys()].map(parse).filter(c => c[0] === 15).map(c => c[1]);
    expect(new Set(rails).size).toBe(style === 'tide' ? 2 : 3);
    // A post cell has the post above and below it; a rail cell does not.
    const post = [...cells.keys()].map(parse).filter(([x, y, z]) => z === 1 && cells.has(key(x, y - 1, z)) && cells.has(key(x, y + 1, z)));
    for (const base of [2, 27]) {
      const xAt = (y: number) => Math.min(...post.filter(c => c[1] === y && c[0] >= base && c[0] <= base + 2).map(c => c[0]));
      expect(xAt(2)).toBe(base);
      expect(xAt(7)).toBe(base + 1);
    }
  });

  it('differs in every kit', () => expect(new Set(fences.map(signature)).size).toBe(3));
});

describe('back fence', () => {
  const fences = KITS.map(style => cellsOf('back-fence', style));

  it.each(KITS.map((style, i) => [style, fences[i]!] as const))('%s has a post every 2 m and both ends, two rails behind and pales in front', (style, cells) => {
    for (const x of [0, 16, 32, 48, 63]) for (let y = 0; y < 8; y++) for (let z = 0; z < 3; z++) expect(cells.has(key(x, y, z)), `${x},${y},${z}`).toBe(true);
    const posts = new Set<number>();
    for (let x = 0; x < 64; x++) if (cells.has(key(x, 4, 0))) posts.add(x);
    expect([...posts]).toEqual([0, 1, 16, 17, 32, 33, 48, 49, 62, 63]);
    // Rails run the whole 8 m on the house side, at two heights.
    const rails = [0, 1, 2, 3, 4, 5, 6, 7, 8].filter(y => Array.from({ length: 64 }, (_, x) => x).every(x => cells.has(key(x, y, 2))));
    expect(rails).toHaveLength(2);
    for (const y of rails) for (let x = 0; x < 64; x++) if (!posts.has(x)) expect(cells.get(key(x, y, 2))).toBe(STYLES[style].trim);
    const pales = Array.from({ length: 64 }, (_, x) => x).filter(x => !posts.has(x) && cells.has(key(x, 6, 1)));
    expect(pales.length).toBeGreaterThanOrEqual(20);
    expect(pales.every(x => !cells.has(key(x, 3, 2 + 1)))).toBe(true);
    expect(top(cells)).toBeLessThanOrEqual(8);
  });

  it('is painted, arched or rustic by kit', () => {
    expect(new Set(fences.map(signature)).size).toBe(3);
    expect([...fences[1]!.values()]).toContain(MAT.cream);
    const tops = fences.map(cells => new Set(Array.from({ length: 12 }, (_, i) => i + 4).map(x => top(new Map([...cells].filter(([k]) => parse(k)[0] === x && parse(k)[2] === 1))))));
    expect(tops[0]!.size).toBeGreaterThanOrEqual(2);
  });
});
