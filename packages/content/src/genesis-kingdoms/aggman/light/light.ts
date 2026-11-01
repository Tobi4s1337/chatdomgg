import type { Vec3, VoxelBlueprint } from '@chatdom/shared';
import { Boxes } from '../../../civic/kit';
import { MAT, STYLES } from '../../../materials';
import type { AggmanPiece } from '../piece';

/**
 * The Last Lantern: the harbour light at the west end of The_AGGman's quay, named for the channel's own line, "At the
 * harbour's last lantern, there is always room for one more wanderer." A square stone tower on a dark wet plinth,
 * with quoined corner piers, a cornice, and a glazed lantern room under a slate pyramid and a brass finial. Its
 * seaward face is one tall lancet: the kingdom's window, set flush into the wall, lit from within by a brazier on
 * a stone stand so it glows toward the boats at dusk.
 *
 * The lancet is the Genesis window unit (`EmoteGlass`): the channel's approved stained glass when there is one,
 * plain leaded lights when there is not. The tower is sized to the unit's opening; the host places the unit at
 * `glassAt` and turns both by the same quarter turns.
 *
 * Local frame: build cells, x right, y up, +Z the seaward front, origin at the (0,0,0) corner, y = 0 the ground.
 */
export interface LastLantern extends AggmanPiece {
  /** Where the window unit's origin goes, in tower-local cells (its frame face flush with the front wall). */
  readonly glassAt: Vec3;
  /** The top of the finial, on the tower's axis: where a weathervane's foot plate stands. */
  readonly vaneAt: Vec3;
}

/** The plinth, the wall's inset and thickness, and the sill of the lancet, in cells. */
const PLINTH = 6, INSET = 2, WALL = 6, PIER = 6, SILL = 10;

const hash = (a: number, b: number, c: number): number => {
  let h = Math.imul(a ^ 0x2545f491, 0x85ebca6b) ^ Math.imul(b + 0x6c8e9cf5, 0xc2b2ae35) ^ Math.imul(c + 0x1b873593, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d); h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
};

/**
 * A tone for one block of a course. Below the first string course the tower is bare harbour stone: mostly grey,
 * some salt-pale, a few dark, a rare warm one. Above it the shaft is limewashed, as harbour lights are, so it reads
 * white against the dusk from the water, with the odd pale or bare stone where the wash has weathered.
 */
const tone = (u: number, row: number, face: number, washed: boolean): number => {
  const t = hash(u, row, face);
  if (washed) return t < .78 ? MAT.cream : t < .94 ? MAT.limestone : MAT.stone;
  return t < .5 ? MAT.stone : t < .76 ? MAT.limestone : t < .93 ? MAT.darkStone : MAT.brick;
};

