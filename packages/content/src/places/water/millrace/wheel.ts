import type { Vec3 } from '@chatdom/shared';
import { Boxes } from '../../../civic/kit';
import { MAT, type StyleKey } from '../../../materials';
import { NO_METADATA, type WaterPiece } from '../place-piece';
import { IRON, checkStyle, millBlueprint, runs, stroke, wood } from './craft';

/**
 * The overshot wheel, frozen so the pit, the trough and the host's spin all agree. The wheel turns in the YZ
 * plane about an axle along X. Its hub centre sits on the cell corner (y 20, z 20), so the lattice is symmetric
 * under quarter turns about it. Rotating positively about the mount axis [1,0,0] carries the top towards +Z:
 * water enters just past top dead centre and the +Z side descends full.
 */
export const WHEEL = {
  /** Build cells: 2.5 m along the axle, 5 m across. */
  size: [20, 40, 40] as const satisfies Vec3,
  /** The hub centre (y, z) in the wheel plane: a cell corner. */
  hub: [20, 20] as const,
  /** Outer radius of the shrouds in cells: the rim's outermost cells reach y = 0 and y = 39. */
  radius: 20,
  buckets: 20,
  /** Half-open X spans: the axle, its two iron journals, the hub, both shrouds and the bucket floor between them. */
  axle: [0, 20] as const,
  journals: [[0, 2], [18, 20]] as const,
  hubSpan: [3, 17] as const,
  shrouds: [[4, 6], [14, 16]] as const,
  sole: [6, 14] as const,
} as const;

/** Radii in cells, measured from the hub corner to cell centres. */
const HUB_R = 3.2, BAND_R = 3.7, SHROUD_IN = 16.4, SOLE_IN = 15.3, SOLE_OUT = 16.9, KNEE_R = 18.2, TIP_R = 19.9;
/** How far (radians) each bucket's outer board leans back against the turn, so the pocket holds on the way down. */
const LEAN = 0.15;
/** The board's start: bucket 0 sits half a pitch past top dead centre, under where the lip spills. */
const PHASE = Math.PI / WHEEL.buckets;
/** Eight arms per shroud, set off the axes so none of them reads as a ruler line. */
const ARMS = 8, ARM_PHASE = Math.PI / 8;
/** Buckets that have grown a little weed, chosen once; the rest are clean wet wood. */
const WEEDY: Readonly<Record<StyleKey, readonly number[]>> = { hearth: [3, 11, 16], tide: [2, 9, 15], grove: [1, 6, 12, 17] };

type Cell2 = readonly [number, number];

/** The (y, z) cell centre at radius r and angle φ, where φ = 0 is the top and φ grows towards +Z. */
const polar = (r: number, phi: number): Cell2 => [WHEEL.hub[0] + r * Math.cos(phi), WHEEL.hub[1] + r * Math.sin(phi)];
const radius = (y: number, z: number) => Math.hypot(y + 0.5 - WHEEL.hub[0], z + 0.5 - WHEEL.hub[1]);

/** Every cell of the wheel plane that satisfies the predicate. */
function disc(inside: (y: number, z: number) => boolean): [number, number][] {
  const out: [number, number][] = [];
  for (let y = 0; y < WHEEL.size[1]; y++) for (let z = 0; z < WHEEL.size[2]; z++) if (inside(y, z)) out.push([z, y]);
  return out;
}

/** Lays wheel-plane cells (given as [z, y]) as boxes spanning x0..x1. */
function lay(b: Boxes, cells: Iterable<Cell2>, x0: number, x1: number, material: number): void {
  runs(cells, (z0, z1, y) => b.add(x0, y, z0, x1, y + 1, z1, material));
}

/** One bucket board as wheel-plane cells: radial off the sole, then leaning back to the rim. */
function bucket(i: number): [number, number][] {
  const phi = PHASE + (2 * Math.PI * i) / WHEEL.buckets;
  const [a, k, t] = [polar(SOLE_OUT - 0.4, phi), polar(KNEE_R, phi), polar(TIP_R - 0.3, phi - LEAN)];
  const cells = [...stroke([a[1], a[0]], [k[1], k[0]]), ...stroke([k[1], k[0]], [t[1], t[0]])];
  // Only what lies inside the rim belongs to the board.
  return cells.filter(([z, y]) => y >= 0 && z >= 0 && y < WHEEL.size[1] && z < WHEEL.size[2] && radius(y, z) < WHEEL.radius);
}

/**
 * The dynamic overshot wheel: an axle with iron journals, a banded hub, two shrouds 3–4 cells deep with eight
 * arms each, a sole ring between them and twenty bucket pockets whose boards lean back so they hold water on the
 * descending side. The bucket boards' end grain shows on the outer shroud faces, so the buckets read from the
 * side; a few buckets carry weed. Everything is face-connected to the axle, which the host mounts at `axle`.
 */
