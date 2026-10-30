import { describe, expect, it } from 'vitest';
import { createForgeMotif, type ForgeMotif } from './index';
import type { StyleKey } from '../materials';

describe('forge motifs', () => {
  for (const motif of ['sleeping-dragon','crescent-moon','watchful-owl'] as ForgeMotif[]) for (const style of ['hearth','tide','grove'] as StyleKey[]) it(`${style} ${motif} is bounded and connected to its mount`, () => {
    const {size,boxes,mount} = createForgeMotif(motif,style);
    expect(boxes.length).toBeLessThan(400);
    const cells = new Set<string>();
    const key = (x:number,y:number,z:number) => `${x},${y},${z}`;
    for (const {from,to,material} of boxes) {
      for (let i=0;i<3;i++) { expect(from[i]).toBeGreaterThanOrEqual(0); expect(to[i]).toBeLessThanOrEqual(size[i]!); expect(to[i]).toBeGreaterThan(from[i]!); }
      for (let x=from[0];x<to[0];x++) for (let y=from[1];y<to[1];y++) for (let z=from[2];z<to[2];z++) {if(material===0)cells.delete(key(x,y,z));else cells.add(key(x,y,z));}
    }
    expect(cells.has(key(...mount))).toBe(true);
    const todo = [mount], seen = new Set([key(...mount)]);
    while (todo.length) { const [x,y,z] = todo.pop()!; for (const [dx,dy,dz] of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]]) { const p: [number,number,number] = [x+dx!,y+dy!,z+dz!]; const k=key(...p); if(cells.has(k) && !seen.has(k)) {seen.add(k); todo.push(p);} } }
    expect(seen.size).toBe(cells.size);
  });
});
