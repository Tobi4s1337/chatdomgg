/**
 * Integer hashing for seekable life: every choice the water's creatures make is a pure function of the caller's
 * seed, a fixed stream id and a whole-number slot, so any time can be evaluated without history.
 */

/** lowbias32 (Chris Wellons, public domain): a well-mixed 32-bit integer hash. */
function mix(x: number): number {
  x ^= x >>> 16; x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15; x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;
  return x >>> 0;
}

/** Hash of whole numbers (each truncated to 32 bits), order-sensitive. */
export function hash(...values: readonly number[]): number {
  let h = 0x9e3779b9;
  for (const value of values) h = mix((h ^ (value | 0)) + 0x632be5ab);
  return h;
}

/** A uniform number in [0, 1) from whole numbers. */
export const unit = (...values: readonly number[]): number => hash(...values) / 4294967296;

/** A uniform number in [a, b) from whole numbers. */
export const between = (a: number, b: number, ...values: readonly number[]): number => a + (b - a) * unit(...values);

/** Stream ids: each kind of choice draws from its own sequence so adding one never reshuffles another. */
export const STREAM = {
  duckLoop: 11, duckPair: 12, duckDabble: 13, duckCall: 14,
  fish: 21, fishSite: 22,
  heron: 31, heronCall: 32,
  kingfisher: 41,
  dragonfly: 51,
  firefly: 61, spray: 62, dust: 63, weir: 64,
  boat: 71, floater: 81,
} as const;

/** A caller seed as a whole number: integers pass through, anything else must be rejected by the caller. */
export function seedOf(seed: number): number {
  if (!Number.isSafeInteger(seed)) throw new RangeError('Water life needs a whole-number seed');
  return seed | 0;
}
