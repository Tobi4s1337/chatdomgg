import type { ChannelKingdomRecipe, DeepReadonly, GenesisLandscape } from '@chatdom/world/genesis';
import { proposeGenesisKeepers, type KeeperProposal } from '../../../../../../packages/content/src/genesis-keepers/adapter';
import { keeperRole } from '../../../../../../packages/content/src/genesis-keepers/roles/index';
import { planKeeperRound, type KeeperFixture, type KeeperPlaceSite, type KeeperRound } from '../../../../../../packages/content/src/genesis-keepers/routine';

/** A keeper the recipe chose, with the place the town actually built for them and their round at a given hour. */
export interface PlacedKeeper {
  readonly proposal: KeeperProposal;
  readonly site: KeeperPlaceSite;
  readonly round: KeeperRound;
}

/** A place as the town built it: where it is and the fixtures it offers, all from pieces the seat placed. */
export interface BuiltPlace {
  readonly centre: readonly [number, number];
  readonly fixtures: readonly KeeperFixture[];
}

/**
 * Give each of the recipe's keepers the place the town built under the same place ID. The recipe's keeper record is
 * carried unchanged (role, authored name, place, no presence light); the site holds only fixtures from placed
 * content, and the radius is the role's own. A keeper whose place the town has not built is left out rather than
 * standing on an anchor that proves nothing.
 */
export function placeKeepers(recipe: DeepReadonly<ChannelKingdomRecipe>, landscape: DeepReadonly<GenesisLandscape>,
  built: Readonly<Record<string, BuiltPlace>>, hour: number): readonly PlacedKeeper[] {
  const placed: PlacedKeeper[] = [];
  for (const proposal of proposeGenesisKeepers(recipe, landscape)) {
    const place = built[proposal.place.id];
    if (!place) continue;
    const site: KeeperPlaceSite = { placeId: proposal.place.id, centre: place.centre, radius: proposal.routine.radius, fixtures: place.fixtures, provenance: 'host' };
    const round = planKeeperRound(keeperRole(proposal.keeper.role), site, hour, proposal.speaker.seedKey);
    placed.push({ proposal, site, round });
  }
  return placed;
}
