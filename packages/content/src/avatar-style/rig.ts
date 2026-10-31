import { AVATAR_RIG, AVATAR_SOCKETS, type AvatarAttachmentId, type AvatarBoneId, type Vec3 } from '@chatdom/shared';
import type { BodyFamily } from '../avatars/body';
import { restPosition } from '../avatars/rig';
import { styleRow, torsoTop, type AvatarStyle } from './styles';

/**
 * A study skeleton: the frozen rig's bones and sockets, in the frozen hierarchy, at a style's own rest
 * positions (root-local cells). Selecting a style whose joints differ from today's would change
 * `AVATAR_RIG` offsets in `@chatdom/shared`; the study only proposes them.
 */
export interface StyleRig {
  /** Root-local rest position of every bone and socket. */
  readonly rest: ReadonlyMap<AvatarAttachmentId, Vec3>;
  /** Parent of every bone and socket, as in the frozen rig. */
  readonly parent: ReadonlyMap<AvatarAttachmentId, AvatarAttachmentId | null>;
}

const PARENTS = new Map<AvatarAttachmentId, AvatarAttachmentId | null>([
  ...AVATAR_RIG.map(bone => [bone.id, bone.parent] as const),
  ...Object.entries(AVATAR_SOCKETS).map(([id, socket]) => [id as AvatarAttachmentId, socket.parent] as const),
]);

/** Today's rig, so the current wardrobe can stand on the same bench under the same pose. */
export function currentRig(): StyleRig {
  return { rest: new Map([...PARENTS.keys()].map(id => [id, restPosition(id)] as const)), parent: PARENTS };
}

/** Joint columns sit on cell corners inside a limb, truncated toward the centre line. */
const middle = (a: number, b: number): number => Math.trunc((a + b) / 2);

export function styleRig(style: AvatarStyle, family: BodyFamily): StyleRig {
  const f = style.families[family];
  const top = torsoTop(style, family);
  const shoulderX = middle(f.arm.inner, f.arm.outer), hipX = middle(f.leg.outer, f.leg.inner);
  const rest = new Map<AvatarAttachmentId, Vec3>();
  const bones: Record<AvatarBoneId, Vec3> = {
    root: [0, 0, 0],
    pelvis: [0, style.hipY, 0],
    chest: [0, style.chestY, 0],
    head: [0, style.head.y[0], 0],
    upperArmLeft: [-shoulderX, style.shoulderY, 0], forearmLeft: [-shoulderX, style.elbowY, 0], handLeft: [-shoulderX, style.wristY, 0],
    upperArmRight: [shoulderX, style.shoulderY, 0], forearmRight: [shoulderX, style.elbowY, 0], handRight: [shoulderX, style.wristY, 0],
    thighLeft: [hipX, style.hipY, 0], shinLeft: [hipX, style.kneeY, 0], footLeft: [hipX, style.ankleY, 0],
    thighRight: [-hipX, style.hipY, 0], shinRight: [-hipX, style.kneeY, 0], footRight: [-hipX, style.ankleY, 0],
  };
  for (const [id, at] of Object.entries(bones)) rest.set(id as AvatarBoneId, at);
  // The cloak pins one row under the collar, two cells in front of the deepest back so its mount clears it.
  const deepest = Math.min(...f.torso.map(s => s.back));
  rest.set('back', [0, top - 1, Math.min(0, deepest + 2)]);
  rest.set('hat', [0, style.head.y[1], 0]);
  rest.set('face', [0, style.head.eyeBottom, style.head.z[1]]);
  const handBottom = style.handBottom;
  rest.set('gripLeft', [-shoulderX, handBottom + 1, f.arm.front]);
  rest.set('gripRight', [shoulderX, handBottom + 1, f.arm.front]);
  for (const id of PARENTS.keys()) if (!rest.has(id)) throw new Error(`${style.id}: no rest position for ${id}.`);
  // Sanity: the chest bone sits inside the torso, the head on top of it.
  styleRow(style, family, style.chestY);
  if (style.head.y[0] <= top) throw new Error(`${style.id}: the head overlaps the torso.`);
  return { rest, parent: PARENTS };
}

/** Parent-local offset of an attachment in a rig (cells). */
export function rigOffset(rig: StyleRig, id: AvatarAttachmentId): Vec3 {
  const at = rig.rest.get(id), parentId = rig.parent.get(id);
  if (!at || parentId === undefined) throw new Error(`Unknown avatar attachment ${id}.`);
  if (parentId === null) return at;
  const p = rig.rest.get(parentId)!;
  return [at[0] - p[0], at[1] - p[1], at[2] - p[2]];
}
