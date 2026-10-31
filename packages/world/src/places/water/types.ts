import type { Vec3 } from '@chatdom/shared';
import type { LandSite, WaterBody } from '../../kingdom-land/types';
import type { CardinalTurn, LandformPlan, StreetNode, XZ } from '../../settlement/types';
import type { CardinalFrame } from './frame';
import type { WaterReach } from './reaches';

/**
 * Structural mirror of the content constants and frame functions the planner reads (content's WHEEL_PIT +
 * wheelPitFrame, WEIR + weirFrame, BRIDGE + humpbackDeckTop, MILL, WHEEL, FINGERPOST, fishingRockTop). The host
 * passes the real ones; the frame functions throw `RangeError` for parameters their pieces cannot be built at,
 * and the planner reports those as needs instead of clamping them. All sizes are build cells.
 */
export interface WaterPieceSpecs {
  readonly mill: { readonly size: Vec3; readonly shaft: Vec3 };
  readonly wheel: { readonly size: Vec3; readonly radius: number };
  readonly wheelPit: {
    readonly width: number; readonly length: number; readonly troughWalls: number;
    readonly run: readonly [number, number]; readonly foot: readonly [number, number];
    readonly frame: (run: number) => {
      readonly size: Vec3; readonly pitStart: number; readonly wheelOffset: Vec3; readonly hub: Vec3; readonly troughFloor: number;
      readonly lip: Vec3; readonly leatEnd: Vec3; readonly trestles: readonly number[];
    };
  };
  readonly weir: {
    readonly cap: readonly [number, number];
    readonly frame: (width: number, drop: number) => {
      readonly size: Vec3; readonly channel: readonly [number, number]; readonly crestTop: number;
      readonly upstream: number; readonly downstream: number;
    };
  };
  readonly bridge: {
    readonly size: Vec3; readonly centre: number; readonly radius: number; readonly walk: readonly [number, number];
    readonly deckTop: (x: number, water: number, bank: number) => number;
  };
  /** Validates a water depth for the fishing rock (any variant) and returns its walking top. */
  readonly rock: { readonly top: (variant: number, water: number) => number };
  readonly fingerpost: { readonly plan: number };
}

export type FingerpostTarget = 'castle' | 'market' | 'lake' | 'road';

export interface WaterPlaceInput {
  /** The approved landform. Version 1 (the legacy ellipse) has no courses or sites and yields only needs. */
  readonly landform: LandformPlan;
  readonly sites: readonly LandSite[];
  /** Public path nodes the decks must meet (routes' `land:pier:*` and `land:bridge:*`). Absent: joins unchecked. */
  readonly nodes?: readonly Pick<StreetNode, 'id' | 'position'>[];
  /** Destination anchors that actually exist. A fingerpost arm is made only for these. */
  readonly destinations?: Partial<Readonly<Record<FingerpostTarget, XZ>>>;
  readonly specs: WaterPieceSpecs;
}

export type WaterNeedCode = 'land-version' | 'site-missing' | 'site-duplicate' | 'site-datum' | 'site-turn' | 'water-missing'
  | 'reach-missing' | 'reach-join' | 'footprint' | 'pier' | 'boathouse' | 'rock' | 'weir' | 'head' | 'trough' | 'trestle'
  | 'mill-shaft' | 'bridge' | 'sign' | 'path-join';

/** A defect in the supplied geography or binding, with who must act. Never silently repaired. */
export interface WaterNeed {
  readonly code: WaterNeedCode;
  readonly owner: 'land' | 'integrator' | 'content';
  readonly subject: string;
  readonly message: string;
}

/** A static piece's frame in the world: the blueprint corner, its cardinal turn, its size and plan outline. */
export interface WaterPlacement extends CardinalFrame {
  readonly siteId: string;
  /** Blueprint size in cells, as the factory will build it. */
  readonly size: Vec3;
  readonly outline: readonly XZ[];
}

/** Ground or bed (world y) sampled on a local grid over a site, for piles, trestles and plinths. */
export interface FoundationGrid {
  readonly frame: CardinalFrame;
  /** Local metres of the first sample. */
  readonly min: XZ;
  readonly step: number;
  readonly columns: number;
  readonly rows: number;
  /** Row-major (local z rows, local x columns), world metres. */
  readonly heights: readonly number[];
}

export interface SiteRef { readonly id: string; readonly turn: CardinalTurn; readonly footprint: readonly XZ[] }

