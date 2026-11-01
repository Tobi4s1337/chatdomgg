import type { GrandLandRecipe } from '../../../../../packages/world/src/grand/recipe';
import type { SettlementPlan } from '@chatdom/world';
import type { GrandLand } from '../../../../../packages/world/src/grand/types';
import type { SeatedKingdom } from '../../../../../packages/world/src/grand/kingdom';

export type HostedRequest =
  | { type: 'generate'; plan: SettlementPlan; recipe: GrandLandRecipe }
  | { type: 'adopt'; land: GrandLand; seated: SeatedKingdom }
  | { type: 'mesh'; id: number; level: number; rx: number; rz: number };
export type HostedMesh = { type: 'mesh'; id: number; level: number; rx: number; rz: number;
  quads: Uint32Array; offsets: Int32Array; minY: number; maxY: number };
export type HostedReply =
  | { type: 'land'; land: GrandLand; seated: SeatedKingdom }
  | { type: 'ready' }
  | HostedMesh
  | { type: 'error'; message: string };

/** Two concurrent workers reserve this much result memory each; the host never exceeds 16 MiB. */
export const HOSTED_RESULT_BYTES = 8 * 1024 * 1024;
