import { Boxes } from '../../../civic/kit';
import { MAT } from '../../../materials';
import { runs, type Wood } from '../millrace/craft';

/**
 * The few things left about the boathouse, each hung on something that holds it: a coil of rope on a peg by the
 * side door, a pair of oars resting on pegs across two posts of the east wall, and a ring buoy on the front.
 * Heights are given from the stagings' tread (`deck`).
 */

/** Cells (u, v) of a ring round (cu, cv) between two radii, measured to cell centres. */
function ring(cu: number, cv: number, inner: number, outer: number): [number, number][] {
  const out: [number, number][] = [];
  for (let v = Math.floor(cv - outer); v <= Math.ceil(cv + outer); v++) for (let u = Math.floor(cu - outer); u <= Math.ceil(cu + outer); u++) {
    const r = Math.hypot(u + 0.5 - cu, v + 0.5 - cv);
    if (r >= inner && r <= outer) out.push([u, v]);
  }
  return out;
}

/**
 * A coil of hemp rope on the west wall's upper storey beside the door, two turns lying on each other, hung on an
 * iron peg driven into the boards, its loose end hanging below.
 */
export function layRopeCoil(b: Boxes, deck: number, rope: number, iron: number): void {
  const cz = 26, cy = deck + 12;
  runs(ring(cz, cy, 1.5, 3.1), (z0, z1, y) => b.add(1, y, z0, 2, y + 1, z1, rope));
  runs(ring(cz + 0.5, cy - 0.5, 1.2, 2.7), (z0, z1, y) => b.add(0, y, z0, 1, y + 1, z1, rope));
  b.add(1, cy + 3, cz - 1, 3, cy + 4, cz + 1, iron);
  b.add(1, cy - 5, cz + 1, 2, cy - 3, cz + 2, rope);
}

/**
 * Two oars resting on pegs across the east wall's posts, blades towards the lake: shafts of plain timber, worn
 * grips and blades with their tips painted cream.
 */
export function layOars(b: Boxes, deck: number, timber: Wood, iron: number): void {
  const x = 62;
  for (const [y, z0, z1] of [[deck + 6, 43, 63], [deck + 2, 45, 65]] as const) {
    b.add(x, y, z0 + 2, x + 1, y + 1, z1, timber.plank);
    b.add(x, y, z0, x + 1, y + 1, z0 + 2, timber.end);
    b.add(x, y - 1, z1, x + 1, y + 2, z1 + 6, timber.plank);
    b.add(x, y - 1, z1 + 6, x + 1, y + 2, z1 + 7, MAT.cream);
    // The pegs under each shaft, driven into the posts at z 45 and 58.
    for (const z of [46, 59]) b.add(x, y - 1, z, x + 1, y, z + 1, iron);
  }
}

/**
 * A ring buoy in red and cream quarters on the front wall's east panel, hung from an iron peg on a dark board so
 * it reads against pale boarding from the lake.
 */
export function layLifebuoy(b: Boxes, deck: number, wall: number, board: number, iron: number): void {
  const cx = 54.5, cy = deck + 9.5, layer = wall + 1;
  b.add(50, deck + 5, wall, 59, deck + 15, wall + 1, board);
  const cells = ring(cx, cy, 2.1, 3.9);
  for (const tone of [MAT.cloth, MAT.cream]) {
    const mine = cells.filter(([u, v]) => {
      const quarter = Math.floor((Math.atan2(v + 0.5 - cy, u + 0.5 - cx) + Math.PI * 1.25) / (Math.PI / 2)) % 4;
      return (quarter % 2 === 0) === (tone === MAT.cloth);
    });
    runs(mine, (x0, x1, y) => b.add(x0, y, layer, x1, y + 1, layer + 1, tone));
  }
  b.add(54, deck + 13, layer, 55, deck + 14, layer + 1, iron);
}
