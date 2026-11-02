import { canonicalSceneJson } from '../../../../../packages/world/src/founded-world/codec';
import { adoptedGrandRecipe } from '../../../../../packages/world/src/grand/adopted';
import { freezeGrandLandRecipe, type GrandLandRecipe } from '../../../../../packages/world/src/grand/recipe';
import { validateSketchRecipe } from '../../../../../packages/world/src/grand/sketch';
import { HOSTED_GRAND_COMPILER } from '../../../../../packages/world/src/grand/baked/types';
import { readBounded } from './baked-client-transport';

// The registry lives with the recipe so the realm's land module bakes from the same pinned bytes.
export { adoptedGrandRecipe as grandRecipeFor };

/** A pinned land recipe is a few hundred bytes; the realm stores at most this. */
export const SERVED_RECIPE_BYTES = 64 * 1024;
/** A realm that has not answered by now does not serve this kingdom's recipe: today's land stands. */
export const SERVED_RECIPE_TIMEOUT_MS = 4000;

/**
 * Accept a served recipe only as a kingdom founded on its own world (GW13): the exact `grand-land-2` shape this build
 * bakes and draws, a seed that is that channel's own world by its full identity, and canonical bytes. Anything else
 * is not a land this page may draw. The land the recipe names is still bound to the receipt by the recipe's hash.
 */
export function validateServedLandRecipe(text: string, kingdomId: string): GrandLandRecipe {
  const value = JSON.parse(text) as GrandLandRecipe;
  const recipe = freezeGrandLandRecipe(value);
  if (canonicalSceneJson(recipe) !== text) throw new Error('A served land recipe must use canonical JSON bytes');
  if (recipe.version !== 1 || recipe.generator !== 'grand-land-2' || recipe.kit !== 'grand-artisans-1' || recipe.grader !== 'gk11-grade-3'
    || recipe.mesher !== HOSTED_GRAND_COMPILER) throw new Error('The served land recipe names compilers this build does not draw');
  const { minSize, ...seed } = recipe.seed;
  if (seed.kingdomId !== kingdomId) throw new Error('The served land recipe belongs to another kingdom');
  if (minSize !== undefined && (!Number.isSafeInteger(minSize) || minSize < 256 || minSize > 4096)) throw new Error('Invalid served land size');
  // The world part is exactly a sketch's: the channel's own Genesis identity and curated traits.
  validateSketchRecipe({ version: 1, kind: 'sketch', generator: 'grand-land-2', kit: 'grand-artisans-1', mesher: HOSTED_GRAND_COMPILER, seed });
  const frame = recipe.frame as unknown as Record<string, unknown> | null;
  if (!frame || typeof frame !== 'object' || !frame.envelope || !frame.centre || typeof frame.waterLevel !== 'number')
    throw new Error('Invalid served land frame');
  return recipe;
}

/**
 * The recipe of a kingdom founded on its own world, as the realm pinned it at founding (`GET
 * /api/realm/land/<kingdom>/recipe`). Undefined when the realm keeps none, does not answer in time or answers with
 * anything this build would not draw: that kingdom keeps today's land, as every kingdom without a land does.
 */
export async function readServedLandRecipe(kingdomId: string, options: {
  readonly signal?: AbortSignal;
  readonly fetch?: typeof globalThis.fetch;
  readonly timeoutMs?: number;
} = {}): Promise<GrandLandRecipe | undefined> {
  if (!/^[1-9][0-9]{0,31}$/.test(kingdomId)) return undefined;
  options.signal?.throwIfAborted();
  const fetcher = options.fetch ?? globalThis.fetch, controller = new AbortController();
  const abort = () => controller.abort(options.signal?.reason);
  options.signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? SERVED_RECIPE_TIMEOUT_MS);
  try {
    const response = await fetcher(`/api/realm/land/${kingdomId}/recipe`, { signal: controller.signal, credentials: 'same-origin', headers: { accept: 'application/json' } });
    if (response.status !== 200 || (response.headers.get('content-type') ?? '').split(';')[0]!.trim() !== 'application/json') {
      void response.body?.cancel().catch(() => undefined);
      return undefined;
    }
    const bytes = await readBounded(response.body, SERVED_RECIPE_BYTES, controller.signal);
    return validateServedLandRecipe(new TextDecoder('utf-8', { fatal: true }).decode(bytes), kingdomId);
  } catch (error) {
    options.signal?.throwIfAborted();
    void error;
    return undefined;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', abort);
  }
}
