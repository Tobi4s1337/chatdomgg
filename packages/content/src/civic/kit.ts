import type { VoxelBlueprint } from '@chatdom/shared';
import { MAT, STYLES } from '../materials';

export type CivicStyle = 'hearth' | 'tide';
type Box = VoxelBlueprint['boxes'][number];

/**
 * One civic treatment per kit. Structure always resolves through the kit's own wall, roof, trim and stone; the
 * rest are the few registered accents the spec allows. Hearth is warm limestone, plaster and tile with a red
 * field; Tide is grey stone on a dark base, cream render and slate with a sea-blue field.
 */
export interface CivicKit {
  readonly style: CivicStyle;
  readonly wall: number;
  readonly roof: number;
  readonly trim: number;
  readonly stone: number;
  /** The heavy bottom course and the wear-darkened joints. */
  readonly base: number;
  /** Alternate voussoirs and quoins, so arches and corners read as laid stones. */
  readonly band: number;
  /** Hand rope or a second rail. */
  readonly cord: number;
  readonly field: number;
  readonly charge: number;
  readonly border: number;
}

export const CIVIC_KITS: Readonly<Record<CivicStyle, CivicKit>> = {
  hearth: {
    style: 'hearth', ...pick('hearth'), base: MAT.limestone, band: MAT.cream, cord: MAT.timber,
    field: MAT.cloth, charge: MAT.cream, border: MAT.brass,
  },
  tide: {
    style: 'tide', ...pick('tide'), base: MAT.darkStone, band: MAT.cream, cord: MAT.thatch,
    field: MAT.slate, charge: MAT.cream, border: MAT.brass,
  },
};

function pick(style: CivicStyle) {
  const { wall, roof, trim, stone } = STYLES[style];
  return { wall, roof, trim, stone };
}

/** Ordered half-open boxes: later boxes overwrite earlier ones and material zero carves. */
export class Boxes {
  readonly list: Box[] = [];
  add(x: number, y: number, z: number, X: number, Y: number, Z: number, material: number): void {
    if (x >= X || y >= Y || z >= Z) return;
    this.list.push({ from: [x, y, z], to: [X, Y, Z], material });
  }
  /** The box and its mirror across the plane x = width / 2. */
  pair(width: number, x: number, y: number, z: number, X: number, Y: number, Z: number, material: number): void {
    this.add(x, y, z, X, Y, Z, material);
    this.add(width - X, y, z, width - x, Y, Z, material);
  }
}

/** Where the charge sits on a heraldic surface, in grid rows from the top (see `blazon`). */
export interface Charge {
  /** The row of the chevron's apex, and how many rows deep its arms are. */
  readonly apex: number;
  readonly thickness: number;
  /** The lozenge under it: centre row and half its width and height, in cells. */
  readonly lozenge: readonly [centre: number, halfWidth: number, halfHeight: number];
}

/**
 * The kingdom's base arms: a broad chevron (one roof) over a lozenge (the light kept under it), on a field inside
 * a one-cell border. It is original and abstract and claims nothing about a channel, rank or purchase. The same
 * arms are drawn at every size, from the gateway keystone to the banner and the crest, so they always match.
 * Returns rows top to bottom: B border, F field, C charge, '.' outside the outline.
 */
export function blazon(width: number, height: number, inside: (col: number, row: number) => boolean, charge: Charge): string[] {
  const within = (col: number, row: number) => col >= 0 && row >= 0 && col < width && row < height && inside(col, row);
  const [centre, halfWidth, halfHeight] = charge.lozenge;
  return Array.from({ length: height }, (_, row) => Array.from({ length: width }, (_, col) => {
    if (!within(col, row)) return '.';
    // The border follows the outline through its diagonals too, so a tapering edge stays one unbroken line.
    for (const dc of [-1, 0, 1]) for (const dr of [-1, 0, 1]) if (!within(col + dc, row + dr)) return 'B';
    const u = Math.abs(col + 0.5 - width / 2) - 0.5;
    const arm = row - charge.apex - u;
    if (arm >= 0 && arm < charge.thickness) return 'C';
    return u / halfWidth + Math.abs(row + 0.5 - centre) / halfHeight < 1 ? 'C' : 'F';
  }).join(''));
}

/** A heater outline: straight sides for `straight` rows, then curving in to a point. */
export function heater(width: number, height: number, straight: number): (col: number, row: number) => boolean {
  return (col, row) => {
    if (row < straight) return true;
    const t = (row + 0.5 - straight) / (height - straight);
    return Math.abs(col + 0.5 - width / 2) < (width / 2) * Math.sqrt(Math.max(0, 1 - t * t)) + 0.25;
  };
}

/** The gateway keystone: the arms on a 12 × 14 heater. */
export const CIVIC_SHIELD = blazon(12, 14, heater(12, 14, 7), { apex: 2, thickness: 2, lozenge: [10, 2, 2.2] });

/** A column whose corners are cut by one cell, so round things read as faceted rather than as cubes. */
export function octagon(b: Boxes, x0: number, y0: number, z0: number, X: number, Y: number, Z: number, material: number): void {
  b.add(x0, y0, z0 + 1, X, Y, Z - 1, material);
  b.add(x0 + 1, y0, z0, X - 1, Y, Z, material);
}

/**
 * Lays a shield grid into a face, so it is inset in the masonry it sits in. `x0`/`y0` is its lower-left cell;
 * `face` is the cell layer of the masonry face (the field, flush) and `proud` the layer in front of it, where the
 * border and charge stand one cell forward.
 */
export function shield(boxes: Boxes, kit: CivicKit, grid: readonly string[], x0: number, y0: number, face: number, proud: number): void {
  const material = { B: kit.border, F: kit.field, C: kit.charge } as Record<string, number>;
  grid.forEach((row, i) => {
    const y = y0 + grid.length - 1 - i;
    let start = 0;
    for (let x = 1; x <= row.length; x++) {
      if (x < row.length && row[x] === row[start]) continue;
      const mark = row[start]!;
      if (mark !== '.') {
        boxes.add(x0 + start, y, face, x0 + x, y + 1, face + 1, kit.field);
        // The field is flush; anything already standing proud in front of it (a ring, a beam) is cut back.
        boxes.add(x0 + start, y, proud, x0 + x, y + 1, proud + 1, mark === 'F' ? MAT.air : material[mark]!);
      }
      start = x;
    }
  });
}
