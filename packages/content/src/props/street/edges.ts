import type { VoxelBlueprint } from '@chatdom/shared';
import { MAT, STYLES } from '../../materials';

type Box = VoxelBlueprint['boxes'][number];
export type StreetStyle = 'hearth' | 'tide';
type Kit = (typeof STYLES)[StreetStyle];

/** Push one half-open box; later boxes overwrite earlier cells, so accents follow their structure. */
const put = (boxes: Box[], x: number, y: number, z: number, X: number, Y: number, Z: number, material: number) => {
  if (x < X && y < Y && z < Z) boxes.push({ from: [x, y, z], to: [X, Y, Z], material });
};

/**
 * Join profile shared by every fence piece. Runs lie along local X with their centre line at z=2;
 * the two rails cross the join planes as full 2×2-cell timbers, so neighbouring rails meet end to end.
 */
export const FENCE_PROFILE = { rails: [[3, 5], [8, 10]], railZ: [1, 3], depth: 4, height: 12 } as const;
/** Join profile shared by every wall piece: plinth, inset body, overhanging cap and a cope crown. */
export const WALL_PROFILE = { plinth: [0, 2], body: [2, 6], cap: [6, 8], crown: [8, 9], depth: 4 } as const;

/**
 * A strainer post: stone plinth, a chamfered 4×4 timber, a cap that oversails the chamfers and a small finial.
 * Corners and run ends use it; its cross-shaped body keeps the rail-bearing face middle (cells 1..3) solid.
 */
function strainerPost(boxes: Box[], kit: Kit, px: number, pz: number) {
  put(boxes, px, 0, pz, px + 4, 2, pz + 4, kit.stone);
  put(boxes, px + 1, 2, pz, px + 3, 10, pz + 4, kit.trim);
  put(boxes, px, 2, pz + 1, px + 4, 10, pz + 3, kit.trim);
  put(boxes, px, 10, pz, px + 4, 11, pz + 4, kit.trim);
  put(boxes, px + 1, 11, pz + 1, px + 3, 12, pz + 3, kit.trim);
}

/** Two continuous rails along X between x0 and x1 at the shared fence heights. */
function railsAlongX(boxes: Box[], kit: Kit, x0: number, x1: number) {
  for (const [y0, y1] of FENCE_PROFILE.rails) put(boxes, x0, y0, FENCE_PROFILE.railZ[0], x1, y1, FENCE_PROFILE.railZ[1], kit.trim);
}

/**
 * Two metres of post-and-rail: one bay. A lighter line post stands mid-bay on a flat footing stone, so a run
 * never doubles a post against a corner or end strainer. Above the lower rail it leans one cell along the run,
 * an old fence settled by weather, and its top is weathered round. Both rails pass through it and cross both
 * join planes at full section, so joins stay exact whatever the lean.
 */
export function fenceStraight(kit: Kit): Box[] {
  const boxes: Box[] = [];
  put(boxes, 6, 0, 0, 12, 1, 4, kit.stone);
  put(boxes, 7, 1, 0, 10, 6, 4, kit.trim);
  put(boxes, 8, 6, 0, 11, 11, 4, kit.trim);
  put(boxes, 8, 11, 1, 11, 12, 3, kit.trim);
  railsAlongX(boxes, kit, 0, 16);
  return boxes;
}

/**
 * A right-angle turn around one shared strainer post at local [12,16)×[0,4). One arm runs to the x=0 plane,
 * the other to the z=16 plane, each carrying the same rails as a straight piece.
 */
export function fenceCorner(kit: Kit): Box[] {
  const boxes: Box[] = [];
  strainerPost(boxes, kit, 12, 0);
  railsAlongX(boxes, kit, 0, 12);
  for (const [y0, y1] of FENCE_PROFILE.rails) put(boxes, 13, y0, 4, 15, y1, 16, kit.trim);
  return boxes;
}

/** A capped terminal strainer post; rails arriving on its x=0 face finish against solid timber. */
export function fenceEnd(kit: Kit): Box[] {
  const boxes: Box[] = [];
  strainerPost(boxes, kit, 0, 0);
  return boxes;
}

/** Cope stones along X between x0 and x1, with one-cell joints at the given positions. */
function crownAlongX(boxes: Box[], kit: Kit, segments: readonly (readonly [number, number])[]) {
  for (const [a, b] of segments) put(boxes, a, WALL_PROFILE.crown[0], 1, b, WALL_PROFILE.crown[1], 3, kit.stone);
}

/**
 * Two metres of low garden wall in three clear courses: a wide plinth, a body set back one cell on each face,
 * and an oversailing cap with a crown of cope stones. The crown joints sit at x=5 and x=10 so the pattern
 * mirrors cleanly and cope stones pair across a join into one ten-cell stone.
 */
export function wallStraight(kit: Kit): Box[] {
  const boxes: Box[] = [];
  put(boxes, 0, 0, 0, 16, 2, 4, kit.stone);
  put(boxes, 0, 2, 1, 16, 6, 3, kit.stone);
  put(boxes, 0, 6, 0, 16, 8, 4, kit.stone);
  crownAlongX(boxes, kit, [[0, 5], [6, 10], [11, 16]]);
  // Moss has taken one cope joint.
  put(boxes, 10, 8, 1, 11, 9, 3, MAT.moss);
  return boxes;
}

/**
 * A wall turn of the same thickness throughout. The corner square is bonded by alternating quoins: the lower
 * one runs along X, the upper one along Z, so the turn reads as laid stone rather than two walls intersecting.
 */
export function wallCorner(kit: Kit): Box[] {
  const boxes: Box[] = [];
  put(boxes, 0, 0, 0, 16, 2, 4, kit.stone);
  put(boxes, 12, 0, 4, 16, 2, 16, kit.stone);
  put(boxes, 0, 2, 1, 15, 6, 3, kit.stone);
  put(boxes, 13, 2, 1, 15, 6, 16, kit.stone);
  put(boxes, 10, 2, 0, 16, 4, 4, kit.stone);
  put(boxes, 12, 4, 0, 16, 6, 6, kit.stone);
  put(boxes, 0, 6, 0, 16, 8, 4, kit.stone);
  put(boxes, 12, 6, 4, 16, 8, 16, kit.stone);
  // Cope stones mirror across the diagonal; the corner stone itself is one L.
  crownAlongX(boxes, kit, [[0, 5], [6, 11], [12, 15]]);
  put(boxes, 13, 8, 3, 15, 9, 4, kit.stone);
  put(boxes, 13, 8, 5, 15, 9, 10, kit.stone);
  put(boxes, 13, 8, 11, 15, 9, 16, kit.stone);
  put(boxes, 13, 8, 10, 15, 9, 11, MAT.moss);
  return boxes;
}

/**
 * A low end pier. Its x=0 face is solid across the whole wall section; the outer two vertical edges are
 * chamfered and its cap sits one course above the wall cap, so the run visibly stops here.
 */
export function wallEnd(kit: Kit): Box[] {
  const boxes: Box[] = [];
  put(boxes, 0, 0, 0, 4, 2, 4, kit.stone);
  put(boxes, 0, 2, 0, 3, 7, 4, kit.stone);
  put(boxes, 3, 2, 1, 4, 7, 3, kit.stone);
  put(boxes, 0, 7, 0, 4, 9, 4, kit.stone);
  put(boxes, 1, 9, 1, 3, 10, 3, kit.stone);
  return boxes;
}
