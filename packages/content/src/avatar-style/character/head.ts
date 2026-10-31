import type { VoxelGrid } from './grid';
import type { CitizenLook, EyeShape, EyeSpacing, Freckles } from './recipe';

/*
 * The head: a hard-edged 8 × 8 × 8 skull, the face on its front plane. Eight cells is the resolution at which
 * one-cell eyes sit two cells apart with a two-cell margin, which is the reference face exactly; with a cell
 * of hair around it the silhouette is ten cells wide. It is also the frozen rig's head: the head bone at
 * y 16, the hat socket eight cells up and the face socket on the front plane, so no contract changes.
 */
export const SKULL = { x: [-4, 4], y: [16, 24], z: [-4, 4] } as const;
/** The front layer of cells (the face plane is z = 4). */
export const FACE_Z: number = SKULL.z[1] - 1;
/** Face rows count from the chin: row 0 is y 16. The eyes sit on row 2, so the chin shows two rows under them. */
export const EYE_ROW = 2;
/** Face columns count from the person's right (x = -4) to their left. */
export const faceX = (col: number) => SKULL.x[0] + col;
export const faceY = (row: number) => SKULL.y[0] + row;

const EYE_COLUMNS: Record<EyeSpacing, readonly [number, number]> = { set: [2, 5], wide: [1, 6] };

/** Face cells of the two eyes, as [col, row]. Mirror-symmetric for every shape. */
export function eyeCells(shape: EyeShape, spacing: EyeSpacing): readonly (readonly [number, number])[] {
  const cells: [number, number][] = [];
  for (const [side, col] of EYE_COLUMNS[spacing].map((c, i) => [i === 0 ? -1 : 1, c] as const)) {
    if (shape === 'closed') cells.push([col, EYE_ROW], [col + side, EYE_ROW]);
    else cells.push([col, EYE_ROW]);
    if (shape === 'tall') cells.push([col, EYE_ROW + 1]);
  }
  return cells;
}

/** Blush sits under the outer corner of each eye. */
export function blushCells(spacing: EyeSpacing): readonly (readonly [number, number])[] {
  const [l, r] = EYE_COLUMNS[spacing];
  return spacing === 'set' ? [[l - 1, EYE_ROW - 1], [r + 1, EYE_ROW - 1]] : [[l, EYE_ROW - 1], [r, EYE_ROW - 1]];
}

/**
 * Freckles dust the outer cheeks, off the eye columns (a dark cell under an eye reads as a taller eye) and
 * off the centre line (two dark cells there read as a mouth). `full` carries them up beside the eyes.
 */
export function freckleCells(freckles: Freckles, spacing: EyeSpacing): readonly (readonly [number, number])[] {
  if (freckles === 'none') return [];
  const [l, r] = EYE_COLUMNS[spacing];
  const outer = (dx: number, row: number): [number, number][] => [[l - dx, row], [r + dx, row]];
  const light = spacing === 'set' ? [...outer(2, EYE_ROW - 1), ...outer(1, EYE_ROW - 2)] : [...outer(1, EYE_ROW - 1), ...outer(0, EYE_ROW - 2)];
  if (freckles === 'light') return light;
  return [...light, ...(spacing === 'set' ? outer(1, EYE_ROW - 1) : outer(1, EYE_ROW - 2))];
}

export interface HeadOptions {
  /** Draws the eyes closed whatever their shape: the blink frame. */
  readonly blink?: boolean;
}

export function drawHead(grid: VoxelGrid, look: CitizenLook, options: HeadOptions = {}): void {
  grid.fill([SKULL.x[0], SKULL.y[0], SKULL.z[0]], [SKULL.x[1], SKULL.y[1], SKULL.z[1]], 'skin');
  const shape = options.blink ? 'closed' : look.eyes.shape;
  if (look.blush) for (const [c, r] of blushCells(look.eyes.spacing)) grid.set(faceX(c), faceY(r), FACE_Z, 'blush');
  for (const [c, r] of freckleCells(look.freckles, look.eyes.spacing)) grid.set(faceX(c), faceY(r), FACE_Z, 'freckle');
  for (const [c, r] of eyeCells(shape, look.eyes.spacing)) grid.set(faceX(c), faceY(r), FACE_Z, 'eye');
}