export function createMillWheel(style: StyleKey): WaterPiece {
  checkStyle('mill wheel', style);
  const { plank, end } = wood(style), b = new Boxes(), [X0, X1] = WHEEL.sole;
  // The shrouds: rings of felloes, the outermost course of each face banded in iron at the five felloe joints.
  const ring = disc((y, z) => { const r = radius(y, z); return r >= SHROUD_IN && r < WHEEL.radius; });
  for (const [s0, s1] of WHEEL.shrouds) lay(b, ring, s0, s1, plank);
  // The sole: the floor every pocket sits on, overlapping the shrouds' inner course so it is let into them.
  lay(b, disc((y, z) => { const r = radius(y, z); return r >= SOLE_IN && r < SOLE_OUT; }), X0, X1, plank);
  // The arms: hub to sole in each shroud plane, two cells broad, with an iron strap where they meet the sole.
  for (let a = 0; a < ARMS; a++) {
    const phi = ARM_PHASE + (2 * Math.PI * a) / ARMS;
    const [p, q] = [polar(HUB_R - 0.6, phi), polar(SOLE_IN + 0.6, phi)];
    const arm = stroke([p[1], p[0]], [q[1], q[0]], 1);
    const strap = arm.filter(([z, y]) => { const r = radius(y, z); return r >= SOLE_IN - 2.2 && r < SOLE_IN - 1; });
    for (const [s0, s1] of WHEEL.shrouds) { lay(b, arm, s0, s1, plank); lay(b, strap, s0, s1, IRON); }
  }
  // The buckets, and their end grain on the outer faces of both shrouds.
  const boards = Array.from({ length: WHEEL.buckets }, (_, i) => bucket(i));
  const [[w0], [, e1]] = WHEEL.shrouds;
  boards.forEach((cells, i) => {
    lay(b, cells, X0, X1, plank);
    const ends = cells.filter(([z, y]) => radius(y, z) >= SHROUD_IN);
    lay(b, ends, w0, w0 + 1, end);
    lay(b, ends, e1 - 1, e1, end);
    if (WEEDY[style].includes(i)) {
      // Weed at the lip: the outermost cells of the board go to moss, and a leaf frond trails into the pocket.
      const tip = cells.filter(([z, y]) => radius(y, z) >= TIP_R - 1.4);
      lay(b, tip, X0 + 1 + (i % 3), X1 - 1, MAT.moss);
      const frond = tip.slice(0, 1);
      lay(b, frond, X0 + 2 + (i % 2), X0 + 4 + (i % 2), MAT.leaf);
    }
  });
  // Felloe joints: an iron plate through each shroud face at five points round the ring, between buckets.
  for (let j = 0; j < 5; j++) {
    const [y, z] = polar((SHROUD_IN + WHEEL.radius) / 2, (2 * Math.PI * j) / 5 + 0.05).map(Math.floor) as [number, number];
    for (const x of [w0, e1 - 1]) b.add(x, y, z, x + 1, y + 1, z + 1, IRON);
  }
  // The hub: a faceted drum with iron bands at both ends and the middle, standing a touch proud.
  const [h0, h1] = WHEEL.hubSpan;
  lay(b, disc((y, z) => radius(y, z) < HUB_R), h0, h1, plank);
  const band = disc((y, z) => radius(y, z) < BAND_R);
  for (const x of [h0, Math.floor((h0 + h1) / 2) - 1, h1 - 1]) lay(b, band, x, x + (x === h0 || x === h1 - 1 ? 1 : 2), IRON);
  // The axle, square in section, and its iron journals where the bearings carry it.
  const [y0, z0] = [WHEEL.hub[0] - 1, WHEEL.hub[1] - 1];
  b.add(WHEEL.axle[0], y0, z0, WHEEL.axle[1], y0 + 2, z0 + 2, plank);
  for (const [j0, j1] of WHEEL.journals) b.add(j0, y0, z0, j1, y0 + 2, z0 + 2, IRON);
  const blueprint = millBlueprint(`water-${style}-mill-wheel`, style, 'prop', WHEEL.size, b);
  const centre: Vec3 = [(WHEEL.axle[0] + WHEEL.axle[1]) / 2, WHEEL.hub[0], WHEEL.hub[1]];
  return {
    ...NO_METADATA, blueprint,
    mounts: [{ id: 'axle', position: centre, axis: [1, 0, 0] }],
    sounds: [{ id: 'wheel', kind: 'wheel', position: centre }],
  };
}

/** Axle cells to seed a support flood from: the wheel hangs from its bearings, not from the bottom of its box. */
export const WHEEL_AXLE_SEEDS: readonly Vec3[] = [
  [WHEEL.journals[0][0], WHEEL.hub[0] - 1, WHEEL.hub[1] - 1],
  [WHEEL.journals[1][1] - 1, WHEEL.hub[0], WHEEL.hub[1]],
];
