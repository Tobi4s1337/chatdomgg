import type { Vec3 } from '@chatdom/shared';
import { MAT, STYLES } from '../../../materials';
import type { AggmanPiece, Livery } from '../piece';
import { Cells, pieceId, smallLantern, toPiece } from './cells';

/**
 * The market awning, in build cells. Two timber posts stand at the back (z 1..3) on stone pads; from each a
 * rafter runs forward and falls two cells over the 2 m depth, braced back to its post. Striped canvas, two cells
 * thick, lies over the rafters and sags a cell between them, from 2.6 m at the back to 2.25 m at the front; a
 * timber batten carries the front edge, where a valance in the same stripes turns down over a gold piping and
 * ends in a scallop per stripe. Narrow side valances hang along both edges. +Z is the customer's side.
 */
export const AWNING = {
  widths: { min: 16, max: 64 },
  depth: 16,
  height: 22,
} as const;

const DEPTH = AWNING.depth;
/** The top of the rafter at depth z: y 19 at the posts, falling to 17 at the front. */
const rafterTop = (z: number) => 19 - Math.floor((2 * z) / DEPTH);

/** The stripes: an odd count, so both edges are the field, each about three and a half cells wide. */
function stripes(width: number): number[] {
  let count = Math.max(3, Math.round(width / 3.5));
  if (count % 2 === 0) count++;
  return Array.from({ length: count + 1 }, (_, k) => Math.round((k * width) / count));
}

/** Writes an awning `width` cells wide into a canvas with its back left corner at (ox, 0, oz). */
function awningInto(c: Cells, livery: Livery, ox: number, oz: number, width: number): void {
  const timber = STYLES.tide.trim;
  const posts = [1, width - 3];
  if (width > 36) posts.push(Math.floor(width / 2) - 1);
  const bounds = stripes(width);
  const stripeOf = (x: number) => bounds.findIndex((b, k) => x >= b && x < bounds[k + 1]!);
  const colourOf = (x: number) => (stripeOf(x) % 2 ? livery.cream : livery.red);
  const near = (x: number) => Math.min(...posts.map(p => Math.max(0, p - x, x - (p + 1))));
  const sag = (x: number) => (near(x) >= 4 ? 1 : 0);

  for (const [i, px] of posts.entries()) {
    const standing = i < 2;
    if (standing) {
      c.fill(ox + px - 1, 0, oz, ox + px + 3, 1, oz + 4, STYLES.tide.stone);
      c.fill(ox + px, 1, oz + 1, ox + px + 2, rafterTop(0) - 2, oz + 3, timber);
      // The knee brace, stepping from the post's front face up to the rafter.
      for (let step = 0; step < 4; step++) c.fill(ox + px, 12 + step, oz + 3 + step, ox + px + 2, 14 + step, oz + 4 + step, timber);
    }
    for (let z = 0; z < DEPTH; z++) c.fill(ox + px, rafterTop(z) - 2, oz + z, ox + px + 2, rafterTop(z), oz + z + 1, timber);
  }
  // The canvas.
  for (let x = 0; x < width; x++) for (let z = 0; z < DEPTH; z++) {
    const y = rafterTop(z) - sag(x);
    c.fill(ox + x, y, oz + z, ox + x + 1, y + 2, oz + z + 1, colourOf(x));
  }
  // The front batten, then the valance over it: gold piping where the canvas turns down, and a scallop per stripe.
  const front = DEPTH - 1, top = rafterTop(front);
  c.fill(ox, top - 2, oz + front, ox + width, top - 1, oz + front + 1, timber);
  for (let x = 0; x < width; x++) {
    const k = stripeOf(x), a = bounds[k]!, b = bounds[k + 1]!;
    const y = top - sag(x), drop = Math.round(2.2 * Math.sin((Math.PI * (x - a + 0.5)) / (b - a)));
    c.fill(ox + x, y - 2 - drop, oz + DEPTH, ox + x + 1, y + 2, oz + DEPTH + 1, colourOf(x));
    c.set(ox + x, y, oz + DEPTH, livery.gold);
  }
  // Side valances along both edges, scalloped every four cells.
  for (const x of [0, width - 1]) for (let z = 0; z < DEPTH; z++) {
    const y = rafterTop(z) - sag(x), drop = z % 4 === 1 || z % 4 === 2 ? 1 : 0;
    c.fill(ox + x, y - 2 - drop, oz + z, ox + x + 1, y, oz + z + 1, colourOf(x));
  }
}

export function createAwning(livery: Livery, widthCells: number): AggmanPiece {
  const { widths, height } = AWNING;
  if (!Number.isInteger(widthCells) || widthCells < widths.min || widthCells > widths.max) {
    throw new Error(`Awning width ${widthCells} must be a whole number of cells from ${widths.min} to ${widths.max}.`);
  }
  const c = new Cells(widthCells, height, DEPTH + 1);
  awningInto(c, livery, 0, 0, widthCells);
  return toPiece(pieceId(`awning-${widthCells}`, livery), 'prop', c, [], { from: [0, 0], to: [widthCells, 4] });
}

/**
 * A crate of fish: a timber box with a dark slat gap round it, packed level with silver-bellied, blue-backed fish
 * laid head to tail, and a few more heaped on top.
 */
