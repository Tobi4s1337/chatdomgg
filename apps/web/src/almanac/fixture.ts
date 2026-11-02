import type { KingdomId, PierAlmanac, PierAlmanacEntry, PierAlmanacFact, PierAlmanacMark } from '@chatdom/shared';

/* Willowmere, a meadow kingdom on a still lake, two weeks into its pier: the bench's book and the checks' full copy. */

/** 2 November 2026, 19:40 in the realm's day. */
export const WILLOWMERE_AS_OF = Date.UTC(2026, 10, 2, 19, 40);
const at = (month: number, day: number, hour: number, minute = 0) => Date.UTC(2026, month - 1, day, hour, minute);

type Who = string | null;
const fact = (name: Who, when: number, via: 'pier' | 'chat' = 'pier'): PierAlmanacFact => ({ name, at: when, via });
function caught(speciesId: string, count: number, first: PierAlmanacFact, biggest: [Who, number, number, number, ('pier' | 'chat')?], mounts = 0): PierAlmanacEntry {
  const [name, when, weightG, lengthMm, via] = biggest;
  return { speciesId, status: 'caught', count, first, biggest: { ...fact(name, when, via ?? 'pier'), weightG, lengthMm }, mounts };
}
const unknown = (speciesId: string, status: 'waiting' | 'elsewhere'): PierAlmanacEntry =>
  ({ speciesId, status, count: 0, first: null, biggest: null, mounts: 0 });

const ENTRIES: readonly PierAlmanacEntry[] = [
  caught('fish:copper-perch', 58, fact('Juniper', at(10, 19, 19, 12)), ['Tobias', at(10, 27, 20, 4), 1130, 398]),
  caught('fish:bell-minnow', 71, fact('saoirse_k', at(10, 19, 19, 31), 'chat'), ['Hamish', at(10, 30, 9, 50), 74, 176, 'chat']),
  caught('fish:reed-roach', 36, fact('Tobias', at(10, 20, 7, 2)), ['Juniper', at(11, 1, 16, 22), 482, 309]),
  caught('fish:silver-dace', 29, fact(null, at(10, 20, 13, 40), 'chat'), ['saoirse_k', at(10, 24, 12, 8), 331, 286]),
  caught('fish:lantern-eel', 9, fact('Juniper', at(10, 21, 23, 17)), ['mossy_otter', at(10, 29, 1, 44), 2210, 1040], 1),
  caught('fish:moonlit-pike', 2, fact('saoirse_k', at(10, 23, 19, 48)), ['saoirse_k', at(10, 23, 19, 48), 9620, 1188], 2),
  caught('fish:mossback-carp', 12, fact('Hamish', at(10, 22, 15, 5)), ['Tobias', at(11, 2, 17, 26), 7340, 812]),
  caught('fish:whisker-catfish', 7, fact('mossy_otter', at(10, 25, 22, 30), 'chat'), ['Juniper', at(10, 31, 20, 2), 5180, 862]),
  caught('fish:mistfin-trout', 4, fact('Juniper', at(10, 26, 6, 21)), ['Juniper', at(10, 26, 6, 21), 1470, 488], 1),
  caught('fish:sun-bream', 41, fact('Tobias', at(10, 19, 20, 3)), ['saoirse_k', at(10, 28, 10, 15), 1290, 410]),
  caught('fish:glimmer-rudd', 33, fact('saoirse_k', at(10, 20, 18, 9)), ['Hamish', at(10, 30, 19, 55), 820, 361]),
  caught('fish:thimble-gudgeon', 64, fact('Hamish', at(10, 19, 19, 20), 'chat'), [null, at(10, 26, 13, 4), 68, 165, 'chat']),
  caught('fish:willow-tench', 11, fact('Tobias', at(10, 22, 20, 44)), ['Tobias', at(10, 30, 23, 30), 3960, 604]),
  caught('fish:starlit-bleak', 6, fact('mossy_otter', at(10, 24, 0, 18), 'chat'), ['Juniper', at(11, 1, 23, 51), 58, 194]),
  caught('fish:ember-sunfish', 8, fact('Juniper', at(10, 27, 11, 33)), ['Hamish', at(10, 31, 14, 2), 512, 238]),
  caught('fish:hollow-burbot', 3, fact('Tobias', at(10, 28, 2, 10)), ['Tobias', at(10, 28, 2, 10), 3120, 744], 1),
  caught('fish:stormcrown-sturgeon', 1, fact('Juniper', at(11, 1, 23, 8)), ['Juniper', at(11, 1, 23, 8), 41_600, 2030], 1),
  unknown('fish:pearl-grayling', 'waiting'),
  unknown('fish:goldscale-emperor', 'waiting'),
  unknown('fish:redfin-char', 'elsewhere'),
  unknown('fish:saltmarsh-mullet', 'elsewhere'),
  unknown('fish:pebble-flounder', 'elsewhere'),
  unknown('fish:harbour-mackerel', 'elsewhere'),
  unknown('fish:driftglass-herring', 'elsewhere'),
  unknown('fish:inkfin-wrasse', 'elsewhere'),
  unknown('fish:tidepool-sculpin', 'elsewhere'),
  unknown('fish:moonwake-ray', 'elsewhere'),
  unknown('fish:frostking-char', 'elsewhere'),
];

export const WILLOWMERE_ALMANAC: PierAlmanac = {
  version: 1, kingdomId: '48151623' as KingdomId, kingdom: 'Willowmere', asOf: WILLOWMERE_AS_OF, water: 'lake',
  entries: ENTRIES,
  caught: ENTRIES.filter(entry => entry.status === 'caught').length,
  catches: ENTRIES.reduce((sum, entry) => sum + entry.count, 0),
};

/** saoirse_k's own marks: nine species, the pike and the rudd first in Willowmere. */
export const SAOIRSE_MARKS: readonly PierAlmanacMark[] = [
  { speciesId: 'fish:copper-perch', count: 11, firstAt: at(10, 19, 20, 2), bestWeightG: 860, bestLengthMm: 352, kingdomFirst: false },
  { speciesId: 'fish:bell-minnow', count: 17, firstAt: at(10, 19, 19, 31), bestWeightG: 61, bestLengthMm: 158, kingdomFirst: true },
  { speciesId: 'fish:silver-dace', count: 6, firstAt: at(10, 21, 8, 40), bestWeightG: 331, bestLengthMm: 286, kingdomFirst: false },
  { speciesId: 'fish:moonlit-pike', count: 2, firstAt: at(10, 23, 19, 48), bestWeightG: 9620, bestLengthMm: 1188, kingdomFirst: true },
  { speciesId: 'fish:sun-bream', count: 9, firstAt: at(10, 20, 10, 5), bestWeightG: 1290, bestLengthMm: 410, kingdomFirst: false },
  { speciesId: 'fish:glimmer-rudd', count: 7, firstAt: at(10, 20, 18, 9), bestWeightG: 640, bestLengthMm: 322, kingdomFirst: true },
  { speciesId: 'fish:thimble-gudgeon', count: 14, firstAt: at(10, 20, 11, 15), bestWeightG: 52, bestLengthMm: 141, kingdomFirst: false },
  { speciesId: 'fish:willow-tench', count: 1, firstAt: at(10, 31, 21, 12), bestWeightG: 2240, bestLengthMm: 512, kingdomFirst: false },
  { speciesId: 'fish:starlit-bleak', count: 3, firstAt: at(10, 26, 0, 40), bestWeightG: 44, bestLengthMm: 171, kingdomFirst: false },
];
