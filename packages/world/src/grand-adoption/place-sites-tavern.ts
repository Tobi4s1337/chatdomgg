import type { Vec3, VoxelBlueprint } from '@chatdom/shared';
import { WALK_BODY, type SolidBox } from '@chatdom/shared/realm';
import { bodyClear, finiteVec3 } from '../interactions/geometry';
import { placeHeading } from '../interactions/registry';
import { transformCardinalPoint } from '../settlement/geometry';
import { fullySupported, PLACE_SITE_BUDGET, type PlaceSiteContext, type PlaceSiteDiagnostic, type PlaceSiteFailure } from './place-sites';

export interface TavernDoorAnchor {
  /** Supported standing feet outside the existing doorway/porch; never the building centre. */
  readonly position: Vec3;
  /** World radians, zero +Z, facing into the doorway (same convention as interaction records). */
  readonly facing: number;
  readonly placementId: string;
  readonly assetHash: string;
}
export type TavernDoorSite = TavernDoorAnchor;
export interface TavernDoorResult { readonly anchor?: TavernDoorAnchor; readonly diagnostic?: PlaceSiteDiagnostic }
const EPS = 1e-6;

/** The installed growth producer authors this doorway at x28..36, y3..17, z22..24 build cells.
 * Source: packages/content/src/growth-civic/index.ts tavern(). Its mature porch ends at z31;
 * x32,z35 puts the full walker outside that porch at every level, on the same entrance axis.
 * This explicit producer adapter is intentionally not a "find the centre of any building" fallback. */
function knownDoor(bp: VoxelBlueprint): boolean {
  if (!/^growth-(hearth|tide)-tavern-[1-9][0-9]*$/.test(bp.id) || bp.kind !== 'civic' || bp.lattice !== 'build'
    || bp.size[0] !== 64 || bp.size[1] !== 64 || bp.size[2] !== 32) return false;
  const materialAt = (x: number, y: number, z: number) => {
    let material = 0;
    for (const b of bp.boxes) if (x >= b.from[0] && x < b.to[0] && y >= b.from[1] && y < b.to[1] && z >= b.from[2] && z < b.to[2]) material = b.material;
    return material;
  };
  // Verify the authored aperture against final ordered writes, so a changed asset cannot quietly close it.
  for (let x = 28; x < 36; x++) for (let y = 3; y < 17; y++) for (let z = 22; z < 24; z++) if (materialAt(x, y, z) !== 0) return false;
  return materialAt(32, 2, 22) !== 0;
}
function absent(reason: PlaceSiteFailure): TavernDoorResult {
  return { diagnostic: Object.freeze({ place: 'tavern', reason: 'unavailable', checked: 1, rejected: Object.freeze({ [reason]: 1 }) }) };
}

/** Cheap installed-asset lookup. No layout search, no terrain edit and no new exterior building.
 * Unknown producer geometry stays absent until that producer supplies an authored door adapter. */
export function findTavernDoor(context: PlaceSiteContext): TavernDoorResult {
  const { scene, collision, groundAt } = context;
  if (scene.plan.revision !== scene.layoutRevision || collision && collision.revision !== scene.collisionRevision) return absent('revision-mismatch');
  if (!collision) return absent('no-collision');
  if (scene.placements.length + scene.assets.length > PLACE_SITE_BUDGET.primitives) return absent('budget-exceeded');
  const matching = scene.placements.filter(p => p.id === 'civic:growth:v1:tavern');
  if (matching.length !== 1) return absent('missing-tavern');
  const placement = matching[0]!, bp = scene.assets.find(a => a.assetHash === placement.assetHash)?.blueprint;
  if (!bp || bp.boxes.length > 2_048 || !knownDoor(bp)) return absent('unsupported-tavern');
  const approach = transformCardinalPoint(placement.position, placement.rotation, [4, 0, 4.375]);
  const threshold = transformCardinalPoint(placement.position, placement.rotation, [4, .375, 3]);
  const ground = groundAt(approach[0], approach[2]);
  if (!finiteVec3(ground) || ground[0] !== approach[0] || ground[2] !== approach[2]) return absent('unknown-ground');
  const r = WALK_BODY.radius, bounds = { minX: approach[0] - r, maxX: approach[0] + r, minZ: approach[2] - r, maxZ: approach[2] + r };
  // Exterior foundations may be above terrain. Read their real tops rather than pretending groundAt includes them.
  if (ground[1] > threshold[1] + EPS || threshold[1] - ground[1] > WALK_BODY.stepHeight + .375) return absent('uneven-ground');
  const search: SolidBox = { min: [bounds.minX, ground[1] - .05, bounds.minZ], max: [bounds.maxX, threshold[1] + EPS, bounds.maxZ] };
  const boxes = collision.query(search);
  if (boxes.length > PLACE_SITE_BUDGET.collisionBoxes) return absent('budget-exceeded');
  const tops = [...new Set(boxes.filter(b => b.max[1] >= ground[1] - EPS && b.max[1] <= threshold[1] + EPS).map(b => b.max[1]))].sort((a, b) => b - a);
  if (tops.length > 16) return absent('budget-exceeded');
  for (const top of tops) {
    const point: Vec3 = [approach[0], top, approach[2]];
    if (fullySupported(bounds, boxes, top) === true && bodyClear(collision, point)) return { anchor: Object.freeze({
      position: Object.freeze(point), facing: placeHeading(placement.rotation, Math.PI), placementId: placement.id, assetHash: placement.assetHash,
    }) };
  }
  return absent('no-physical-support');
}
