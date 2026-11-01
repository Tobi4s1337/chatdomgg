import type { Vec3, VoxelBlueprint } from '@chatdom/shared';
import type { BoundsXZ, CardinalTurn, XZ } from '../../../settlement/types';

export type WallStyle = 'hearth' | 'tide' | 'grove';

export interface TownWallOptions {
  /** Varies heights, roof pitches and battlement rhythm. The same plan and key always give the same walls. */
  readonly seedKey: string;
  readonly style: WallStyle;
  /** Physical ground in settlement metres (the founded surface, `terrainHeight(plan, x, z)`). */
  readonly ground: (x: number, z: number) => number;
  /** Water surface over a point, or null where dry. */
  readonly water: (x: number, z: number) => number | null;
  /** The exact physical region; nothing of the wall stands within 2 m of its edge. */
  readonly region: BoundsXZ;
}

/** How a stretch of the circuit is closed: a wall, the castle's own curtain, the shore, or left open. */
export type RingSpanKind = 'wall' | 'castle' | 'water' | 'open';

export interface TownWallSpan {
  readonly kind: RingSpanKind;
  /** Centre line in settlement metres; shares its first point with the previous span's last. */
  readonly points: readonly XZ[];
}

/** One stepped run of curtain wall: a level footing between two centre-line points. */
export interface TownWallSegment {
  /** Centre line ends at the footing (the masonry's lowest course, up to half a metre under the ground). */
  readonly from: Vec3;
  readonly to: Vec3;
  /** Footing to the top of the merlons. */
  readonly height: number;
}

export interface TownWallTower {
  readonly id: string;
  /** Centre of the drum at its footing. */
  readonly position: Vec3;
  readonly radius: number;
  /** Footing to the crown (top of the masonry and hoarding, where the roof springs). */
  readonly height: number;
  /** Absolute height of the roof's apex. */
  readonly apex: number;
  /** Owning gate, for a gatehouse's flanking towers. */
  readonly gateId?: string;
}

export interface TownGate {
  readonly id: string;
  /** The widest street through the gate; `growth:<nodeId>` for a gate kept for a future quarter's street. */
  readonly streetId: string;
  /** Every plan street that passes through this opening. */
  readonly streetIds: readonly string[];
  /** Growth junctions (quarter growth nodes, the frontier) whose future streets will leave by this gate. */
  readonly growthNodeIds: readonly string[];
  /** Middle of the opening on the street's surface. */
  readonly position: Vec3;
  /** Rotation about +Y (three.js convention: local +Z maps to (sin yaw, cos yaw)); local +Z points out of the town. */
  readonly yaw: number;
  /** Clear opening along the wall line, in metres. */
  readonly width: number;
  /** Clear headroom over the highest street surface in the passage. */
  readonly headroom: number;
  /** An arched gatehouse with a lintel, or (for a very wide or skewed crossing) flanking towers with no lintel. */
  readonly kind: 'arch' | 'open';
}

export interface TownWallPiece {
  readonly id: string;
  readonly kind: 'wall' | 'tower' | 'gatehouse';
  /** Build-lattice blueprint; boxes are in cells from its local origin. */
  readonly blueprint: VoxelBlueprint;
  /** Settlement metres of the blueprint's local origin (cell 0, 0, 0's corner). */
  readonly position: Vec3;
  /** Cardinal turn about the origin, exactly as `transformCardinalPoint`. */
  readonly rotation: CardinalTurn;
}

export interface TownBannerAnchor {
  readonly id: string;
  /** Top of the pole (towers) or the hanging point over the arch (gatehouses). */
  readonly position: Vec3;
  /** Yaw the cloth faces (same convention as gates): outward from the town. */
  readonly facing: number;
}

export interface TownWalls {
  /** The whole circuit, implicitly closed, interior on the left (positive shoelace area in x, z). */
  readonly ring: readonly XZ[];
  /** The circuit in order, by how each stretch is closed. */
  readonly spans: readonly TownWallSpan[];
  readonly segments: readonly TownWallSegment[];
  readonly towers: readonly TownWallTower[];
  readonly gates: readonly TownGate[];
  readonly pieces: readonly TownWallPiece[];
  readonly bannerAnchors: readonly TownBannerAnchor[];
  /** Reservations that cannot lie inside the walls (their margin would leave the region); their streets keep gates. */
  readonly beyond: readonly string[];
}
