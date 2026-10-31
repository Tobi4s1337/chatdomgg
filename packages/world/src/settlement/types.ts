import type { HomeTier, Vec3 } from '@chatdom/shared';
import type { KingdomConfig } from '../layout';

export type CardinalTurn = 0 | 1 | 2 | 3;
export type XZ = readonly [number, number];
export interface BoundsXZ { minX: number; maxX: number; minZ: number; maxZ: number }
export interface StreetNode {
  id: string; position: Vec3;
  kind: 'junction' | 'market' | 'court' | 'frontage' | 'castle-gate' | 'frontier';
}
export interface StreetEdge {
  id: string; from: string; to: string; kind: 'main' | 'lane' | 'approach' | 'trail'; name: string;
  points: readonly Vec3[]; width: number; verge: number; quarterYear?: number;
}
export interface PublicSquare { id: string; boundary: readonly XZ[]; elevation: number; nodeId: string }
export interface PlotReservation {
  id: string; quarterYear: number; ordinal: number; street: string; streetId: string;
  courtId: string; approachId: string; position: Vec3; rotation: CardinalTurn;
  lot: BoundsXZ & { height: 20; depth: 16; frontage: 8 };
}
export interface SettlementHome extends PlotReservation {
  slot: number; tier: HomeTier; allowedDepth: number; style: 'hearth' | 'tide' | 'grove'; variant: number;
}
export interface SettlementQuarter {
  year: number; name: string; rootNodeId: string; courtIds: readonly string[]; growthNodeIds: readonly string[];
}
export interface CastleModulePlacement {
  id: string; kind: 'keep' | 'gatehouse' | 'curtain' | 'tower';
  position: Vec3; rotation: CardinalTurn; size: Vec3;
}
export interface CastlePlan {
  centre: Vec3; bounds: BoundsXZ; modules: readonly CastleModulePlacement[];
  court: PublicSquare; gateNodeId: string; beaconModuleId: string;
}
export interface LandformBase {
  seed: number;
  ridge: { origin: XZ; bearing: number; length: number; width: number; height: number };
  castleRise: { centre: XZ; radius: number; height: number };
  lake: { x: number; z: number; radiusX: number; radiusZ: number; level: number };
}
export interface LegacyLandformPlan extends LandformBase { version: 1 }
/** Version 2 is consumed only after kingdom-land supplies its sampler and grading dispatch. */
export type LandformPlan = LegacyLandformPlan | import('../kingdom-land/types').KingdomLandform;
export interface SettlementPlan {
  version: 2; revision: string; config: KingdomConfig; landform: LandformPlan;
  /** Read-only potential-land consumer, never an adopted scene or a grant of citizenship. */
  genesisSurface?: import('../genesis/contracts').DeepReadonly<import('../genesis/contracts').GenesisLandscape>;
  homes: readonly SettlementHome[]; reservations: readonly PlotReservation[];
  quarters: readonly SettlementQuarter[]; nodes: readonly StreetNode[]; streets: readonly StreetEdge[];
  activeStreetIds: readonly string[]; market: PublicSquare; courts: readonly PublicSquare[];
  castle: CastlePlan; bounds: BoundsXZ; lake: LandformPlan['lake'];
}
export interface PublicGroundSample {
  id: string; kind: 'main' | 'lane' | 'approach' | 'trail' | 'market' | 'court' | 'forecourt';
  height: number; pavingDistance: number; reservedDistance: number;
}
