import { heater } from '../civic/kit';

/**
 * The kingdom's crest and banner as authored cell grids, drawn from the recipe's crest and banner grammar. Rows run
 * top to bottom: 'B' border, 'F' field, 'C' charge, '.' outside. They carry only the recipe's shape, charge and
 * cut; colours arrive later as snapped kit materials. Nothing here is a channel emote, badge or logo.
 */
export type CrestShape = 'heater' | 'round' | 'swallowtail';
export type CrestCharge = 'oak' | 'star' | 'wave' | 'mountain';
export type BannerCut = 'square' | 'forked' | 'pennant';

export const CREST_WIDTH = 14;
export const CREST_HEIGHT = 16;
export const FLAG_LENGTH = 22;
export const FLAG_HEIGHT = 13;

const CHARGES: Readonly<Record<CrestCharge, readonly string[]>> = {
  // Two rolling crests of sea.
  wave: [
    '..##....',
    '.#..#..#',
    '#....##.',
    '........',
    '..##....',
    '.#..#..#',
    '#....##.',
  ],
  star: [
    '...#...',
    '...#...',
    '#######',
    '.#####.',
    '..###..',
    '.##.##.',
    '.#...#.',
  ],
  oak: [
    '.#.#.#.',
    '#######',
    '#######',
    '.#####.',
    '...#...',
    '...#...',
    '..###..',
  ],
  mountain: [
    '...#....',
    '..###...',
    '..####.#',
    '.#######',
    '########',
    '########',
  ],
};

function outline(shape: CrestShape): (col: number, row: number) => boolean {
  if (shape === 'heater') return heater(CREST_WIDTH, CREST_HEIGHT, 8);
  if (shape === 'round') {
    return (col, row) => ((col + 0.5 - CREST_WIDTH / 2) / (CREST_WIDTH / 2)) ** 2 + ((row + 0.5 - CREST_HEIGHT / 2) / (CREST_HEIGHT / 2)) ** 2 < 1.04;
  }
  // A swallowtail shield: square shoulders, a notch rising four rows from the hem between two tails.
  return (col, row) => {
    const fromHem = CREST_HEIGHT - 1 - row, u = Math.abs(col + 0.5 - CREST_WIDTH / 2);
    return fromHem >= 4 || u > fromHem + 1.5;
  };
}

/** The crest: a one-cell border following the outline, the field, and the recipe's charge centred on it. */
export function crestGrid(shape: CrestShape, charge: CrestCharge): string[] {
  const inside = outline(shape);
  const within = (col: number, row: number) => col >= 0 && row >= 0 && col < CREST_WIDTH && row < CREST_HEIGHT && inside(col, row);
  const art = CHARGES[charge], artWidth = art[0]!.length;
  const left = Math.floor((CREST_WIDTH - artWidth) / 2), top = shape === 'heater' ? 3 : Math.floor((CREST_HEIGHT - art.length) / 2) - (shape === 'swallowtail' ? 1 : 0);
  return Array.from({ length: CREST_HEIGHT }, (_, row) => Array.from({ length: CREST_WIDTH }, (_, col) => {
    if (!within(col, row)) return '.';
    for (const dc of [-1, 0, 1]) for (const dr of [-1, 0, 1]) if (!within(col + dc, row + dr)) return 'B';
    const mark = art[row - top]?.[col - left];
    return mark === '#' ? 'C' : 'F';
  }).join(''));
}

/**
 * The flag that flies from the tower, hoist at column 0 and fly at the far end. 'B' is the hoist binding, 'F' the
 * field, 'C' a band through the middle in the second colour. Square is whole; forked cuts a swallowtail six columns
 * deep; pennant tapers to a point.
 */
export function flagGrid(cut: BannerCut): string[] {
  const mid = (FLAG_HEIGHT - 1) / 2;
  return Array.from({ length: FLAG_HEIGHT }, (_, row) => Array.from({ length: FLAG_LENGTH }, (_, col) => {
    const off = Math.abs(row - mid);
    if (cut === 'forked' && col >= FLAG_LENGTH - 7 && off < (col - (FLAG_LENGTH - 7)) * 0.9 + 0.5) return '.';
    if (cut === 'pennant' && off > (mid + 0.5) * (1 - col / FLAG_LENGTH)) return '.';
    if (col === 0) return 'B';
    return off <= 1 ? 'C' : 'F';
  }).join(''));
}
