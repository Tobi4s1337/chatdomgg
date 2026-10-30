import type { Vec3 } from '@chatdom/shared';
import type { CardinalTurn, LandformBase, SettlementPlan, XZ } from '../settlement/types';

/** Presentation geography, not a deed, ownership record or authority to move an existing home. */
export interface LandHill { id: string; centre: XZ; radius: number; height: number; plateau: number }
export interface WaterBody {
  id: string; x: number; z: number; radiusX: number; radiusZ: number; level: number; depth: number;
}
/** Downstream order; >=2 points, bed < level, positive width, non-increasing level. */
export interface LandStream {
  id: string; kind: 'stream' | 'leat' | 'tailrace'; bank: number;
  points: readonly { position: XZ; bed: number; level: number; width: number }[];
}
export interface KingdomLandform extends LandformBase {
  version: 2; hills: readonly LandHill[]; waters: readonly WaterBody[]; streams: readonly LandStream[];
}
/** Signed distance to the wet edge (negative inside), including a bank envelope in the sampler. */
export interface LandWaterSample { id: string; surface: number; bed: number; shoreDistance: number }
export interface LandSite {
  id: string;
  kind: 'statue' | 'forge' | 'well' | 'stall' | 'bench' | 'pier' | 'boathouse' | 'rock' | 'mill' | 'wheel'
    | 'weir' | 'bridge' | 'sign';
  name: string;
  /** Blueprint placement origin, world metres; local +Z is forward. Structural yaw = turn * PI/2. */
  position: Vec3; turn: CardinalTurn; footprint: readonly XZ[];
}
export interface LandPlaces {
  court: { boundary: readonly XZ[]; elevation: number; keepDoor: Vec3; gate: Vec3;
    parapet: readonly (readonly [XZ, XZ])[] };
  lookout: { summit: Vec3; viewBearing: number; trail: readonly Vec3[] };
  forest: { oak: Vec3; entryBearing: number; path: readonly Vec3[];
    clearing: { centre: Vec3; radius: number; gapBearing: number }; treeline: readonly XZ[] };
}
export type TreeZoneKind = 'ridge' | 'forest-wall' | 'clearing-ring' | 'stream-alders' | 'lake-alders' | 'grove';
export interface TreeZone { id: string; kind: TreeZoneKind; outline: readonly XZ[] }
export interface LandmarkTree { id: 'elder-oak' | 'summit-pine'; position: Vec3; yaw: number }
export interface LandDressing {
  form: 'bench' | 'direction-sign' | 'footbridge'
    | 'fence-straight' | 'fence-corner' | 'fence-end' | 'wall-straight' | 'wall-corner' | 'wall-end';
  style: 'hearth' | 'tide'; position: Vec3; turn: CardinalTurn; siteId?: string;
}
export interface LandPath {
  id: string; from: string; to: string; edgeIds: readonly string[];
  surface: 'paving' | 'packed-earth' | 'trodden-grass' | 'stone' | 'planks'; length: number;
  beats: readonly { at: number; siteId?: string; dressingIndex?: number; reveal?: string }[];
}
export type LandViewId = 'town-dusk' | 'street' | 'plaza-statue' | 'forge' | 'crown-road-bend' | 'court-wall-walk'
  | 'bridge' | 'lake-reveal' | 'pier-end' | 'lookout' | 'forest-approach' | 'clearing-gap';
export interface LandView { id: LandViewId; eye: Vec3; target: Vec3; fov: number }
export interface KingdomLand {
  version: 1; plan: SettlementPlan & { landform: KingdomLandform };
  sites: readonly LandSite[]; places: LandPlaces;
  /** Derived alias of plan.landform.waters; never a second source of geography. */
  waters: readonly WaterBody[];
  treeZones: readonly TreeZone[]; landmarks: readonly LandmarkTree[];
  dressings: readonly LandDressing[]; paths: readonly LandPath[]; views: readonly LandView[];
}
