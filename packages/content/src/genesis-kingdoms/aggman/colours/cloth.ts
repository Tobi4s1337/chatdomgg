import type { HeraldicColours } from '../../../genesis-heraldry/kit';
import type { Livery } from '../piece';
import type { Cells } from './cells';

/**
 * The arms' three colours as the livery wears them: the red field, the cream charge (the wave) and a brass
 * border. These are the same tinctures `composeGenesisHeraldry` snaps for The_AGGman (tested), so a small cloth
 * and the 14 m standard read as one device.
 */
export function liveryColours(livery: Livery): HeraldicColours {
  return { field: livery.red, charge: livery.cream, border: livery.brass };
}

export function markMaterial(colours: HeraldicColours, mark: string): number {
  return mark === 'B' ? colours.border : mark === 'C' ? colours.charge : colours.field;
}

type Weights = Record<string, number>;

/** How much of each mark lies under a fractional window of the source grid (columns c0..c1, rows r0..r1). */
function coverage(arms: readonly string[], c0: number, c1: number, r0: number, r1: number): Weights {
  const weights: Weights = {};
  for (let row = Math.floor(r0); row < Math.ceil(r1); row++) for (let col = Math.floor(c0); col < Math.ceil(c1); col++) {
    const area = (Math.min(c1, col + 1) - Math.max(c0, col)) * (Math.min(r1, row + 1) - Math.max(r0, row));
    if (area <= 0) continue;
    const mark = arms[row]?.[col] ?? '.';
    weights[mark] = (weights[mark] ?? 0) + area;
  }
  return weights;
}

/**
 * The arms redrawn at a smaller size. The outline is whatever covers most of each new cell, the border is drawn
 * again one cell wide round that outline (through the diagonals, as `emblazon` does, so the fork stays one
 * unbroken line), and every inside cell takes the charge or the field, whichever covers more of it. The charge
 * keeps its place and its rhythm instead of being point-sampled into broken cells.
 */
export function resampleArms(arms: readonly string[], width: number, rows: number): string[] {
  const sw = arms[0]!.length, sh = arms.length, du = sw / width, dv = sh / rows;
  const weight = (col: number, row: number) => coverage(arms, col * du, (col + 1) * du, row * dv, (row + 1) * dv);
  const inside = Array.from({ length: rows }, (_, row) => Array.from({ length: width }, (_, col) => {
    const w = weight(col, row);
    return (w['.'] ?? 0) < du * dv / 2;
  }));
  const within = (col: number, row: number) => col >= 0 && row >= 0 && col < width && row < rows && inside[row]![col]!;
  return inside.map((line, row) => line.map((on, col) => {
    if (!on) return '.';
    for (const dc of [-1, 0, 1]) for (const dr of [-1, 0, 1]) if (!within(col + dc, row + dr)) return 'B';
    const w = weight(col, row);
    return (w['C'] ?? 0) > (w['F'] ?? 0) ? 'C' : 'F';
  }).join(''));
}

/**
 * The band of the arms that carries the charge, inside the border: every row the charge touches and one row of
 * field above and below, resampled to `width` × `rows` as field ('F') and charge ('C'). A pennant flies the
 * charge along its length, so the three wavy bars run with the wind.
 */
export function chargeBand(arms: readonly string[], width: number, rows: number): string[] {
  const charged = arms.flatMap((line, row) => (line.includes('C') ? [row] : []));
  if (!charged.length) return Array.from({ length: rows }, () => 'F'.repeat(width));
  const r0 = Math.max(0, charged[0]! - 1), r1 = Math.min(arms.length, charged[charged.length - 1]! + 2);
  const c0 = 1, c1 = arms[0]!.length - 1, du = (c1 - c0) / width, dv = (r1 - r0) / rows;
  return Array.from({ length: rows }, (_, row) => Array.from({ length: width }, (_, col) => {
    const w = coverage(arms, c0 + col * du, c0 + (col + 1) * du, r0 + row * dv, r0 + (row + 1) * dv);
    return (w['C'] ?? 0) > (w['F'] ?? 0) ? 'C' : 'F';
  }).join(''));
}

/**
 * How far each column of a hanging cloth bellies forward when full of air: a soft wave across the width, with the
 * columns listed in `still` (those against a pole) held flat. Neighbouring columns never differ by more than a
 * cell, so a two-cell cloth stays one face-connected sheet.
 */
export function foldProfile(width: number, phase: number, still: readonly number[] = []): number[] {
  const fold = Array.from({ length: width }, (_, col) => Math.max(0, Math.round(1.25 + 1.25 * Math.sin((2 * Math.PI * (col + 0.5)) / 8 + phase))));
  for (const col of still) if (col >= 0 && col < width) fold[col] = 0;
  for (let pass = 0; pass < width; pass++) for (let col = 0; col < width; col++) {
    const left = col > 0 ? fold[col - 1]! + 1 : Infinity, right = col + 1 < width ? fold[col + 1]! + 1 : Infinity;
    fold[col] = Math.min(fold[col]!, left, right);
  }
  return fold;
}

/** A cloth's head hangs flat from its loops; the folds deepen a cell every four rows down to their full depth. */
export const deepen = (profile: readonly number[]) => (col: number, row: number) => Math.min(profile[col]!, Math.max(0, Math.floor((row - 1) / 4)));

export interface Hang {
  /** Cell of the cloth's left column. */
  readonly x: number;
  /** Cell of its top row; rows run downward from here. */
  readonly top: number;
  /** Back face of the cloth where it does not belly; it is two cells thick, from `z` + fold. */
  readonly z: number;
  readonly fold: (col: number, row: number) => number;
}

/** Weaves the arms grid through a two-cell cloth hanging from `hang.top` downward. */
export function weave(c: Cells, grid: readonly string[], colours: HeraldicColours, hang: Hang): void {
  grid.forEach((line, row) => {
    for (let col = 0; col < line.length; col++) {
      const mark = line[col]!;
      if (mark === '.') continue;
      const z = hang.z + hang.fold(col, row), material = markMaterial(colours, mark);
      c.set(hang.x + col, hang.top - row, z, material);
      c.set(hang.x + col, hang.top - row, z + 1, material);
    }
  });
}

/**
 * A tassel at every tip of the hem: a brass head two cells wide under the hem and a gold fall `length` cells
 * long. Returns the lowest cell row it reaches.
 */
export function tassels(c: Cells, grid: readonly string[], hang: Hang, brass: number, gold: number, length = 3): number {
  const row = grid.length - 1, last = grid[row]!, hem = hang.top - row;
  let start = -1;
  for (let col = 0; col <= last.length; col++) {
    const on = col < last.length && last[col] !== '.';
    if (on && start < 0) start = col;
    if (!on && start >= 0) {
      const centre = Math.floor((start + col) / 2), from = Math.max(start, centre - 1), to = Math.min(col, from + 2);
      for (let x = from; x < to; x++) {
        const z = hang.z + hang.fold(x, row);
        c.fill(hang.x + x, hem - 1, z, hang.x + x + 1, hem, z + 2, brass);
        c.fill(hang.x + x, hem - 1 - length, z, hang.x + x + 1, hem - 1, z + 2, gold);
      }
      start = -1;
    }
  }
  return hem - 1 - length;
}
