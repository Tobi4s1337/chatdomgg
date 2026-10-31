import { describe, expect, it } from 'vitest';
import { VoxelBlueprintSchema } from '@chatdom/shared';
import { createForgeHearth, FORGE_HEARTH_PIVOT } from '../forge-square';
import { createForgeWorkshop, FORGE_WORKSHOP_HEARTH_PIVOT } from './index';

describe('forge workshop', () => {
  it.each(['hearth', 'tide', 'grove'] as const)('supports its structure and clears the existing %s hearth', style => {
    const model = VoxelBlueprintSchema.parse(createForgeWorkshop(style));
    const [w, h, d] = model.size, cells = new Uint8Array(w * h * d);
    const index = (x: number, y: number, z: number) => x + w * (y + h * z);
    for (const b of model.boxes) for (let z = b.from[2]; z < b.to[2]; z++)
      for (let y = b.from[1]; y < b.to[1]; y++) for (let x = b.from[0]; x < b.to[0]; x++)
        cells[index(x, y, z)] = b.material;
    const hearth = createForgeHearth(style);
    const offset = FORGE_WORKSHOP_HEARTH_PIVOT.map((n, i) => n - FORGE_HEARTH_PIVOT[i]!);
    const hearthCells = new Uint8Array(hearth.size[0] * hearth.size[1] * hearth.size[2]);
    const hi = (x: number, y: number, z: number) => x + hearth.size[0] * (y + hearth.size[1] * z);
    for (const b of hearth.boxes) for (let z = b.from[2]; z < b.to[2]; z++)
      for (let y = b.from[1]; y < b.to[1]; y++) for (let x = b.from[0]; x < b.to[0]; x++)
        hearthCells[hi(x, y, z)] = b.material;
    for (let z = 0; z < hearth.size[2]; z++) for (let y = 0; y < hearth.size[1]; y++)
      for (let x = 0; x < hearth.size[0]; x++) if (hearthCells[hi(x, y, z)])
        expect(cells[index(x + offset[0]!, y, z + offset[2]!)]).toBe(0);
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
