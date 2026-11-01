import { MAT, STYLES } from '@chatdom/content';
import type { VoxelBlueprint } from '@chatdom/shared';

type Box = VoxelBlueprint['boxes'][number];
const CELL = .125;

/** Occupied extent of a blueprint in build cells: [min, max) on each axis. */
export function occupied(blueprint: VoxelBlueprint): { min: [number, number, number]; max: [number, number, number] } {
  const min: [number, number, number] = [Infinity, Infinity, Infinity], max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const box of blueprint.boxes) for (let a = 0; a < 3; a++) { min[a] = Math.min(min[a]!, box.from[a]!); max[a] = Math.max(max[a]!, box.to[a]!); }
  return { min, max };
}

function asset(id: string, size: [number, number, number], boxes: Box[], kind: VoxelBlueprint['kind'] = 'prop'): VoxelBlueprint {
  for (const box of boxes) for (let a = 0; a < 3; a++) {
    box.from[a] = Math.max(0, Math.min(size[a]! - 1, box.from[a]!));
    box.to[a] = Math.max(box.from[a]! + 1, Math.min(size[a]!, box.to[a]!));
  }
  return { version: 1, id, styleId: STYLES.hearth.id, kind, lattice: 'build', size, boxes, windows: [] };
}

export const SCAFFOLD_PAD = 6;

/**
 * Timber scaffolding around the part of the lot the next home will fill: standards every two metres along the sides
 * and back, ledgers and boarded lifts every course of the climb, a ladder on the right. The street side stays open
 * so the door and the people arriving can always be seen. Local origin is the home's origin less the padding.
 */
export function createScaffold(next: VoxelBlueprint, tier: string): VoxelBlueprint {
  const { min, max } = occupied(next), pad = SCAFFOLD_PAD;
  const width = next.size[0] + pad * 2, depth = next.size[2] + pad, top = Math.min(150, Math.round(max[1] * .82));
  const height = top + 10;
  const boxes: Box[] = [];
  const add = (x: number, y: number, z: number, X: number, Y: number, Z: number, material: number) => boxes.push({ from: [x, y, z], to: [X, Y, Z], material });
  // Back of the home's real footprint (z grows toward the street); the front three metres are left open.
  const back = Math.max(0, min[2] + pad - 4), front = Math.min(depth, next.size[2] + pad - 18);
  const left = pad - 4, right = pad + next.size[0] + 2;
  const standards: [number, number][] = [];
  for (let z = back; z <= front; z += 16) { standards.push([left, z], [right, z]); }
  for (let x = left + 16; x < right; x += 16) standards.push([x, back]);
  standards.push([right, back], [left, back]);
  for (const [x, z] of standards) add(x, 0, z, x + 2, top + 6, z + 2, MAT.bark);
  // Lifts: a ledger and a boarded walk at every two metres of height, along both sides and the back.
  for (let y = 14; y <= top; y += 16) {
    add(left, y, back, left + 2, y + 2, front + 2, MAT.timber);
    add(right, y, back, right + 2, y + 2, front + 2, MAT.timber);
    add(left, y, back, right + 2, y + 2, back + 2, MAT.timber);
    // Boards on the outside of each side, a walk wide enough for a builder, with a gap between planks.
    for (let z = back; z < front; z += 4) {
      add(left - 4, y + 2, z, left + 2, y + 3, z + 3, MAT.timber);
      add(right, y + 2, z, right + 6, y + 3, z + 3, MAT.timber);
    }
    for (let x = left; x < right; x += 4) add(x, y + 2, back - 4, x + 3, y + 3, back + 2, MAT.timber);
    // A guard rail one metre above each walk.
    add(left - 4, y + 10, back, left - 3, y + 11, front + 2, MAT.bark);
    add(right + 5, y + 10, back, right + 6, y + 11, front + 2, MAT.bark);
  }
  // Ladder up the right side, near the street.
  const lz = front - 10;
  add(right + 6, 0, lz, right + 7, top + 8, lz + 1, MAT.timber);
  add(right + 6, 0, lz + 5, right + 7, top + 8, lz + 6, MAT.timber);
  for (let y = 3; y < top + 6; y += 3) add(right + 6, y, lz + 1, right + 7, y + 1, lz + 5, MAT.bark);
  // A canvas sheet hung on the back lift, and a builder's lantern hook at the corner nearest the street.
  add(left + 4, 16, back - 1, right - 2, Math.min(top, 40), back, MAT.cloth);
  add(right, top + 6, front, right + 2, top + 7, front + 4, MAT.darkStone);
  return asset(`growth-scaffold-hearth-${tier}`, [width + 8, height, depth + 6], boxes.map(b => ({ ...b, from: [b.from[0] + 4, b.from[1], b.from[2] + 4] as [number, number, number], to: [b.to[0] + 4, b.to[1], b.to[2] + 4] as [number, number, number] })));
}

