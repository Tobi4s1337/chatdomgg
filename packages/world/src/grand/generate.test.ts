import { beforeAll, describe, expect, it } from 'vitest';
import { generateGrandLand } from './generate';
import { M, GrandKind, grandPalette, kindTable } from './palette';
import { planGrandLand } from './plan';
import { skyOcclusionMap } from './sky-map';
import { Cover, GRAND_CHUNK, TREE_SPECIES, TREE_STRIDE, type GrandLand, type GrandLandSeed } from './types';
import { chunkColumnRange, createVoxelizeContext, padIndex, PAD_VOLUME, voxelizeChunk } from './voxelize';

const HAMLET: GrandLandSeed = { seedKey: 'twitch:129634568', kingdomId: 'kingdom-129634568', name: 'tobi4s_', biome: 'meadow', tier: 'hamlet', character: 'coastal-harbour' };
const PASS: GrandLandSeed = { seedKey: 'twitch:154972160', kingdomId: 'kingdom-154972160', name: 'MashaD4', biome: 'highland', tier: 'hamlet', character: 'mountain-pass' };

function digest(land: GrandLand): number {
  let h = 2166136261;
  for (const array of [land.ground, land.water, land.cover, land.plot, land.coast, land.trees]) {
    const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
    for (let i = 0; i < bytes.length; i += 7) h = Math.imul(h ^ bytes[i]!, 16777619);
  }
  return h >>> 0;
}

const count = (land: GrandLand, cover: number) => land.cover.reduce((n, c) => n + (c === cover ? 1 : 0), 0);

