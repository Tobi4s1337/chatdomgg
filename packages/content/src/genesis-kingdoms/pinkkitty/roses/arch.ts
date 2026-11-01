import type { VoxelBlueprint } from '@chatdom/shared';
import { MAT } from '../../../materials';
import { Grid, blob, bloom, blueprint, hash, type Allow } from './shape';

/**
 * The lane-mouth rose arch, in build cells. X runs across the lane with the opening centred; Z is the arch's depth
 * (the lane runs along it); y = 0 is the ground. Each side of the opening carries one post and its roses inside a
 * band `side` cells wide, so a host keeps the lane clear by giving the opening alone to walkers.
 */
export const ROSE_ARCH_POST = {
  /** Cells from the outer edge of the piece to the opening, on each side. */
  side: 10,
  /** Depth of the whole piece along Z. */
  depth: 10,
  /** The square timber post's section. */
  section: 4,
  /** The dark stone footing's square, one cell wider than the post all round. */
  footing: 6,
  /** Top of the post capitals, where the hoop springs. */
  springing: 30,
} as const;

/** Clear height guaranteed everywhere inside the opening: nothing hangs lower than this. */
export const ROSE_ARCH_CLEAR_HEIGHT = 28;
export const ROSE_ARCH_WIDTHS = { min: 32, max: 48, default: 40 } as const;

export interface RoseArchFrame {
  readonly size: readonly [number, number, number];
  /** The clear opening: half-open X range across the full depth, air from y = 0 to `height`. */
  readonly opening: { readonly x: readonly [number, number]; readonly height: number };
  /** Each side's whole ground footprint (post, footing, climbing and foot roses), half-open X and Z ranges. */
  readonly posts: readonly { readonly x: readonly [number, number]; readonly z: readonly [number, number] }[];
  /** Each post's dark stone footing, half-open X and Z ranges. */
  readonly footings: readonly { readonly x: readonly [number, number]; readonly z: readonly [number, number] }[];
}

const BEAM = 3, BEAM_Z = [3, 7] as const, PITCH = 20;

function check(clearWidthCells: number): void {
  if (!Number.isInteger(clearWidthCells) || clearWidthCells < ROSE_ARCH_WIDTHS.min || clearWidthCells > ROSE_ARCH_WIDTHS.max)
    throw new Error(`A rose arch spans ${ROSE_ARCH_WIDTHS.min} to ${ROSE_ARCH_WIDTHS.max} whole cells, not ${String(clearWidthCells)}.`);
}

/** The hoop's circle: it springs from the posts' inner faces at the springing height and rises about a quarter of its span. */
function hoop(clearWidthCells: number) {
  const { side, springing } = ROSE_ARCH_POST, sizeX = clearWidthCells + side * 2, cx = sizeX / 2;
  const half = clearWidthCells / 2 + 1, rise = Math.round(clearWidthCells * 0.27);
  const radius = (half * half + rise * rise) / (2 * rise), centreY = springing + rise - radius;
  return { sizeX, cx, half, rise, radius, centreY, sizeY: springing + rise + BEAM + 8 };
}

/** The arch's frame for a host: overall size, the clear opening and the two post footprints. */
export function roseArchFrame(clearWidthCells: number = ROSE_ARCH_WIDTHS.default): RoseArchFrame {
  check(clearWidthCells);
  const { side, depth, section } = ROSE_ARCH_POST, { sizeX, sizeY } = hoop(clearWidthCells);
  const x0 = side, x1 = side + clearWidthCells;
  return {
    size: [sizeX, sizeY, depth],
    opening: { x: [x0, x1], height: ROSE_ARCH_CLEAR_HEIGHT },
    posts: [{ x: [0, x0], z: [0, depth] }, { x: [x1, sizeX], z: [0, depth] }],
    footings: [{ x: [x0 - 2 - section, x0], z: [2, 8] }, { x: [x1, x1 + 2 + section], z: [2, 8] }],
  };
}

