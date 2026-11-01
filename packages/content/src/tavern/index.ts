import type { Vec3, VoxelBlueprint } from '@chatdom/shared';
import { Boxes, CIVIC_KITS, type CivicKit, type CivicStyle } from '../civic/kit';
import { MAT, STYLES } from '../materials';

/** Room bounds in metres. +Z is the entry side; local origin is the south-west floor corner. */
export const TAVERN_ROOM_BOUNDS = [14, 10] as const;
export const TAVERN_FLOOR = 0.125;
export const TAVERN_DOOR = { centre: [7, TAVERN_FLOOR, 9.625], width: 1.5 } as const;

export interface TavernSeat {
  readonly key: string;
  readonly tableId: string;
  /** Centre of the chair's top, in metres. */
  readonly position: Vec3;
  readonly approach: Vec3;
  /** Heading in radians; zero faces +Z. */
  readonly facing: number;
}
export interface TavernTable {
  readonly id: string;
  readonly centre: Vec3;
  readonly size: readonly [number, number];
  readonly seats: readonly TavernSeat[];
  readonly corner: boolean;
}
export interface TavernSolid { readonly min: Vec3; readonly max: Vec3 }
export interface TavernKit {
  /** All pieces share a local origin. Render one mesh per piece; fade the camera-facing wall. */
  readonly pieces: Readonly<Record<'room' | 'front' | 'back' | 'left' | 'right', VoxelBlueprint>>;
  readonly tables: readonly TavernTable[];
  readonly solids: readonly TavernSolid[];
  readonly hearth: Vec3;
}

const CELL = 0.125;
const point = (x: number, y: number, z: number): Vec3 => [x * CELL, y * CELL, z * CELL];
const solid = (x: number, y: number, z: number, X: number, Y: number, Z: number): TavernSolid => ({ min: point(x, y, z), max: point(X, Y, Z) });
const centres = [
  { id: 'west', x: 21, z: 40 }, { id: 'hearth', x: 44, z: 40 },
  { id: 'middle', x: 68, z: 40 }, { id: 'east', x: 91, z: 40 },
  { id: 'corner', x: 79, z: 56 },
] as const;

