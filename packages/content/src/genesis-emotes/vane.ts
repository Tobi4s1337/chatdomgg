import { VoxelBlueprintSchema, type VoxelBlueprint } from '@chatdom/shared';
import { MAT, STYLES } from '../materials';
import type { CompiledEmote } from './deps';
import { CAME, Sculpt, type EmoteArtKit } from './kit';

/**
 * Cardinal letters cut from sheet, rows top to bottom. Every stroke meets its neighbour face to face (never only at a
 * corner) and every letter stands on a bar riveted to its arm, so the cut sheet is one piece with the mast.
 */
const LETTERS: Readonly<Record<'N' | 'E' | 'S' | 'W', readonly string[]>> = {
  N: ['X..X', 'XX.X', 'X.XX', 'X..X', 'X..X'],
  E: ['XXX', 'X..', 'XX.', 'X..', 'XXX'],
  S: ['XXXX', 'X...', 'XXXX', '...X', 'XXXX'],
  W: ['X...X', 'X...X', 'X.X.X', 'X.X.X', 'XXXXX'],
};
/** Reach of each cardinal arm from the spindle, in cells. */
const ARM = 9;
const SPINDLE_TOP = 30;

/**
 * A weathervane of one approved emote: a fixed iron mast with gilded cardinal letters and ball, and a rotor that
 * turns on it. The rotor is the emote cut flat from sheet metal and gilded (light tones gold leaf, mid tones brass,
 * darks copper and iron, so the drawing survives), standing on an arrow with a swallow-tailed feather.
 */
export interface EmoteVane {
  readonly mast: VoxelBlueprint;
  /** Turns about the vertical axis through `rotorPivot`; at rest the arrowhead points along +X (east). */
  readonly rotor: VoxelBlueprint;
  /** Where the rotor sits on the mast, in mast-local cells: on the axis, at the top of the ball. */
  readonly mastPivot: readonly [number, number, number];
  /** The point of the rotor that rests on `mastPivot`, in rotor-local cells. */
  readonly rotorPivot: readonly [number, number, number];
  /** Bottom centre of the mast's foot plate, in mast-local cells: where a host sets it on a ridge or tower. */
  readonly mount: readonly [number, number, number];
}

function letter(b: Sculpt, glyph: readonly string[], x: number, y: number, z: number, material: number): void {
  b.add(x, y - 1, z, x + glyph[0]!.length, y, z + 1, CAME);
  glyph.forEach((row, r) => [...row].forEach((c, i) => { if (c === 'X') b.cell(x + i, y + glyph.length - 1 - r, z, material); }));
}

export function composeEmoteVane(kit: EmoteArtKit, emote: CompiledEmote): EmoteVane {
  const frame = emote.frames[0]!.blueprint;
  const [mw, mh] = frame.size;
  const styleId = STYLES[kit.style].id;
  const key = `${kit.style}-${emote.geometryHash.slice(0, 16)}`;

  // Rotor: arrow shaft along X at y 5–7, head at +X, feather at 0; the emote stands on the shaft, a little toward
  // the feather so the larger area trails the wind. The collar under the shaft rides the mast's ball.
  const L = Math.max(30, mw + 18);
  const r = new Sculpt();
  const shaftY = 5;
  r.add(0, shaftY, 0, L, shaftY + 2, 2, MAT.brass);
  for (let k = 0; k < 7; k++) {
    const half = 6 - k;
    r.add(L - 7 + k, shaftY + 1 - half, 0, L - 6 + k, shaftY + 1 + half, 2, MAT.goldLeaf);
  }
  for (let k = 0; k < 8; k++) {
    const half = 2 + Math.floor((8 - k) / 2);
    const m = k % 3 === 2 ? MAT.brass : MAT.goldLeaf;
    r.add(k, shaftY + 1 - half, 0, k + 1, shaftY + 1 + half, 2, m);
  }
  // The swallow-tail notch.
  r.add(0, shaftY, 0, 2, shaftY + 2, 2, 0);
  const pivotX = Math.round(L / 2);
  const ex = Math.max(9, Math.min(L - 8 - mw, Math.round(L * 0.44 - mw / 2)));
  r.place(frame.boxes, ex, shaftY + 2, 0);
  r.add(pivotX - 1, 0, 0, pivotX + 1, shaftY, 2, MAT.brass);
  r.add(pivotX - 2, shaftY - 1, 0, pivotX + 2, shaftY, 2, MAT.goldLeaf);
  const rotor = VoxelBlueprintSchema.parse({
    version: 1, id: `genesis-emote-vane-rotor-${key}`, styleId, kind: 'prop', lattice: 'build',
    size: [L, Math.max(shaftY + 2 + mh, shaftY + 8), 2], boxes: r.list, windows: [],
  });

  // Mast: foot plate, iron spindle, cardinal cross with gilded letters, gilded ball.
  const c = ARM + 6, S = 2 * c + 2;
  const m = new Sculpt();
  m.add(c - 2, 0, c - 2, c + 4, 1, c + 4, kit.footing);
  m.add(c - 1, 1, c - 1, c + 3, 3, c + 3, CAME);
  m.add(c, 3, c, c + 2, SPINDLE_TOP, c + 2, CAME);
  const crossY = 16;
  m.add(c - ARM, crossY, c, c + 2 + ARM, crossY + 1, c + 2, CAME);
  m.add(c, crossY, c - ARM, c + 2, crossY + 1, c + 2 + ARM, CAME);
  m.add(c - 1, crossY - 1, c - 1, c + 3, crossY + 2, c + 3, MAT.brass);
  letter(m, LETTERS.E, c + 2 + ARM - 2, crossY + 1, c, MAT.goldLeaf);
  letter(m, LETTERS.W, c - ARM - 3, crossY + 1, c, MAT.goldLeaf);
  letter(m, LETTERS.N, c - 1, crossY + 1, c - ARM, MAT.goldLeaf);
  letter(m, LETTERS.S, c - 1, crossY + 1, c + 1 + ARM, MAT.goldLeaf);
  // The ball, rounded by trimming its edges.
  const by = SPINDLE_TOP;
  m.add(c - 1, by, c - 1, c + 3, by + 4, c + 3, MAT.goldLeaf);
  for (const [x, z] of [[c - 1, c - 1], [c + 2, c - 1], [c - 1, c + 2], [c + 2, c + 2]] as const) { m.cell(x, by, z, 0); m.cell(x, by + 3, z, 0); }
  m.add(c, by + 4, c, c + 2, by + 5, c + 2, CAME);
  const mast = VoxelBlueprintSchema.parse({
    version: 1, id: `genesis-emote-vane-mast-${kit.style}`, styleId, kind: 'prop', lattice: 'build',
    size: [S, by + 5, S], boxes: m.list, windows: [],
  });
  return { mast, rotor, mastPivot: [c + 1, by + 5, c + 1], rotorPivot: [pivotX, 0, 1], mount: [c + 1, 0, c + 1] };
}
