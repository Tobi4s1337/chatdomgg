import type { Vec3, VoxelBlueprint } from '@chatdom/shared';
import type { BoundsXZ, CardinalTurn } from '../settlement/types';
import type { PierAnchor, PierSiteContext, PierSiteFailure, PierSiteWork } from './pier-sites-types';

export interface AuthoredPierPiece {
  readonly id: string; readonly blueprint: VoxelBlueprint; readonly position: Vec3; readonly rotation: CardinalTurn;
}
export interface AuthoredPierProposal {
  readonly version: 1;
  readonly anchor: Omit<PierAnchor, 'depth'>;
  /** Actual authored deck datum, distinct from the bank's root height. */
  readonly deckY: number;
  readonly walkLength: number;
  readonly head: { readonly pieceId: string; readonly width: number; readonly depth: number };
  readonly pieces: readonly AuthoredPierPiece[];
  readonly entry: Vec3;
  /** World feet positions from entry through the gateway to the head. No teleport or jump. */
  readonly route: readonly Vec3[];
  readonly fishing: readonly {
    readonly id: string; readonly position: Vec3;
    /** Starts at route's final point and ends at this fishing position. Traversed both ways. */
    readonly route: readonly Vec3[];
    readonly castArea: BoundsXZ;
  }[];
}
export interface AuthoredPierCertificate {
  readonly version: 1;
  readonly anchor: PierAnchor;
  readonly proposal: AuthoredPierProposal;
  /** Canonical proposal plus material solidity identity; not a scene receipt, public digest or collision revision. */
  readonly geometryKey: string;
  readonly layoutRevision: string;
  readonly collisionRevision: number;
}
export type AuthoredPierFailure = PierSiteFailure | 'invalid-proposal' | 'invalid-blueprint' | 'head-mismatch'
  | 'route-invalid' | 'route-blocked' | 'route-unsupported' | 'cast-too-far' | 'water-mismatch' | 'compile-failed';
export interface AuthoredPierWork extends PierSiteWork {
  proposalBytes: number; blueprintCells: number; writeCells: number; compiledBoxes: number;
  movementTicks: number; overlayBoxChecks: number;
}
export interface AuthoredPierDetail {
  readonly stage: 'header' | 'exclusion' | 'root' | 'water' | 'compile' | 'walk' | 'pin';
  readonly pieceId?: string; readonly routeId?: string; readonly at?: Vec3;
  readonly message?: string;
}
export type AuthoredPierResult = { readonly ok: true; readonly certificate: AuthoredPierCertificate; readonly work: Readonly<AuthoredPierWork> }
  | { readonly ok: false; readonly reason: AuthoredPierFailure; readonly detail: AuthoredPierDetail; readonly work: Readonly<AuthoredPierWork> };
export type AuthoredPierContext = PierSiteContext;
export const AUTHORED_PIER_BUDGET = Object.freeze({ pieces: 16, blueprintWrites: 32_768, blueprintCells: 8_388_608,
  writeCells: 67_108_864, compiledBoxes: 16_384, proposalBytes: 2_097_152, routes: 16, routePoints: 256,
  routeMetres: 512, movementTicks: 12_000, collisionQueries: 240_000, queryBoxes: 4_096,
  collisionBoxes: 4_000_000, overlayBoxChecks: 16_000_000, overlayBinEntries: 131_072, overlayQueryBins: 4_096,
  groundSamples: 65_536, waterSamples: 65_536,
  coverageQueries: 256, castReach: 12, castArea: 64 });
