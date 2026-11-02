import type * as THREE from 'three';
import type { CollisionWorld } from '@chatdom/shared/realm';
import { createDrawnGround, type DrawnGroundAt, type DrawnSurfaceAt } from './drawn-ground';
import { createGroundOffset, type GroundOffset } from './offset';
import { createSupportClassifier, type SupportClassifier } from './support';

export { createDrawnGround, sampleHeightField, terrainHeightField, type DrawnGround, type DrawnGroundAt, type DrawnGroundOptions,
  type DrawnSurfaceAt, type DrawnSurfaceSample, type TerrainHeightField } from './drawn-ground';
export { createGroundOffset, followsDrawnGround, GROUND_OFFSET, type GroundOffset, type GroundOffsetSample } from './offset';
export { createSupportClassifier, type SupportClassifier, type SupportOptions, type WalkerSupport } from './support';

/** Highest solid placement top at (x, z) not above `below`, or null. */
export type SolidFloorAt = (x: number, z: number, below: number) => number | null;

export interface WalkerGroundOptions {
  /** The scene holding the drawn terrain tiles (the fallback source until the land seam has `surfaceAt`). */
  readonly scene?: THREE.Object3D | undefined;
  /** `KingdomLandInterface.surfaceAt` once grand-world ships it (SEAMS A2); preferred over the scene. */
  readonly surfaceAt?: DrawnSurfaceAt | undefined;
  /** The collision revision walkers move in right now, or null while it is not here. */
  readonly world: () => CollisionWorld | null;
  /** Bottom of the compiled terrain columns: `sampleFoundedTerrain(scene.plan).origin[1]`. */
  readonly terrainFloorY: number;
  /** Top of the compiled volume: `sampleFoundedTerrain(scene.plan).ceilingY`. */
  readonly terrainCeilingY?: number | undefined;
  readonly clock?: (() => number) | undefined;
}

export interface WalkerGroundPose {
  readonly x: number; readonly y: number; readonly z: number;
  /** Only the walker's own predicted body knows it; leave it out for everyone else. */
  readonly grounded?: boolean | undefined;
  /** Seated or otherwise drawn at an authored rest pose. */
  readonly posed?: boolean | undefined;
}

export interface WalkerGround {
  /**
   * The height to DRAW this walker's feet at this frame: `pose.y` plus its eased, clamped visual ground offset.
   * Presentation only. The camera, collision, prediction, interaction reach and footstep gating keep `pose.y`.
   */
  bodyY(id: string, pose: WalkerGroundPose, dtSeconds: number): number;
  /** The drawn ground sampler, also for the gait's per-foot heights (`FootstepSample.ground`). */
  readonly drawnAt: DrawnGroundAt;
  /** A per-walker sampler for the gait: the drawn ground while this walker's body follows it, otherwise undefined. */
  groundFor(id: string): DrawnGroundAt | undefined;
  /**
   * The stepped solid floor for the gait (`FootstepSample.floor`), shared by every walker: the highest placement top
   * at (x, z) not above `below`, from the same cached bins. Null where no placement is or no world is loaded.
   */
  readonly floorAt: SolidFloorAt;
  /** Drop state for walkers that are gone. Call once per frame with everyone drawn this frame. */
  retain(ids: ReadonlySet<string>): void;
  /** Forget one walker's easing (teleport, relocation, reconnect), or everyone's. */
  reset(id?: string): void;
}

/**
 * Per-walker drawn ground for the renderer: one shared drawn sampler and support classifier, one offset filter per
 * walker. About two drawn samples per walker per frame (body and gait) and no collision query once a 4 m bin is known.
 */
export function createWalkerGround(options: WalkerGroundOptions): WalkerGround {
  const drawn = createDrawnGround({ scene: options.scene, surfaceAt: options.surfaceAt, clock: options.clock });
  const walkers = new Map<string, GroundOffset>();
  let support: SupportClassifier | undefined;
  const classifier = (): SupportClassifier | undefined => {
    const world = options.world();
    if (!world) return undefined;
    // A new revision may have moved floors; each walker's offset eases to what the new one says, so nothing pops.
    if (support?.world !== world) support = createSupportClassifier(world, { terrainFloorY: options.terrainFloorY,
      ...(options.terrainCeilingY === undefined ? {} : { terrainCeilingY: options.terrainCeilingY }) });
    return support;
  };
  const floorAt: SolidFloorAt = (x, z, below) => classifier()?.topAt(x, z, below) ?? null;
  return {
    drawnAt: drawn.at,
    floorAt,
    bodyY(id, pose, dt) {
      let walker = walkers.get(id);
      if (!walker) walkers.set(id, walker = createGroundOffset());
      const classify = classifier();
      const drawnY = classify && !pose.posed ? drawn.at(pose.x, pose.z) : null;
      const offset = walker.update({ y: pose.y, drawnY, support: classify ? classify.at(pose.x, pose.y, pose.z) : 'solid',
        grounded: pose.grounded, posed: pose.posed, dt });
      return pose.y + offset;
    },
    groundFor(id) { return walkers.get(id)?.following ? drawn.at : undefined; },
    retain(ids) { for (const id of walkers.keys()) if (!ids.has(id)) walkers.delete(id); },
    reset(id) {
      if (id === undefined) { for (const walker of walkers.values()) walker.reset(); return; }
      walkers.get(id)?.reset();
    },
  };
}
