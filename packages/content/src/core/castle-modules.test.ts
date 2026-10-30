import { describe, expect, it } from 'vitest';
import { VoxelBlueprintSchema, type Vec3, type VoxelBlueprint } from '@chatdom/shared';
import { MAT, STYLES, type StyleKey } from '../materials';
import { createCastle } from './index';
import { createCastleModule } from './castle-modules';

const cases = [
  ['keep', [32,31,32]], ['tower', [12,24,12]], ['gatehouse', [16,18,10]],
  ['curtain', [12,10,3]], ['curtain', [20,10,3]], ['curtain', [24,10,3]],
] as const;
const materialAt = (asset: VoxelBlueprint, x: number, y: number, z: number) => {
  let material = 0;
  for (const b of asset.boxes) if (x >= b.from[0] && x < b.to[0] && y >= b.from[1] && y < b.to[1] && z >= b.from[2] && z < b.to[2]) material = b.material;
  return material;
};

describe('castle modules', () => {
  it('keeps the existing keep and validates exact dimensions and palette', () => {
    for (const style of Object.keys(STYLES) as StyleKey[]) for (const [kind, dimensions] of cases) {
      const asset = createCastleModule(kind, dimensions, style);
      expect(VoxelBlueprintSchema.safeParse(asset).success).toBe(true);
      expect(asset.size).toEqual(dimensions.map(n => n*8));
      const kit = STYLES[style];
      const palette = new Set<number>([MAT.air, kit.stone, kit.wall, kit.roof, kit.trim, MAT.brass, MAT.darkStone, MAT.cloth, MAT.glass, MAT.paving]);
      expect(asset.boxes.every(b => palette.has(b.material))).toBe(true);
      if (kind === 'keep') expect(asset).toEqual(createCastle(style));
    }
  });
  it('rejects dimensions outside the pinned compound', () => {
    expect(() => createCastleModule('tower', [12, 23, 12], 'tide')).toThrow();
    expect(() => createCastleModule('curtain', [16, 10, 3], 'tide')).toThrow();
  });
  it('leaves a continuous four by six metre gate passage from the ground through its full depth', () => {
    const gate = createCastleModule('gatehouse', [16,18,10], 'tide');
    // Box intersection covers the whole continuous volume, rather than a few samples.
    for (const b of gate.boxes) {
      const intersects = b.from[0] < 80 && b.to[0] > 48 && b.from[1] < 48 && b.to[1] > 0 && b.from[2] < 80 && b.to[2] > 0;
      expect(intersects && b.material !== MAT.air).toBe(false);
    }
  });
  it('leaves a grounded tower interior and court entrance', () => {
    const tower = createCastleModule('tower', [12,24,12], 'tide');
    for (const z of [14, 24, 48, 72, 82, 90, 95]) for (const y of [0, 10, 12, 17, 25, 39]) for (const x of [38,48,58]) {
      expect(materialAt(tower,x,y,z)).toBe(MAT.air);
    }
    expect(materialAt(tower,8,20,48)).toBe(STYLES.tide.stone);
  });
  it('gives curtain parapets actual gaps and solid merlons', () => {
    for (const width of [12,20,24]) {
      const wall = createCastleModule('curtain', [width,10,3] as Vec3, 'tide');
      expect(materialAt(wall,4,75,2)).toBe(STYLES.tide.stone);
      expect(materialAt(wall,12,75,2)).toBe(MAT.air);
      expect(materialAt(wall,12,60,12)).not.toBe(MAT.air);
    }
  });
});

// Execute ordered boxes then flood face-neighbours from the ground. This catches
// unsupported roof courses, details and crenellations without a full meshing pass.
it('connects every new module component to the ground', () => {
  for (const [kind, dimensions] of cases) {
    if (kind === 'keep') continue;
    const asset = createCastleModule(kind, dimensions, 'tide');
    const [sx, sy, sz] = asset.size;
    const plane = sx * sy;
    const voxels = new Uint8Array(plane * sz);
    for (const box of asset.boxes) for (let z = box.from[2]; z < box.to[2]; z++) for (let y = box.from[1]; y < box.to[1]; y++) {
      voxels.fill(box.material === MAT.air ? 0 : 1, z * plane + y * sx + box.from[0], z * plane + y * sx + box.to[0]);
    }
    const queue = new Int32Array(voxels.length);
    let head = 0, tail = 0;
    const visit = (i: number) => { if (voxels[i] === 1) { voxels[i] = 2; queue[tail++] = i; } };
    for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) visit(z * plane + x);
    while (head < tail) {
      const i = queue[head++]!;
      const x = i % sx, y = Math.floor(i / sx) % sy, z = Math.floor(i / plane);
      if (x > 0) visit(i - 1); if (x + 1 < sx) visit(i + 1);
      if (y > 0) visit(i - sx); if (y + 1 < sy) visit(i + sx);
      if (z > 0) visit(i - plane); if (z + 1 < sz) visit(i + plane);
    }
    expect(voxels.includes(1), `${asset.id} has unsupported occupied cell at ${voxels.indexOf(1) % sx},${Math.floor(voxels.indexOf(1) / sx) % sy},${Math.floor(voxels.indexOf(1) / plane)}`).toBe(false);
  }
});