export function createLastLantern(glass: { readonly blueprint: VoxelBlueprint; readonly opening: readonly [number, number] }, band: number = MAT.fabricRed): LastLantern {
  const [gw, gh] = glass.opening;
  if (!Number.isInteger(gw) || !Number.isInteger(gh) || gw < 12 || gh < 20 || gw > 48 || gh > 80) throw new Error('The Last Lantern takes a lancet 12–48 cells wide and 20–80 tall.');
  const W = gw + 2 * (INSET + PIER), D = 40;
  const x0 = INSET, x1 = W - INSET, z0 = INSET, z1 = D - INSET;
  const top = SILL + gh + 9, cornice = top + 4, deck = cornice + 2;
  const wash = Math.round(PLINTH + (top - PLINTH) / 3);
  const b = new Boxes();

  // Plinth: a dark, wet stepped base with a weed line, then a pale moulded course.
  b.add(0, 0, 0, W, PLINTH - 2, D, MAT.darkStone);
  for (let x = 0; x < W; x += 5) b.add(x, PLINTH - 3, D - 1, Math.min(W, x + 2 + Math.floor(hash(x, 1, 7) * 3)), PLINTH - 2, D, MAT.moss);
  b.add(1, PLINTH - 2, 1, W - 1, PLINTH, D - 1, MAT.limestone);

  // The walls: a solid core one cell short of each face, so every face block below opens onto a recessed joint.
  const core = (a: number, c: number, A: number, C: number, y0 = PLINTH, y1 = top) => b.add(a, y0, c, A, y1, C, MAT.stone);
  core(x0 + 1, z0 + 1, x1 - 1, z0 + WALL);              // back
  core(x0 + 1, z0 + 1, x0 + WALL, z1 - 1);              // west
  core(x1 - WALL, z0 + 1, x1 - 1, z1 - 1);              // east
  const gx = (W - gw) / 2;
  core(x0 + 1, z1 - WALL, gx, z1 - 1);                  // front, west of the lancet
  core(gx + gw, z1 - WALL, x1 - 1, z1 - 1);             // front, east of the lancet
  core(gx, z1 - WALL, gx + gw, z1 - 1, PLINTH, SILL);   // under the sill
  core(gx, z1 - WALL, gx + gw, z1 - 1, SILL + gh, top); // over the head

  // Coursed faces: staggered blocks three rows tall, each leaving a joint above and beside it.
  const courses = (face: number, along: [number, number], lay: (u0: number, u1: number, y0: number, y1: number, m: number) => void, skip?: (u0: number, u1: number, y0: number, y1: number) => [number, number][]) => {
    for (let row = 0, y = PLINTH; y < top; row++, y += 3) {
      const y1 = Math.min(top, y + 3);
      for (let u = along[0] - (row % 2) * 3; u < along[1];) {
        const long = 5 + Math.floor(hash(u, row, face) * 4), u1 = Math.min(along[1], u + long), u0 = Math.max(along[0], u);
        const spans = skip ? skip(u0, u1 - 1, y, y1 - 1) : [[u0, u1 - 1] as [number, number]];
        for (const [a, c] of spans) if (c > a) lay(a, c, y, y1 - 1, tone(u, row, face, y >= wash));
        u = u1;
      }
    }
  };
  // Back (z = z0) and the two sides (x = x0, x = x1 - 1).
  courses(1, [x0, x1], (a, c, y, Y, m) => b.add(a, y, z0, c, Y, z0 + 1, m));
  courses(2, [z0, z1], (a, c, y, Y, m) => b.add(x0, y, a, x0 + 1, Y, c, m));
  courses(3, [z0, z1], (a, c, y, Y, m) => b.add(x1 - 1, y, a, x1, Y, c, m));
  // Front: the lancet's opening is left for the window unit.
  courses(4, [x0, x1], (a, c, y, Y, m) => b.add(a, y, z1 - 1, c, Y, z1, m), (u0, u1, y0, y1) => {
    const inside = y1 >= SILL && y0 < SILL + gh;
    if (!inside) return [[u0, u1]];
    return [[u0, Math.min(u1, gx)], [Math.max(u0, gx + gw), u1]];
  });

  // Corner piers standing a cell proud, quoined in long and short pale stones.
  for (const [px, pz] of [[x0 - 1, z0 - 1], [x1 - PIER + 1, z0 - 1], [x0 - 1, z1 - PIER + 1], [x1 - PIER + 1, z1 - PIER + 1]] as const) {
    const west = px < W / 2;
    for (let y = PLINTH, i = 0; y < top; y += 4, i++) {
      const Y = Math.min(top, y + 4) - 1;
      // Long stones show on the front and back faces, short ones on the sides, alternating up the pier.
      if (i % 2 === 0) b.add(px, y, pz, px + PIER, Y, pz + PIER, MAT.limestone);
      else b.add(west ? px : px + 2, y, pz, west ? px + PIER - 2 : px + PIER, Y, pz + PIER, MAT.stone);
    }
  }
  // A string course round the sides and back at a third of the height, and one under the cornice.
  for (const y of [wash, top - 6]) {
    b.add(x0 - 1, y, z0 - 1, x1 + 1, y + 1, z0 + 1, MAT.limestone);
    b.add(x0 - 1, y, z0 - 1, x0 + 1, y + 1, z1 + 1, MAT.limestone);
    b.add(x1 - 1, y, z0 - 1, x1 + 1, y + 1, z1 + 1, MAT.limestone);
    b.add(x0 - 1, y, z1 - 1, gx - 1, y + 1, z1 + 1, MAT.limestone);
    b.add(gx + gw + 1, y, z1 - 1, x1 + 1, y + 1, z1 + 1, MAT.limestone);
  }

  // The kingdom's band, painted round the shaft under the cornice: the livery red the boats steer by.
  b.add(x0, top - 5, z0, x1, top - 1, z1, band);
  // Cornice oversailing the piers, and the lead-dark deck the lantern room stands on.
  b.add(0, top, 0, W, top + 2, D, MAT.limestone);
  b.add(1, top + 2, 1, W - 1, cornice, D - 1, MAT.stone);
  for (let x = 1; x < W - 1; x += 3) { b.add(x, top + 2, 0, x + 1, top + 3, 1, MAT.limestone); b.add(x, top + 2, D - 1, x + 1, top + 3, D, MAT.limestone); }
  b.add(2, cornice, 2, W - 2, deck, D - 2, STYLES.tide.roof);
  // An iron rail round the deck.
  for (let x = 3; x < W - 3; x += 5) for (const z of [3, D - 4]) b.add(x, deck, z, x + 1, deck + 5, z + 1, MAT.hairBlack);
  for (let z = 3; z < D - 3; z += 5) for (const x of [3, W - 4]) b.add(x, deck, z, x + 1, deck + 5, z + 1, MAT.hairBlack);
  b.add(3, deck + 5, 3, W - 3, deck + 6, 4, MAT.hairBlack); b.add(3, deck + 5, D - 4, W - 3, deck + 6, D - 3, MAT.hairBlack);
  b.add(3, deck + 5, 3, 4, deck + 6, D - 3, MAT.hairBlack); b.add(W - 4, deck + 5, 3, W - 3, deck + 6, D - 3, MAT.hairBlack);

  // The lantern room: glazed on four sides between iron posts, a brass sill band and a brass head band.
  const cx = Math.floor(W / 2), cz = Math.floor(D / 2), half = 12, room = 16;
  const rx0 = cx - half, rx1 = cx + half, rz0 = cz - half, rz1 = cz + half, ry = deck, rY = deck + room;
  b.add(rx0, ry, rz0, rx1, ry + 2, rz1, MAT.brass);
  b.add(rx0, ry + 2, rz0, rx1, rY - 2, rz0 + 1, MAT.glass); b.add(rx0, ry + 2, rz1 - 1, rx1, rY - 2, rz1, MAT.glass);
  b.add(rx0, ry + 2, rz0 + 1, rx0 + 1, rY - 2, rz1 - 1, MAT.glass); b.add(rx1 - 1, ry + 2, rz0 + 1, rx1, rY - 2, rz1 - 1, MAT.glass);
  for (const x of [rx0, cx - 1, rx1 - 2]) for (const z of [rz0, rz1 - 1]) b.add(x, ry + 2, z, x + 2, rY - 2, z + 1, MAT.brass);
  for (const z of [rz0 + 1, cz - 1, rz1 - 3]) for (const x of [rx0, rx1 - 1]) b.add(x, ry + 2, z, x + 1, rY - 2, z + 2, MAT.brass);
  // A transom bar round the glazing.
  b.add(rx0, ry + 9, rz0, rx1, ry + 10, rz0 + 1, MAT.brass); b.add(rx0, ry + 9, rz1 - 1, rx1, ry + 10, rz1, MAT.brass);
  b.add(rx0, ry + 9, rz0, rx0 + 1, ry + 10, rz1, MAT.brass); b.add(rx1 - 1, ry + 9, rz0, rx1, ry + 10, rz1, MAT.brass);
  b.add(rx0, rY - 2, rz0, rx1, rY, rz1, MAT.brass);
  // The light itself: a brass lamp on a pedestal, its flame the piece's high lantern cell.
  b.add(cx - 2, ry + 2, cz - 2, cx + 2, ry + 5, cz + 2, MAT.brass);
  b.add(cx - 1, ry + 5, cz - 1, cx + 1, ry + 9, cz + 1, MAT.glass);
  const high: Vec3 = [cx, ry + 6, cz];

  // The slate pyramid, one cell in per course, and the brass finial.
  let y = rY;
  for (let i = 0; rx0 - 2 + i < rx1 + 2 - i - 1; i++, y++) b.add(rx0 - 2 + i, y, rz0 - 2 + i, rx1 + 2 - i, y + 1, rz1 + 2 - i, i % 4 === 3 ? MAT.darkStone : STYLES.tide.roof);
  // A brass ball on a short neck: the foot a weathervane stands on.
  b.add(cx - 1, y, cz - 1, cx + 1, y + 2, cz + 1, MAT.brass);
  b.add(cx - 2, y + 2, cz - 2, cx + 2, y + 5, cz + 2, MAT.brass);
  const height = y + 5;

  // Inside, behind the lancet: a stone stand carrying the brazier that lights the window from within.
  const fz = z1 - WALL - 5;
  b.add(cx - 3, PLINTH, fz - 3, cx + 3, SILL + 14, fz + 3, MAT.stone);
  b.add(cx - 3, SILL + 14, fz - 3, cx + 3, SILL + 16, fz + 3, MAT.brass);
  b.add(cx - 2, SILL + 16, fz - 2, cx + 2, SILL + 19, fz + 2, MAT.glass);
  const low: Vec3 = [cx, SILL + 17, fz];

  // The keeper's door at the back, deep in its wall under a pale lintel, with a lamp beside it.
  b.add(cx - 4, PLINTH, z0 - 1, cx + 4, PLINTH + 18, z0, MAT.timber);
  b.add(cx - 5, PLINTH + 18, z0 - 1, cx + 5, PLINTH + 20, z0, MAT.limestone);
  b.add(cx + 6, PLINTH + 12, z0 - 2, cx + 8, PLINTH + 13, z0, MAT.hairBlack);
  b.add(cx + 6, PLINTH + 13, z0 - 3, cx + 8, PLINTH + 16, z0 - 1, MAT.glass);
  // Slit lights in each side wall, at the string course and above it.
  for (const x of [x0, x1 - 1]) for (const yy of [PLINTH + 30, PLINTH + 44]) b.add(x, yy, cz - 1, x + 1, yy + 8, cz + 1, MAT.glass);

  const occupied = b.list.filter(box => box.to[0] > 0 && box.from[0] < W && box.to[2] > 0 && box.from[2] < D);
  const blueprint: VoxelBlueprint = {
    version: 1, id: `genesis-aggman-last-lantern-${gw}x${gh}`, styleId: STYLES.tide.id, kind: 'civic', lattice: 'build',
    size: [W, height, D], windows: [],
    boxes: occupied.map(box => ({ from: [Math.max(0, box.from[0]), box.from[1], Math.max(0, box.from[2])] as [number, number, number], to: [Math.min(W, box.to[0]), box.to[1], Math.min(D, box.to[2])] as [number, number, number], material: box.material })),
  };
  return { blueprint, lanterns: [high, low], footprint: { from: [0, 0], to: [W, D] }, glassAt: [gx, SILL, z1 - WALL], vaneAt: [cx, height, cz] };
}
