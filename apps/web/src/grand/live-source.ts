import { KingdomIdSchema, type KingdomId } from '@chatdom/shared';
import { grandRecipeFor } from '../kingdom/grand-land/recipes';
import type { GrandLandRecipe } from '../../../../packages/world/src/grand/recipe';

export interface GrandLiveSelection { readonly kingdomId: KingdomId; readonly recipe: GrandLandRecipe; readonly hour: number }
/** Names resolve only to an adopted identity. Unknown names never fall back to somebody else's kingdom. */
export function grandLiveSelection(params: URLSearchParams): GrandLiveSelection | null {
  const resolve = (value: string) => value.trim().toLowerCase() === 'tobi4s_' ? '129634568' : value.trim();
  const channel = params.get('channel'), kingdom = params.get('kingdom');
  if (channel !== null && kingdom !== null && resolve(channel) !== resolve(kingdom)) return null;
  const parsed = KingdomIdSchema.safeParse(resolve(kingdom ?? channel ?? '129634568'));
  if (!parsed.success) return null;
  const recipe = grandRecipeFor(parsed.data);
  if (!recipe) return null;
  const input = params.get('hour'), value = input === null || !input.trim() ? NaN : Number(input);
  return { kingdomId: parsed.data, recipe, hour: Number.isFinite(value) && value >= 0 && value <= 24 ? value : 17.5 };
}
