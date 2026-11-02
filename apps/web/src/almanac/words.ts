import { fishingHourBand, kingdomFishingHour, type FishSpecies, type FishingHour, type FishingMood, type PierAlmanacFact, type PierAlmanacMark } from '@chatdom/shared';

/* Every sentence the Almanac prints is written here, from the realm's facts and the authored species. Each helper
   answers an empty string when it has nothing true to say, so a page never prints "undefined", "NaN" or an id. */

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'] as const;
const SMALL = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'] as const;

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const whole = (value: unknown): number => finite(value) && value > 0 ? Math.floor(value) : 0;

export function capitalise(text: string): string {
  return text ? text[0]!.toUpperCase() + text.slice(1) : text;
}

/** "one" … "twelve", then numerals; a book spells its small numbers. */
export function numberWord(count: number): string {
  const n = whole(count);
  return n <= 12 ? SMALL[n]! : n.toLocaleString('en-GB');
}

/** "412 g", "2.4 kg", "14 kg". Empty when there is no real weight. */
export function formatWeight(grams: number): string {
  if (!finite(grams) || grams <= 0) return '';
  if (grams < 1000) return `${Math.max(1, Math.round(grams))} g`;
  const kg = grams / 1000;
  const shown = kg < 10 ? (Math.round(kg * 10) / 10).toFixed(1) : String(Math.round(kg));
  return `${shown.replace(/\.0$/, '')} kg`;
}

/** "34 cm", "1.4 m". Empty when there is no real length. */
export function formatLength(mm: number): string {
  if (!finite(mm) || mm <= 0) return '';
  if (mm < 1000) return `${Math.max(1, Math.round(mm / 10))} cm`;
  return `${(Math.round(mm / 100) / 10).toFixed(1).replace(/\.0$/, '')} m`;
}

/** "2 November", in the realm's day (UTC); the year is added when it is not the year the page was written. */
export function formatDay(at: number, asOf?: number): string {
  if (!finite(at) || at < 0) return '';
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return '';
  const day = `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`;
  if (finite(asOf) && asOf >= 0 && new Date(asOf).getUTCFullYear() !== date.getUTCFullYear()) return `${day} ${date.getUTCFullYear()}`;
  return day;
}

/** The time of day a catch was made, by the kingdom's clock: "at dawn", "in the morning", "at dusk", "at night". */
export function formatHour(at: number): string {
  if (!finite(at) || at < 0 || !Number.isSafeInteger(Math.floor(at))) return '';
  const hour = kingdomFishingHour(Math.floor(at));
  const band = fishingHourBand(hour);
  if (band === 'day') return hour < 12 ? 'in the morning' : 'in the afternoon';
  return band === 'dawn' ? 'at dawn' : band === 'dusk' ? 'at dusk' : 'at night';
}

/** An approved name, or "a fisher" when the name is kept hidden. */
export function fisherName(name: string | null | undefined): string {
  const clean = typeof name === 'string' ? name.replace(/\s+/g, ' ').trim() : '';
  return clean || 'a fisher';
}

/** "Willowmere", or a fallback phrase for a kingdom without an approved name. */
export function placeName(kingdom: string | null | undefined): string {
  const clean = typeof kingdom === 'string' ? kingdom.replace(/\s+/g, ' ').trim() : '';
  return clean;
}

/** "in Willowmere" / "here". */
function inPlace(kingdom: string): string { return kingdom ? `in ${kingdom}` : 'here'; }

/** "Willowmere’s" / "the kingdom’s". */
function placeOwn(kingdom: string): string { return kingdom ? `${kingdom}’s` : 'the kingdom’s'; }

/** "a" or "an" before a word. */

