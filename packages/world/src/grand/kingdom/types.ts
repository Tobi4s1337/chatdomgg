import type { Vec3 } from '@chatdom/shared';
import type { BoundsXZ, SettlementPlan } from '../../settlement/types';

/** The grand land's lattice: one terrain voxel is half a metre (spec 56). */
export const LAND_CELL = 0.5;

/**
 * The part of the grand land the kingdom reads and grades. Structurally the generated `GrandLand`
 * (`packages/world/src/grand/types.ts`): plain typed arrays, one entry per column, in voxels.
 */
export interface GrandField {
  /** Columns per side. Column (x, z) covers land metres [x, x+1)·0.5 × [z, z+1)·0.5. */
  readonly size: number;
  /** World height in voxels. */
  readonly height: number;
  readonly seaLevel: number;
  /** Top solid y + 1 per column (0 is no ground), so the top surface is at `ground · 0.5` land metres. */
  readonly ground: Uint16Array;
  /** Water surface y + 1 per column, 0 where dry. */
  readonly water: Uint16Array;
  readonly cover: Uint8Array;
  /** Signed distance to the coast in columns: positive inland, negative at sea. */
  readonly coast: Int8Array;
  /** Placed trees, `TREE_STRIDE` floats each: x, z, groundY, species, seed, scale. */
  readonly trees: Float32Array;
  treeCount: number;
}

/** The sites the land composed itself around, in columns. */
export interface GrandFieldSites {
  readonly castle: { readonly x: number; readonly z: number; readonly radius: number; readonly top: number };
  readonly town: { readonly x: number; readonly z: number; readonly rx: number; readonly rz: number; readonly angle: number; readonly level: number };
  readonly harbour: { readonly x: number; readonly z: number; readonly facing: number };
  readonly headland: { readonly x: number; readonly z: number; readonly y: number };
  readonly fields: { readonly x: number; readonly z: number; readonly radius: number };
}

/**
 * Mirrors `Cover` in `grand/types.ts`; the grade writes only these. `reserved` is the settlement's own ground (lawns
 * and verges, no wild flowers); `paved` is public paving (streets, squares, aprons), drawn as the kingdom's paving.
 * A land that does not know `paved` yet draws it as its default ground.
 */
export const KINGDOM_COVER = { sea: 0, sand: 1, shingle: 2, grass: 3, meadow: 4, rock: 7, riverbed: 10, lakebed: 11, reserved: 13, paved: 16 } as const;
export const TREE_STRIDE = 6;

/**
 * What an installed (or potential) settlement asks of the land. All in settlement metres.
 * The physical region is the founded terrain compiler's own footprint: plan bounds aligned to 16 m chunks.
 */
export interface SettlementFrame {
  readonly plan: SettlementPlan;
  /** Exact physical region, 16 m chunk aligned. Outside it nothing is known or walkable. */
  readonly region: BoundsXZ;
  /**
   * Everything the settlement can grow into: every plot (built or reserved), every street (active or reserved), the
   * castle and its water, aligned out to 16 m like the region. It contains the region and stays the same while
   * reserved plots are built, so the seat, and with it the land around the town, does not move as the town grows.
   */
  readonly envelope: BoundsXZ;
  /** The settlement's water level (v1 lake, Genesis coast) that the grand sea level takes. */
  readonly waterLevel: number;
  /** Where the settlement's own sea or open water lies, as a unit XZ direction, if it has one. */
  readonly seaward: readonly [number, number] | null;
  /** Centre of the town (every plot, built or reserved, and the market), not of the bounds. Unchanged by growth. */
  readonly centre: readonly [number, number];
  readonly castle: { readonly centre: Vec3; readonly bounds: BoundsXZ };
}

/** Where the settlement sits on the land: a pure translation, half-metre exact on every axis. */
export interface GrandSeat {
  /** Settlement metres + offset = land metres. Every component is a multiple of 0.5. */
  readonly offset: Vec3;
  /** The physical region in land columns, [x0, x1) × [z0, z1). */
  readonly columns: { readonly x0: number; readonly z0: number; readonly x1: number; readonly z1: number };
  /** Width of the blend band around the region, in columns. */
  readonly band: number;
}

/** Physical ground and water of the settlement, in settlement metres. */
export interface SettlementGround {
  /** Physical top at a half-metre cell centre, already on the half-metre lattice. */
  readonly top: (x: number, z: number) => number;
  /** Water surface over this cell, or null where dry. */
  readonly water: (x: number, z: number) => number | null;
  /** Paved public ground (streets, squares, aprons) here. */
  readonly paved: (x: number, z: number) => boolean;
}
