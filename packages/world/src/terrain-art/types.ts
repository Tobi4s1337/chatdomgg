import type { BoundsXZ, PublicGroundSample, SettlementPlan } from '../settlement/types';

/**
 * Picture-land candidate producer (spec 46). Local types only: nothing here is a shared schema, a placement
 * ledger or a revision. A candidate becomes authority only when main adopts it for rendering, horizon,
 * light-field occupancy and collision/contact together.
 */

/** Producer identity. A future change to the land's numbers must change this string. */
export const TERRAIN_ART_PRODUCER = 'picture-land:1' as const;

/** One classification per metre patch, derived from the candidate's own corners and the plan's ground. */
export type TerrainArtMaterial = 'grass' | 'heath' | 'trail' | 'paving' | 'scree' | 'rock' | 'ledge' | 'waterbed';
export const TERRAIN_ART_MATERIALS: readonly TerrainArtMaterial[] = Object.freeze(['grass', 'heath', 'trail', 'paving', 'scree', 'rock', 'ledge', 'waterbed']);

/** What keeps a corner on the authoritative ground. */
export type TerrainArtGuard = 'public-ground' | 'street' | 'square' | 'home' | 'reservation' | 'castle' | 'water' | 'none';

/** The town's back: the side its ridges stand behind (north is −z). */
export type TerrainArtBackdrop = 'north' | 'east' | 'south' | 'west';

export interface TerrainArtInputs {
  /** The accepted plan, read only. Its landform and optional Genesis surface decide the water guards. */
  readonly plan: SettlementPlan;
  /** Explicit sampling bounds. Queries outside them are refused. */
  readonly bounds: BoundsXZ;
  /** The caller's authoritative ground. Read only at integer-metre corners. */
  readonly ground: (x: number, z: number) => number;
  /** The caller's public-ground query (streets, trails, squares, forecourts). */
  readonly publicGround: (x: number, z: number) => PublicGroundSample | undefined;
}

export interface TerrainArtProtection {
  /** Metres from the nearest guarded footprint (negative inside it). */
  readonly distance: number;
  /** The guard nearest to the point, or 'none' when every guard is beyond the producer's reach. */
  readonly guard: TerrainArtGuard;
}

export interface TerrainArtCandidate {
  readonly producer: typeof TERRAIN_ART_PRODUCER;
  /** The plan revision this candidate was produced for. The candidate is never that revision's authority. */
  readonly planRevision: string;
  /** Names the candidate: plan revision plus producer. Main pins this when it adopts a validated revision. */
  readonly candidateRevision: string;
  readonly bounds: Readonly<BoundsXZ>;
  readonly backdrop: TerrainArtBackdrop;
  /** Height on the 1 m corner triangles, split on the accepted 00→11 diagonal. */
  height(x: number, z: number): number;
  /** Float32 corner height. A drawn vertex, a contact sample and a material all read these exact values. */
  corner(ix: number, iz: number): number;
  /** Stable material of the metre patch containing (x, z), derived from the same corners as `height`. */
  material(x: number, z: number): TerrainArtMaterial;
  /** The preservation rule, exposed so tests and main can check it. */
  protection(x: number, z: number): TerrainArtProtection;
}
