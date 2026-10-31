import { MAT } from '@chatdom/content';
import { VOXEL_METRES, type HomeTier, type VoxelAsset } from '@chatdom/shared';
import { hash2 } from './stage';

const CELL = VOXEL_METRES.build;

/**
 * The town square in the composition's own frame: metres, the statue at the origin facing +Z, the
 * camera out in front. Homes ring the back and sides, turned to face the statue; the market fills
 * the near corners so the frame has a foreground.
 */
export const SQUARE = {
  /** Ground slab extent in metres (x and z) and the height of its paved top, in build cells. */
  min: [-28, -32] as const,
  max: [28, 22] as const,
  top: 3,
  /** The statue's dais: an outer step and an inner floor, radii in metres. */
  daisOuter: 5.4,
  daisInner: 4.55,
  /** The dark compass ring set into the paving, and the edge of the fan-laid setts. */
  ring: 9.2,
  fan: 13.5,
} as const;
export const GROUND_Y = SQUARE.top * CELL;
export const DAIS_OUTER_Y = (SQUARE.top + 1) * CELL;
export const DAIS_Y = (SQUARE.top + 2) * CELL;

export interface HomePlot {
  readonly tier: HomeTier;
  readonly variant: 0 | 1 | 2;
  /** Middle of the street front, on the paving, in metres. */
  readonly front: readonly [number, number];
  /** Turn about +Y; zero faces the camera (+Z). */
  readonly facing: number;
  /** Whether someone is home tonight: the SIMULATED presence lights these windows. */
  readonly lit: boolean;
}

/** Six real Hearth homes in a loose ring, each turned toward the statue, tiers and families mixed. */
export const HOME_PLOTS: readonly HomePlot[] = [
  { tier: 'house', variant: 1, front: [-14.6, -9.0], facing: .5, lit: true },
  { tier: 'manor', variant: 0, front: [-5.2, -12.6], facing: .12, lit: true },
  { tier: 'hall', variant: 2, front: [4.6, -13.1], facing: -.1, lit: true },
  { tier: 'house', variant: 0, front: [14.2, -9.6], facing: -.52, lit: false },
  { tier: 'cottage', variant: 2, front: [-20.4, 0.4], facing: 1.12, lit: true },
  { tier: 'manor', variant: 1, front: [20.6, 0.2], facing: -1.12, lit: true },
];

/** Things standing on the square, in metres; `facing` turns their +Z front about +Y. */
export const PROPS = {
  banners: [{ at: [-6.1, -.9], facing: .16 }, { at: [6.1, -.9], facing: -.16 }],
  lanterns: [[-3.9, 3.0], [3.9, 3.0], [-4.6, -1.8], [4.6, -1.8]],
  stall: { at: [-9.8, 5.6], facing: .62 },
  well: { at: [10.4, 2.9], facing: -.4 },
  seats: [{ at: [6.6, 7.4], facing: -.35 }, { at: [-2.6, 8.9], facing: .1 }],
  troughs: [{ at: [-11.2, -6.4], facing: .5 }, { at: [-1.7, -10.0], facing: .12 }, { at: [8.3, -10.6], facing: -.1 }, { at: [-15.9, 2.6], facing: 1.12 }],
  shrubs: [[-9.3, -10.4], [9.5, -11.5], [-18.6, -5.2], [18.6, -5.4], [-17.4, 6.1], [16.2, 7.6]],
  pots: [[2.6, -11.0], [-7.6, -9.4], [12.6, -5.0]],
} as const;

/** SIMULATED citizens for scale, never more than two: one waves back at the statue, one minds the stall. */
export const CITIZENS = [
  { look: 'citizen-a', at: [2.15, 4.4], facing: Math.PI + .55, waving: true },
  { look: 'common-short-cloak-tide', at: [-7.5, 6.9], facing: 2.55, waving: false },
] as const;

/**
 * The paved floor of the square, built straight into one build-lattice asset so the mesher bakes AO
 * across it. Setts are laid in fans around the statue (the old way to pave a round square), a dark
 * compass ring sits in them, the dais rises in two limestone steps, and beyond the fans the street
 * runs in a coursed bond with moss and turf in the quiet edges.
 */
export function squareAsset(): VoxelAsset {
  const nx = Math.round((SQUARE.max[0] - SQUARE.min[0]) / CELL), nz = Math.round((SQUARE.max[1] - SQUARE.min[1]) / CELL), ny = SQUARE.top + 2;
  const voxels = new Uint16Array(nx * ny * nz);
  const fans = [MAT.paving, MAT.paving, MAT.stone, MAT.paving, MAT.limestone, MAT.stone, MAT.paving, MAT.darkStone];
  const street = [MAT.stone, MAT.paving, MAT.stone, MAT.darkStone, MAT.stone, MAT.paving];
  const set = (x: number, y: number, z: number, material: number) => { voxels[x + nx * (y + ny * z)] = material; };
  for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) {
    const wx = SQUARE.min[0] + (x + .5) * CELL, wz = SQUARE.min[1] + (z + .5) * CELL;
    const r = Math.hypot(wx, wz), angle = Math.atan2(wz, wx);
    let top: number, height = SQUARE.top;
    if (r <= SQUARE.daisInner) {
      // The dais floor: limestone flags in two rings round a dark inlaid circle under the plinth.
      const ring = Math.floor(r / .75), flag = Math.floor((angle + Math.PI) * Math.max(1, r) / .9 + ring * .5);
      top = r > SQUARE.daisInner - .25 ? MAT.darkStone : hash2(ring * 31 + flag, 11) % 5 === 0 ? MAT.cream : MAT.limestone;
      height = SQUARE.top + 2;
    } else if (r <= SQUARE.daisOuter) {
      top = r > SQUARE.daisOuter - .2 ? MAT.stone : MAT.limestone;
      height = SQUARE.top + 1;
    } else if (r <= SQUARE.fan) {
      // Fan-laid setts: rings half a metre wide, each sett a little longer than the ring is wide.
      const ring = Math.floor((r - SQUARE.daisOuter) / .5), along = Math.floor((angle + Math.PI) * r / .56 + (ring % 2) * .5);
      const joint = (r - SQUARE.daisOuter) % .5 < CELL * .9;
      const sett = hash2(ring, along);
      top = Math.abs(r - SQUARE.ring) < .32 ? (Math.abs(r - SQUARE.ring) < .15 ? MAT.brass : MAT.darkStone)
        : joint && sett % 3 === 0 ? MAT.darkStone : fans[sett % fans.length]!;
      if (top === MAT.brass && hash2(along, 3) % 4) top = MAT.darkStone;
    } else {
      // The street beyond the fans: coursed setts, worn smooth, with moss and turf where nobody walks.
      const row = Math.floor(z / 3), sett = hash2(Math.floor((x + (row % 2) * 3) / 5), row);
      const quiet = (hash2(Math.floor(x / 6), Math.floor(z / 6)) % 1000) / 1000;
      const edge = Math.min(Math.abs(wx - SQUARE.min[0]), Math.abs(wx - SQUARE.max[0]), Math.abs(wz - SQUARE.min[1]), Math.abs(wz - SQUARE.max[1]));
      top = street[sett % street.length]!;
      if (r > 17 && quiet > .55 + edge * .02) top = quiet > .8 ? MAT.grass : MAT.moss;
    }
    for (let y = 0; y < height; y++) set(x, y, z, y === height - 1 ? top : y >= SQUARE.top - 1 ? MAT.stone : MAT.earth);
  }
  return { id: 'bench.emote-square', revision: 1, lattice: 'build', size: [nx, ny, nz], voxels };
}