function fishCrate(c: Cells, x: number, y: number, z: number, w: number, d: number, seed: number): void {
  c.fill(x, y, z, x + w, y + 3, z + d, STYLES.tide.trim);
  c.fill(x, y + 1, z, x + w, y + 2, z + d, MAT.bark);
  c.fill(x + 1, y + 1, z + 1, x + w - 1, y + 2, z + d - 1, STYLES.tide.trim);
  for (let j = 1; j < d - 1; j++) for (let i = 1; i < w - 1; i++) {
    const k = (i + j * 2 + seed) % 3, back = j % 2 ? k === 0 : k === 2;
    c.set(x + i, y + 2, z + j, back ? MAT.slate : MAT.hairSilver);
    if ((i * 3 + j * 5 + seed) % 7 === 0) c.set(x + i, y + 3, z + j, (i + seed) % 2 ? MAT.hairSilver : MAT.slate);
  }
}

/**
 * The fish stall, in build cells: a 3.25 m striped awning over a trestle counter (top at y 7, 0.9 m) with a
 * painted front board in the kingdom's blue carrying a cream wave, two crates of fish on the counter, a hanging
 * balance with a fish on one pan, a brass bell under the left eave, a keeper's lantern under the canvas, and
 * two more crates set out on the quay in front.
 */
export const FISH_STALL = { size: [30, 22, 21], awning: { x: 2, width: 26 } } as const;

export function createFishStall(livery: Livery): AggmanPiece {
  const { size, awning } = FISH_STALL;
  const c = new Cells(size[0], size[1], size[2]);
  const timber = STYLES.tide.trim;
  awningInto(c, livery, awning.x, 0, awning.width);
  const ox = awning.x;
  // A purlin under the canvas between the rafters, from which the balance hangs.
  c.fill(ox + 1, rafterTop(10) - 2, 10, ox + awning.width - 1, rafterTop(10) - 1, 11, timber);

  // The trestles, the counter planks with their seams, and the painted front board.
  for (const tx of [6, 22]) {
    c.fill(tx, 0, 6, tx + 2, 4, 7, timber);
    c.fill(tx, 3, 7, tx + 2, 7, 8, timber);
    c.fill(tx, 0, 13, tx + 2, 4, 14, timber);
    c.fill(tx, 3, 12, tx + 2, 7, 13, timber);
    c.fill(tx, 3, 8, tx + 2, 4, 12, timber);
  }
  c.fill(5, 7, 6, 25, 8, 14, timber);
  for (const z of [8, 11]) c.fill(5, 7, z, 25, 8, z + 1, MAT.bark);
  c.fill(5, 4, 13, 25, 7, 14, livery.blue);
  for (let x = 5; x < 25; x++) c.set(x, 5 + Math.round(Math.sin((x - 5) * 0.8)), 13, livery.cream);
  c.fill(5, 3, 13, 25, 4, 14, timber);

  // Two crates on the counter, and a gutting board with the morning's last fish.
  fishCrate(c, 6, 8, 7, 6, 5, 0);
  fishCrate(c, 12, 8, 8, 5, 5, 2);
  c.fill(18, 8, 8, 24, 9, 12, MAT.bark);
  c.fill(19, 9, 10, 22, 10, 11, MAT.hairSilver);
  c.set(22, 9, 10, MAT.slate);

  // The balance: a chain from the purlin, a brass beam, two chains and two pans; a fish weighs down the left pan.
  const purlin = rafterTop(10) - 2;
  c.set(20, purlin - 1, 10, MAT.darkStone);
  c.fill(17, purlin - 2, 10, 24, purlin - 1, 11, livery.brass);
  for (const x of [17, 23]) c.set(x, purlin - 3, 10, MAT.darkStone);
  for (const x of [16, 22]) c.fill(x, purlin - 4, 9, x + 3, purlin - 3, 12, livery.brass);
  c.fill(16, purlin - 3, 11, 19, purlin - 2, 12, MAT.hairSilver);

  // The bell under the left eave: chain, crown, body, lip and clapper.
  const eave = rafterTop(14) - 2;
  c.set(ox + 1, eave - 1, 14, MAT.darkStone);
  c.set(ox + 1, eave - 2, 14, livery.brass);
  c.fill(ox, eave - 4, 13, ox + 3, eave - 2, 16, livery.brass);
  c.fill(ox - 1, eave - 5, 12, ox + 4, eave - 4, 17, livery.brass);
  c.set(ox + 1, eave - 6, 14, MAT.darkStone);

  // The keeper's lantern hangs from the canvas over the keeper's side of the counter.
  const lantern: Vec3 = smallLantern(c, 14, 12, 4, livery.brass, MAT.glass);
  c.set(14, 17, 4, MAT.darkStone);

  // Crates set out on the quay: one packed with fish, an empty one on its side behind it.
  fishCrate(c, 25, 0, 15, 5, 5, 1);
  c.fill(24, 0, 10, 29, 4, 14, timber);
  c.fill(24, 2, 10, 29, 3, 14, MAT.bark);
  c.fill(25, 1, 11, 28, 3, 14, MAT.air);
  return toPiece(pieceId('fish-stall', livery), 'prop', c, [lantern], { from: [2, 0], to: [30, 21] });
}
