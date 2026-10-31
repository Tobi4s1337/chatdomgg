/**
 * The sky hand: a small pixel alphabet, drawn for Chatdom, for writing a cheerer's name in sparks. Glyphs sit on a
 * 5 × 7 grid (rows top to bottom, `#` lit) and are set proportionally: a glyph advances by its own inked width plus
 * one cell. Lower case is set in capitals, which read better at sky scale; accents fold onto their base letter.
 */
export const SKY_GLYPH = { height: 7, spacing: 1, space: 3, lineGap: 3 } as const;

const GLYPHS: Readonly<Record<string, readonly string[]>> = {
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  B: ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
  C: ['.####', '#....', '#....', '#....', '#....', '#....', '.####'],
  D: ['###..', '#..#.', '#...#', '#...#', '#...#', '#..#.', '###..'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  F: ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
  G: ['.####', '#....', '#....', '#..##', '#...#', '#...#', '.###.'],
  H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  I: ['###', '.#.', '.#.', '.#.', '.#.', '.#.', '###'],
  J: ['..###', '...#.', '...#.', '...#.', '...#.', '#..#.', '.##..'],
  K: ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
  L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  M: ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'],
  N: ['#...#', '##..#', '##..#', '#.#.#', '#..##', '#..##', '#...#'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
  Q: ['.###.', '#...#', '#...#', '#...#', '#.#.#', '#..#.', '.##.#'],
  R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  V: ['#...#', '#...#', '#...#', '#...#', '.#.#.', '.#.#.', '..#..'],
  W: ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '##.##', '#...#'],
  X: ['#...#', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '#...#'],
  Y: ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..'],
  Z: ['#####', '....#', '...#.', '..#..', '.#...', '#....', '#####'],
  0: ['.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '.###.'],
  1: ['.#.', '##.', '.#.', '.#.', '.#.', '.#.', '###'],
  2: ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
  3: ['####.', '....#', '....#', '.###.', '....#', '....#', '####.'],
  4: ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],
  5: ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
  6: ['..##.', '.#...', '#....', '####.', '#...#', '#...#', '.###.'],
  7: ['#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'],
  8: ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
  9: ['.###.', '#...#', '#...#', '.####', '....#', '...#.', '.##..'],
  _: ['....', '....', '....', '....', '....', '....', '####'],
  '-': ['...', '...', '...', '###', '...', '...', '...'],
  '.': ['.', '.', '.', '.', '.', '.', '#'],
  ',': ['..', '..', '..', '..', '..', '.#', '#.'],
  "'": ['#', '#', '.', '.', '.', '.', '.'],
  '!': ['#', '#', '#', '#', '#', '.', '#'],
  '?': ['.###.', '#...#', '....#', '..##.', '..#..', '.....', '..#..'],
  ':': ['.', '.', '#', '.', '.', '#', '.'],
  '&': ['.##..', '#..#.', '#.#..', '.#...', '#.#.#', '#..#.', '.##.#'],
  '(': ['..#', '.#.', '#..', '#..', '#..', '.#.', '..#'],
  ')': ['#..', '.#.', '..#', '..#', '..#', '.#.', '#..'],
  '+': ['...', '...', '.#.', '###', '.#.', '...', '...'],
  '…': ['.....', '.....', '.....', '.....', '.....', '.....', '#.#.#'],
};
/** Anything the hand has no letter for is set as the crest's small lozenge, so a name never shows a gap. */
const FALLBACK = ['.....', '..#..', '.#.#.', '#...#', '.#.#.', '..#..', '.....'];

/** A glyph's lit cells as (column, row-from-top), and its inked width. */
interface Glyph { readonly width: number; readonly cells: readonly (readonly [number, number])[] }
const cache = new Map<string, Glyph>();
function glyph(char: string): Glyph {
  let g = cache.get(char);
  if (g) return g;
  const rows = GLYPHS[char] ?? FALLBACK, cells: [number, number][] = [];
  rows.forEach((row, y) => { for (let x = 0; x < row.length; x++) if (row[x] === '#') cells.push([x, y]); });
  g = { width: rows[0]!.length, cells };
  cache.set(char, g);
  return g;
}

/** Fold a name onto the hand's letters: accents to their base, lower case to capitals, runs of spaces to one. */
export function skyNormalise(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
}

const advance = (char: string) => (char === ' ' ? SKY_GLYPH.space : glyph(char).width + SKY_GLYPH.spacing);
const lineWidth = (line: string) => Math.max(0, [...line].reduce((w, c) => w + advance(c), 0) - (line.endsWith(' ') ? 0 : SKY_GLYPH.spacing));
const clip = (line: string, max: number) => ([...line].length > max ? `${[...line].slice(0, max - 1).join('').trimEnd()}…` : line);

/**
 * Break a name into at most two lines. A name that fits `maxLine` characters stays whole; a longer one breaks at
 * the space, underscore or hyphen nearest its middle; a single long word stays on one line (the sky shrinks the
 * letters rather than splitting a login). Any line past `hardMax` characters ends in an ellipsis.
 */
export function skyLines(text: string, maxLine = 14, hardMax = 22): string[] {
  const name = skyNormalise(text), chars = [...name];
  if (chars.length <= maxLine) return name ? [name] : [];
  let best = -1;
  chars.forEach((c, i) => {
    if (c !== ' ' && c !== '_' && c !== '-') return;
    if (i === 0 || i === chars.length - 1) return;
    if (best < 0 || Math.abs(i - chars.length / 2) < Math.abs(best - chars.length / 2)) best = i;
  });
  // Only a break near the middle makes two good lines; "longusername_x9" stays whole rather than strand "X9".
  if (best < 0 || Math.abs(best - chars.length / 2) > chars.length * 0.25) return [clip(name, hardMax)];
  // A space is consumed by the break; an underscore or hyphen stays at the end of the first line.
  const keep = chars[best] === ' ' ? best : best + 1;
  return [chars.slice(0, keep).join('').trimEnd(), chars.slice(best + 1).join('').trimStart()].map(line => clip(line, hardMax));
}

export interface SkyTextCell {
  /** Cell centre from the block's centre, in cells; +x to the reader's right, +y up. */
  readonly x: number;
  readonly y: number;
  /** Which letter this cell belongs to, counted across lines without spaces: 0..glyphs-1, in reading order. */
  readonly glyph: number;
  readonly line: number;
}
export interface SkyText { readonly cells: readonly SkyTextCell[]; readonly width: number; readonly height: number; readonly glyphs: number; readonly lines: readonly string[] }

/** Lay a name out in sky cells, each line centred, the whole block centred on the origin. */
export function skyText(text: string, maxLine?: number, hardMax?: number): SkyText {
  const lines = skyLines(text, maxLine, hardMax), cells: SkyTextCell[] = [];
  const { height, lineGap } = SKY_GLYPH;
  const blockHeight = lines.length ? lines.length * height + (lines.length - 1) * lineGap : 0;
  let width = 0, index = 0;
  lines.forEach((line, l) => {
    const w = lineWidth(line);
    width = Math.max(width, w);
    const top = blockHeight / 2 - l * (height + lineGap);
    let pen = -w / 2;
    for (const char of line) {
      if (char === ' ') { pen += SKY_GLYPH.space; continue; }
      const g = glyph(char);
      for (const [x, y] of g.cells) cells.push({ x: pen + x + 0.5, y: top - y - 0.5, glyph: index, line: l });
      pen += g.width + SKY_GLYPH.spacing;
      index++;
    }
  });
  return { cells, width, height: blockHeight, glyphs: index, lines };
}
