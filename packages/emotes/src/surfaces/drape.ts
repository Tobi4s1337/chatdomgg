import { StyleIdSchema, VoxelBlueprintSchema, type VoxelBlueprint } from '../deps';
import type { EmoteStatueLayout } from './statue';

/** The cloth and its cord, from the caller's registry subset (usually the kingdom's livery). */
export interface EmoteDrapeMaterials {
  readonly cloth: number;
  readonly cord: number;
}

const DRAPE_STYLE = StyleIdSchema.parse('emote');

/** Extra cells the hem may spread beyond the statue's width and depth; the plinth cap holds 6 and 8. */
export const DRAPE_SPREAD_CELLS = [4, 6] as const;

/**
 * A plinth waiting under cloth. When a carving is withdrawn (its source changed or left the channel,
 * the provider was switched off), its plinth stays in the square, covered, until the monarch
 * unveils a new carving there. The form under the cloth is generic: a tall rounded mass sized only
 * by the old statue's frame size, so nothing of the withdrawn emote's silhouette survives.
 *
 * Built like cloth hanging from the top of a mass: a domed crown, a cinch at the cord, pleats that
 * fan out from the crown and deepen toward the hem, and a hem that pools on the cap. A gold cord is
 * tied round it with its ends hanging at the front. Front faces +Z. Size is
 * `[width + 4, height, depth + 6]` in build cells; `seed` only turns the fold rhythm.
 */
