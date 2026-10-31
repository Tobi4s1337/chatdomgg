import { describe, expect, it } from 'vitest';
import { MAT } from '../../../content/src/materials';
import { VoxelBlueprintSchema, type VoxelBlueprint } from '../deps';
import { composeDrapedPlinth, createEmoteDrape } from './drape';
import { layoutEmotePlinth } from './statue';

const LIVERY = { cloth: MAT.fabricMutedRed, cord: MAT.fabricGold };
const PLINTH = { footing: MAT.darkStone, body: MAT.limestone, cap: MAT.stone, plate: MAT.brass };

/** Rasterises a blueprint (later boxes overwrite earlier ones) into a dense grid. */
function grid(blueprint: VoxelBlueprint): { at(x: number, y: number, z: number): number } {
  const [w, h, d] = blueprint.size, cells = new Uint16Array(w * h * d);
  for (const box of blueprint.boxes) {
    for (let y = box.from[1]; y < box.to[1]; y++) for (let z = box.from[2]; z < box.to[2]; z++) for (let x = box.from[0]; x < box.to[0]; x++) cells[x + w * (z + d * y)] = box.material;
  }
  return { at: (x, y, z) => cells[x + w * (z + d * y)]! };
}

describe('a withdrawn carving leaves its plinth under cloth', () => {
  it('drapes a generic form sized only by the old frame, on the same plinth, in the given cloth', () => {
    const size = [40, 44, 4] as const;
    const drape = createEmoteDrape(size, LIVERY, 'drape.test');
    expect(VoxelBlueprintSchema.safeParse(drape).success).toBe(true);
    expect(drape.size).toEqual([44, 44, 10]);
    expect(new Set(drape.boxes.map(b => b.material))).toEqual(new Set([LIVERY.cloth, LIVERY.cord]));
    // Deterministic, and nothing but the size (and the fold seed) shapes it.
    expect(createEmoteDrape(size, LIVERY, 'drape.test')).toEqual(drape);
    expect(createEmoteDrape(size, LIVERY, 'drape.test', 3).boxes).not.toEqual(drape.boxes);

    const cells = grid(drape), [W, H, D] = drape.size;
    const row = (y: number) => { let n = 0; for (let x = 0; x < W; x++) for (let z = 0; z < D; z++) if (cells.at(x, y, z)) n++; return n; };
    const span = (y: number) => { let lo = W, hi = -1; for (let x = 0; x < W; x++) for (let z = 0; z < D; z++) if (cells.at(x, y, z)) { lo = Math.min(lo, x); hi = Math.max(hi, x); } return hi - lo + 1; };
    // The hem pools wider than the body, the crown is domed, and the very top still carries cloth.
    expect(span(0)).toBeGreaterThan(span(16));
    expect(span(H - 1)).toBeLessThan(span(16) / 2);
    expect(row(H - 1)).toBeGreaterThan(0);
    // The cord is tied round the cinch and its ends hang at the front.
    const cordY = Math.round(H * .4);
    let cord = 0;
    for (let x = 0; x < W; x++) for (let z = 0; z < D; z++) if (cells.at(x, cordY, z) === LIVERY.cord) cord++;
    expect(cord).toBeGreaterThan(span(16));
    let tassel = 0;
    for (let y = 0; y < cordY - 1; y++) for (let x = 0; x < W; x++) if (cells.at(x, y, D - 1) === LIVERY.cord || cells.at(x, y, D - 2) === LIVERY.cord) tassel++;
    expect(tassel).toBeGreaterThan(4);
    // Pleats: the front face is not one flat plane below the crown.
    const fronts = new Set<number>();
    for (let x = 4; x < W - 4; x++) { let z = D - 1; while (z > 0 && !cells.at(x, 10, z)) z--; fronts.add(z); }
    expect(fronts.size).toBeGreaterThan(1);

    // On the very plinth the statue stood on: same footprint and height as before.
    const layout = layoutEmotePlinth(size, PLINTH, 'plinth.test');
    const composed = composeDrapedPlinth(layout, drape, 'draped.test');
    expect(VoxelBlueprintSchema.safeParse(composed).success).toBe(true);
    expect(composed.size).toEqual([layout.footprintCells[0], layout.heightCells, layout.footprintCells[1]]);
    expect(() => createEmoteDrape([40, 8, 4], LIVERY, 'too.short')).toThrow();
  });
});
