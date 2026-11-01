import { VoxelBlueprintSchema } from '@chatdom/shared';
import { meshCost, unsupported } from '../../places/water/piece-checks';
import { MATERIALS } from '../../materials';
import type { AggmanPiece } from './piece';

/** Test-only: the shared bar every AggmanPiece meets. Production code never imports this module. */
export interface PieceBudget { readonly boxes: number; readonly triangles: number }
export const PROP_BUDGET: PieceBudget = { boxes: 1500, triangles: 60_000 };
export const BUILDING_BUDGET: PieceBudget = { boxes: 4000, triangles: 250_000 };

export function aggmanPieceFailures(piece: AggmanPiece, budget: PieceBudget = PROP_BUDGET): string[] {
  const failures: string[] = [];
  const parsed = VoxelBlueprintSchema.safeParse(piece.blueprint);
  if (!parsed.success) return [`schema: ${parsed.error.message}`];
  const b = piece.blueprint;
  if (!b.id.startsWith('genesis-aggman-')) failures.push(`id ${b.id} must start with genesis-aggman-`);
  if (b.boxes.length > budget.boxes) failures.push(`${b.boxes.length} boxes > ${budget.boxes}`);
  const registered = new Set(MATERIALS.materials.map(m => m.id));
  for (const box of b.boxes) if (!registered.has(box.material)) failures.push(`unregistered material ${box.material}`);
  const loose = unsupported(b);
  if (loose) failures.push(`${loose} occupied cells have no face-connected path to y = 0`);
  const { triangles } = meshCost(b);
  if (triangles > budget.triangles) failures.push(`${triangles} triangles > ${budget.triangles}`);
  const [sx, sy, sz] = b.size;
  for (const [x, y, z] of piece.lanterns) if (x < 0 || y < 0 || z < 0 || x >= sx || y >= sy || z >= sz) failures.push(`lantern ${x},${y},${z} outside the model`);
  const { from, to } = piece.footprint;
  if (!(from[0] >= 0 && from[1] >= 0 && to[0] <= sx && to[1] <= sz && from[0] < to[0] && from[1] < to[1])) failures.push('footprint outside the model');
  return failures;
}