/**
 * A lane-mouth rose arch. Two square timber posts stand on chamfered dark stone footings with brass shoes and
 * collars under moulded capitals. From the capitals springs a segmental timber hoop, three cells deep, bound by four
 * brass straps, with a brass disc and rose boss on both faces at its crown. A climbing rose is planted at the foot
 * of each post, twists up it in two strands with leafy tufts and heads, and masses thickly over the capitals and
 * along the top of the hoop, draping down its faces and dropping a few short trails with a head at the tip. The
 * timber still shows along the hoop's lower faces and soffit. Nothing comes lower than 28 cells over the opening.
 */
export function createRoseArch(clearWidthCells: number = ROSE_ARCH_WIDTHS.default): VoxelBlueprint {
  check(clearWidthCells);
  const frame = roseArchFrame(clearWidthCells), { section: P, springing: S, depth: D } = ROSE_ARCH_POST;
  const { sizeX, cx, half, radius: R, centreY, sizeY } = hoop(clearWidthCells);
  const [x0, x1] = frame.opening.x, seed = 0xa5c4 + clearWidthCells * 104729, grid = new Grid([sizeX, sizeY, D]);
  const dist = (x: number, y: number) => Math.hypot(x + 0.5 - cx, y + 0.5 - centreY);
  const inOpening = (x: number) => x >= x0 && x < x1;
  // The lowest hoop course in each column over the opening.
  const soffit = (x: number) => { let y = S; while (dist(x, y) < R) y++; return y; };
  const crownSoffit = soffit(Math.floor(cx));

  // Posts: footing, brass shoe, the post, a brass collar below the capital and the two-course capital.
  const posts = [x0 - 1 - P, x1 + 1];
  for (const px of posts) {
    grid.softSquare(px - 1, 2, px + P + 1, 8, 0, 2, MAT.darkStone);
    grid.fill(px - 1, 2, 3, px + P + 1, 3, 7, MAT.darkStone);
    grid.fill(px, 2, 2, px + P, 3, 8, MAT.darkStone);
    grid.fill(px, 3, 2, px + P, 4, 8, MAT.brass);
    grid.fill(px - 1, 3, 3, px + P + 1, 4, 7, MAT.brass);
    grid.fill(px, 4, 3, px + P, S - 2, 7, MAT.timber);
    grid.fill(px, S - 5, 2, px + P, S - 4, 8, MAT.brass);
    grid.fill(px - 1, S - 5, 3, px + P + 1, S - 4, 7, MAT.brass);
    grid.softSquare(px - 1, 2, px + P + 1, 8, S - 2, S, MAT.timber);
    grid.fill(px, S - 3, 2, px + P, S - 2, 8, MAT.timber);
    // A saddle on the capital seats the hoop's foot.
    grid.fill(px, S, BEAM_Z[0], px + P, S + 2, BEAM_Z[1], MAT.timber);
  }

  // The hoop with its brass straps, square-ended over the posts.
  const reach = half + P;
  const spring = Math.asin(Math.min(1, half / R)), mid = R + BEAM / 2;
  const straps = [-0.7, -0.3, 0.3, 0.7].map(k => k * spring);
  for (let y = S; y < sizeY; y++) for (let x = 0; x < sizeX; x++) {
    const r = dist(x, y);
    if (r < R || r >= R + BEAM || Math.abs(x + 0.5 - cx) > reach) continue;
    const a = Math.atan2(x + 0.5 - cx, y + 0.5 - centreY), strap = straps.some(s => Math.abs(a - s) * mid < 0.55);
    grid.fill(x, y, BEAM_Z[0], x + 1, y + 1, BEAM_Z[1], strap ? MAT.brass : MAT.timber);
  }

  // The crown disc and rose boss on both faces, hanging just below the soffit like a keystone.
  const even = sizeX % 2 === 0, dw = even ? 6 : 5, bw = even ? 4 : 3, dx0 = Math.round(cx - dw / 2), bx0 = Math.round(cx - bw / 2);
  const discY = crownSoffit - 2;
  for (const [disc, boss] of [[BEAM_Z[0] - 1, BEAM_Z[0] - 2], [BEAM_Z[1], BEAM_Z[1] + 1]] as const) {
    grid.fill(dx0 + 1, discY, disc, dx0 + dw - 1, discY + dw, disc + 1, MAT.brass);
    grid.fill(dx0, discY + 1, disc, dx0 + dw, discY + dw - 1, disc + 1, MAT.brass);
    grid.fill(bx0 + 1, discY + 1, boss, bx0 + bw - 1, discY + 1 + bw, boss + 1, MAT.petal);
    grid.fill(bx0, discY + 2, boss, bx0 + bw, discY + bw, boss + 1, MAT.petal);
    const core = even ? [Math.round(cx) - 1, Math.round(cx) + 1] : [Math.floor(cx), Math.floor(cx) + 1];
    grid.fill(core[0]!, discY + 2, boss, core[1]!, discY + bw, boss + 1, MAT.fabricRed);
  }
  const medallion = (x: number, y: number, z: number) => Math.abs(x + 0.5 - cx) <= dw / 2 + 1 && y < discY + dw + 1 && (z < BEAM_Z[0] || z >= BEAM_Z[1]);

  // Where the roses may grow up top: over the opening only on the hoop's outer half and above, never on the soffit,
  // never across the crown disc, and always a cell short of the top for heads.
  const mass: Allow = (x, y, z) => y < sizeY - 1 && !medallion(x, y, z) && (!inOpening(x) || dist(x, y) >= R + 1.5) && !(inOpening(x) && y < soffit(x));

  // The foot of each climber: a planted mound outside the footing, and a second one to the front or the back.
  const [lp, rp] = posts as [number, number];
  blob(grid, [lp - 1.4, 0.4, 5.2], [2.8, 4.2, 3.6], MAT.leaf, { allow: x => x < x0 });
  blob(grid, [lp + P / 2 - 0.5, 0.3, 0.9], [2.6, 3, 1.7], MAT.leaf, { allow: x => x < x0 });
  blob(grid, [rp + P + 1.4, 0.4, 4.8], [2.8, 4.2, 3.6], MAT.leaf, { allow: x => x >= x1 });
  blob(grid, [rp + P / 2 + 0.5, 0.3, 9.1], [2.6, 3, 1.7], MAT.leaf, { allow: x => x >= x1 });

  // Two strands twist up each post on the ring of cells around it, with a leafy tuft standing out every few courses.
  for (const [side, px] of [[0, lp], [1, rp]] as const) {
    const pcx = px + P / 2, pcz = 5, phase = side * 2.1 + hash(seed, side) * 0.8;
    const around = (x: number, z: number) => Math.atan2(z + 0.5 - pcz, x + 0.5 - pcx);
    const ring: [number, number][] = [];
    for (let z = BEAM_Z[0] - 1; z < BEAM_Z[1] + 1; z++) for (let x = px - 1; x < px + P + 1; x++)
      if (x < px || x >= px + P || z < BEAM_Z[0] || z >= BEAM_Z[1]) ring.push([x, z]);
    for (let y = 3; y < S + 1; y++) for (const strand of [0, Math.PI]) {
      const t = (Math.PI * 2 * (y - 3)) / PITCH + strand + phase;
      for (const [x, z] of ring) {
        const gap = Math.abs(Math.atan2(Math.sin(around(x, z) - t), Math.cos(around(x, z) - t)));
        if (gap > 0.55 || grid.get(x, y, z) !== MAT.air) continue;
        grid.set(x, y, z, MAT.leaf);
        // A tuft standing out from the strand, never into the lane.
        if (gap < 0.2 && (y + strand * 3) % 4 === 0) {
          // At a ring corner the tuft steps out along one axis only, so it joins the strand through a face.
          const corner = (x < px || x >= px + P) && (z < BEAM_Z[0] || z >= BEAM_Z[1]), alongX = !corner || y % 2 === 0;
          const ox = !alongX ? 0 : x < px ? -1 : x >= px + P ? 1 : 0, oz = corner && alongX ? 0 : z < BEAM_Z[0] ? -1 : z >= BEAM_Z[1] ? 1 : 0;
          if (!inOpening(x + ox) && grid.get(x + ox, y, z + oz) === MAT.air) grid.set(x + ox, y, z + oz, MAT.leaf);
        }
      }
    }
    // The rose comes over the capital in a heavy haunch.
    blob(grid, [pcx + (side ? 0.6 : -0.6), S + 1.5, 5], [4.3, 4, 4.6], MAT.leaf, { allow: mass });
    blob(grid, [pcx + (side ? 3 : -3), S - 1, 4.6], [2.2, 2.6, 2.8], MAT.leaf, { allow: (x, y, z) => mass(x, y, z) && !inOpening(x) });
  }

  // The garland along the hoop: overlapping clumps on its back, bigger at the haunches and the crown.
  const top = R + BEAM - 0.4, arc = (spring + 0.18) * 2 * top, clumps = Math.ceil(arc / 3.6);
  for (let i = 0; i <= clumps; i++) {
    const a = -spring - 0.18 + ((spring + 0.18) * 2 * i) / clumps, crown = 1 - Math.abs(a) / spring;
    const lift = top + (hash(seed, i, 1) - 0.3) * 1.2, swell = 2.5 + hash(seed, i, 2) * 1.2 + (crown > 0.75 || crown < 0.2 ? 0.7 : 0);
    const zc = 5 + (hash(seed, i, 3) - 0.5) * 1.4;
    blob(grid, [cx + Math.sin(a) * lift, centreY + Math.cos(a) * lift, zc], [swell + 0.6, swell, 4.1 + hash(seed, i, 4) * 0.5], MAT.leaf, { allow: mass, power: 2.1 });
  }

  // The older growth: wherever the rose hangs out over air, its underside turns olive, as on the bushes.
  for (let y = S - 4; y < sizeY; y++) for (let z = 0; z < D; z++) for (let x = 0; x < sizeX; x++)
    if (grid.get(x, y, z) === MAT.leaf && grid.get(x, y - 1, z) === MAT.air) grid.set(x, y, z, MAT.moss);

  // Short trails dropping over the hoop's faces, a head at each tip, all well above the clear height.
  const trails = Math.round(clearWidthCells / 7);
  for (let i = 0; i < trails; i++) {
    const x = x0 + 3 + Math.floor(((i + 0.25 + hash(seed, i, 41) * 0.5) / trails) * (clearWidthCells - 6));
    if (Math.abs(x + 0.5 - cx) <= dw / 2 + 2) continue;
    const z = i % 2 === 0 ? BEAM_Z[0] - 1 : BEAM_Z[1], under = soffit(x);
    let y = under + 2;
    while (grid.get(x, y, z) === MAT.air && y < sizeY - 1) y++;
    const tip = Math.max(ROSE_ARCH_CLEAR_HEIGHT, under - 1 - Math.floor(hash(seed, i, 42) * 3));
    if (grid.get(x, y, z) === MAT.air) continue;
    grid.fill(x, tip + 1, z, x + 1, y, z + 1, MAT.leaf, true);
    grid.set(x, tip, z, hash(seed, i, 43) < 0.25 ? MAT.fabricRed : MAT.petal);
  }

  bloom(grid, {
    seed, count: clearWidthCells * 2 + 30, spacing: 2.1, proud: 0.45, lift: 0.25,
    colour: u => u < 0.14 ? MAT.fabricRed : u < 0.8 ? MAT.petal : MAT.fabricViolet,
    allow: (x, y, z) => !inOpening(x) ? x >= 0 && y < sizeY - 1 : mass(x, y, z),
  });
  return blueprint(`genesis-pinkkitty-rose-arch-w${clearWidthCells}`, 'civic', grid);
}
