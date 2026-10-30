import { AVATAR_RIG, AVATAR_SOCKETS, AvatarAttachmentIdSchema, VOXEL_METRES, type AvatarAttachmentId, type AvatarBoneId, type AvatarPartBlueprint, type Vec3 } from '@chatdom/shared';

/** Column-major 4×4, the layout `THREE.Matrix4.fromArray` reads. Translations are metres. */
export type Mat4 = readonly number[];

/**
 * Review-only joint rotations in degrees, applied in X then Y then Z order about each joint
 * (the same convention as `THREE.Euler` 'XYZ'). This is a static bench pose, not an animation protocol.
 */
export interface AvatarPose {
  readonly id: string;
  readonly label: string;
  readonly rotations: Partial<Record<AvatarBoneId, Vec3>>;
  /** Root translation in avatar cells, used to sit the body onto a seat or drop a crouch to the ground. */
  readonly root?: Vec3;
}

export const REST_POSE: AvatarPose = { id: 'rest', label: 'Standing at rest', rotations: {} };

type SocketId = keyof typeof AVATAR_SOCKETS;
const boneById = new Map(AVATAR_RIG.map(bone => [bone.id, bone]));
const isSocket = (id: AvatarAttachmentId): id is SocketId => Object.hasOwn(AVATAR_SOCKETS, id);

/** Parent and parent-local bind offset (cells) for any bone or socket, read from the frozen rig. */
export function attachmentBind(id: AvatarAttachmentId): { parent: AvatarAttachmentId | null; offset: Vec3 } {
  const valid = AvatarAttachmentIdSchema.parse(id);
  if (isSocket(valid)) return AVATAR_SOCKETS[valid];
  const bone = boneById.get(valid);
  if (!bone) throw new Error(`Unknown avatar attachment ${id}.`);
  return { parent: bone.parent, offset: bone.offset };
}

/** Assembled rest position in root-local avatar cells: the sum of bind offsets up the chain. */
export function restPosition(id: AvatarAttachmentId): Vec3 {
  const sum = [0, 0, 0];
  for (let at: AvatarAttachmentId | null = id; at; ) {
    const bind = attachmentBind(at);
    for (let i = 0; i < 3; i++) sum[i]! += bind.offset[i]!;
    at = bind.parent;
  }
  return sum as unknown as Vec3;
}

const identity = (): number[] => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

export function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Array<number>(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let sum = 0;
    for (let k = 0; k < 4; k++) sum += a[k * 4 + r]! * b[c * 4 + k]!;
    out[c * 4 + r] = sum;
  }
  return out;
}

export function translation(metres: Vec3): Mat4 {
  const m = identity();
  m[12] = metres[0]; m[13] = metres[1]; m[14] = metres[2];
  return m;
}

/** Rotation for intrinsic X, then Y, then Z degrees: R = Rx · Ry · Rz. */
export function rotationXYZ(degrees: Vec3): Mat4 {
  const [x, y, z] = degrees.map(d => d * Math.PI / 180) as [number, number, number];
  const a = Math.cos(x), b = Math.sin(x), c = Math.cos(y), d = Math.sin(y), e = Math.cos(z), f = Math.sin(z);
  const ae = a * e, af = a * f, be = b * e, bf = b * f;
  // Same element layout as THREE.Matrix4.makeRotationFromEuler for order 'XYZ'.
  return [c * e, af + be * d, bf - ae * d, 0, -c * f, ae - bf * d, be + af * d, 0, d, -b * c, a * c, 0, 0, 0, 0, 1];
}

const cellsToMetres = (cells: Vec3): Vec3 => cells.map(v => v * VOXEL_METRES.avatar) as unknown as Vec3;

/**
 * Parent-local transform of a bone or socket in a pose: its bind translation, then its own rotation.
 * Sockets never rotate on their own; they ride their parent bone.
 */
export function attachmentLocalMatrix(id: AvatarAttachmentId, pose: AvatarPose = REST_POSE): Mat4 {
  const bind = attachmentBind(id);
  const offset = id === 'root' && pose.root ? bind.offset.map((v, i) => v + pose.root![i]!) as unknown as Vec3 : bind.offset;
  const rotation = isSocket(id) ? undefined : pose.rotations[id];
  const local = translation(cellsToMetres(offset));
  return rotation ? multiply(local, rotationXYZ(rotation)) : local;
}

/** Root-local transform of every attachment in a pose, composed down the frozen hierarchy. */
export function poseAttachments(pose: AvatarPose = REST_POSE): ReadonlyMap<AvatarAttachmentId, Mat4> {
  const out = new Map<AvatarAttachmentId, Mat4>();
  const resolve = (id: AvatarAttachmentId): Mat4 => {
    const known = out.get(id);
    if (known) return known;
    const { parent } = attachmentBind(id);
    const local = attachmentLocalMatrix(id, pose);
    const world = parent ? multiply(resolve(parent), local) : local;
    out.set(id, world);
    return world;
  };
  for (const id of AvatarAttachmentIdSchema.options) resolve(id);
  return out;
}

/** Geometry offset inside the attachment: the mesh's cell coordinates become `(cell - pivot)` metres. */
export function partPivotMatrix(part: Pick<AvatarPartBlueprint, 'pivot'>): Mat4 {
  return translation(cellsToMetres(part.pivot.map(v => -v) as unknown as Vec3));
}

/** Root-local transform of a part's mesh in a pose. */
export function partMatrix(part: Pick<AvatarPartBlueprint, 'pivot' | 'attachment'>, pose: AvatarPose = REST_POSE): Mat4 {
  const attachment = poseAttachments(pose).get(part.attachment);
  if (!attachment) throw new Error(`Unknown avatar attachment ${part.attachment}.`);
  return multiply(attachment, partPivotMatrix(part));
}

export function transformPoint(m: Mat4, p: Vec3): Vec3 {
  return [
    m[0]! * p[0] + m[4]! * p[1] + m[8]! * p[2] + m[12]!,
    m[1]! * p[0] + m[5]! * p[1] + m[9]! * p[2] + m[13]!,
    m[2]! * p[0] + m[6]! * p[1] + m[10]! * p[2] + m[14]!,
  ];
}