export interface PierPlan {
  readonly site: SiteRef;
  readonly frame: CardinalFrame;
  /** Deck walking height, world metres, and its height over the water. */
  readonly deck: number;
  readonly deckAboveWater: number;
  /** Local metres: walk strip x span and length to the head; the head's x span and z span. */
  readonly walk: { readonly x: readonly [number, number]; readonly length: number };
  readonly head: { readonly x: readonly [number, number]; readonly z: readonly [number, number] };
  /** Local z where the walk's centreline first stands over water: piles beyond, bank bearing before. */
  readonly shore: number;
  /** Water depth under the head's centre. */
  readonly headDepth: number;
  /** Ground under the walk's root (local z 0) and its step to the deck. */
  readonly rootGround: number;
  readonly foundation: FoundationGrid;
}

export interface BoathousePlan {
  readonly site: SiteRef; readonly frame: CardinalFrame;
  /** Local z where the building's centreline first stands over water, and the depth at its open (+Z) end. */
  readonly shore: number; readonly bayDepth: number;
  readonly foundation: FoundationGrid;
}

export interface RockPlan {
  readonly site: SiteRef; readonly frame: CardinalFrame;
  /** Whole cells of water over the rock's base, and that base (world y): never above the bed it stands on. */
  readonly water: number; readonly base: number;
  /** The site's local extent, for centring a rock variant of the caller's choice. */
  readonly local: { readonly x: readonly [number, number]; readonly z: readonly [number, number] };
}

export interface LakePlace {
  readonly water: WaterBody | null;
  readonly pier: PierPlan | null;
  readonly boathouse: BoathousePlan | null;
  readonly rock: RockPlan | null;
}

export interface WeirPlan {
  readonly site: SiteRef; readonly placement: WaterPlacement;
  readonly factory: { readonly width: number; readonly drop: number };
  /** The foam lip: the crest's water line from bank to bank, world metres. */
  readonly crest: readonly [Vec3, Vec3];
  readonly pondLevel: number; readonly tailLevel: number;
}

export interface WheelPlan {
  readonly site: SiteRef;
  readonly pit: WaterPlacement;
  readonly wheel: WaterPlacement;
  readonly factory: { readonly run: number; readonly feet: readonly number[] };
  /** The axle: world pivot and unit axis. Positive spin about it carries the top downstream (overshot). */
  readonly hub: Vec3; readonly axis: Vec3;
  /** Unit world direction of the descending (wet, shedding) side from the hub. */
  readonly descending: Vec3;
  readonly floor: number; readonly troughFloor: number;
  /** Leat surface over the pit floor; trough water depth at the leat end; lip clearance over the wheel's top. */
  readonly head: number; readonly troughDepth: number; readonly lipOverWheel: number;
  /** Where the water leaves the lip, world metres. */
  readonly lip: Vec3;
  readonly leatEnd: Vec3;
}

export interface MillPlan { readonly site: SiteRef; readonly placement: WaterPlacement; readonly shaft: Vec3 }

export interface BridgePlan {
  readonly site: SiteRef; readonly placement: WaterPlacement;
  /** Cells above the bed: the pool's water and the bank tops at both ends. */
  readonly factory: { readonly water: number; readonly bank: number };
  readonly pool: { readonly reach: string; readonly level: number; readonly bed: number; readonly width: number;
    readonly speed: number; readonly openSpeed: number };
  /** Deck walk ends at the bank tops, west (local x 0) then east, world metres. */
  readonly ends: readonly [Vec3, Vec3];
  readonly landings: readonly [number, number];
}

export interface FingerpostArmPlan {
  readonly destination: FingerpostTarget;
  readonly target: XZ;
  /** Bearing from the post axis, atan2(dx, dz); and the arm's yaw about +Y (arms point along local +X). */
  readonly bearing: number;
  readonly yaw: number;
}
export interface SignPlan { readonly site: SiteRef; readonly placement: WaterPlacement; readonly axis: Vec3; readonly arms: readonly FingerpostArmPlan[] }

export interface MillPlace {
  readonly pond: WaterBody | null;
  readonly weir: WeirPlan | null;
  readonly wheel: WheelPlan | null;
  readonly mill: MillPlan | null;
  readonly bridge: BridgePlan | null;
  readonly sign: SignPlan | null;
}

export interface WaterPlacePlan {
  /** Changes whenever any input that shapes the plan changes. */
  readonly revision: string;
  readonly reaches: readonly WaterReach[];
  readonly lake: LakePlace;
  readonly mill: MillPlace;
  /** Empty only when every supplied input agrees; a production mount refuses a plan with needs. */
  readonly needs: readonly WaterNeed[];
}
