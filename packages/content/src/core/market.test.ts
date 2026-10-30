import { describe, expect, it } from 'vitest';
import { VoxelBlueprintSchema, type VoxelBlueprint } from '@chatdom/shared';
import { MAT } from '../materials';
import { createMarketStall, createMarketWell } from './market';

const assets = [createMarketWell(), createMarketStall(0), createMarketStall(1)];

describe('market furnishings', () => {
  it('defines deterministic, passive blueprints with registered palette and metre-scale bounds', () => {
    expect(new Set(assets.map(asset => asset.id)).size).toBe(3);
    expect(createMarketWell()).toEqual(assets[0]);
    expect(createMarketStall(0)).toEqual(assets[1]);
    expect(createMarketStall(1)).toEqual(assets[2]);
    expect(assets.map(asset => asset.size)).toEqual([[32,40,32],[40,32,24],[40,32,24]]);
    const palette = new Set<number>(Object.values(MAT));
    for (const asset of assets) {
      expect(VoxelBlueprintSchema.safeParse(asset).success, asset.id).toBe(true);
      expect(asset.boxes.every(box => palette.has(box.material)), asset.id).toBe(true);
      expect(asset.windows).toEqual([]);
    }
    expect(() => createMarketStall(2 as 0)).toThrow();
  });
  it('supports every occupied component from the ground', () => {
    for (const asset of assets) expect(unsupported(asset), asset.id).toBe(0);
  });
});

function unsupported(asset: VoxelBlueprint): number {
  const [sx,sy,sz] = asset.size, plane = sx * sy, cells = new Uint8Array(plane * sz);
  for (const box of asset.boxes) for (let z=box.from[2];z<box.to[2];z++) for (let y=box.from[1];y<box.to[1];y++)
    cells.fill(box.material === MAT.air ? 0 : 1,z*plane+y*sx+box.from[0],z*plane+y*sx+box.to[0]);
  const queue = new Int32Array(cells.length); let head=0,tail=0;
  const visit = (i:number) => { if (cells[i]===1) {cells[i]=2;queue[tail++]=i;} };
  for (let z=0;z<sz;z++) for (let x=0;x<sx;x++) visit(z*plane+x);
  while(head<tail) {
    const i=queue[head++]!,x=i%sx,y=Math.floor(i/sx)%sy,z=Math.floor(i/plane);
    if(x>0)visit(i-1);if(x+1<sx)visit(i+1);if(y>0)visit(i-sx);if(y+1<sy)visit(i+sx);if(z>0)visit(i-plane);if(z+1<sz)visit(i+plane);
  }
  return cells.reduce((n,value)=>n+Number(value===1),0);
}
