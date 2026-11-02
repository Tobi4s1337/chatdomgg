import { VOXEL_METRES, type Vec3, type VoxelAsset } from '@chatdom/shared';
import { MAT } from '../materials';
import type { KeepsakeShelf } from './shelf';

/*
 * The corner of a home the shelf stands in, on the build lattice: a half-timbered plaster wall with a dado rail and
 * skirting, a leaded window to the left that the evening light comes through, a dark beam overhead, floorboards and
 * a striped rag rug before the shelf. Front faces +Z; the wall's face is z=2 and the floor's top is y=2.
 */
export interface ShelfAlcove {
  readonly asset: VoxelAsset;
  /** Where the shelf asset's (0,0,0) corner stands, in metres in the alcove's frame. */
  readonly shelfAt: Vec3;
  /** The window's centre on the wall's face, in metres in the alcove's frame: the room's key light comes from here. */
  readonly window: Vec3;
}

const WALL = 2, FLOOR = 2;
/** Build cells: wall either side of the shelf, room above it, floor before it. */
const SIDE = 64, ABOVE = 26, ROOM = 52;
const RATIO = VOXEL_METRES.build / VOXEL_METRES.avatar;

export function createShelfAlcove(shelf: KeepsakeShelf): ShelfAlcove {
  if (shelf.asset.lattice !== 'avatar') throw new Error('The alcove is made for a shelf on the avatar lattice.');
  const [sw, sh, sd] = shelf.asset.size.map(n => Math.ceil(n / RATIO)) as [number, number, number];
  const sx = SIDE + sw + SIDE, sy = FLOOR + sh + ABOVE, sz = WALL + ROOM;
  const v = new Uint16Array(sx * sy * sz);
  const put = (x: number, y: number, z: number, m: number) => {
    if (x < 0 || y < 0 || z < 0 || x >= sx || y >= sy || z >= sz) throw new Error(`Alcove cell ${x},${y},${z} is outside the ${sx}x${sy}x${sz} block.`);
    v[x + sx * (y + sy * z)] = m;
  };
  const box = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, m: number) => {
    for (let z = z0; z < z1; z++) for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) put(x, y, z, m);
  };
  const shelfX0 = SIDE, shelfX1 = SIDE + sw;
  const behind = (x: number) => x >= shelfX0 - 1 && x < shelfX1 + 1;

  // The window, to the left of the shelf, placed first so the framing goes round it.
  const ww = 22, wh = 30, wx = Math.max(6, shelfX0 - 14 - ww), wy = FLOOR + Math.round(sh * .32);
  const clear = (x0: number, x1: number) => x1 <= wx - 3 || x0 >= wx + ww + 3;

  // Floorboards, then the wall: plaster in a frame of flush timbers, a beam along the top.
  box(0, 0, 0, sx, FLOOR, sz, MAT.timber);
  box(0, FLOOR, 0, sx, sy, WALL, MAT.plaster);
  const beam = sy - 5, rail = FLOOR + 9;
  const studs: number[] = [shelfX0 - 4, shelfX1 + 1];
  for (let x = 6; x < shelfX0 - 8; x += 26) if (clear(x, x + 3)) studs.push(x);
  for (let x = sx - 9; x > shelfX1 + 8; x -= 26) studs.push(x);
  studs.push(wx - 4, wx + ww + 1);
  studs.sort((a, b) => a - b);
  for (const x of studs) if (x >= 0 && x + 3 <= sx) box(x, FLOOR, 0, x + 3, beam, WALL, MAT.timber);
  for (let x = 0; x < sx; x++) {
    put(x, rail, 1, MAT.timber); put(x, rail + 1, 1, MAT.timber);
    if (!behind(x)) { put(x, rail, WALL, MAT.timber); put(x, FLOOR, WALL, MAT.timber); put(x, FLOOR + 1, WALL, MAT.timber); }
  }
  // Braces rising across the outer panels at forty-five degrees, as an old house is framed.
  for (let i = 0; i + 1 < studs.length; i++) {
    const a = studs[i]! + 3, c = studs[i + 1]!;
    if (c - a < 8 || behind(a) || behind(c - 1) || !clear(a, c) || a < 0 || c > sx) continue;
    for (let x = a; x < c; x++) {
      const y = rail + 2 + (x - a);
      if (y + 1 < beam) { put(x, y, 1, MAT.timber); put(x, y + 1, 1, MAT.timber); }
    }
  }
  box(0, beam, 0, sx, beam + 4, WALL + 3, MAT.bark);
  box(0, beam + 4, 0, sx, sy, WALL, MAT.timber);

  // The window: a timber frame, a cross of mullions, leaded glass and a deep sill.
  box(wx, wy, 0, wx + ww, wy + wh, WALL, MAT.air);
  for (let y = wy; y < wy + wh; y++) for (let x = wx; x < wx + ww; x++) {
    const frame = x < wx + 2 || x >= wx + ww - 2 || y < wy + 2 || y >= wy + wh - 2;
    const mullion = Math.abs(x + .5 - (wx + ww / 2)) < 1 || Math.abs(y + .5 - (wy + wh * .62)) < 1;
    const lead = (x - wx) % 5 === 0 || (y - wy) % 6 === 0;
    put(x, y, 1, frame || mullion ? MAT.timber : lead ? MAT.darkStone : MAT.glass);
    if (frame) put(x, y, 0, MAT.timber);
  }
  box(wx - 2, wy - 2, 0, wx + ww + 2, wy, WALL + 3, MAT.timber);
  box(wx - 3, wy - 3, WALL, wx + ww + 3, wy - 2, WALL + 2, MAT.bark);
  // A little pot of herbs on the sill.
  const px = wx + ww - 6;
  box(px, wy, WALL, px + 3, wy + 3, WALL + 3, MAT.terracotta);
  for (const [dx, dy, dz] of [[1, 3, 1], [1, 4, 1], [0, 4, 1], [2, 4, 1], [1, 5, 1], [1, 4, 2], [0, 5, 1]] as const) put(px + dx, wy + dy, WALL + dz, MAT.leaf);

  // A striped rag rug on the boards before the shelf.
  const rz0 = WALL + sd + 2, rz1 = Math.min(sz - 2, rz0 + 20);
  const stripes = [MAT.fabricMutedRed, MAT.fabricMutedGold, MAT.fabricMutedRed, MAT.cream, MAT.fabricMutedBlue, MAT.fabricMutedRed];
  for (let z = rz0; z < rz1; z++) for (let x = shelfX0 + 8; x < shelfX1 - 8; x++)
    put(x, FLOOR, z, z === rz0 || z === rz1 - 1 ? MAT.fabricMutedRed : stripes[Math.floor((z - rz0) / 2) % stripes.length]!);

  const m = VOXEL_METRES.build;
  return {
    asset: { id: `keepsake:alcove.${shelf.bays}`, revision: 1, lattice: 'build', size: [sx, sy, sz], voxels: v },
    shelfAt: [shelfX0 * m, FLOOR * m, WALL * m],
    window: [(wx + ww / 2) * m, (wy + wh / 2) * m, WALL * m],
  };
}