export function createEmoteDrape(size: readonly [number, number, number], materials: EmoteDrapeMaterials, id: string, seed = 0): VoxelBlueprint {
  const [width, height, depth] = size;
  if (![width, height, depth].every(n => Number.isInteger(n) && n > 0 && n <= 256) || height < 12) throw new Error('The drape size is malformed.');
  const W = width + DRAPE_SPREAD_CELLS[0], D = depth + DRAPE_SPREAD_CELLS[1], H = height;
  const cx = W / 2, cz = D / 2;
  // The covered mass: a little narrower than the statue was, with a softly domed crown.
  const body = Math.max(3, width * .36), crown = Math.max(4, Math.min(H * .36, body * 1.1));
  const cordY = Math.round(H * .4);
  const turn = ((seed % 6) + 6) % 6;

  /** Half-width of the form at height y (cell centre), before pleats. */
  const halfWidth = (y: number): number => {
    let w = body;
    if (y < 5) w += (W / 2 - body) * ((5 - y) / 5) ** 1.8;
    if (Math.abs(y - cordY) <= 1) w -= y === cordY ? 1.5 : .8;
    const t = (y - (H - crown)) / crown;
    if (t > 0) w *= Math.sqrt(Math.max(0, 1 - t * t * .96));
    return Math.max(1, w);
  };
  /** Half-depth at height y: the cloth stands off a thin relief, then falls to the hem. */
  const halfDepth = (y: number): number => {
    let d = depth / 2 + 1.5;
    if (y < 5) d += (D / 2 - d) * ((5 - y) / 5) ** 1.8;
    if (Math.abs(y - cordY) <= 1) d -= .7;
    const t = (y - (H - crown)) / crown;
    if (t > 0) d *= Math.sqrt(Math.max(0, 1 - t * t * .9));
    return Math.max(1, d);
  };
  /**
   * Pleats: straight vertical folds a cell proud, one every few cells, like cloth falling from a
   * crown. Each starts at its own height under the crown, and every other one deepens at the hem.
   */
  const SPACING = 5.5;
  const fold = (x: number, y: number): number => {
    const u = x + .5 - cx + turn;
    const k = Math.round(u / SPACING);
    if (Math.abs(u - SPACING * k) >= 1.05) return 0;
    const start = H - crown * (.35 + .4 * (((k * 2654435761) >>> 0) % 97) / 97);
    if (y > start) return 0;
    return y < 4 && k % 2 === 0 ? 2 : 1;
  };

  type Run = { x: number; y0: number; y1: number; z0: number; z1: number; x1: number };
  const boxes: VoxelBlueprint['boxes'] = [];
  const open = new Map<number, Run>();
  const flush = (run: Run) => boxes.push({ from: [run.x, run.y0, run.z0], to: [run.x1, run.y1, run.z1], material: materials.cloth });
  for (let y = 0; y < H; y++) {
    const hw = halfWidth(y + .5);
    const x0 = Math.max(0, Math.round(cx - hw)), x1 = Math.min(W, Math.round(cx + hw));
    const seen = new Set<number>();
    for (let x = x0; x < x1; x++) {
      const edge = Math.min(x - x0, x1 - 1 - x);
      // Round the sides: the outermost column sits a cell back, so the silhouette is not a slab.
      const hd = halfDepth(y + .5) + fold(x, y) - (edge === 0 && y > 3 ? 1 : 0);
      const z0 = Math.max(0, Math.round(cz - hd)), z1 = Math.min(D, Math.round(cz + hd));
      if (z1 <= z0) continue;
      seen.add(x);
      const run = open.get(x);
      if (run && run.y1 === y && run.z0 === z0 && run.z1 === z1) { run.y1 = y + 1; continue; }
      if (run) flush(run);
      open.set(x, { x, x1: x + 1, y0: y, y1: y + 1, z0, z1 });
    }
    for (const [x, run] of open) if (!seen.has(x)) { flush(run); open.delete(x); }
  }
  for (const run of open.values()) flush(run);

  // The cord: one ring proud of the cinch, a knot at the front, and two ends with tassels.
  const ringW = halfWidth(cordY + .5) + 1, ringD = halfDepth(cordY + .5) + 1;
  const rx0 = Math.max(0, Math.round(cx - ringW)), rx1 = Math.min(W, Math.round(cx + ringW));
  const rz0 = Math.max(0, Math.round(cz - ringD)), rz1 = Math.min(D, Math.round(cz + ringD));
  boxes.push({ from: [rx0, cordY, rz0], to: [rx1, cordY + 1, rz1], material: materials.cord });
  const knotX = Math.max(rx0 + 1, Math.min(rx1 - 3, Math.round(cx + width * .16)));
  const front = Math.min(D - 1, rz1);
  if (front < D) {
    boxes.push({ from: [knotX, cordY - 1, front - 1], to: [knotX + 2, cordY + 2, Math.min(D, front + 1)], material: materials.cord });
    for (const [dx, drop] of [[0, 7], [1, 5]] as const) {
      const x = knotX + dx, bottom = Math.max(2, cordY - drop);
      boxes.push({ from: [x, bottom, front], to: [x + 1, cordY - 1, front + 1], material: materials.cord });
      if (bottom >= 2) boxes.push({ from: [Math.max(0, x - (dx ? 0 : 1)), bottom - 2, front], to: [Math.min(W, x + (dx ? 2 : 1)), bottom, front + 1], material: materials.cord });
    }
  }
  return VoxelBlueprintSchema.parse({ version: 1, id, styleId: DRAPE_STYLE, kind: 'civic', lattice: 'build', size: [W, H, D], boxes, windows: [] });
}

/** The draped form standing on the withdrawn statue's own plinth, meshed as one blueprint. */
export function composeDrapedPlinth(layout: EmoteStatueLayout, drape: VoxelBlueprint, id: string): VoxelBlueprint {
  const [w, h, d] = drape.size, [footW, footD] = layout.footprintCells;
  const ox = Math.round(footW / 2 - w / 2), oy = layout.statueOffset[1], oz = Math.round(footD / 2 - d / 2);
  if (ox < 0 || oz < 0 || ox + w > footW || oz + d > footD) throw new Error('The drape does not fit this plinth.');
  const boxes: VoxelBlueprint['boxes'] = [...layout.plinth.boxes];
  for (const box of drape.boxes) boxes.push({ from: [box.from[0] + ox, box.from[1] + oy, box.from[2] + oz], to: [box.to[0] + ox, box.to[1] + oy, box.to[2] + oz], material: box.material });
  return VoxelBlueprintSchema.parse({ version: 1, id, styleId: DRAPE_STYLE, kind: 'civic', lattice: 'build', size: [footW, Math.max(layout.plinth.size[1], oy + h), footD], boxes, windows: [] });
}