/** "a, b and c". */
export function listWords(items: readonly string[], join = 'and'): string {
  const parts = items.filter(Boolean);
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts.slice(0, -1).join(', ')} ${join} ${parts[parts.length - 1]}`;
}

/* ---------- Where and when it bites ---------- */

const ALL_WATERS = ['lake', 'river', 'sea'] as const;

function watersPhrase(waters: readonly string[]): string {
  const has = (water: string) => waters.includes(water);
  if (ALL_WATERS.every(has)) return 'in every water, fresh or salt';
  if (has('lake') && has('river')) return 'in lakes and rivers';
  if (has('lake') && has('sea')) return 'in still lakes and in the sea';
  if (has('river') && has('sea')) return 'in rivers and in the sea';
  if (has('lake')) return 'in still lakes';
  if (has('river')) return 'in running rivers';
  if (has('sea')) return 'in the sea';
  return '';
}

const BIOMES: Readonly<Record<string, string>> = {
  highland: 'the highlands', meadow: 'meadows', woodland: 'woods', coastal: 'the coast', forest: 'forests', marsh: 'marshes',
  snow: 'snowy country', autumn: 'autumn woods', desert: 'desert oases', mountain: 'the mountains', fog: 'foggy country',
};

function biomesPhrase(biomes: readonly string[]): string {
  if (!biomes.length || biomes.includes('*')) return '';
  const words = biomes.map(biome => BIOMES[biome] ?? '').filter(Boolean);
  if (!words.length) return '';
  if (biomes.length === 1 && biomes[0] === 'coastal') return 'along the coast';
  if (biomes.length === 1 && (biomes[0] === 'highland' || biomes[0] === 'mountain')) return `up in ${words[0]}`;
  return `among ${listWords(words)}`;
}

const HOUR_WORDS: Readonly<Record<FishingHour, string>> = { dawn: 'at dawn', day: 'by day', dusk: 'at dusk', night: 'by night' };

function hoursPhrase(hours: readonly FishingHour[]): string {
  const set = new Set(hours);
  if (set.size === 0) return '';
  if (set.size === 4) return 'at any hour';
  if (set.size === 3 && !set.has('night')) return 'from dawn until dusk';
  if (set.size === 3 && !set.has('day')) return 'from dusk through the night until dawn';
  if (set.size === 3 && !set.has('dawn')) return 'from morning far into the night';
  if (set.size === 3 && !set.has('dusk')) return 'at any hour but dusk';
  if (set.size === 2 && set.has('dawn') && set.has('dusk')) return 'at dawn and at dusk';
  const order: readonly FishingHour[] = ['dawn', 'day', 'dusk', 'night'];
  return listWords(order.filter(hour => set.has(hour)).map(hour => HOUR_WORDS[hour]));
}

const MOOD_WORDS: Readonly<Record<FishingMood, string>> = { clear: 'clear skies', breeze: 'a breeze', mist: 'mist', rain: 'rain' };
const MOOD_BUT: Readonly<Record<FishingMood, string>> = { clear: 'a clear sky', breeze: 'a breeze', mist: 'mist', rain: 'rain' };

function moodsPhrase(moods: readonly FishingMood[]): string {
  const set = new Set(moods);
  if (set.size === 0) return '';
  if (set.size === 4) return 'in any weather';
  const order: readonly FishingMood[] = ['clear', 'breeze', 'mist', 'rain'];
  if (set.size === 3) return `in any weather but ${MOOD_BUT[order.find(mood => !set.has(mood))!]}`;
  if (set.size === 1 && set.has('clear')) return 'under clear skies';
  if (set.size === 2 && set.has('clear') && set.has('breeze')) return 'in fair weather, still or breezy';
  if (set.size === 2 && set.has('clear')) return `under clear skies or in ${MOOD_WORDS[order.find(mood => mood !== 'clear' && set.has(mood))!]}`;
  return `in ${listWords(order.filter(mood => set.has(mood)).map(mood => MOOD_WORDS[mood]), 'or')}`;
}

/** "Bites in still lakes at dusk and by night, in mist or rain." Written from the authored conditions. */
export function whereWhen(species: Pick<FishSpecies, 'waters' | 'biomes' | 'hours' | 'moods' | 'minDepthM'>): string {
  const where = [watersPhrase(species.waters), biomesPhrase(species.biomes)].filter(Boolean).join(' ');
  const deep = finite(species.minDepthM) && species.minDepthM >= 3 ? 'where the water runs deep' : '';
  const when = hoursPhrase(species.hours);
  const weather = moodsPhrase(species.moods);
  const head = [where, deep].filter(Boolean).join(', ');
  // A clause that already holds a comma closes with one before the hours: "in every water, fresh or salt, from dawn".
  const first = [head, when].filter(Boolean).join(head.includes(',') ? ', ' : ' ');
  if (!first && !weather) return '';
  return `Bites ${[first, weather].filter(Boolean).join(', ')}.`;
}

/** "Grows to 41 cm and 1.2 kg." */
export function sizeLine(species: Pick<FishSpecies, 'lengthMm' | 'weightG'>): string {
  const length = formatLength(species.lengthMm?.[1] ?? NaN), weight = formatWeight(species.weightG?.[1] ?? NaN);
  if (!length && !weight) return '';
  return `Grows to ${listWords([length, weight])}.`;
}

/* ---------- The kingdom's record ---------- */

/** ", on a line cast from chat" when the catch came in through chat. */
function viaWords(fact: Pick<PierAlmanacFact, 'via'>): string {
  return fact.via === 'chat' ? ', on a line cast from chat' : '';
}

/** "First caught in Willowmere by Juniper at dusk on 2 November." */
export function firstLine(first: PierAlmanacFact | null | undefined, kingdom: string, asOf?: number): string {
  if (!first) return '';
  const hour = formatHour(first.at), day = formatDay(first.at, asOf);
  const when = [hour, day ? `on ${day}` : ''].filter(Boolean).join(' ');
  return `First caught ${inPlace(kingdom)} by ${fisherName(first.name)}${when ? ` ${when}` : ''}${viaWords(first)}.`;
}

export type BiggestFact = PierAlmanacFact & { readonly weightG: number; readonly lengthMm: number };

/** "The biggest weighed 3.9 kg and measured 91 cm, landed by saoirse_k on 14 October." */
export function biggestLine(biggest: BiggestFact | null | undefined, first: PierAlmanacFact | null | undefined, asOf?: number, count = 2): string {
  if (!biggest) return '';
  const weight = formatWeight(biggest.weightG), length = formatLength(biggest.lengthMm);
  if (!weight && !length) return '';
  const measures = [weight ? `weighed ${weight}` : '', length ? `measured ${length}` : ''].filter(Boolean).join(' and ');
  if (whole(count) === 1) return `It ${measures}.`;
  const same = first && first.at === biggest.at && fisherName(first.name) === fisherName(biggest.name);
  if (same) return `That first fish is still the biggest: it ${measures}.`;
  const day = formatDay(biggest.at, asOf);
  return `The biggest ${measures}, landed by ${fisherName(biggest.name)}${day ? ` on ${day}` : ''}.`;
}

/** "Caught fourteen times in Willowmere." */
export function countLine(count: number, kingdom: string): string {
  const n = whole(count);
  if (!n) return '';
  const times = n === 1 ? 'once' : n === 2 ? 'twice' : `${numberWord(n)} times`;
  return `Caught ${times} ${inPlace(kingdom)}.`;
}

/** "Three numbered mounts hang on Willowmere’s shelves." */
export function mountsLine(mounts: number, kingdom: string): string {
  const n = whole(mounts);
  if (!n) return '';
  return n === 1 ? `One numbered mount hangs on a shelf ${inPlace(kingdom)}.` : `${capitalise(numberWord(n))} numbered mounts hang on shelves ${inPlace(kingdom)}.`;
}

/** The gentle hint on a page the kingdom has not filled. */
export function unknownHint(status: 'waiting' | 'elsewhere', kingdom: string): string {
  if (status === 'waiting') return 'Lives in these waters. No one here has caught it yet.';
  return kingdom ? `Not in ${placeOwn(kingdom)} waters. Caught only somewhere else.` : 'Not in these waters. Caught only somewhere else.';
}

/** The contents' one-word state of a page: "caught 14 times", "lives here", "only elsewhere". */
export function statusWords(status: 'caught' | 'waiting' | 'elsewhere', count: number): string {
  if (status === 'waiting') return 'lives here, not yet caught';
  if (status === 'elsewhere') return 'only in other waters';
  const n = whole(count);
  return n <= 1 ? 'caught once' : n === 2 ? 'caught twice' : `caught ${n.toLocaleString('en-GB')} times`;
}

/** "17 of 28 known in Willowmere". */
export function summaryLine(known: number, total: number, kingdom: string): string {
  const k = whole(known), t = whole(total);
  if (!t) return '';
  return `${k} of ${t} known ${inPlace(kingdom)}`;
}

/** "312 fish landed at the pier." */
export function catchesLine(catches: number): string {
  const n = whole(catches);
  if (!n) return 'No fish landed yet. The first could be yours.';
  return n === 1 ? 'One fish landed at the pier so far.' : `${n.toLocaleString('en-GB')} fish landed at the pier so far.`;
}

/** "Willowmere’s pier stands over a still lake." */
export function waterLine(water: 'lake' | 'river' | 'sea' | null, kingdom: string): string {
  const pier = kingdom ? `${placeOwn(kingdom)} pier` : 'The pier';
  if (water === 'lake') return `${pier} stands over a still lake.`;
  if (water === 'river') return `${pier} stands over a running river.`;
  if (water === 'sea') return `${pier} runs out into the sea.`;
  return kingdom ? `${kingdom} has no pier yet.` : 'This kingdom has no pier yet.';
}

/** "Brought up to date on 2 November." */
export function asOfLine(asOf: number): string {
  const day = formatDay(asOf);
  return day ? `Brought up to date on ${day}.` : '';
}

/* ---------- The reader's own marks ---------- */

export interface MarkWords { readonly head: string; readonly lines: readonly string[] }

/** The reader's pencilled note on a page: how many, the best, the first day, and a kingdom first. */
export function markWords(mark: PierAlmanacMark | null | undefined, kingdom: string, asOf?: number): MarkWords | null {
  if (!mark || whole(mark.count) < 1) return null;
  const n = whole(mark.count);
  const head = n === 1 ? 'Yours: caught once' : n === 2 ? 'Yours: caught twice' : `Yours: caught ${numberWord(n)} times`;
  const lines: string[] = [];
  const best = [formatWeight(mark.bestWeightG), formatLength(mark.bestLengthMm)].filter(Boolean).join(', ');
  if (best) lines.push(n === 1 ? best : `best ${best}`);
  const day = formatDay(mark.firstAt, asOf);
  if (day && n > 1) lines.push(`first on ${day}`);
  else if (day) lines.push(`on ${day}`);
  if (mark.kingdomFirst) lines.push(kingdom ? `the first in ${kingdom}!` : 'the first here!');
  return { head, lines };
}

/** "You have caught 9 of them." */
export function marksSummary(marks: readonly PierAlmanacMark[] | null | undefined): string {
  if (!marks) return '';
  const caught = marks.filter(mark => whole(mark.count) > 0).length;
  if (!caught) return 'None of them by your hand yet.';
  return caught === 1 ? 'You have caught one of them.' : `You have caught ${numberWord(caught)} of them.`;
}

/** The book's title. */
export function bookTitle(kingdom: string): { readonly title: string; readonly sub: string } {
  return { title: 'The Almanac', sub: kingdom ? `of the waters of ${kingdom}` : 'of the kingdom’s waters' };
}

/** A legend's eyebrow, and a fish's grade in plain words. */
export function gradeWords(species: Pick<FishSpecies, 'rarity' | 'legend'>): string {
  if (species.legend) return 'One of the four legends';
  return species.rarity === 'rare' ? 'Rare' : species.rarity === 'uncommon' ? 'Uncommon' : 'Common';
}

