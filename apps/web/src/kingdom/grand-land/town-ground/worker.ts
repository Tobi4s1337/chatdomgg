/// <reference lib="webworker" />
import type { SettlementPlan } from '@chatdom/world';
import type { GroundPiece } from '../../ground-dressing/plan';
import { planTownGround, type TownGroundInput, type TownGroundMask, type TownGroundPlan } from './plan';

/**
 * The town's land use, planned off the main thread: on the real town it is seconds of pure work (the founded floor
 * grid, the keep-out raster, the parcels), which on the stream's main thread would freeze the picture.
 */
export interface TownGroundRequest {
  readonly plan: SettlementPlan;
  readonly occupied: TownGroundInput['occupied'];
  readonly existing?: TownGroundInput['existing'];
}
export type TownGroundReply =
  | { readonly ok: true; readonly mask: TownGroundMask; readonly report: TownGroundPlan['report'];
    /** Pieces by blueprint id, without their blueprints: the client puts back the town's shared blueprint objects. */
    readonly pieces: readonly (readonly [string, readonly Omit<GroundPiece, 'blueprint'>[]])[] }
  | { readonly ok: false; readonly message: string };

const scope = self as unknown as DedicatedWorkerGlobalScope;
scope.onmessage = (event: MessageEvent<TownGroundRequest>) => {
  try {
    const { plan, occupied, existing } = event.data;
    const planned = planTownGround(plan, { occupied, ...(existing ? { existing } : {}) });
    const pieces = [...planned.pieces].map(([id, list]) => [id, list.map(piece => ({ id: piece.id, position: piece.position, yaw: piece.yaw, ...(piece.slope ? { slope: piece.slope } : {}), ...(piece.lotSlot === undefined ? {} : { lotSlot: piece.lotSlot }) }))] as const);
    const reply: TownGroundReply = { ok: true, mask: planned.mask, report: planned.report, pieces };
    scope.postMessage(reply, [planned.mask.data.buffer, planned.mask.rows.buffer]);
  } catch (error) {
    scope.postMessage({ ok: false, message: error instanceof Error ? error.message : String(error) } satisfies TownGroundReply);
  }
};