it('climbs continuously from the keep approach to its court with generous headroom', () => {
  const keep = createCastle('tide');
  // The court ends at z=201; z=254..255 is level with the outside ground.
  // Check every cell across a 1.5 m clear path, not just the middle of the stair.
  for (let z = 201; z < 256; z++) {
    const height = z === 201 ? 13 : z >= 254 ? 0 : 13 - Math.floor((z - 202) / 4);
    const nextHeight = z === 255 ? 0 : z + 1 >= 254 ? 0 : 13 - Math.floor((z + 1 - 202) / 4);
    expect(Math.abs(height - nextHeight)).toBeLessThanOrEqual(1);
    for (let x = 122; x < 134; x++) {
      for (let y = 0; y < height; y++) expect(materialAt(keep,x,y,z)).not.toBe(MAT.air);
      for (let y = height; y < height + 20; y++) expect(materialAt(keep,x,y,z)).toBe(MAT.air);
    }
  }
});

it('joins all eight placed tower and curtain ends at the actual stone surfaces', () => {
  const tower = createCastleModule('tower', [12,24,12], 'tide');
  const front = createCastleModule('curtain', [12,10,3], 'tide');
  const rear = createCastleModule('curtain', [20,10,3], 'tide');
  const side = createCastleModule('curtain', [24,10,3], 'tide');
  type Placed = { asset: VoxelBlueprint; x: number; z: number; turn?: 1 };
  const at = (p: Placed, x: number, y: number, z: number) => {
    // Positions are integer build cells; a quarter turn maps local +X to world -Z.
    const lx = p.turn ? p.z-z-1 : x-p.x;
    const lz = p.turn ? x-p.x : z-p.z;
    return lx < 0 || lz < 0 || lx >= p.asset.size[0] || lz >= p.asset.size[2]
      ? MAT.air : materialAt(p.asset,lx,y,lz);
  };
  const nw: Placed = {asset:tower,x:-256,z:-672}, ne: Placed = {asset:tower,x:160,z:-672};
  const sw: Placed = {asset:tower,x:-256,z:-384}, se: Placed = {asset:tower,x:160,z:-384};
  const joins: { tower: Placed; wall: Placed; axis: 'x'|'z'; towerEdge: number; wallEdge: number; start: number; end: number }[] = [
    {tower:nw,wall:{asset:rear,x:-160,z:-672},axis:'x',towerEdge:-161,wallEdge:-160,start:-672,end:-648},
    {tower:ne,wall:{asset:rear,x:0,z:-672},axis:'x',towerEdge:160,wallEdge:159,start:-672,end:-648},
    {tower:sw,wall:{asset:front,x:-160,z:-312},axis:'x',towerEdge:-161,wallEdge:-160,start:-312,end:-288},
    {tower:se,wall:{asset:front,x:64,z:-312},axis:'x',towerEdge:160,wallEdge:159,start:-312,end:-288},
    {tower:nw,wall:{asset:side,x:-256,z:-384,turn:1},axis:'z',towerEdge:-577,wallEdge:-576,start:-256,end:-232},
    {tower:sw,wall:{asset:side,x:-256,z:-384,turn:1},axis:'z',towerEdge:-384,wallEdge:-385,start:-256,end:-232},
    {tower:ne,wall:{asset:side,x:232,z:-384,turn:1},axis:'z',towerEdge:-577,wallEdge:-576,start:232,end:256},
    {tower:se,wall:{asset:side,x:232,z:-384,turn:1},axis:'z',towerEdge:-384,wallEdge:-385,start:232,end:256},
  ];
  for (const join of joins) for (const y of [4, 20, 50, 60]) {
    let contact = false;
    for (let p=join.start; p<join.end; p++) {
      const towerSolid = join.axis === 'x' ? at(join.tower,join.towerEdge,y,p) : at(join.tower,p,y,join.towerEdge);
      const wallSolid = join.axis === 'x' ? at(join.wall,join.wallEdge,y,p) : at(join.wall,p,y,join.wallEdge);
      if (towerSolid !== MAT.air && wallSolid !== MAT.air) contact = true;
    }
    expect(contact, `missing ${join.axis} contact at ${join.tower.x},${join.tower.z}, y=${y}`).toBe(true);
  }
});

it('keeps the placed route from outer gate to the keep court clear', () => {
  const tower = createCastleModule('tower', [12,24,12], 'tide');
  const front = createCastleModule('curtain', [12,10,3], 'tide');
  const rear = createCastleModule('curtain', [20,10,3], 'tide');
  const side = createCastleModule('curtain', [24,10,3], 'tide');
  const gate = createCastleModule('gatehouse', [16,18,10], 'tide');
  const keep = createCastle('tide');
  const placed: { asset: VoxelBlueprint; x: number; z: number; turn?: boolean }[] = [
    {asset:keep,x:-128,z:-640}, {asset:gate,x:-64,z:-368},
    ...[-256,160].flatMap(x => [-672,-384].map(z => ({asset:tower,x,z}))),
    ...[-160,64].map(x => ({asset:front,x,z:-312})),
    ...[-160,0].map(x => ({asset:rear,x,z:-672})),
    ...[-256,232].map(x => ({asset:side,x,z:-384,turn:true})),
  ];
  for (let z=-439; z < -288; z++) {
    const kz = z+640;
    const floor = kz === 201 ? 13 : kz >= 202 && kz < 254 ? 13-Math.floor((kz-202)/4) : 0;
    for (let x=-6; x<6; x++) for (let y=floor; y<floor+20; y++) for (const p of placed) {
      const lx = p.turn ? p.z-z-1 : x-p.x, lz = p.turn ? x-p.x : z-p.z;
      if (lx >= 0 && lz >= 0 && lx < p.asset.size[0] && lz < p.asset.size[2]) {
        expect(materialAt(p.asset,lx,y,lz), `${p.asset.id} obstructs ${x},${y},${z}`).toBe(MAT.air);
      }
    }
  }
});
