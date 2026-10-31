// Stateless hashing: every pose is a pure function of seed, source, slot, cycle and the caller's clock, so frame
// rate, seeking and update order cannot change what is drawn.

export function mix32(value: number): number {
  let h = value | 0;
  h ^= h >>> 16; h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15; h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return h >>> 0;
}

export function hashString(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return mix32(h);
}

/** Any number, including fractions and non-finite values, maps to a stable 32-bit seed. */
export function seedHash(seed: number): number {
  return hashString(Number.isFinite(seed) ? String(seed) : 'non-finite');
}

/** A stable key for one emitter slot. */
export function slotKey(seed: number, kind: number, source: number, slot: number): number {
  return mix32(seed ^ mix32(kind ^ mix32(source ^ mix32(slot + 0x9e3779b9))));
}

/** The n-th independent unit value in [0, 1) for a key and (optionally) a cycle. */
export function unit(key: number, n: number, cycle = 0): number {
  return mix32(key ^ mix32(Math.imul(n + 1, 0x27d4eb2d) ^ mix32(cycle | 0))) / 4294967296;
}

/** Floor-modulo that stays positive for negative clocks. */
export function wrap(value: number, period: number): number {
  return value - Math.floor(value / period) * period;
}
