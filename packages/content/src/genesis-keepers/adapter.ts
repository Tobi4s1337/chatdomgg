import type { ChannelKingdomRecipe, DeepReadonly, GenesisLandscape } from '../../../world/src/genesis/contracts';
import { draw } from '../../../world/src/genesis/landscape';
import { AVATAR_PALETTE } from '../materials';
import { createKeeperLook } from './look';
import { KEEPER_RETREAT, type KeeperRetreatPolicy } from './presence';
import { keeperRole } from './roles/index';
import type { KeeperSpeaker } from './greetings';
import { KEEPER_TEMPERAMENTS, type KeeperFixtureKind, type KeeperKitId, type KeeperLook, type KeeperRole, type KeeperTemperament } from './types';

type RecipeKeeper = DeepReadonly<ChannelKingdomRecipe>['soul']['keepers'][number];
type Place = DeepReadonly<GenesisLandscape>['places'][number];

/**
 * A keeper the recipe chose, made ready to stand in its place. The recipe's own record is carried unchanged; everything
 * added is a deterministic content proposal: who they look like, what they do, when they give way and what they may say.
 * Nothing here places, moves, voices or counts anyone.
 */
export interface KeeperProposal {
  /** `<landscape id>/keeper/<index>-<role>`: stable for the same recipe and landscape. */
  readonly id: string;
  readonly landscapeId: string;
  /** The recipe's keeper exactly as given: role, authored name, place and `carriesPresenceLight: false`. */
  readonly keeper: RecipeKeeper;
  /** The selected landscape's place this keeper belongs to. */
  readonly place: { readonly id: string; readonly name: string; readonly purpose: Place['purpose']; readonly anchor: readonly [number, number] };
  readonly temperament: KeeperTemperament;
  readonly look: KeeperLook;
  readonly routine: {
    /** Fixture kinds the host must supply at the place for the keeper's work. */
    readonly needs: readonly KeeperFixtureKind[];
    readonly acts: readonly string[];
    /** Metres from the place's anchor the keeper keeps to. */
    readonly radius: number;
  };
  readonly retreat: KeeperRetreatPolicy;
  readonly speaker: KeeperSpeaker;
  /** Never a person: no presence light, never counted, never in Twitch chat, never a citizen card or name plate. */
  readonly presence: { readonly carriesPresenceLight: false; readonly counted: false; readonly twitchChat: 'never'; readonly citizen: false };
  readonly provenance: { readonly evidence: 'observed' | 'simulated'; readonly label: 'SIMULATED' | null };
  /** What main must do or prove before this keeper stands anywhere. */
  readonly checks: readonly string[];
}

const RADIUS: Readonly<Record<KeeperRole, number>> = { innkeeper: 9, lamplighter: 24, ferryman: 14 };
/** The place purposes each role belongs to. Any other attachment is carried as given and flagged for main. */
const HOMES: Readonly<Record<KeeperRole, readonly Place['purpose'][]>> = {
  innkeeper: ['tavern'], lamplighter: ['plaza', 'gate', 'old-row', 'castle'], ferryman: ['plaza', 'tavern', 'gate'],
};
const HUMAN_SKINS = AVATAR_PALETTE.skin.slice(0, 8);

export function proposeGenesisKeepers(recipe: DeepReadonly<ChannelKingdomRecipe>, landscape: DeepReadonly<GenesisLandscape>): readonly KeeperProposal[] {
  if (recipe.version !== 'channel-genesis-1') throw new Error(`Unsupported recipe version ${String(recipe.version)}.`);
  const own = recipe.landscapes.find(candidate => candidate.id === landscape.id);
  if (!own) throw new Error(`Landscape ${landscape.id} is not one of this recipe's candidates.`);
  if (own !== landscape && JSON.stringify(own) !== JSON.stringify(landscape)) throw new Error(`Landscape ${landscape.id} differs from the recipe's candidate.`);
  const kit = recipe.identity.styleFamily as KeeperKitId;
  const names = recipe.soul.keepers.map(keeper => keeper.name);
  return recipe.soul.keepers.map((keeper, index) => {
    if (keeper.carriesPresenceLight !== false) throw new Error(`Keeper ${keeper.name} would carry a presence light.`);
    const def = keeperRole(keeper.role);
    const place = landscape.places.find(candidate => candidate.id === keeper.placeId);
    if (!place) throw new Error(`Keeper ${keeper.name} keeps ${keeper.placeId}, which landscape ${landscape.id} does not have.`);
    const slot = `keeper/${index}/${keeper.role}`;
    const pick = <T>(values: readonly T[], what: string): T => values[Math.floor(draw(recipe.seedKey, `${slot}/${what}`) * values.length)]!;
    const temperament = pick(KEEPER_TEMPERAMENTS, 'temperament');
    const look = createKeeperLook({
      role: keeper.role, temperament, kit, body: def.bodies[temperament],
      skin: pick(HUMAN_SKINS, 'skin'), hair: { form: pick(def.hairForms, 'hair-form'), swatch: pick(AVATAR_PALETTE.hair, 'hair') },
    });
    const radius = RADIUS[keeper.role];
    const checks = [
      `Supply a KeeperPlaceSite for ${place.id} from the content actually placed there (${def.needs.join(', ')}), within ${radius} m of its anchor; a missing fixture means that act is not performed.`,
      'Walk the keeper between visits with the realm\'s own navigation; never slide, teleport or pop a keeper in view.',
      `Feed keeperPresenceIntent with the realm's real counts at ${place.id} and in town; keepers are excluded from every count, presence light and headcount.`,
      'Draw keepers with no presence light, name plate, citizen card or selectable citizen identity; they never post in Twitch chat.',
      'Speak greetings only through the realm\'s voice, quoting a person\'s name only after it passed the name check.',
    ];
    if (!HOMES[keeper.role].includes(place.purpose)) checks.push(`A ${keeper.role} keeping a ${place.purpose} is unusual; confirm the recipe meant it.`);
    if (names.filter(name => name === keeper.name).length > 1) checks.push(`Two keepers in this kingdom share the name ${keeper.name}; the recipe should draw keeper names without repeats.`);
    return {
      id: `${landscape.id}/keeper/${index}-${keeper.role}`,
      landscapeId: landscape.id,
      keeper,
      place: { id: place.id, name: place.name, purpose: place.purpose, anchor: place.anchor },
      temperament,
      look,
      routine: { needs: def.needs, acts: def.acts.map(act => act.id), radius },
      retreat: KEEPER_RETREAT[keeper.role],
      speaker: { role: keeper.role, temperament, name: keeper.name, placeName: place.name, seedKey: `${recipe.seedKey}/${slot}` },
      presence: { carriesPresenceLight: false, counted: false, twitchChat: 'never', citizen: false },
      provenance: recipe.evidence.kind === 'simulated' ? { evidence: 'simulated', label: 'SIMULATED' } : { evidence: 'observed', label: null },
      checks,
    };
  });
}
