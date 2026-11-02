import { describe, expect, it } from 'vitest';
import { VoxelBlueprintSchema } from '@chatdom/shared';
import {
  createForgeLedgerWall, FORGE_LEDGER_WALL_HEADER, FORGE_LEDGER_WALL_NICHES, FORGE_LEDGER_WALL_PIVOT,
  FORGE_LEDGER_WALL_SIZE,
} from './ledger-wall';

const STYLE_KEYS = ['hearth', 'tide', 'grove'] as const;

function occupancy(style: (typeof STYLE_KEYS)[number]) {
  const blueprint = VoxelBlueprintSchema.parse(createForgeLedgerWall(style));
  const [w, h, d] = blueprint.size, cells = new Uint8Array(w * h * d);
  const index = (x: number, y: number, z: number) => x + w * (y + h * z);
  for (const box of blueprint.boxes) for (let z = box.from[2]; z < box.to[2]; z++)
    for (let y = box.from[1]; y < box.to[1]; y++) for (let x = box.from[0]; x < box.to[0]; x++)
      cells[index(x, y, z)] = box.material;
  const at = (x: number, y: number, z: number) =>
    x < 0 || y < 0 || z < 0 || x >= w || y >= h || z >= d ? 0 : cells[index(x, y, z)]!;
  return { blueprint, cells, index, at, w, h, d };
}

/** A front-facing board: solid just behind the plane across its whole area, open just in front. */
function expectFrontBoard(at: (x: number, y: number, z: number) => number,
  centre: readonly [number, number, number], size: readonly [number, number]) {
  const plane = centre[2];
  expect(Number.isInteger(plane)).toBe(true);
  for (let x = centre[0] - size[0] / 2; x < centre[0] + size[0] / 2; x++)
    for (let y = centre[1] - size[1] / 2; y < centre[1] + size[1] / 2; y++) {
      expect(Number.isInteger(x) && Number.isInteger(y)).toBe(true);
      expect(at(x, y, plane - 1)).not.toBe(0);
      expect(at(x, y, plane)).toBe(0);
    }
}

describe('forge ledger wall', () => {
  it('rejects unknown styles', () => {
    expect(() => createForgeLedgerWall('ash' as never)).toThrow(/Unknown forge ledger wall style/);
  });

  it('has the same shape in every kit', () => {
    const shape = (style: (typeof STYLE_KEYS)[number]) => {
      const { cells } = occupancy(style);
      return Array.from(cells, material => (material ? 1 : 0)).join('');
    };
    expect(shape('tide')).toBe(shape('hearth'));
    expect(shape('grove')).toBe(shape('hearth'));
  });

  it('lists twelve niches in reading order as seen from the front', () => {
    expect(FORGE_LEDGER_WALL_NICHES).toHaveLength(12);
    expect(FORGE_LEDGER_WALL_NICHES.map(niche => niche.index)).toEqual([...Array(12).keys()]);
    for (const niche of FORGE_LEDGER_WALL_NICHES) {
      const row = Math.floor(niche.index / 4), column = niche.index % 4;
      if (column > 0) expect(niche.floor[0]).toBeGreaterThan(FORGE_LEDGER_WALL_NICHES[niche.index - 1]!.floor[0]);
      if (column > 0) expect(niche.floor[1]).toBe(FORGE_LEDGER_WALL_NICHES[niche.index - 1]!.floor[1]);
      if (row > 0) expect(niche.floor[1]).toBeLessThan(FORGE_LEDGER_WALL_NICHES[niche.index - 4]!.floor[1]);
      expect(niche.size[0]).toBeGreaterThanOrEqual(7);
      expect(niche.size[1]).toBeGreaterThanOrEqual(7);
      expect(niche.size[2]).toBeGreaterThanOrEqual(3);
      expect(niche.plaque.size[0]).toBeGreaterThanOrEqual(7);
      expect(niche.plaque.size[1]).toBeGreaterThanOrEqual(2);
      expect(niche.plaque.centre[1]).toBeLessThan(niche.floor[1]);
    }
    expect(FORGE_LEDGER_WALL_HEADER.size[0]).toBeGreaterThanOrEqual(24);
    expect(FORGE_LEDGER_WALL_HEADER.size[1]).toBeGreaterThanOrEqual(4);
  });

  it.each(STYLE_KEYS)('is grounded, open in every niche and boarded for plaques in %s', style => {
    const { blueprint, cells, index, at, w, h, d } = occupancy(style);
    expect(blueprint.id).toBe(`civic-forge-ledger-wall-${style}`);
    expect(blueprint.kind).toBe('prop');
    expect(blueprint.size).toEqual([...FORGE_LEDGER_WALL_SIZE]);
    expect(blueprint.boxes.length).toBeLessThan(400);
    expect(FORGE_LEDGER_WALL_PIVOT[1]).toBe(0);
    expect(at(Math.floor(FORGE_LEDGER_WALL_PIVOT[0]), 0, Math.floor(FORGE_LEDGER_WALL_PIVOT[2]))).not.toBe(0);

    for (const niche of FORGE_LEDGER_WALL_NICHES) {
      const [fx, fy, fz] = niche.floor, [sw, sh, sd] = niche.size;
      for (let x = fx - sw / 2; x < fx + sw / 2; x++) for (let y = fy; y < fy + sh; y++)
        for (let z = fz - sd / 2; z < fz + sd / 2; z++) {
          expect(Number.isInteger(x) && Number.isInteger(z)).toBe(true);
          expect(at(x, y, z)).toBe(0);
        }
      expect(at(Math.floor(fx), fy - 1, Math.floor(fz))).not.toBe(0);
      expectFrontBoard(at, niche.plaque.centre, niche.plaque.size);
    }
    expectFrontBoard(at, FORGE_LEDGER_WALL_HEADER.centre, FORGE_LEDGER_WALL_HEADER.size);

    const seen = new Uint8Array(cells.length), queue: number[] = [];
    for (let z = 0; z < d; z++) for (let x = 0; x < w; x++) {
      const i = index(x, 0, z); if (cells[i]) { seen[i] = 1; queue.push(i); }
    }
    for (let head = 0; head < queue.length; head++) {
      const i = queue[head]!, x = i % w, y = Math.floor(i / w) % h, z = Math.floor(i / (w * h));
      for (const [nx, ny, nz] of [[x-1,y,z],[x+1,y,z],[x,y-1,z],[x,y+1,z],[x,y,z-1],[x,y,z+1]]) {
        if (nx! < 0 || ny! < 0 || nz! < 0 || nx! >= w || ny! >= h || nz! >= d) continue;
        const n = index(nx!, ny!, nz!); if (cells[n] && !seen[n]) { seen[n] = 1; queue.push(n); }
      }
    }
    expect(queue.length).toBe(cells.filter(Boolean).length);
  });
});
