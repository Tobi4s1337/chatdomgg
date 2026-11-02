import { grandSketchRecipe, type GrandSketchRecipe } from '../../../../packages/world/src/grand/sketch';
import { HoldingError, readDoorHolding, type DoorHolding } from '../../../web/src/atlas/data/holding';
import { grandSeedForHolding } from '../../../web/src/grand/holding-world';
import type { TrustedWorld } from './sketches';

/** How long the realm keeps what the Atlas said about one channel. Surveys change by the hour, not the minute. */
export const ATLAS_WORLD_TTL_MS = 10 * 60_000;
/** At most this many channels' answers are kept. */
export const ATLAS_WORLD_CACHE = 512;

/**
 * The world a channel's own survey facts give, read by the realm itself (GW13). It walks the Atlas the same way the
 * public page does (`readDoorHolding`, the served preview and names projection, no storage) and makes the same
 * recipe (`grandSeedForHolding`), so an honest page and the realm agree byte for byte. A withheld or missing holding
 * has no world (null); an Atlas that cannot be read just now gives no answer (undefined) and nothing is pinned.
 *
 * `base` is where the Atlas data service answers `/v1/preview…`, for example `http://127.0.0.1:5193/map-data`.
 */
export function atlasTrustedWorld(options: {
  readonly base: string;
  readonly fetch?: typeof globalThis.fetch;
  readonly now?: () => number;
  /** For tests: the holding reader. */
  readonly read?: (id: string) => Promise<DoorHolding>;
}): TrustedWorld {
  const fetcher = options.fetch ?? globalThis.fetch, now = options.now ?? Date.now;
  const source = { base: options.base.replace(/\/+$/, ''), fetch: fetcher };
  const read = options.read ?? ((id: string) => readDoorHolding(source, null, id, AbortSignal.timeout(60_000)));
  const kept = new Map<string, { readonly at: number; readonly recipe: GrandSketchRecipe | null }>();
  return async kingdomId => {
    const hit = kept.get(kingdomId);
    if (hit && now() - hit.at < ATLAS_WORLD_TTL_MS) return hit.recipe;
    let recipe: GrandSketchRecipe | null;
    try {
      const holding = await read(kingdomId);
      recipe = holding.id === kingdomId ? grandSketchRecipe(grandSeedForHolding(holding)) : null;
    } catch (error) {
      if (error instanceof HoldingError && error.reason !== 'unavailable') recipe = null;
      else return undefined;
    }
    kept.delete(kingdomId);
    kept.set(kingdomId, { at: now(), recipe });
    while (kept.size > ATLAS_WORLD_CACHE) kept.delete(kept.keys().next().value!);
    return recipe;
  };
}
