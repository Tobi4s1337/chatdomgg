/// <reference lib="webworker" />
import type { VoxelBlueprint } from '@chatdom/shared';
import { identify } from './identity';
import { dressKingdom } from './dress';
import type { KingdomPlacement } from './mount';
import { loadGrandKingdomContent, type GrandKingdomContent } from './pieces';

/**
 * Composes a kingdom's exact content and its dressing (town walls, banners) off the main thread. The compositions
 * (a native town's founding, a Genesis city's homes and groves, the wall circuit) take seconds; the page keeps
 * drawing the land meanwhile. The result is plain data.
 */
export type ContentRequest = { readonly login: string };
export type ContentReply =
  | { readonly ok: true; readonly content: GrandKingdomContent; readonly dressing: KingdomPlacement[]; readonly dressingError: string | null }
  | { readonly ok: false; readonly message: string };

const message = (error: unknown) => error instanceof Error ? error.message : String(error);
const scope = self as unknown as DedicatedWorkerGlobalScope;
scope.onmessage = (event: MessageEvent<ContentRequest>) => {
  loadGrandKingdomContent(event.data.login).then(async loaded => {
    // The town stands without its walls rather than not at all; the reason travels with it.
    let walls: Omit<KingdomPlacement, 'assetHash'>[] = [], dressingError: string | null = null;
    try { walls = dressKingdom(loaded).placements; } catch (error) { dressingError = message(error); }
    const memo = new Map<VoxelBlueprint, Promise<string>>();
    const content: GrandKingdomContent = { ...loaded, pieces: await identify(loaded.pieces, memo) };
    const dressing = await identify(walls, memo);
    scope.postMessage({ ok: true, content, dressing, dressingError } satisfies ContentReply);
  }).catch((error: unknown) => scope.postMessage({ ok: false, message: message(error) } satisfies ContentReply));
};