/** Geometry, collision and game anchors are authored from the same layout in both civic styles. */
export function createTavernKit(style: CivicStyle): TavernKit {
  if (style !== 'hearth' && style !== 'tide') throw new Error(`Unknown tavern style: ${String(style)}`);
  const k = CIVIC_KITS[style];
  const room = new Boxes(), front = new Boxes(), back = new Boxes(), left = new Boxes(), right = new Boxes();
  const solids: TavernSolid[] = [
    solid(2, 1, 2, 5, 34, 77), solid(107, 1, 2, 110, 34, 77),
    solid(4, 1, 2, 108, 34, 5), solid(4, 1, 75, 50, 34, 78), solid(62, 1, 75, 108, 34, 78),
  ];
  // Worn planks and joists carry the room to the entry threshold.
  room.add(3, 0, 3, 109, 1, 77, k.trim);
  for (let x = 5; x < 108; x += 8) room.add(x, 0, 4, x + 1, 1, 76, MAT.bark);
  room.add(50, 0, 77, 62, 1, 79, k.stone);
  // Flat woven rugs share the floor's surface: no raised edge in a walker's path.
  rug(room, k, 10, 27, 55, 54);
  rug(room, k, 60, 27, 104, 70);

  // Plaster between dark timbers, a substantial sill and front lintel. The 12-cell doorway is empty.
  front.add(3, 1, 75, 50, 34, 78, k.wall); front.add(62, 1, 75, 109, 34, 78, k.wall);
  front.add(50, 24, 75, 62, 34, 78, k.wall);
  front.add(3, 1, 75, 50, 5, 79, k.stone); front.add(62, 1, 75, 109, 5, 79, k.stone);
  for (const x of [4, 25, 48, 62, 85, 106]) front.add(x, 1, 75, x + 2, 34, 79, k.trim);
  front.add(48, 23, 75, 64, 25, 79, k.trim);
  front.add(3, 32, 75, 109, 34, 79, k.trim);
  // A carved cup on the inner wall welcomes guests without inventing a name or a patron.
  front.add(82, 21, 74, 93, 29, 75, k.trim);
  front.add(83, 22, 73, 92, 28, 74, k.field);
  front.add(85, 23, 73, 90, 26, 74, k.charge);
  front.add(86, 22, 73, 89, 23, 74, k.charge);

  wall(back, k, 'back'); wall(left, k, 'left'); wall(right, k, 'right');
  tapestry(back, k);
  // Two ceiling timbers run between the walls; each chain meets a timber above the walking camera.
  room.add(4, 33, 35, 108, 34, 37, k.trim);
  room.add(4, 33, 58, 108, 34, 60, k.trim);
  // Lanterns are fixtures, not presence lights. Their warm lighting is supplied by the room renderer.
  for (const [x, z] of [[24, 36], [61, 36], [84, 59]] as const) lantern(room, k, x, z);

  bar(room, k); hearth(room, k); notices(room, k);
  solids.push(solid(7, 1, 5, 44, 12, 15), solid(77, 1, 3, 101, 25, 13), solid(80, 1, 18, 98, 5, 22));
  const tables = centres.map(({ id, x, z }) => {
    table(room, k, x, z, id === 'corner');
    const seats = ([-1, 1] as const).map((direction, i): TavernSeat => {
      chair(room, k, x, z + direction * 9, direction < 0 ? 'north' : 'south');
      const cz = z + direction * 9;
      // Approach just beyond the chair, on the floor; not inside its own collision.
      return { key: `${id}:${i + 1}`, tableId: id, position: point(x, 5, cz), approach: point(x, 1, cz + direction * 6), facing: direction < 0 ? 0 : Math.PI };
    });
    if (id === 'hearth') {
      for (const direction of [-1, 1] as const) {
        const cx = x + direction * 9;
        chair(room, k, cx, z, direction < 0 ? 'west' : 'east');
        seats.push({ key: `${id}:${direction < 0 ? 3 : 4}`, tableId: id,
          position: point(cx, 5, z), approach: point(cx + direction * 5, 1, z + 6),
          facing: direction < 0 ? Math.PI / 2 : -Math.PI / 2 });
        solids.push(solid(cx - 3, 1, z - 3, cx + 3, 12, z + 3));
      }
    }
    solids.push(solid(x - 6, 1, z - 4, x + 6, 8, z + 4));
    for (const direction of [-1, 1]) solids.push(solid(x - 3, 1, z + direction * 9 - 3, x + 3, 12, z + direction * 9 + 3));
    return { id, centre: point(x, 8, z), size: [1.5, 1] as const, seats, corner: id === 'corner' };
  });
  const blueprint = (name: string, b: Boxes): VoxelBlueprint => ({ version: 1, id: `tavern-${style}-${name}`, styleId: STYLES[style].id,
    kind: 'civic', lattice: 'build', size: [112, 80, 80], boxes: b.list, windows: [] });
  return { pieces: { room: blueprint('room', room), front: blueprint('front', front), back: blueprint('back', back),
    left: blueprint('left', left), right: blueprint('right', right) },
    tables, solids, hearth: point(89, 8, 12) };
}

