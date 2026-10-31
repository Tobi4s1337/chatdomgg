import { KingdomIdSchema } from '@chatdom/shared';
import { MATERIALS } from '../materials';
import { compileEmote, type CompiledEmote, type EmoteCompileFailureCode, type EmotePurpose } from './deps';
import type { ApprovedEmoteDerivative } from './derivatives';

export type CarveResult =
  | { readonly ok: true; readonly emote: CompiledEmote; readonly size: readonly [number, number, number] }
  | { readonly ok: false; readonly code: EmoteCompileFailureCode };

/**
 * One approved derivative through the existing emote compiler: alpha crop, area-weighted resampling, nearest
 * snapping to a closed palette of registered materials, speckle cleaning, extrusion with a one-cell bevel from
 * three cells deep, greedy boxes, every frame on one shared grid and its own timing. Nothing is re-implemented
 * here; the craft is choosing the profile and the palette for the use.
 */
export function carve(derivative: ApprovedEmoteDerivative, purpose: EmotePurpose, palette: readonly number[], heightCells: number, depthCells: number): CarveResult {
  const result = compileEmote({
    source: {
      id: derivative.emoteId, provider: 'twitch', providerId: derivative.emoteId,
      kingdomId: KingdomIdSchema.parse(derivative.broadcasterId), name: derivative.emoteId,
      origin: derivative.origin, sourceHash: derivative.asset.assetHash, rendition: derivative.rendition,
    },
    decoded: derivative.raster,
  }, MATERIALS, palette, { purpose, targetHeightCells: heightCells, depthCells, paletteRevision: MATERIALS.revision });
  if (!result.ok) return { ok: false, code: result.code };
  return { ok: true, emote: result.emote, size: result.stats.size };
}