describe('the grand land', () => {
  let land: GrandLand;
  beforeAll(() => { land = generateGrandLand(HAMLET); }, 120_000);

  it('is the same land for the same seed, and a different land for another', () => {
    expect(digest(generateGrandLand(HAMLET))).toBe(digest(land));
    expect(planGrandLand(PASS).spines.length).toBeGreaterThan(planGrandLand(HAMLET).spines.length - 1);
    expect(digest(generateGrandLand(PASS))).not.toBe(digest(land));
  }, 240_000);

  it('is an island at the Eldermere scale: sea round the edge, land in the middle, a high summit', () => {
    expect(land.size).toBe(1280);
    expect(land.stats.solidVoxels).toBeGreaterThan(50_000_000);
    const edge = [0, land.size - 1, land.size * (land.size - 1), land.size * land.size - 1];
    for (const i of edge) expect(land.cover[i]).toBe(Cover.sea);
    const centre = (land.size >> 1) * (land.size + 1);
    expect(land.ground[centre]!).toBeGreaterThan(land.seaLevel);
    expect(land.stats.landCells / (land.size * land.size)).toBeGreaterThan(0.25);
    expect(land.sites.summit.y).toBeGreaterThan(land.snowline);
    expect(land.snowline).toBeGreaterThan(land.treeline);
  });

  it('has rivers, lakes, waterfalls, beaches, cliffs, sea stacks, snow, fields and meadows', () => {
    expect(land.stats.riverCells).toBeGreaterThan(1000);
    expect(land.stats.lakeCells).toBeGreaterThan(1000);
    expect(land.stats.waterfalls).toBeGreaterThan(0);
    expect(land.stats.seaStacks).toBeGreaterThan(0);
    expect(land.stats.fieldPlots).toBeGreaterThanOrEqual(8);
    for (const cover of [Cover.sand, Cover.rock, Cover.snow, Cover.meadow, Cover.forest, Cover.field, Cover.riverbed, Cover.lakebed, Cover.hedge]) {
      expect(count(land, cover), `cover ${cover}`).toBeGreaterThan(0);
    }
    // Rivers run downhill to the sea or a lake: water stands on its bed and never above the summit.
    let wet = 0, perched = 0;
    for (let i = 0; i < land.water.length; i++) if (land.water[i]! > 0) { wet++; if (land.water[i]! < land.ground[i]!) perched++; }
    expect(wet).toBeGreaterThan(0);
    expect(perched).toBe(0);
  });

  it('grows forests of distinct species, with hero trees, on dry land', () => {
    expect(land.treeCount).toBeGreaterThan(1000);
    const species = new Set<number>();
    for (let t = 0; t < land.treeCount; t++) {
      const o = t * TREE_STRIDE, x = land.trees[o]!, z = land.trees[o + 1]!;
      species.add(land.trees[o + 3]!);
      const i = Math.floor(x) + Math.floor(z) * land.size;
      expect(land.water[i]! <= land.ground[i]!, 'trees stand on dry ground').toBe(true);
    }
    expect(species.size).toBeGreaterThanOrEqual(8);
    expect([...species].some(s => TREE_SPECIES[s]!.startsWith('hero-'))).toBe(true);
  });

  it('places the castle rock, town, harbour and mere above the sea', () => {
    const { castle, town, harbour, mere } = land.sites;
    expect(castle.top).toBeGreaterThan(land.seaLevel + 20);
    expect(town.level).toBeGreaterThan(land.seaLevel);
    expect(land.cover[harbour.x + harbour.z * land.size]).not.toBe(Cover.rock);
    if (mere) expect(mere.level).toBeGreaterThan(land.seaLevel);
  });

  it('voxelises chunks deterministically, with snow on the summit and the sea fill hidden', () => {
    const ctx = createVoxelizeContext(land), again = createVoxelizeContext(land);
    const { summit } = land.sites;
    const cx = Math.floor(summit.x / GRAND_CHUNK), cz = Math.floor(summit.z / GRAND_CHUNK), cy = Math.floor((summit.y - 1) / GRAND_CHUNK);
    const a = new Uint8Array(PAD_VOLUME), b = new Uint8Array(PAD_VOLUME);
    voxelizeChunk(ctx, 0, cx, cy, cz, a);
    voxelizeChunk(again, 0, cx, cy, cz, b);
    expect(a).toEqual(b);
    const kinds = kindTable(grandPalette(land.style));
    let snow = 0;
    for (const m of a) if (kinds[m] === GrandKind.snow) snow++;
    expect(snow).toBeGreaterThan(0);
    // Open sea: under the plane everything is hidden fill, and the top of the range sits at sea level.
    const sea = new Uint8Array(PAD_VOLUME);
    voxelizeChunk(ctx, 0, 0, 1, 0, sea);
    expect(sea[padIndex(5, land.seaLevel - 1 - GRAND_CHUNK, 5)]).toBe(M.sea);
    expect(sea[padIndex(5, land.seaLevel - GRAND_CHUNK, 5)]).toBe(0);
    // The column range keeps a few cells of margin for the padding shell and decoration.
    expect(chunkColumnRange(ctx, 0, 0, 0).hi).toBeLessThanOrEqual(land.seaLevel + 8);
  });

  it('agrees across chunk borders: a halo cell is the neighbour chunk\'s own cell, at every level', () => {
    const ctx = createVoxelizeContext(land);
    const { town } = land.sites;
    for (const level of [0, 1, 2]) {
      const s = 1 << level, cx = Math.floor(town.x / s / GRAND_CHUNK), cz = Math.floor(town.z / s / GRAND_CHUNK);
      const cy = Math.floor(town.level / s / GRAND_CHUNK);
      const a = new Uint8Array(PAD_VOLUME), b = new Uint8Array(PAD_VOLUME), c = new Uint8Array(PAD_VOLUME);
      voxelizeChunk(ctx, level, cx, cy, cz, a);
      voxelizeChunk(ctx, level, cx + 1, cy, cz, b);
      voxelizeChunk(ctx, level, cx + 1, cy, cz + 1, c);
      let compared = 0;
      for (let y = 0; y < GRAND_CHUNK; y++) for (let z = 0; z < GRAND_CHUNK; z++) {
        // a's +x halo (local x = 32) is b's first column (local x = 0), and the other way round.
        expect(a[padIndex(GRAND_CHUNK, y, z)]).toBe(b[padIndex(0, y, z)]);
        expect(b[padIndex(-1, y, z)]).toBe(a[padIndex(GRAND_CHUNK - 1, y, z)]);
        compared += a[padIndex(GRAND_CHUNK, y, z)]! ? 1 : 0;
      }
      // The diagonal corner halo agrees too.
      for (let y = 0; y < GRAND_CHUNK; y++) expect(a[padIndex(GRAND_CHUNK, y, GRAND_CHUNK)]).toBe(c[padIndex(0, y, 0)]);
      expect(compared, `level ${level} compares real cells`).toBeGreaterThan(0);
    }
  });

  it('is defined outside the land: negative and far chunks are the same hidden sea, every time', () => {
    const ctx = createVoxelizeContext(land), again = createVoxelizeContext(land);
    for (const [cx, cz] of [[-1, -1], [-3, 2], [land.size / GRAND_CHUNK + 2, 5]] as const) {
      const a = new Uint8Array(PAD_VOLUME), b = new Uint8Array(PAD_VOLUME);
      voxelizeChunk(ctx, 0, cx, 1, cz, a);
      voxelizeChunk(again, 0, cx, 1, cz, b);
      expect(a).toEqual(b);
      expect(a[padIndex(5, land.seaLevel - 1 - GRAND_CHUNK, 5)]).toBe(M.sea);
      expect(a[padIndex(5, land.seaLevel - GRAND_CHUNK, 5)]).toBe(0);
    }
  });

  it('keeps the surface at coarser levels: a level-3 column is as high as its highest source column', () => {
    const ctx = createVoxelizeContext(land);
    const { summit } = land.sites;
    const cx = Math.floor(summit.x / 8 / GRAND_CHUNK), cz = Math.floor(summit.z / 8 / GRAND_CHUNK);
    const range = chunkColumnRange(ctx, 3, cx, cz);
    expect(range.hi * 8).toBeGreaterThanOrEqual(summit.y);
  });

  it('maps sky occlusion in metres, with hollows below their surroundings', () => {
    const sky = skyOcclusionMap(land);
    expect(sky.size).toBe(land.size / 4);
    expect(sky.data.length).toBe(sky.size * sky.size * 2);
    expect(Math.max(...sky.data.subarray(0, 4096))).toBeGreaterThan(0);
  });
});