function wall(b: Boxes, k: CivicKit, side: 'back' | 'left' | 'right'): void {
  if (side === 'back') {
    b.add(3, 1, 2, 109, 34, 5, k.wall); b.add(3, 1, 2, 109, 5, 5, k.stone);
    for (const x of [4, 30, 56, 82, 106]) b.add(x, 1, 2, x + 2, 34, 5, k.trim);
    b.add(3, 32, 2, 109, 34, 5, k.trim);
  } else {
    const x = side === 'left' ? 2 : 107;
    b.add(x, 1, 5, x + 3, 34, 75, k.wall); b.add(x, 1, 5, x + 3, 5, 75, k.stone);
    for (const z of [6, 29, 51, 72]) b.add(x, 1, z, x + 3, 34, z + 2, k.trim);
    b.add(x, 32, 5, x + 3, 34, 75, k.trim);
    // Low, hooded sconces protrude toward the interior and belong to the wall that fades.
    const sx = side === 'left' ? 5 : 104;
    for (const z of [20, 66]) {
      b.add(sx, 19, z, sx + 3, 20, z + 4, k.trim);
      b.add(sx + 1, 20, z + 1, sx + 3, 24, z + 3, MAT.glass);
      b.add(sx, 24, z, sx + 3, 25, z + 4, MAT.brass);
    }
  }
}
function table(b: Boxes, k: CivicKit, x: number, z: number, corner: boolean): void {
  // Chamfered top with a dark edge and a cloth inlay for the corner table.
  b.add(x - 5, 7, z - 4, x + 5, 8, z + 4, k.trim);
  b.add(x - 6, 7, z - 3, x + 6, 8, z + 3, k.trim);
  b.add(x - 4, 7, z - 3, x + 4, 8, z + 3, MAT.bark);
  // Narrow woven runner leaves the game surface open. A pair of brass-edged coasters sit at its ends.
  b.add(x - 4, 7, z - 1, x + 4, 8, z + 1, k.field);
  if (corner) b.add(x - 3, 7, z - 2, x + 3, 8, z + 2, k.field);
  for (const dx of [-5, 4]) b.add(x + dx, 7, z - 1, x + dx + 1, 8, z + 1, MAT.brass);
  for (const dx of [-4, 3]) for (const dz of [-2, 1]) b.add(x + dx, 1, z + dz, x + dx + 1, 7, z + dz + 1, k.trim);
  b.add(x - 4, 3, z - 1, x + 4, 4, z + 1, MAT.bark);
}
function chair(b: Boxes, k: CivicKit, x: number, z: number, side: 'north' | 'south' | 'west' | 'east'): void {
  b.add(x - 3, 4, z - 3, x + 3, 5, z + 3, k.trim);
  b.add(x - 2, 4, z - 2, x + 2, 5, z + 2, k.field);
  for (const dx of [-2, 1]) for (const dz of [-2, 1]) b.add(x + dx, 1, z + dz, x + dx + 1, 4, z + dz + 1, k.trim);
  if (side === 'north' || side === 'south') {
    const back = side === 'north' ? z - 3 : z + 2;
    b.add(x - 3, 5, back, x + 3, 11, back + 1, k.trim);
    b.add(x - 2, 10, back, x + 2, 12, back + 1, k.trim);
    for (const dx of [-2, 1]) b.add(x + dx, 8, back, x + dx + 1, 9, back + 1, MAT.brass);
  } else {
    const back = side === 'west' ? x - 3 : x + 2;
    b.add(back, 5, z - 3, back + 1, 11, z + 3, k.trim);
    b.add(back, 10, z - 2, back + 1, 12, z + 2, k.trim);
    for (const dz of [-2, 1]) b.add(back, 8, z + dz, back + 1, 9, z + dz + 1, MAT.brass);
  }
}
function bar(b: Boxes, k: CivicKit): void {
  b.add(8, 1, 6, 43, 10, 14, k.trim);
  b.add(7, 10, 5, 44, 12, 15, MAT.bark);
  for (const x of [10, 18, 26, 34]) {
    b.add(x, 2, 13, x + 6, 8, 14, MAT.bark);
    b.add(x + 1, 3, 13, x + 5, 7, 14, k.field);
  }
  // Shelved casks and cups behind the bar.
  b.add(8, 15, 5, 42, 16, 7, k.trim);
  b.add(8, 23, 5, 42, 24, 7, k.trim);
  for (const x of [11, 18, 25, 32]) {
    // Barrel ends are octagonal, with two dark hoops around the wooden body.
    b.add(x + 1, 16, 5, x + 5, 22, 8, MAT.bark);
    b.add(x, 17, 5, x + 6, 21, 8, k.trim);
    b.add(x + 1, 17, 8, x + 5, 21, 9, k.trim);
    b.add(x + 2, 18, 8, x + 4, 20, 9, MAT.bark);
    b.add(x + 2, 17, 9, x + 4, 18, 10, MAT.brass);
  }
  // A row of solid earthenware tankards with small handles on the upper shelf.
  for (const x of [11, 16, 21, 27, 32, 37]) tankard(b, k, x, 24, 5);
  for (const x of [11, 24, 37]) tankard(b, k, x, 12, 9);

}
function hearth(b: Boxes, k: CivicKit): void {
  b.add(77, 1, 3, 101, 24, 13, k.stone);
  b.add(80, 2, 6, 98, 16, 14, MAT.air);
  b.add(79, 1, 12, 99, 3, 17, k.base);
  b.add(78, 23, 2, 100, 26, 14, k.trim);
  b.add(81, 3, 8, 97, 4, 13, MAT.bark);
  for (const x of [84, 90, 94]) {
    b.add(x, 4, 9, x + 3, 9, 12, MAT.terracotta);
    b.add(x + 1, 5, 10, x + 3, 10, 12, MAT.brass);
  }
  // Low bench faces the fire and leaves the hearth-side aisle open.
  b.add(80, 4, 18, 98, 5, 22, k.trim);
  for (const x of [81, 94]) b.add(x, 1, 18, x + 2, 4, 22, k.trim);
}
function notices(b: Boxes, k: CivicKit): void {
  // An empty notice board is a place for real notices, never names invented by the asset.
  b.add(5, 13, 46, 6, 27, 64, k.trim);
  b.add(6, 14, 47, 7, 26, 63, MAT.bark);
  b.add(6, 16, 49, 7, 23, 53, k.charge);
  b.add(6, 17, 56, 7, 24, 61, k.charge);
  for (const z of [50, 58]) b.add(7, 22, z, 8, 23, z + 1, MAT.brass);
}

