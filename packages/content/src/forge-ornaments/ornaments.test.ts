import { describe, expect, it } from 'vitest';
import { createForgeOrnament, type ForgeOrnament } from './index';
import type { StyleKey } from '../materials';

const ids: ForgeOrnament[] = ['sleeping-fox', 'sunflower', 'scallop-shell', 'shooting-star'];
const families: StyleKey[] = ['hearth', 'tide', 'grove'];

describe('Forge ornaments', () => {
  for (const revision of [1, 2]) for (const id of ids) for (const family of families) it(`${id} in ${family} (revision ${revision}) is bounded and connected to its mount`, () => {
    const model = createForgeOrnament(id, family, revision);
    const cells = new Set<string>();
    const key = (x:number,y:number,z:number) => `${x},${y},${z}`;
    for (const {from, to} of model.boxes) {
      for (let axis=0; axis<3; axis++) {
        expect(from[axis]).toBeGreaterThanOrEqual(0);
        expect(to[axis]).toBeLessThanOrEqual(model.size[axis]!);
        expect(to[axis]).toBeGreaterThan(from[axis]!);
      }
      for (let x=from[0];x<to[0];x++) for (let y=from[1];y<to[1];y++) for (let z=from[2];z<to[2];z++) cells.add(key(x,y,z));
    }
    const start = key(...model.mount);
    expect(cells.has(start)).toBe(true);
    const seen = new Set([start]); const queue = [model.mount];
    for (let i=0;i<queue.length;i++) {
      const [x,y,z] = queue[i]!;
      for (const [dx,dy,dz] of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]]) {
        const next: [number,number,number] = [x+dx!,y+dy!,z+dz!]; const k = key(...next);
        if (cells.has(k) && !seen.has(k)) { seen.add(k); queue.push(next); }
      }
    }
    expect(seen.size).toBe(cells.size);
  });
  for (const id of ids) it(`${id} has distinct native treatments`, () => {
    expect(new Set(families.map(f => JSON.stringify(createForgeOrnament(id, f).boxes))).size).toBe(3);
  });
});
