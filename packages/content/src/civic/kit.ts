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

/**
 * The base civic charge: a lozenge (the beacon) over a broad chevron (one roof), on a field inside a raised
 * border. It is original, abstract and claims nothing about a channel, rank or purchase.
 * Rows run top to bottom: B border, F field, C charge, '.' outside the shield.
 */
export const CIVIC_SHIELD = [
  'BBBBBBBBBBBB',
  'BFFFFFFFFFFB',
  'BFFFFCCFFFFB',
  'BFFFCCCCFFFB',
  'BFFFFCCFFFFB',
  'BFFFFFFFFFFB',
  'BFFFFCCFFFFB',
  'BFFFCCCCFFFB',
  'BFFCCFFCCFFB',
  'BFCCFFFFCCFB',
  '.BCFFFFFFCB.',
  '..BFFFFFFB..',
  '...BFFFFB...',
  '....BBBB....',
] as const;

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
