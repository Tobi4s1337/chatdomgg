import type { Vec3 } from '../voxel';

export const REALM_PROTOCOL = 1 as const;
export const WALK_HZ = 30;
export const REALM_PATCH_MS = 200;
export const REALM_MESSAGE_LIMIT = 90;
export const WALK_BUTTON = { sprint: 1, jump: 2 } as const;
export const WALK_BODY = { radius: .28, height: 1.75, stepHeight: .5 } as const;

/** World-relative signed bytes. Camera rotation occurs before quantization, outside the simulation. */
export interface WalkInput {
  moveX: number; moveZ: number; buttons: number; yaw: number; collisionRevision: number;
}
/** Authority placement context, echoed on the wire. Colyseus still owns all input ordering and acknowledgements.
 * It changes only when the server relocates this walker, so late inputs from before that placement cannot move it. */
export interface RealmWalkInput extends WalkInput { placement: number }
/** Feet in world metres, velocities m/s. The same fields are reconciled on both ends. */
export interface PlayerState {
  x: number; y: number; z: number; vx: number; vy: number; vz: number;
  grounded: boolean; yaw: number; distance: number; collisionRevision: number;
}
export const PLAYER_FIELDS = ['x', 'y', 'z', 'vx', 'vy', 'vz', 'grounded', 'yaw', 'distance', 'collisionRevision'] as const;
export interface SolidBox { readonly min: Vec3; readonly max: Vec3 }
/**
 * Immutable collision revision, independent of render/shadow LOD. Query returns world-space solid boxes
 * intersecting bounds, in stable order with no duplicates. Unknown space must return solid barriers.
 * Openings/air are already resolved; glass remains solid. The caller must not mutate returned boxes.
 */
export interface CollisionWorld {
  readonly revision: number;
  query(bounds: SolidBox): readonly SolidBox[];
}
export type PlayerStep = (state: PlayerState, input: Readonly<WalkInput>, dt: number, voxels: CollisionWorld) => void;

/** Shared sanitizer: finite integral bits, no client delta-time or speed. */
export function sanitizeWalkInput(input: WalkInput): void {
  const byte = (n: number, min: number, max: number) => Number.isFinite(n) ? Math.max(min, Math.min(max, Math.trunc(n))) : 0;
  input.moveX = byte(input.moveX, -127, 127); input.moveZ = byte(input.moveZ, -127, 127);
  input.buttons = byte(input.buttons, 0, 255) & 3;
  input.yaw = byte(input.yaw, 0, 255);
  input.collisionRevision = byte(input.collisionRevision, 0, 0xffffffff);
}

export function sanitizeRealmWalkInput(input: RealmWalkInput): void {
  sanitizeWalkInput(input);
  input.placement = Number.isFinite(input.placement) ? Math.max(0, Math.min(0xffffffff, Math.trunc(input.placement))) : 0;
}
