import type { MaterialRegistry, Vec3, VoxelBlueprint } from '@chatdom/shared';
import type { RealmFoundedManifest } from '@chatdom/shared/realm';
import type { CardinalTurn, SettlementPlan } from '../settlement/types';

/** Reviewed public geometry only. Hash identifies the producer's immutable blueprint bytes. */
export interface RealmFoundedBlueprint {
  readonly assetHash: string;
  readonly blueprint: VoxelBlueprint;
}

/** World metres at blueprint local origin; rotate about that origin before translating.
 * Turn 1 maps local [x,y,z] to [z,y,-x], matching transformCardinalPoint; turns 2/3 repeat it.
 * Openings remain part of the blueprint's ordered voxel operations. */
export interface RealmFoundedPlacement {
  readonly id: string;
  readonly assetHash: string;
  readonly position: Vec3;
  readonly rotation: CardinalTurn;
  /** Public plot identity when this is its approved home geometry; never a person or allocation receipt. */
  readonly plotId?: string;
}

/**
 * Browser-safe public scene behind RealmFoundedManifest.sceneHash. The scene does not hash itself.
 * plan is the exact persisted adopted plan, never regenerated from its config. assets contains unique
 * reviewed blueprints; placements contains all current structures/props and approved home replacements,
 * including fitted geometry. Each placement references an included asset exactly once by hash; repeated
 * instances may share it. Terrain comes from this plan, with the same compiler on server and client.
 *
 * Producers explicitly construct and validate this allowlist before storage/serving. These interfaces
 * are not runtime validation and never authorize serializing RealmPrivateState/RealmOwnedHome: owner IDs,
 * allocation/approval receipts, creation words, private drafts and sessions have no place here. Missing
 * assets, duplicate placement IDs, plan/revision disagreement or unknown space must fail closed.
 */
export interface RealmFoundedScene extends Omit<RealmFoundedManifest, 'sceneHash'> {
  readonly plan: SettlementPlan;
  readonly materials: MaterialRegistry;
  readonly assets: readonly RealmFoundedBlueprint[];
  readonly placements: readonly RealmFoundedPlacement[];
}
