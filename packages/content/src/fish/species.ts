import { FISHING_HOURS, FISHING_MOODS, type FishSpecies } from '@chatdom/shared';

const fresh = ['lake', 'river'] as const;
const everyWater = ['lake', 'river', 'sea'] as const;
const species = (entry: FishSpecies): FishSpecies => {
  for (const array of [entry.waters, entry.biomes, entry.hours, entry.moods, entry.lengthMm, entry.weightG]) Object.freeze(array);
  return Object.freeze(entry);
};

/** Authored selection weights, not mass. Conditions also describe the unknown Almanac page. */
export const FISH_SPECIES: readonly FishSpecies[] = Object.freeze([
  species({ id: 'fish:copper-perch', name: 'Copper Perch', rarity: 'common', weight: 90,
    lore: 'Its copper bars catch the last light long after the reeds have gone dark.',
    riddle: 'A little copper fence moves beneath the reeds.', waters: fresh, biomes: ['*'], hours: FISHING_HOURS, moods: FISHING_MOODS,
    minDepthM: 1, lengthMm: [180, 410], weightG: [90, 1200], fight: 'steady' }),
  species({ id: 'fish:bell-minnow', name: 'Bell Minnow', rarity: 'common', weight: 100,
    lore: 'They gather beneath the pier bell, as though waiting for it to ring.',
    riddle: 'Where a bell has no voice underwater, a small throat shines.', waters: everyWater, biomes: ['*'], hours: FISHING_HOURS, moods: FISHING_MOODS,
    minDepthM: 1, lengthMm: [80, 180], weightG: [8, 75], fight: 'dart' }),
  species({ id: 'fish:reed-roach', name: 'Reed Roach', rarity: 'common', weight: 75,
    lore: 'A red-finned visitor that follows the long shadows of the reeds.',
    riddle: 'Silver slips between the reeds on little red oars.', waters: fresh, biomes: ['*'], hours: ['dawn', 'day', 'dusk'], moods: FISHING_MOODS,
    minDepthM: 1, lengthMm: [150, 320], weightG: [45, 500], fight: 'dart' }),
  species({ id: 'fish:silver-dace', name: 'Silver Dace', rarity: 'common', weight: 70,
    lore: 'A silver stitch in moving water; the shoal turns as one.',
    riddle: 'A seam of silver stitches the current.', waters: everyWater, biomes: ['*'], hours: FISHING_HOURS, moods: FISHING_MOODS,
    minDepthM: 1, lengthMm: [120, 300], weightG: [25, 350], fight: 'dart' }),
  species({ id: 'fish:lantern-eel', name: 'Lantern Eel', rarity: 'uncommon', weight: 22,
    lore: 'Gold marks along its sides borrow the lanterns, one soft glimmer at a time.',
    riddle: 'After dark, the lanterns seem to have a winding reflection.', waters: fresh, biomes: ['*'], hours: ['night'], moods: FISHING_MOODS,
    minDepthM: 2, lengthMm: [400, 1100], weightG: [200, 2400], fight: 'surge' }),
  species({ id: 'fish:moonlit-pike', name: 'Moonlit Pike', rarity: 'rare', weight: 3,
    lore: 'The old fishers lower their voices when its pale jaw breaks the water.',
    riddle: 'A long pale jaw waits where the evening light sinks deepest.', waters: ['lake'], biomes: ['*'], hours: ['dusk', 'night'], moods: ['clear', 'mist'],
    minDepthM: 3, lengthMm: [650, 1400], weightG: [1900, 14500], fight: 'surge' }),
  species({ id: 'fish:mossback-carp', name: 'Mossback Carp', rarity: 'uncommon', weight: 28,
    lore: 'So unhurried that the pond seems to have grown over its shoulders.',
    riddle: 'A green hill moves slowly under the lily leaves.', waters: ['lake'], biomes: ['meadow', 'woodland'], hours: ['day', 'dusk'], moods: ['clear', 'breeze', 'rain'],
    minDepthM: 2, lengthMm: [350, 900], weightG: [650, 9000], fight: 'steady' }),
  species({ id: 'fish:whisker-catfish', name: 'Whisker Catfish', rarity: 'uncommon', weight: 24,
    lore: 'It tastes the rain before the first ring reaches the bank.',
    riddle: 'The bottom has whiskers when rain comes.', waters: fresh, biomes: ['*'], hours: ['dusk', 'night'], moods: ['rain', 'mist'],
    minDepthM: 2, lengthMm: [300, 1000], weightG: [350, 8000], fight: 'surge' }),
  species({ id: 'fish:mistfin-trout', name: 'Mistfin Trout', rarity: 'uncommon', weight: 30,
    lore: 'Its rose cheek is the first colour to return when the morning mist lifts.',
    riddle: 'Before the sun clears the mist, a rose blooms below.', waters: fresh, biomes: ['*'], hours: ['dawn'], moods: ['mist'],
    minDepthM: 1, lengthMm: [220, 650], weightG: [120, 3200], fight: 'dart' }),
  species({ id: 'fish:sun-bream', name: 'Sun Bream', rarity: 'common', weight: 65,
    lore: 'A little round sun that keeps its warmth below the surface.',
    riddle: 'The water keeps a small round sun of its own.', waters: everyWater, biomes: ['*'], hours: ['dawn', 'day', 'dusk'], moods: ['clear', 'breeze'],
    minDepthM: 1, lengthMm: [170, 430], weightG: [80, 1400], fight: 'steady' }),
  species({ id: 'fish:pebble-flounder', name: 'Pebble Flounder', rarity: 'common', weight: 75,
    lore: 'A pebble that grew fins, and is quietly considering another shore.',
    riddle: 'One pebble on the seabed has looked up twice.', waters: ['sea'], biomes: ['*'], hours: FISHING_HOURS, moods: FISHING_MOODS,
    minDepthM: 1, lengthMm: [160, 450], weightG: [70, 1600], fight: 'steady' }),
  species({ id: 'fish:redfin-char', name: 'Redfin Char', rarity: 'rare', weight: 5,
    lore: 'The cold water keeps its back dark and its fins the colour of embers.',
    riddle: 'In the cold deep, a coal has learned to swim.', waters: fresh, biomes: ['highland'], hours: ['dawn', 'dusk'], moods: ['breeze', 'rain'],
    minDepthM: 4, lengthMm: [320, 800], weightG: [350, 5800], fight: 'surge' }),
]);
