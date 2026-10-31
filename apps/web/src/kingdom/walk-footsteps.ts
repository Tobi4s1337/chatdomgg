import type { RealmWalkerPose } from '../realm/client';
import { VOXEL_METRES, type Vec3 } from '@chatdom/shared';
import type { AudioMaterial } from '@chatdom/audio';
import type { RealmFoundedScene } from '@chatdom/world';

export interface WalkFootstepFrame {
  readonly now: number;
  readonly pose: Pick<RealmWalkerPose, 'distance' | 'x' | 'y' | 'z' | 'speed'> | undefined;
  readonly active: boolean;
  readonly grounded: boolean;
  readonly placement: number;
  readonly revision: number;
}

// The renderer's full left/right stride is 1.8 m. Contacts are its half-stride zero crossings.
const CONTACT_METRES = .9;

/** Observes the existing render clock and distance; never schedules or catches up missed footfalls. */
export function createWalkFootsteps() {
  let previous: WalkFootstepFrame | undefined;
  return {
    reset() { previous = undefined; },
    /** A contact's absolute index (for alternating feet), or null when nothing touches down this frame. */
    update(frame: WalkFootstepFrame): number | null {
      const prior = previous;
      const pose = frame.pose;
      if (!frame.active || !frame.grounded || !pose
        || ![frame.now, pose.distance, pose.x, pose.y, pose.z, pose.speed].every(Number.isFinite)) {
        previous = undefined;
        return null;
      }
      previous = frame;
      if (!prior?.pose || prior.placement !== frame.placement || prior.revision !== frame.revision) return null;
      const elapsed = frame.now - prior.now;
      const travel = pose.distance - prior.pose.distance;
      const displacement = Math.hypot(pose.x - prior.pose.x, pose.z - prior.pose.z);
      // Hidden tabs, relocations and reconciliation may advance the gait over several contacts. Consume
      // that observation silently. Ordinary 7 m/s sprint frames still pass, including a 100 ms frame.
      if (!(elapsed > 0 && elapsed <= 200) || travel < 0 || travel > CONTACT_METRES
        || displacement > CONTACT_METRES || Math.abs(pose.y - prior.pose.y) > .75) return null;
      const before = Math.floor(prior.pose.distance / CONTACT_METRES);
      const contact = Math.floor(pose.distance / CONTACT_METRES);
      return contact === before + 1 && pose.speed > .1 && displacement > .001 ? contact : null;
    },
  };
}

/** Samples only an accepted home's retained geometry, on contact; later writes (including air) win. */
export function createHomeStepMaterial(scene: Pick<RealmFoundedScene, 'assets' | 'placements' | 'materials'>) {
  const assets = new Map(scene.assets.map(asset => [asset.assetHash, asset.blueprint]));
  const homes = new Map(scene.placements.filter(placement => placement.plotId && assets.get(placement.assetHash)?.kind === 'home')
    .map(placement => [placement.plotId!, { placement, blueprint: assets.get(placement.assetHash)! }]));
  const materials = new Map(scene.materials.materials.map(material => [material.id, material]));
  return (plotId: string | null, feet: Vec3): AudioMaterial | undefined => {
    const home = plotId ? homes.get(plotId) : undefined;
    if (!home) return undefined;
    const { placement, blueprint } = home;
    const dx = feet[0] - placement.position[0], dz = feet[2] - placement.position[2];
    const local = placement.rotation === 0 ? [dx, dz] : placement.rotation === 1 ? [-dz, dx]
      : placement.rotation === 2 ? [-dx, -dz] : [dz, -dx];
    const cell = [Math.floor(local[0]! / VOXEL_METRES.build),
      Math.floor((feet[1] - placement.position[1] - .001) / VOXEL_METRES.build),
      Math.floor(local[1]! / VOXEL_METRES.build)];
    for (let index = blueprint.boxes.length - 1; index >= 0; index--) {
      const box = blueprint.boxes[index]!;
      if (!cell.every((value, axis) => value >= box.from[axis]! && value < box.to[axis]!)) continue;
      const material = materials.get(box.material);
      if (!material?.solid) return undefined;
      switch (material.surface) {
        case 'wood': case 'stone': case 'earth': case 'metal': case 'glass': case 'fabric': return material.surface;
        case 'grass': return 'earth';
        case 'plaster': return 'stone';
        default: return undefined;
      }
    }
    return undefined;
  };
}