/** Where the scaffold blueprint's local origin sits relative to the home's origin, in metres (home frame). */
export const SCAFFOLD_OFFSET: readonly [number, number, number] = [-(SCAFFOLD_PAD + 4) * CELL, 0, -(SCAFFOLD_PAD + 4) * CELL];
/** The builder's lantern hook, in scaffold cells, for the glow and its light. */
export function scaffoldLantern(next: VoxelBlueprint): [number, number, number] {
  const { max } = occupied(next), top = Math.min(150, Math.round(max[1] * .82));
  return [SCAFFOLD_PAD + next.size[0] + 2 + 1 + 4, top + 4, Math.min(next.size[2] + SCAFFOLD_PAD, next.size[2] + SCAFFOLD_PAD - 18) + 2 + 4];
}

/**
 * A plot kept for a new citizen: four marker stakes with red cloth tied on, and a small blank board by the street.
 * It is a promise of a home, not a home: no tent is drawn.
 */
export function createPlotStakes(): VoxelBlueprint {
  const boxes: Box[] = [];
  const add = (x: number, y: number, z: number, X: number, Y: number, Z: number, material: number) => boxes.push({ from: [x, y, z], to: [X, Y, Z], material });
  for (const [x, z] of [[1, 1], [61, 1], [1, 125], [61, 125]] as const) {
    add(x, 0, z, x + 2, 9, z + 2, MAT.timber);
    add(x, 9, z, x + 2, 10, z + 2, MAT.bark);
    add(x - 1, 6, z, x, 8, z + 3, MAT.fabricRed);
    add(x - 1, 5, z + 2, x, 6, z + 3, MAT.fabricRed);
  }
  // The board by the street: two posts and a plain plank.
  add(46, 0, 121, 47, 10, 122, MAT.bark);
  add(55, 0, 121, 56, 10, 122, MAT.bark);
  add(45, 6, 120, 57, 11, 121, MAT.timber);
  add(45, 11, 120, 57, 12, 121, MAT.darkStone);
  // A turned square of earth where the first hearth will be laid.
  add(24, 0, 84, 40, 1, 104, MAT.earth);
  return asset('growth-plot-stakes-hearth', [64, 12, 128], boxes);
}

export const GARLAND_SPAN = 7.6;
/** The garland's posts stand at the lot's front corners; this many lanterns hang between them. */
export const GARLAND_LANTERNS = 7;
/** Sag of the line at its middle, metres, below the post tops. */
const SAG = .7, POST = 3.1;

/** Lantern i of n along the line, in garland-local metres (x along the front, y up, z out to the street). */
export function garlandPoint(i: number, n = GARLAND_LANTERNS): [number, number, number] {
  const u = (i + 1) / (n + 1), x = .1 + u * GARLAND_SPAN;
  return [x, POST - .12 - SAG * 4 * u * (1 - u) - .28, .06];
}

/** Two dressed posts and a rope of cloth pennants across the front of the lot, strung for the housewarming. */
export function createGarland(): VoxelBlueprint {
  const boxes: Box[] = [];
  const add = (x: number, y: number, z: number, X: number, Y: number, Z: number, material: number) => boxes.push({ from: [x, y, z], to: [X, Y, Z], material });
  const W = Math.round(GARLAND_SPAN / CELL) + 2, top = Math.round(POST / CELL);
  for (const x of [0, W - 2]) {
    add(x, 0, 0, x + 2, top, 2, MAT.timber);
    add(x - 1, top, -0, x + 3, top + 1, 2, MAT.bark);
    add(x, 0, 0, x + 2, 2, 2, MAT.darkStone);
  }
  const colours = [MAT.fabricMutedRed, MAT.fabricGold, MAT.fabricMutedGreen, MAT.fabricMutedBlue, MAT.fabricMutedOrange];
  for (let cx = 2; cx < W - 2; cx++) {
    const u = (cx * CELL - .1) / GARLAND_SPAN, y = Math.round((POST - .12 - SAG * 4 * u * (1 - u)) / CELL);
    add(cx, y, 1, cx + 1, y + 1, 2, MAT.bark);
    // A pennant hangs every five cells: a short triangle of cloth.
    if ((cx - 2) % 5 === 1 && cx < W - 4) {
      const material = colours[Math.floor((cx - 2) / 5) % colours.length]!;
      add(cx - 1, y - 2, 1, cx + 2, y, 2, material);
      add(cx, y - 3, 1, cx + 1, y - 2, 2, material);
    }
  }
  return asset('growth-garland-hearth', [W + 2, top + 2, 3], boxes.map(b => ({ ...b, from: [b.from[0] + 1, b.from[1], b.from[2]] as [number, number, number], to: [b.to[0] + 1, b.to[1], b.to[2]] as [number, number, number] })));
}
