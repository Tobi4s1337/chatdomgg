import type { Cell, Slot, VoxelGrid } from './grid';
import { NECK, PROUD_Z, TORSO } from './body';
import { FRONT, slab } from './hair-kit';
import type { Hat } from './accessories';
import type { CrestShape, EarnedLook, EarnedPin, ForgedMotif, MonthMark } from './recipe';
import { MONTH_MARKS } from './recipe';

/*
 * Earned pieces on the lattice (spec B3). Each says something true about the person and has to read at stream
 * distance, so each is a shape, not a texture: the month ribbons are a two-cell bar on the left breast,
 * the tenure hood a thick collar round the back of the neck with the hood hanging down the back, pins are 3 × 3
 * badges standing proud of whatever is worn, the raid scarf is chunky two-colour knit with a long fringed tail,
 * and the forged hat is a soft felt cap with the forged piece's motif on its front.
 * Capes are cloth sheets, never voxels (the frozen cape treatment): `capeCut` gives their cut for the runtime.
 */

/** Every mark has its own ribbon colour, so the bar shows the newest two marks reached. */
export const RIBBON_COLOURS: Readonly<Record<MonthMark, `#${string}`>> = {
  1: '#f3ead2', 3: '#3fae4a', 6: '#43b6ec', 9: '#8a3fe6', 12: '#e8b54a',
  18: '#ef6fae', 24: '#d3202a', 36: '#1ea59a', 48: '#2d5fd8', 60: '#fff1b8',
};

/** The marks a bar shows for the highest mark worn: that mark and the one before it, oldest first. */
export function ribbonMarks(months: MonthMark): readonly MonthMark[] {
  const at = MONTH_MARKS.indexOf(months);
  return MONTH_MARKS.slice(Math.max(0, at - 1), at + 1);
}

/** Motifs and crests as 3 × 3 badges, top row first: `a` the first colour, `b` the second, `m` metal. */
export const MOTIF_GLYPHS: Readonly<Record<ForgedMotif, readonly [string, string, string]>> = {
  'sleeping-dragon': ['aab', 'mab', 'baa'],
  'crescent-moon': ['.aa', 'a.m', '.aa'],
  'watchful-owl': ['a.a', 'bab', 'aaa'],
  'sleeping-fox': ['a.a', 'aaa', '.b.'],
  sunflower: ['.a.', 'aba', 'ma.'],
  'scallop-shell': ['aba', 'aba', '.m.'],
  'shooting-star': ['.a.', 'aba', 'm.a'],
};
const CREST_GLYPHS: Readonly<Record<CrestShape, readonly [string, string, string]>> = {
  heater: ['aaa', 'aba', '.a.'],
  round: ['.a.', 'aba', '.a.'],
  swallowtail: ['aaa', 'aba', 'a.a'],
};
/** The founder's pin: a little gold star with a white heart. */
const FOUNDER_GLYPH = ['.m.', 'mbm', 'm.m'] as const;

export function pinGlyph(pin: EarnedPin): readonly [string, string, string] {
  return pin.kind === 'keepsake' ? CREST_GLYPHS[pin.shape] : pin.kind === 'forged' ? MOTIF_GLYPHS[pin.motif] : FOUNDER_GLYPH;
}

const [TX0, TX1] = TORSO.x, SHOULDER = TORSO.y[1] - 1;

/** The frontmost occupied z over a footprint of (x, y) columns on the chest, at or behind `limit`. */
function front(g: VoxelGrid, cells: readonly (readonly [number, number])[], limit = PROUD_Z + 3): number {
  let z = TORSO.z[1] - 1;
  for (const [x, y] of cells) for (let at = limit; at > z; at--) if (g.has(x, y, at)) { z = at; break; }
  return z;
}

/**
 * The month ribbons: a two-cell bar high on the left breast, one cell proud of what is worn, on the lapel of an
 * open layer (never across the opening). The newest mark sits outside, the one before it inside; with one mark
 * reached both cells are its colour.
 */
function drawRibbons(g: VoxelGrid): void {
  const y = SHOULDER - 1, x0 = TX1 - 2;
  const cells = [0, 1].map(i => [x0 + i, y] as const);
  const z = front(g, cells) + 1;
  for (let i = 0; i < 2; i++) g.set(x0 + i, y, z, `ribbon${i + 1}` as Slot);
}

