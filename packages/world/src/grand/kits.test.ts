import { describe, expect, it } from 'vitest';
import { composeStructures, GRAND_KITS, landMaterials, placeBoxes } from './kits';
import { M } from './palette';
import { createVoxelizeContext, padIndex, PAD_VOLUME, voxelizeChunk, chunkColumnRange } from './voxelize';
import { Cover, STRUCTURE_STRIDE, type GrandComposeInput, type GrandKitPiece, type GrandLand } from './types';

const tower: GrandKitPiece = { id: 'tower', anchors: { top: [0, 40, 0] }, boxes: [
  { min: [0, 0, 0], size: [4, 40, 2], colour: '#B1A38E' },
  { min: [0, 40, 0], size: [4, 2, 2], colour: '#4d597e' },
] };

function flatLand(): GrandLand {
  const size = 256, n = size * size;
  const ground = new Uint16Array(n).fill(60);
  const land = {
    seed: { seedKey: 'test', kingdomId: 'test', name: 'test', biome: 'meadow', tier: 'hamlet', character: 'coastal-harbour' },
    style: { stone: 'granite', grass: 'summer', hueDrift: 0, autumn: 0 },
    size, height: 384, seaLevel: 48, snowline: 300, treeline: 250, ground, water: new Uint16Array(n), cover: new Uint8Array(n).fill(Cover.grass),
    plot: new Uint16Array(n), plots: [], coast: new Int8Array(n).fill(100), trees: new Float32Array(0), treeCount: 0,
    sites: { castle: { x: 0, z: 0, radius: 1, top: 60 }, town: { x: 0, z: 0, rx: 1, rz: 1, angle: 0, level: 60 }, harbour: { x: 0, z: 0, facing: 0 }, headland: { x: 0, z: 0, y: 48 }, mere: null, fields: { x: 0, z: 0, radius: 1 }, summit: { x: 0, z: 0, y: 60 }, focus: [] },
    stats: { size, solidVoxels: 0, trees: 0, treesBySpecies: {}, riverCells: 0, lakeCells: 0, waterfalls: 0, fieldPlots: 0, seaStacks: 0, landCells: 0, millis: 0 },
  } as unknown as GrandComposeInput;
  const placed = composeStructures(land, { trees: GRAND_KITS.trees, compose: [() => [{ piece: tower, at: [100, 60, 100], turns: 1 }]] });
  return { ...land, structures: placed.boxes, structureCount: placed.count, structureColours: placed.colours };
}

describe('grand dressing kits', () => {
  it('places pieces with quarter turns, shared colour slots and clipping to the land', () => {
    const placed = placeBoxes([{ piece: tower, at: [10, 5, 10], turns: 1 }, { piece: tower, at: [254, 0, 0], turns: 0 }], 256, 384);
    expect(placed.colours).toEqual(['#b1a38e', '#4d597e']);
    // One turn maps (x, z) → (−z − sz, x): the 4×2 footprint becomes 2×4 west of the origin.
    expect([...placed.boxes.subarray(0, STRUCTURE_STRIDE)]).toEqual([8, 5, 10, 10, 45, 14, M.structureBase]);
    // The second tower is clipped at the land's edge.
    expect(placed.boxes[2 * STRUCTURE_STRIDE + 3]).toBe(256);
  });

  it('voxelises placed pieces over the terrain at every level and raises the column range', () => {
    const land = flatLand(), ctx = createVoxelizeContext(land);
    const out = new Uint8Array(PAD_VOLUME);
    voxelizeChunk(ctx, 0, 3, 2, 3, out);
    // The tower (turned) covers x 98..99, z 100..103, y 60..99; chunk (3,2,3) holds y 64..95.
    expect(out[padIndex(98 - 96, 70 - 64, 101 - 96)]).toBe(M.structureBase);
    expect(out[padIndex(97 - 96, 70 - 64, 101 - 96)]).toBe(0);
    expect(chunkColumnRange(ctx, 0, 3, 3).hi).toBeGreaterThanOrEqual(102);
    const coarse = new Uint8Array(PAD_VOLUME);
    voxelizeChunk(ctx, 3, 0, 0, 0, coarse);
    expect(coarse[padIndex(12, 8, 12)]).toBe(M.structureBase);
    expect(landMaterials(land).find(m => m.id === M.structureBase + 1)?.colour).toBe('#4d597e');
  });
});
