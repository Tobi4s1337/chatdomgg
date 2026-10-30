/**
 * Small seeded noise for draft cartography. Integer hashing only (Math.imul), so the same seed gives the same
 * coastline on every machine; there is no Math.random anywhere in the preview.
 */
export function hashString(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return mix(h);
}

export function mix(value: number): number {
  let h = value | 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Hash of an integer lattice point, uniform in [0, 1). */
export function hash2(seed: number, x: number, y: number): number {
  return mix(seed ^ Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1)) / 4294967296;
}

const smooth = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);

/** Gradient noise in roughly [-1, 1]. */
export function gradient2(seed: number, x: number, y: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const dot = (ix: number, iy: number, dx: number, dy: number) => {
    const angle = hash2(seed, ix, iy) * Math.PI * 2;
    return Math.cos(angle) * dx + Math.sin(angle) * dy;
  };
  const a = dot(x0, y0, fx, fy);
  const b = dot(x0 + 1, y0, fx - 1, fy);
  const c = dot(x0, y0 + 1, fx, fy - 1);
  const d = dot(x0 + 1, y0 + 1, fx - 1, fy - 1);
  const u = smooth(fx);
  const v = smooth(fy);
  return 1.41 * (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v);
}

/** Fractal sum of gradient noise; offsets keep the lattice away from the world origin, where noise is linear. */
export function fbm(seed: number, x: number, y: number, octaves: number): number {
  let sum = 0;
  let amplitude = 1;
  let norm = 0;
  let frequency = 1;
  for (let i = 0; i < octaves; i++) {
    sum += amplitude * gradient2(seed + i * 1013, x * frequency + 17.31 * (i + 1), y * frequency - 9.77 * (i + 1));
    norm += amplitude;
    amplitude *= 0.5;
    frequency *= 2.03;
  }
  return sum / norm;
}

/** Ridged noise in [0, 1]: high along thin crests, used for mountain chains. */
export function ridge(seed: number, x: number, y: number, octaves: number): number {
  let sum = 0;
  let amplitude = 1;
  let norm = 0;
  let frequency = 1;
  for (let i = 0; i < octaves; i++) {
    const n = 1 - Math.abs(gradient2(seed + i * 7919, x * frequency + 3.7 * (i + 1), y * frequency + 5.3 * (i + 1)));
    sum += amplitude * n * n;
    norm += amplitude;
    amplitude *= 0.5;
    frequency *= 2.1;
  }
  return sum / norm;
}