/**
 * The tenure hood, worn down: a thick collar round the back and sides of the neck, its trim along the top,
 * and the hood itself hanging down the back to a point. From the front it reads as a collar in the kingdom's
 * colour behind the neck; from behind, as a hood.
 */
function drawHood(g: VoxelGrid): void {
  const y = NECK.y[0], back = TORSO.z[0] - 1;
  for (let x = TX0; x < TX1; x++) for (const z of [back, back + 1]) g.set(x, y, z, z === back ? 'hoodTrim' : 'hood');
  for (const x of [NECK.x[0] - 1, NECK.x[1]]) for (let z = NECK.z[0]; z < NECK.z[1]; z++) g.set(x, y, z, 'hood');
  const rows: readonly (readonly [number, number, number])[] = [[SHOULDER, TX0, TX1], [SHOULDER - 1, TX0, TX1], [SHOULDER - 2, TX0 + 1, TX1 - 1], [SHOULDER - 3, -1, 1]];
  for (const [ry, x0, x1] of rows) for (let x = x0; x < x1; x++) g.set(x, ry, back, ry === SHOULDER - 3 || x === x0 || x === x1 - 1 ? 'hoodDeep' : 'hood');
  // The hood's inside shows as a deep fold just under the collar.
  for (let x = TX0 + 1; x < TX1 - 1; x++) g.set(x, SHOULDER, back, 'hoodDeep');
}

/** Where each pin goes: the right breast first (the side the portrait shows), then the left under the ribbons. */
const PIN_PLACES: readonly (readonly [x0: number, top: number])[] = [[TX0, SHOULDER - 1], [TX1 - 3, SHOULDER - 2]];

function drawPin(g: VoxelGrid, pin: EarnedPin, index: 0 | 1): void {
  const [x0, top] = PIN_PLACES[index]!;
  const glyph = pinGlyph(pin);
  const cells: [number, number, Slot][] = [];
  glyph.forEach((row, r) => [...row].forEach((c, i) => {
    if (c === '.') return;
    cells.push([x0 + i, top - r, `pin${index + 1}${c}` as Slot]);
  }));
  const z = front(g, cells.map(([x, y]) => [x, y] as const)) + 1;
  for (const [x, y, slot] of cells) g.set(x, y, z, slot);
}

/**
 * The raid scarf: chunky knit in the two kingdoms' colours, wound twice (a ring round the neck and a second
 * over the shoulders), one long tail down the right of the chest ending in a fringe, a short end flying at the
 * back. Two-row stripes, so it reads as a raid scarf and never as plain neckwear.
 */
function drawRaidScarf(g: VoxelGrid): void {
  const stripe = (y: number): Slot => ((y >> 1) & 1 ? 'raidB' : 'raidA');
  const y = NECK.y[0];
  for (let x = NECK.x[0] - 1; x < NECK.x[1] + 1; x++) for (let z = NECK.z[0] - 1; z < NECK.z[1] + 1; z++) {
    if (x < NECK.x[0] || x >= NECK.x[1] || z < NECK.z[0] || z >= NECK.z[1]) g.set(x, y, z, 'raidA');
  }
  // The second wind over the shoulders, proud of whatever is worn.
  const wind: [number, number][] = [];
  for (let x = TX0 + 1; x < TX1 - 1; x++) wind.push([x, SHOULDER]);
  const z = front(g, wind) + 1;
  for (const [x] of wind) g.set(x, SHOULDER, z, 'raidB');
  for (let x = TX0 + 1; x < TX1 - 1; x++) g.set(x, SHOULDER, TORSO.z[0] - 1, 'raidB');
  // The long tail on the right of the chest, two cells wide, with a fringe at its end.
  const tail = [-2, -1], bottom = 8;
  const tz = front(g, tail.flatMap(x => Array.from({ length: SHOULDER - bottom }, (_, i) => [x, bottom + i] as [number, number]))) + 1;
  for (let ty = bottom; ty < SHOULDER; ty++) for (const x of tail) g.set(x, ty, tz, stripe(ty));
  g.set(-2, bottom - 1, tz, 'raidDeep');
  g.set(-1, bottom - 1, tz, 'raidDeep');
  // The end flying out behind, over the left shoulder blade.
  for (const [x, ty, bz] of [[1, SHOULDER - 1, TORSO.z[0] - 1], [1, SHOULDER - 2, TORSO.z[0] - 2], [2, SHOULDER - 3, TORSO.z[0] - 2]] as Cell[]) g.set(x, ty, bz, stripe(ty));
}

