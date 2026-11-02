import { VOXEL_METRES, type Vec3 } from '@chatdom/shared';
import { transformCardinalPoint, type RealmFoundedScene } from '@chatdom/world';

/** The director's held pier shot: the deck and its lanterns in the lower third, the head out on the water. */
export interface PierShotPose {
  readonly eye: Vec3;
  readonly target: Vec3;
  readonly fov: number;
  /** Where the deck meets the bank, and its far end, at deck height. */
  readonly root: Vec3;
  readonly head: Vec3;
}

/** pier's own framing of its 1080p stills: 16 m behind the root along the deck, 18 m aside, 9 m over the deck. */
const BEHIND = 16, ASIDE = 18, RISE = 9, FOV = 45;
/** The eye keeps this much air over the drawn land under it. */
const EYE_CLEARANCE = 3;

/**
 * Frames the founded pier from the shore, from the pier's own placements (ids `pier:…`) and their blueprints, so
 * the shot exists exactly when a pier stands in the kingdom and follows it wherever it was placed. The deck runs
 * along the pieces' shared turn (local +Z points out over the water); the root is its landward end. Of the two
 * shore sides the eye takes the one whose sightline to the middle of the walk the drawn land does not cut, the
 * pier's own side (+X local) on a tie. `ground` is the drawn land height (visual, never walking ground).
 * Null when the kingdom has no pier.
 */
export function pierShot(scene: Pick<RealmFoundedScene, 'assets' | 'placements'>, ground: (x: number, z: number) => number | null): PierShotPose | null {
  const pieces = scene.placements.filter(piece => piece.id.startsWith('pier:'));
  if (!pieces.length) return null;
  const turns = [0, 0, 0, 0];
  for (const piece of pieces) turns[piece.rotation]!++;
  const turn = turns.indexOf(Math.max(...turns)) as 0 | 1 | 2 | 3;
  const out = transformCardinalPoint([0, 0, 0], turn, [0, 0, 1]), side = transformCardinalPoint([0, 0, 0], turn, [1, 0, 0]);
  const assets = new Map(scene.assets.map(asset => [asset.assetHash, asset.blueprint] as const));
  let s0 = Infinity, s1 = -Infinity, t0 = Infinity, t1 = -Infinity, deckY = Infinity;
  for (const piece of pieces) {
    const blueprint = assets.get(piece.assetHash);
    if (!blueprint) continue;
    const unit = VOXEL_METRES[blueprint.lattice], a = piece.position;
    const b = transformCardinalPoint(a, piece.rotation, [blueprint.size[0] * unit, 0, blueprint.size[2] * unit]);
    for (const [x, z] of [[a[0], a[2]], [b[0], b[2]]] as const) {
      const s = x * out[0] + z * out[2], t = x * side[0] + z * side[2];
      s0 = Math.min(s0, s); s1 = Math.max(s1, s); t0 = Math.min(t0, t); t1 = Math.max(t1, t);
    }
    deckY = Math.min(deckY, a[1]);
  }
  if (![s0, s1, t0, t1, deckY].every(Number.isFinite) || s1 - s0 < .5) return null;
  const at = (s: number, t: number, y: number): Vec3 => [out[0] * s + side[0] * t, y, out[2] * s + side[2] * t];
  const tc = (t0 + t1) / 2, root = at(s0, tc, deckY), head = at(s1, tc, deckY), target = at((s0 + s1) / 2, tc, deckY);
  let best: { eye: Vec3; cut: number } | null = null;
  for (const sign of [1, -1]) {
    const [x, , z] = at(s0 - BEHIND, tc + sign * ASIDE, 0), land = ground(x, z);
    const eye: Vec3 = [x, Math.max(deckY + RISE, (land ?? -Infinity) + EYE_CLEARANCE), z];
    // How far the drawn land rises into the line of sight, summed over the inner samples (0 when clear).
    let cut = land === null ? 1e6 : 0;
    for (let i = 1; i < 24 && cut < 1e6; i++) {
      const k = i / 24, px = eye[0] + (target[0] - eye[0]) * k, pz = eye[2] + (target[2] - eye[2]) * k;
      const h = ground(px, pz);
      if (h !== null) cut += Math.max(0, h + .4 - (eye[1] + (target[1] - eye[1]) * k));
    }
    if (!best || cut < best.cut - 1e-6) best = { eye, cut };
  }
  return Object.freeze({ eye: best!.eye, target, fov: FOV, root, head });
}
