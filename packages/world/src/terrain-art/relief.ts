/**
 * The land's shapes: layered cuesta ridges, flanking highland and ledges. Every function here is pure and
 * deterministic: integer hashing, no shared state, no randomness beyond the seed. Ridges are written in a
 * canonical frame. Its north (−z) is the town's back, x = 0 is the keep's line and z = CANONICAL_BACK
 * is the town's back edge. The producer maps each plan into this frame.
 */

/** The town's back edge in the canonical frame. The founded reference town's own back edge sits here. */
export const CANONICAL_BACK = -100;

export const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function hash2(ix: number, iz: number, seed: number): number {
  let h = Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iz, 0x165667b1) ^ seed;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smooth value noise in [-1, 1]. */
export function noise(x: number, z: number, seed: number): number {
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
  const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz, seed), b = hash2(ix + 1, iz, seed), c = hash2(ix, iz + 1, seed), d = hash2(ix + 1, iz + 1, seed);
  return (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) * 2 - 1;
}

export function fbm(x: number, z: number, seed: number, octaves = 3): number {
  let sum = 0, amplitude = 0.5, total = 0;
  for (let i = 0; i < octaves; i++) {
    // Rotate each octave so the field never lines up into rows.
    const rx = x * 0.8 - z * 0.6, rz = x * 0.6 + z * 0.8;
    sum += noise(rx, rz, seed + i * 977) * amplitude; total += amplitude;
    x = rx * 2.03 + 17.3; z = rz * 2.03 - 5.1; amplitude *= 0.5;
  }
  return sum / total;
}

/**
 * A sharp ledge on any height: long flat treads and a short riser. `k` is the riser's share of one step;
 * `offset` slides the riser along the slope, so a varying offset breaks the ledge's plan line.
 */
export function ledge(height: number, step: number, k: number, offset: number): number {
  const t = height / step + offset, i = Math.floor(t), f = t - i;
  return (i + smoothstep(1 - k, 1, f) - offset) * step;
}

interface Ridge {
  /** Crest line z as a function of x. */
  crest(x: number): number;
  /** Crest height above the land it rises from. */
  height(x: number): number;
  /** Metres from crest to foot on the town face, and on the back slope. */
  face: number; back: number;
  /** Ledge spacing of its rock face, and the riser's share of one step (wider far away, never a one-cell tooth). */
  step: number; riser: number;
}

const gauss = (x: number, centre: number, width: number): number => Math.exp(-(((x - centre) / width) ** 2));
/** A flat-topped table between `a` and `b` with short shoulders: summits read as mesas, never domes. */
const table = (x: number, a: number, b: number, edge: number): number => smoothstep(a - edge, a + edge, x) * (1 - smoothstep(b - edge, b + edge, x));

/**
 * Three layered ridges behind the town, each lower and nearer than the one behind it. Each is high toward
 * the frame's edges and dips behind the keep (x≈0), so the castle keeps the sky while the layers step up and
 * back on either side of it. They are asymmetric: a steep, ledged scarp faces the town and a long slope
 * falls away behind.
 */
export function ridges(seed: number): readonly Ridge[] {
  const p = (seed % 6283) / 1000;
  return Object.freeze([
    { crest: (x: number) => -205 + 18 * Math.sin(x * 0.011 + p) + 7 * Math.sin(x * 0.029 + 2.1),
      height: (x: number) => 28 + 6 * Math.sin(x * 0.0085 + 0.6) + 20 * table(x, -260, -110, 11) + 15 * table(x, 140, 250, 9) - 20 * gauss(x, 12, 60),
      face: 70, back: 150, step: 7, riser: 0.2 },
    { crest: (x: number) => -430 + 30 * Math.sin(x * 0.0062 + 2 + p) + 10 * Math.sin(x * 0.017),
      height: (x: number) => 84 + 12 * Math.sin(x * 0.0052 + 1.4) + 44 * table(x, 210, 430, 14) + 36 * table(x, -470, -230, 16) + 14 * table(x, 520, 700, 20) - 40 * gauss(x, 0, 120),
      face: 130, back: 230, step: 14, riser: 0.24 },
    { crest: (x: number) => -780 + 45 * Math.sin(x * 0.004 + 4 + p),
      height: (x: number) => 160 + 20 * Math.sin(x * 0.0037 + 0.3) + 90 * table(x, -620, -300, 24) + 76 * table(x, 330, 640, 22) - 40 * gauss(x, 10, 170),
      face: 210, back: 320, step: 24, riser: 0.28 },
  ]);
}

/** The rim's rock band: this share of the face drops this share of the ridge's height. */
const CAPROCK = 0.11, CAPROCK_DROP = 0.36;

function ridgeHeight(r: Ridge, x: number, z: number, seed: number): number {
  const s = z - r.crest(x) + 5 * fbm(x * 0.018, z * 0.018, seed);
  // A cuesta: a level caprock that breaks at its rim into a sheer rock band, then a concave talus to the
  // foot; behind the rim the top stays level before a long, gentle back slope. Never a rounded dome.
  const t = Math.min(1, Math.max(0, s / r.face));
  const shape = s >= 0
    ? (t < CAPROCK ? 1 - CAPROCK_DROP * (t / CAPROCK) : (1 - CAPROCK_DROP) * (1 - (t - CAPROCK) / (1 - CAPROCK)) ** 1.9)
    : Math.exp(-((Math.max(0, -s - r.face * 0.3) / r.back) ** 2));
  // Notched crest: shallow cols cut the long line into readable summits.
  const notch = 0.86 + 0.14 * Math.abs(Math.sin(x * 0.0105 + r.face));
  return Math.max(0, r.height(x)) * notch * shape;
}

/** Highland closing the valley: the left rises in broad shelves, the right lifts into a rocky knoll. */
function flanks(x: number, z: number, seed: number): number {
  const wobble = 18 * fbm(x * 0.012, z * 0.012, seed + 31);
  const west = 46 * smoothstep(-235, -420, x + wobble) * (0.65 + 0.35 * smoothstep(250, -150, z));
  const east = 34 * smoothstep(305, 460, x - wobble) * (0.55 + 0.45 * smoothstep(320, -80, z))
    + 22 * gauss(Math.hypot(x - 380, z - 40), 0, 55);
  const south = 8 * smoothstep(340, 520, z) * (0.6 + 0.4 * noise(x * 0.01, z * 0.01, seed + 7));
  return west + east + south;
}

export interface Relief { height: number; step: number; riser: number }

/** Landscape relief at a canonical point: height above the ground and the ledge rhythm of whatever is highest there. */
export function relief(x: number, z: number, seed: number, list: readonly Ridge[]): Relief {
  let height = 0, step = 3.5, riser = 0.2, best = 0;
  for (const r of list) {
    const h = ridgeHeight(r, x, z, seed);
    // A soft maximum keeps each ridge's own silhouette in front of the one behind it.
    if (h > best) { best = h; step = r.step; riser = r.riser; }
    height = Math.max(height, h) + 0.08 * Math.min(height, h);
  }
  const f = flanks(x, z, seed);
  if (f > height) { step = 4.5; riser = 0.22; }
  return { height: Math.max(height, f) + 0.15 * Math.min(height, f), step, riser };
}
