import { grandSeedFromGenesis, GRAND_LANDFORMS, type GrandLandform } from '../../../../packages/world/src/grand/world';
import type { GrandLandSeed } from '../../../../packages/world/src/grand/types';
import { readDoorHolding, type DoorHolding } from '../atlas/data/holding';
import { chooseLandscape, compileHoldingGenesis } from '../genesis/holding-facts';
import type { GrandChannel } from './channels';

/**
 * Any Atlas holding's own world (`grand-land-2`, GW13): the Genesis recipe its survey facts compile to, the landscape
 * its realm leans to, and the land, forest and crest that recipe chooses. The same holding always gets the same world,
 * so a visitor who searches for any streamer opens that streamer's kingdom, not a shared one.
 */
export function grandSeedForHolding(holding: DoorHolding): GrandLandSeed {
  const recipe = compileHoldingGenesis(holding);
  return grandSeedFromGenesis(recipe, holding.name, { character: chooseLandscape(recipe).character });
}

/** Read a holding from the survey this page draws and raise its world. */
export async function grandHoldingChannel(id: string, signal?: AbortSignal): Promise<GrandChannel> {
  const holding = await readDoorHolding({ base: '/map-data', fetch: (input, init) => fetch(input, init) }, null, id, signal);
  return { login: holding.id, name: holding.name, seed: grandSeedForHolding(holding), evidence: 'observed' };
}

/** A bench-only override that raises the same channel as another of the six large forms. */
export function withLandform(seed: GrandLandSeed, landform: string | null): GrandLandSeed {
  if (!seed.world || !landform || !(GRAND_LANDFORMS as readonly string[]).includes(landform)) return seed;
  return { ...seed, world: { ...seed.world, landform: landform as GrandLandform } };
}
