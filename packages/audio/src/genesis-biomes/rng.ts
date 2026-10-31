/**
 * Seeded, stateless randomness for the landscape sound. Every decision (when a gull calls, which wave is the big
 * one, where a raven sits on the ridge) is a pure function of the kingdom's seed key, a layer name and an integer
 * slot, so the same realm moment sounds the same for every viewer and nothing depends on frame timing.
 */

/** FNV-1a over UTF-16 code units, finished with the murmur3 avalanche. */
export function hashString(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return fmix(h);
}

function fmix(value: number): number {
  let h = value >>> 0;
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Mixes integers into a seed. Accepts any finite numbers; non-integers and negatives are folded deterministically. */
export function mix(seed: number, ...values: readonly number[]): number {
  let h = seed >>> 0;
  for (const value of values) {
    const whole = Math.floor(value);
    const low = whole >>> 0, high = Math.floor(whole / 4294967296) >>> 0;
    h = fmix((h ^ low) + 0x9e3779b9 + (h << 6) + (h >>> 2));
    h = fmix((h ^ high) + 0x7f4a7c15 + (h << 6) + (h >>> 2));
  }
  return h;
}

/** A uniform number in [0, 1) for (seed, ...values). */
export function unit(seed: number, ...values: readonly number[]): number {
  return mix(seed, ...values) / 4294967296;
}

/** A small, fast generator (sfc32) for authoring one sound or one texture from a single seed. */
export function generator(seed: number): () => number {
  let a = mix(seed, 1), b = mix(seed, 2), c = mix(seed, 3), d = 1;
  return () => {
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
}

/** Smooth value noise in [0, 1]: seeded lattice values every `period` units, joined with a quintic ease. */
export function valueNoise(seed: number, x: number, period: number): number {
  const position = x / period, k = Math.floor(position), f = position - k;
  const ease = f * f * f * (f * (f * 6 - 15) + 10);
  const a = unit(seed, k), b = unit(seed, k + 1);
  return a + (b - a) * ease;
}

/**
 * Never the same take twice in a row: a deterministic candidate for this event, moved off the previous take when
 * it collides. Every other take stays reachable.
 */
export function freshTake(seed: number, index: number, count: number, previous: number | undefined): number {
  if (count <= 1) return 0;
  const candidate = Math.floor(unit(seed, index, 17) * count) % count;
  if (previous === undefined || candidate !== previous) return candidate;
  return (previous + 1 + (Math.floor(unit(seed, index, 29) * (count - 1)) % (count - 1))) % count;
}

/** Linear interpolation between a and b by a random draw: `range(r(), 3, 5)`. */
export function range(value: number, low: number, high: number): number {
  return low + (high - low) * value;
}

/** Log-uniform interpolation, for frequencies and durations that feel even across octaves. */
export function logRange(value: number, low: number, high: number): number {
  return low * (high / low) ** value;
}
