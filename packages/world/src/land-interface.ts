import type { Vec3 } from '@chatdom/shared';
import type { CollisionWorld } from '@chatdom/shared/realm';
import type { RealmFoundedScene } from './founded-world/types';
import { foundedAnvilPosition } from './interactions/founded';
import { finiteVec3, standingClear, SUPPORT_GAP } from './interactions/geometry';
import type { CardinalTurn } from './settlement/types';
import { planPlaceSites, type KingdomPlaceSites, type PlaceSiteDiagnostic, type PlaceSitePlanningOptions } from './grand-adoption/place-sites';
import { findTavernDoor } from './grand-adoption/place-sites-tavern';
import { planPierSites, type LandWaterSource, type PierAnchor, type PierSiteDiagnostic, type PierSitePlanningOptions } from './grand-adoption/pier-sites';

export { planPlaceSites, validatePlaceSite, placeSiteBounds, PLACE_SITE_BUDGET, CAMPFIRE_SITE_FOOTPRINT } from './grand-adoption/place-sites';
export { findTavernDoor, type TavernDoorAnchor, type TavernDoorSite, type TavernDoorResult } from './grand-adoption/place-sites-tavern';
export type { KingdomPlaceSites, PlaceKind, PlaceSiteContext, PlaceSiteFailure, PlaceSiteDiagnostic, PlaceSitePlan, PlaceSitePlanningOptions } from './grand-adoption/place-sites';
export { planPierSites, validatePierSite, pierSiteBounds, PIER_SITE_BUDGET } from './grand-adoption/pier-sites';
export type { LandWaterSource, LandWaterAt, LandWaterSample, LandWaterCoverage, PierAnchor, PierSiteCandidate,
  PierPlanningDimensions, PierSiteContext, PierSitePlanningOptions, PierSiteValidation, PierSiteFailure,
  PierSiteDiagnostic, PierSitePlan, PierSiteWork } from './grand-adoption/pier-sites';

/** Shared local blueprint origin, world metres on physical ground. Local +Z is the open/front side. */
export interface PlaceSite {
  readonly origin: Vec3;
  readonly turn: CardinalTurn;
  readonly footprint: readonly [width: number, depth: number];
}

/** Actual solid top in world metres, independent of scenery, water sheets and render LOD.
 * null means unknown/unsupported. Implementations must not extrapolate into unloaded land. */
export type LandGroundAt = (x: number, z: number) => Vec3 | null;

/** A physical exterior-ground sampler bound to one installed scene, not a far-LOD height.
 * Revisions attest producer identity; the producer must also test samples against collision.
 * Immutable for these revisions. Loading more physical ground installs a new seam. */
export interface LandGroundSource extends Pick<RealmFoundedScene, 'layoutRevision' | 'collisionRevision'> {
  readonly sample: LandGroundAt;
}

/** Local consumer seam, not a wire schema or a replacement for the adopted settlement.
 * scene is already validated public geometry. All positions are absolute metres. Keep its
 * exact plan, founded-content hashes, placements, attachments and cardinal turns; never reseed it here.
 * Public HOME's ownership/Forge digest is a different hash namespace, resolved by its adapter.
 * Caller owns an immutable installed snapshot. This facade does not deep-freeze caller data. */
export interface KingdomLandInterface {
  readonly scene: RealmFoundedScene;
  /** Invalid coordinates/results and unknown ground return null. Does not grant walking. */
  readonly groundAt: LandGroundAt;
  /** Optional loaded-region physics, including structures. Unknown space remains solid. */
  readonly collision: CollisionWorld | undefined;
  readonly paths: Pick<RealmFoundedScene['plan'], 'nodes' | 'streets' | 'activeStreetIds'>;
  readonly forge: { readonly square: RealmFoundedScene['plan']['market']; readonly anvil: Vec3;
    /** Only offered with actual support and full-body clearance. */
    readonly approach: Vec3 | null };
  /** Inputs for spectaclePlacesOf/doorOf/windowOf: roofs and windows come from actual assets.
   * No synthetic roofs, crowd, or lair/track anchors are inferred from the larger scenery. */
  readonly moments: { readonly plaza: Vec3 | null; readonly castleGate: Vec3 | null };
  /** Exact installed geometry for foundedContent + createWindowLights/light-field occupancy.
   * Slot linkage comes only from scene.plan.homes[].id ↔ placement.plotId; attachments
   * retain their hashes but supply no additional citizen window. Strength comes from presence. */
  readonly light: Pick<RealmFoundedScene, 'plan' | 'assets' | 'placements'>;
  /** Existing tavern portal; the empty campfire site is opt-in installation-time planning. */
  readonly places?: KingdomPlaceSites;
  /** No site is a real outcome: callers must arrange an explicit migration, never invent ground. */
  readonly placeSiteDiagnostics?: readonly PlaceSiteDiagnostic[];
  /** Offered only with revision-matched drawn-water evidence and physical support. Never grants deck collision. */
  readonly piers?: readonly PierAnchor[];
  readonly pierSiteDiagnostics?: readonly PierSiteDiagnostic[];
}

