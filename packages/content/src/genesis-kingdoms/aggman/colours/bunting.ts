import { MAT, STYLES } from '../../../materials';
import type { AggmanPiece, Livery } from '../piece';
import { Cells, pieceId, toPiece } from './cells';

/**
 * A run of bunting, in build cells: two timber posts on stone feet at the ends of the run (x 1..3 and the mirror
 * at the far end), a rope tied to brass rings 3.75 m up (y 30) that hangs between them in a true catenary, and
 * a line of small triangular flags sewn over it. The run is `lengthCells` long on x and 6 cells deep;
 * the rope and flags hang in the plane z 1..4.
 */
export const BUNTING = {
  lengths: { min: 64, max: 200 },
  sag: { min: 0, max: 16 },
  tie: 30,
  height: 34,
  depth: 6,
  flag: { width: 6, depth: 8, pitch: 7 },
} as const;

/**
 * The colour rhythm, read outward from the middle of the run so the line is balanced about its lowest point:
 * red at the centre, then gold, blue and cream, and round again.
 */
const RHYTHM = ['red', 'gold', 'blue', 'cream'] as const;
/** How each flag swings in the wind: its lower half kicks a cell forward, back or hangs plumb. */
const LEAN = [1, 0, -1, 0, 1, -1, 0] as const;

/** The catenary through (0, 0) and (span, 0) whose lowest point is `sag` below them, as height above that point. */
function catenary(span: number, sag: number): (x: number) => number {
  if (sag <= 0) return () => 0;
  // Solve a·(cosh(span / 2a) − 1) = sag for the catenary parameter a by bisection.
  let lo = 1e-3, hi = 1e6;
  for (let i = 0; i < 200; i++) {
    const a = (lo + hi) / 2, s = a * (Math.cosh(span / (2 * a)) - 1);
    if (s > sag) lo = a; else hi = a;
  }
  const a = (lo + hi) / 2;
  return x => a * (Math.cosh((x - span / 2) / a) - 1) - sag;
}

export function createBuntingRun(livery: Livery, lengthCells: number, sagCells: number): AggmanPiece {
  const { lengths, sag, tie, height, depth, flag } = BUNTING;
  if (!Number.isInteger(lengthCells) || lengthCells < lengths.min || lengthCells > lengths.max) {
    throw new Error(`Bunting length ${lengthCells} must be a whole number of cells from ${lengths.min} to ${lengths.max}.`);
  }
  if (!Number.isInteger(sagCells) || sagCells < sag.min || sagCells > sag.max) {
    throw new Error(`Bunting sag ${sagCells} must be a whole number of cells from ${sag.min} to ${sag.max}.`);
  }
  const L = lengthCells, c = new Cells(L, height, depth), timber = STYLES.tide.trim;
  // The posts: stone feet, a rope whipping at hand height, a cap and a brass ball; a brass ring takes the rope.
  for (const px of [1, L - 3]) {
    c.chamfer(px - 1, 0, 1, px + 3, 2, 5, 1, STYLES.tide.stone);
    c.fill(px, 2, 2, px + 2, tie + 2, 4, timber);
    c.fill(px - 1, 8, 2, px + 3, 9, 4, MAT.thatch);
    c.fill(px, 8, 1, px + 2, 9, 5, MAT.thatch);
    c.chamfer(px - 1, tie + 2, 1, px + 3, tie + 3, 5, 1, timber);
    c.fill(px, tie + 3, 2, px + 2, tie + 4, 4, livery.brass);
    const ring = px === 1 ? 3 : L - 4;
    c.fill(ring, tie - 1, 2, ring + 1, tie + 1, 3, livery.brass);
  }
  // The rope: one cell from ring to ring, each column stepping down to meet its neighbour, so it stays unbroken.
  const from = 4, to = L - 5, curve = catenary(to - from, sagCells);
  const ropeY = (x: number) => tie + Math.round(curve(x - from));
  const low: number[] = [];
  for (let x = from; x <= to; x++) {
    const y = ropeY(x), prev = x > from ? ropeY(x - 1) : y;
    const a = Math.min(y, prev), b = Math.max(y, prev);
    for (let j = a; j <= b; j++) c.set(x, j, 2, MAT.thatch);
    low[x] = a;
  }
  // The flags: each column of a flag hangs from the rope's lowest cell above it, so the head follows the rope's
  // slope; the triangle narrows to a two-cell point. Swinging flags fold forward or back at mid height, the fold
  // a cell thick both ways so the cloth stays whole.
  const count = Math.floor((to - from - 6 + (flag.pitch - flag.width)) / flag.pitch);
  const start = Math.round((L - (count * flag.pitch - (flag.pitch - flag.width))) / 2);
  const colour = { red: livery.red, gold: livery.gold, blue: livery.blue, cream: livery.cream };
  for (let k = 0; k < count; k++) {
    const rhythm = Math.floor(Math.abs(k - (count - 1) / 2));
    const material = colour[RHYTHM[rhythm % RHYTHM.length]!];
    const lean = LEAN[k % LEAN.length]!, fold = Math.floor(flag.depth / 2);
    for (let j = 0; j < flag.width; j++) {
      const x = start + k * flag.pitch + j;
      const reach = Math.max(2, Math.round(flag.depth * (1 - Math.abs(j + 0.5 - flag.width / 2) / (flag.width / 2 + 0.4))));
      for (let r = 0; r < reach; r++) {
        const y = low[x]! - 1 - r;
        if (lean && r >= fold) c.set(x, y, 2 + lean, material);
        if (!lean || r <= fold) c.set(x, y, 2, material);
      }
    }
  }
  return toPiece(pieceId(`bunting-${L}-${sagCells}`, livery), 'prop', c, [], { from: [0, 1], to: [L, 5] });
}
