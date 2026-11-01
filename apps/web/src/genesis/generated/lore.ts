import type { ChannelKingdomRecipe, DeepReadonly, GenesisLandscape } from '@chatdom/world/genesis';
import { unit } from '../holding-facts';

/**
 * A potential kingdom's line: authored sentences chosen by its land, its landmark and its size, seeded by the
 * channel. They describe the place, never the community: no claim about who the chat is, what it likes or what it
 * has done. Channel text never reaches them, so nothing here needs a judge.
 */
const LAND: Readonly<Record<GenesisLandscape['character'], readonly string[]>> = {
  'coastal-harbour': [
    'Salt on the shutters and a lamp in every harbour window.',
    'The tide keeps the hours here, and the gulls keep the gossip.',
    'Boats come home by the light on the point, and nobody locks a door.',
    'A harbour of tarred ropes and warm kitchens, facing the open sea.',
    'The quay is never quite empty; someone is always watching the water.',
  ],
  'river-valley': [
    'The river takes its time through the meadows, and so does everyone else.',
    'Willows lean over the water and the lanes follow the river’s bends.',
    'A valley town of bridges, orchards and doors left open in summer.',
    'Mist on the water at dawn, lanterns on the bridge by dusk.',
    'The mill-race hums all night beneath the sleeping lanes.',
  ],
  'mountain-pass': [
    'High on the pass, the keep watches the road and the road watches the sky.',
    'Stone houses climb the slope, each roof a step nearer the snow.',
    'The wind comes over the saddle with news from the far side.',
    'A hill town where every lane is a stair and every stair a view.',
    'Fires burn late up here, and the stars come down to meet them.',
  ],
};

const LANDMARK: Readonly<Record<ChannelKingdomRecipe['identity']['landmark'], readonly string[]>> = {
  'open-air-stage': ['On the green the stage is never dark for long.', 'Someone is always tuning a lute on the green.'],
  'stone-circle': ['Old stones stand in a ring beyond the last house, older than any name.', 'Beyond the lanes, a ring of standing stones keeps its own counsel.'],
  'bell-garden': ['In the bell garden, one note at dusk calls everyone home.', 'A bell hangs in the garden for the evenings worth remembering.'],
  'watermill': ['The sails turn, the bread rises, the kettle sings.', 'Flour on the doorsteps and a mill on the rise that never rests.'],
  'lighthouse': ['Its lamp has never once been allowed to go out.', 'The light on the point turns for anyone still out on the water.'],
  'watchtower': ['From the tower you can see every road that leads home.', 'A watch fire burns on the tower for travellers still on the road.'],
};

const SIZE: Readonly<Record<ChannelKingdomRecipe['size']['tier'], string>> = {
  hamlet: 'Sixteen hearths, and room by every one of them.',
  village: 'Small enough to know every door, big enough for one more.',
  town: 'Wards and greens and a market that never quite closes.',
  city: 'A city of many wards, each with its own green and its own lamps.',
  capital: 'A capital of countless lights, and still a lamp in every window.',
};

const pick = <T,>(items: readonly T[], key: string): T => items[Math.floor(unit(key) * items.length)]!;

/** `landmarkStands` is false when the composition found no site for the realm's landmark: the line never names one that is not there. */
export function generatedLore(recipe: DeepReadonly<ChannelKingdomRecipe>, landscape: DeepReadonly<GenesisLandscape>, placed: { readonly landmarkStands?: boolean } = {}): string {
  const land = pick(LAND[landscape.character], `${recipe.seedKey}/lore/land`);
  const second = placed.landmarkStands !== false && unit(`${recipe.seedKey}/lore/second`) < .7
    ? pick(LANDMARK[recipe.identity.landmark], `${recipe.seedKey}/lore/landmark`)
    : SIZE[recipe.size.tier];
  return `${land} ${second}`;
}