/** Preserve public identity; larger landscape support is supplied by its producer, never
 * the old bounded founded terrain compiler. A supplied collision revision must match. */
export function createKingdomLandInterface(input: {
  readonly scene: RealmFoundedScene; readonly ground: LandGroundSource; readonly collision?: CollisionWorld;
  /** Opt-in, bounded installation-time work; keep the resulting facade instead of rebuilding it per frame. */
  readonly placeSites?: PlaceSitePlanningOptions;
  /** Supplied by the adoption producer from actual installed water; absent/unknown water authorizes no pier. */
  readonly water?: LandWaterSource;
  readonly pierSites?: PierSitePlanningOptions;
}): KingdomLandInterface {
  const { scene, ground, collision } = input, plan = scene.plan;
  if (scene.layoutRevision !== plan.revision || ground.layoutRevision !== scene.layoutRevision
    || ground.collisionRevision !== scene.collisionRevision || collision && collision.revision !== scene.collisionRevision)
    throw new Error('Land consumers need the installed layout and collision revisions');
  const groundAt: LandGroundAt = (x, z) => {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
    const point = ground.sample(x, z);
    return finiteVec3(point) && point[0] === x && point[2] === z ? point : null;
  };
  const anvil = foundedAnvilPosition(scene), candidate: Vec3 = [anvil[0], anvil[1], anvil[2] + 1.7];
  const supported = (point: Vec3): boolean => {
    if (!finiteVec3(point)) return false;
    const top = groundAt(point[0], point[2]);
    // Feet may sit just above a top, never under it. Mirrors interaction support tolerance.
    return top !== null && top[1] <= point[1] + 1e-6 && point[1] - top[1] <= SUPPORT_GAP;
  };
  const node = (id: string): Vec3 | null => {
    const point = plan.nodes.find(item => item.id === id)?.position;
    return point && supported(point) ? point : null;
  };
  const placePlan = input.placeSites ? planPlaceSites({ scene, groundAt, ...(collision ? { collision } : {}) }, input.placeSites) : undefined;
  const tavern = findTavernDoor({ scene, groundAt, ...(collision ? { collision } : {}) });
  const pierPlan = input.pierSites ? planPierSites({ scene, groundAt, ...(collision ? { collision } : {}),
    ...(input.water ? { water: input.water } : {}) }, input.pierSites) : undefined;
  return Object.freeze({ scene, groundAt, collision,
    paths: Object.freeze({ nodes: plan.nodes, streets: plan.streets, activeStreetIds: plan.activeStreetIds }),
    forge: Object.freeze({ square: plan.market, anvil,
      approach: supported(candidate) && collision && standingClear(collision, candidate) ? candidate : null }),
    moments: Object.freeze({ plaza: node(plan.market.nodeId), castleGate: node(plan.castle.gateNodeId) }),
    light: Object.freeze({ plan, assets: scene.assets, placements: scene.placements }),
    places: Object.freeze({ ...placePlan?.places, ...(tavern.anchor ? { tavern: tavern.anchor } : {}) }),
    placeSiteDiagnostics: Object.freeze([...(tavern.diagnostic ? [tavern.diagnostic] : []), ...placePlan?.diagnostics ?? []]),
    ...(pierPlan ? { piers: pierPlan.piers, pierSiteDiagnostics: pierPlan.diagnostics } : {}),
  });
}