/** A patterned, inset floor textile using the civic colours and the existing muted gold ramp. */
function rug(b: Boxes, k: CivicKit, x: number, z: number, X: number, Z: number): void {
  b.add(x, 0, z, X, 1, Z, MAT.fabricMutedGold);
  b.add(x + 1, 0, z + 1, X - 1, 1, Z - 1, k.field);
  b.add(x + 3, 0, z + 3, X - 3, 1, Z - 3, k.style === 'tide' ? MAT.fabricMutedBlue : MAT.fabricMutedRed);
  // Small woven diamonds and bars: deliberate motifs, not noise.
  for (let cx = x + 9; cx < X - 7; cx += 12) {
    const cz = Math.floor((z + Z) / 2);
    b.add(cx - 2, 0, cz, cx + 3, 1, cz + 1, MAT.fabricMutedGold);
    b.add(cx, 0, cz - 2, cx + 1, 1, cz + 3, MAT.fabricMutedGold);
  }
  for (let cx = x + 4; cx < X - 3; cx += 5) {
    b.add(cx, 0, z + 1, cx + 2, 1, z + 2, k.charge);
    b.add(cx, 0, Z - 2, cx + 2, 1, Z - 1, k.charge);
  }
}
function tapestry(b: Boxes, k: CivicKit): void {
  b.add(60, 28, 5, 75, 29, 7, k.trim);
  b.add(62, 13, 5, 73, 28, 6, k.field);
  b.add(63, 14, 6, 72, 27, 7, MAT.fabricMutedGold);
  b.add(64, 15, 6, 71, 26, 7, k.field);
  b.add(67, 17, 7, 68, 24, 8, k.charge);
  b.add(65, 19, 7, 70, 21, 8, k.charge);
  b.add(66, 16, 7, 69, 17, 8, k.charge);
}
function lantern(b: Boxes, k: CivicKit, x: number, z: number): void {
  b.add(x, 30, z, x + 1, 34, z + 1, MAT.brass);
  b.add(x - 2, 28, z - 2, x + 3, 30, z + 3, k.trim);
  b.add(x - 1, 24, z - 1, x + 2, 28, z + 2, MAT.glass);
  for (const dx of [-2, 2]) for (const dz of [-2, 2]) b.add(x + dx, 24, z + dz, x + dx + 1, 29, z + dz + 1, MAT.brass);
  b.add(x - 2, 23, z - 2, x + 3, 24, z + 3, k.trim);
  b.add(x - 1, 22, z - 1, x + 2, 23, z + 2, MAT.brass);
}
function tankard(b: Boxes, k: CivicKit, x: number, y: number, z: number): void {
  b.add(x, y, z, x + 3, y + 3, z + 3, k.charge);
  b.add(x, y + 2, z, x + 3, y + 3, z + 3, k.trim);
  b.add(x + 3, y + 1, z, x + 4, y + 3, z + 2, k.trim);
}
