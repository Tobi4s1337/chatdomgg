import type { PerspectiveCamera, Vector3 } from 'three';
import type { PlaceShot } from '../../interactions/places/framing';

/** Each owner is evaluated by the host before the game layer may touch its shared camera. */
export interface PlaceShotOwners {
  readonly walking: boolean;
  readonly capture: boolean;
  readonly build: boolean;
  readonly forge: boolean;
  readonly arrival: boolean;
  readonly moment: boolean;
  readonly growth: boolean;
  readonly dock: boolean;
  readonly handoff: boolean;
}

/** A game shot is an additive layer over the current director, never a replacement camera mode. */
export function createPlaceShot() {
  let shot: PlaceShot | null = null, active = false, revision = 0;
  return {
    get revision() { return revision; },
    inspect: () => ({ requested: shot !== null, active }),
    set(next: PlaceShot | null) {
      if (next && (next.eye.length !== 3 || next.at.length !== 3 || ![...next.eye, ...next.at].every(Number.isFinite)
        || Math.hypot(...next.eye.map((value, index) => value - next.at[index]!)) < .01)) {
        throw new Error('Place shot needs finite distinct eye and look point');
      }
      if (shot === null && next === null || shot && next && shot.eye.every((v, i) => v === next.eye[i]) && shot.at.every((v, i) => v === next.at[i])) return;
      shot = next ? { eye: [...next.eye], at: [...next.at] } : null;
      revision++;
    },
    apply(camera: PerspectiveCamera, target: Vector3, owners: PlaceShotOwners) {
      const permitted = shot !== null && !Object.values(owners).some(Boolean);
      if (active !== permitted) { active = permitted; revision++; }
      if (!permitted || !shot) return false;
      camera.position.set(...shot.eye); target.set(...shot.at); camera.lookAt(target);
      return true;
    },
  };
}
