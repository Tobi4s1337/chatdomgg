import { describe, expect, it } from 'vitest';
import { VoxelBlueprintSchema } from '@chatdom/shared';
import { createForgeHearth, FORGE_HEARTH_CHIMNEY_NOSE, FORGE_HEARTH_FLAME } from './index';

describe('forge hearth', () => {
  it.each(['hearth', 'tide', 'grove'] as const)('is grounded with open fire and nose anchors in %s', style => {
    const blueprint = VoxelBlueprintSchema.parse(createForgeHearth(style));
    const [w, h, d] = blueprint.size, cells = new Uint8Array(w * h * d);
    const index = (x: number, y: number, z: number) => x + w * (y + h * z);
    for (const box of blueprint.boxes) for (let z = box.from[2]; z < box.to[2]; z++)
      for (let y = box.from[1]; y < box.to[1]; y++) for (let x = box.from[0]; x < box.to[0]; x++)
        cells[index(x, y, z)] = box.material;
    for (const [x, y, z] of [FORGE_HEARTH_FLAME, FORGE_HEARTH_CHIMNEY_NOSE]) expect(cells[index(x, y, z)]).toBe(0);
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