/**
 * The forged hat: a soft felt cap with a slight slouch to the person's right, a band in the second colour, and
 * the forged piece's motif standing on the front as a 3 × 3 badge with metal where the motif has it.
 */
export function forgedHat(motif: ForgedMotif): Hat {
  return {
    brim: 22,
    band: [22, 0],
    draw(g) {
      slab(g, 22, [-5, 5], [-5, 5], 1, 'hatTrim');
      slab(g, 23, [-5, 5], [-5, 5], 1, 'hat');
      slab(g, 24, [-6, 5], [-5, 5], 2, 'hat');
      slab(g, 25, [-6, 4], [-5, 4], 2, 'hat');
      slab(g, 26, [-4, 2], [-3, 3], 1, 'hatDeep');
      // The slouch: the crown leans out over the right ear.
      for (const [x, y, z] of [[-6, 23, -1], [-6, 23, 0], [-6, 23, 1], [-7, 24, 0]] as Cell[]) g.set(x, y, z, 'hatDeep');
      // The motif on the front panel, right of centre, one cell proud of the crown.
      MOTIF_GLYPHS[motif].forEach((row, r) => [...row].forEach((c, i) => {
        if (c !== '.') g.set(i, 25 - r, FRONT + 1, c === 'a' ? 'hatTrim' : 'forgeMetal');
      }));
    },
  };
}

/** Draws the earned pieces worn on the body, in order: the hood under, then ribbons, pins and the raid scarf over. */
export function drawEarnedBody(g: VoxelGrid, earned: EarnedLook): void {
  if (earned.hood) drawHood(g);
  if (earned.scarf) drawRaidScarf(g);
  if (earned.ribbons) drawRibbons(g);
  earned.pins.slice(0, 2).forEach((pin, i) => drawPin(g, pin, i as 0 | 1));
}

/**
 * A cape's cut, in the frozen `AvatarCapeBlueprint`'s terms (metres from the back socket), with colours as
 * `#rrggbb` until main maps per-citizen colours to swatches. The runtime owns the cloth.
 */
export interface CapeCut {
  readonly shape: 'straight' | 'flared' | 'tapered';
  readonly width: number;
  readonly length: number;
  readonly hem: 'straight' | 'rounded' | 'notched';
  readonly trimWidth: number;
  readonly mount: { readonly height: number; readonly back: number };
  readonly colours: { readonly cloth: `#${string}`; readonly lining: `#${string}`; readonly trim: `#${string}` };
  /** The tier 3 rainbow: six hues the cloth cycles through, and how strongly (lower when the sub lapsed). */
  readonly shimmer: { readonly hues: readonly `#${string}`[]; readonly strength: number } | null;
  readonly dim: boolean;
}

export const RAINBOW: readonly `#${string}`[] = ['#ef4b2c', '#f58a1f', '#f6d23c', '#3fae4a', '#2d5fd8', '#8a3fe6'];

export function capeCut(cape: NonNullable<EarnedLook['cape']>, dim = false): CapeCut {
  return {
    shape: cape.kind === 'cheer' ? 'flared' : cape.kind === 'rainbow' ? 'flared' : 'straight',
    width: .5,
    length: cape.kind === 'tier-cloak' ? .62 : .6,
    hem: cape.kind === 'cheer' ? 'notched' : cape.kind === 'rainbow' ? 'rounded' : 'straight',
    trimWidth: cape.kind === 'cheer' ? .03 : .022,
    mount: { height: .0625, back: .05 },
    colours: { cloth: cape.cloth, lining: cape.lining, trim: cape.trim },
    shimmer: cape.kind === 'rainbow' ? { hues: RAINBOW, strength: dim ? .25 : 1 } : null,
    dim,
  };
}
