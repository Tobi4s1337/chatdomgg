/* global Worker:readonly */
import type { VoxelBlueprint } from '@chatdom/shared';
import type { SettlementPlan } from '@chatdom/world';
import type { GroundDressingPlan, GroundPiece } from '../../ground-dressing/plan';
import { TOWN_FORMS, townBlueprint } from './forms';
import { planTownGround, primeTownFloor, type TownGroundInput, type TownGroundPlan } from './plan';
import type { TownGroundReply, TownGroundRequest } from './worker';

/**
 * Plans the town's land use in its own worker and gives back the same plan `planTownGround` would, with every piece
 * on the town's shared blueprint objects (the dressing mount batches by them). The worker receives only what the
 * planner reads: the settlement plan, each placement's blueprint outline (`id`, `size`, `boxes`) and the existing
 * dressing's footprints, and the founded floor when the scene has it. Where no worker can run (tests, a plan that
 * cannot be cloned), it plans inline.
 */
export function planTownGroundAway(plan: SettlementPlan, input: TownGroundInput, signal?: AbortSignal, floor?: Float32Array | null): Promise<TownGroundPlan> {
  if (signal?.aborted) return Promise.reject(new DOMException('The town ground was cancelled', 'AbortError'));
  const inline = () => { primeTownFloor(plan, floor); return planTownGround(plan, input); };
  if (typeof Worker === 'undefined') return Promise.resolve().then(inline);
  const outlines = new Map<VoxelBlueprint, VoxelBlueprint>();
  const outline = (blueprint: VoxelBlueprint): VoxelBlueprint => {
    let known = outlines.get(blueprint);
    if (!known) { known = { id: blueprint.id, size: blueprint.size, boxes: blueprint.boxes } as VoxelBlueprint; outlines.set(blueprint, known); }
    return known;
  };
  const request: TownGroundRequest = {
    plan,
    occupied: input.occupied.map(piece => ({ blueprint: outline(piece.blueprint), position: piece.position, yaw: piece.yaw })),
    // The existing dressing only as footprints: the planner keeps every piece of it clear and reads nothing else.
    // The installed floor the scene's ground workers already sampled: the planner reads it instead of sampling it again.
    ...(floor ? { floor } : {}),
    ...(input.existing ? { existing: { blockers: [], collisionPieces: [], seatAnchors: [], report: input.existing.report,
      pieces: new Map([...input.existing.pieces].map(([id, list]) => [id, list.map(piece =>
        ({ id: piece.id, blueprint: { size: piece.blueprint.size } as VoxelBlueprint, position: piece.position, yaw: piece.yaw }))])) } satisfies GroundDressingPlan } : {}),
  };
  return new Promise<TownGroundPlan>((resolve, reject) => {
    let worker: Worker;
    try { worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'town-ground' }); }
    catch { resolve(inline()); return; }
    const done = () => { signal?.removeEventListener('abort', abort); worker.onmessage = null; worker.onerror = null; worker.terminate(); };
    const abort = () => { done(); reject(new DOMException('The town ground was cancelled', 'AbortError')); };
    signal?.addEventListener('abort', abort, { once: true });
    worker.onerror = event => { event.preventDefault(); done(); reject(new Error(event.message || 'The town ground worker failed')); };
    worker.onmessage = (event: MessageEvent<TownGroundReply>) => {
      done();
      const reply = event.data;
      if (!reply.ok) { reject(new Error(reply.message)); return; }
      const blueprints = new Map(TOWN_FORMS.map(form => { const blueprint = townBlueprint(form); return [blueprint.id, blueprint] as const; }));
      const pieces = new Map<string, readonly GroundPiece[]>();
      for (const [id, list] of reply.pieces) {
        const blueprint = blueprints.get(id);
        if (!blueprint) { reject(new Error(`The town ground planted an unknown form ${id}`)); return; }
        pieces.set(id, list.map(piece => ({ ...piece, blueprint })));
      }
      resolve({ mask: reply.mask, report: reply.report, pieces });
    };
    try { worker.postMessage(request); }
    catch { done(); signal?.removeEventListener('abort', abort); resolve(inline()); }
  });
}
