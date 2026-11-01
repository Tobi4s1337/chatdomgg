import { CLAY, KitBuilder, random, type ArtisanKit } from '../kit';

/** The grand generator's existing material IDs. These are render labels, not collision. */
export const GEOLOGY = { strata: 14, strataCount: 16, scree: 30, snow: 32, snowShade: 33 } as const;

export interface GeologySample {
  /** Integer terrain cells, anchored to world coordinates; top solid cell is surfaceY. */
  readonly x: number; readonly y: number; readonly z: number;
  readonly surfaceY: number;
  /** Height change per horizontal cell; greater values are steeper. */
  readonly slope: number;
  readonly snowline: number;
  /** Wind exposure 0..1. Sheltered ledges catch snow at a lower elevation. */
  readonly exposure: number;
  readonly seedKey: string;
  /** Surface sits below a steep rock face, where fallen material accumulates. */
  readonly talus?: boolean;
}

function seedPhase(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296 * Math.PI * 2;
}

/** Bind a column once, so every voxel in a worker chunk reuses the same warp and snowline drift. */
function columnAtPhase(x: number, z: number, p: number) {
  const warp = 4.4 * Math.sin(x / 71 + p) + 2.2 * Math.sin(z / 97 - p * 0.7)
    + 1.4 * Math.sin((x + z) / 39 + p * 0.3);
  const snowDrift = 2.2 * Math.sin(x / 31 + z / 47 + p);
  return {
    band(y: number): number {
      const band = Math.floor((y + warp) / 5);
      return ((band % GEOLOGY.strataCount) + GEOLOGY.strataCount) % GEOLOGY.strataCount;
    },
    material(y: number, surfaceY: number, slope: number, snowline: number, exposure: number, talus = false): number {
      const depth = surfaceY - y;
      const line = snowline + 5 * Math.max(0, Math.min(1, exposure)) + snowDrift;
      if (depth >= 0 && depth < 2 && surfaceY >= line && slope < 1.35) {
        return depth === 0 ? GEOLOGY.snow : GEOLOGY.snowShade;
      }
      if (talus && depth === 0 && slope < 2.8) return GEOLOGY.scree;
      const band = Math.floor((y + warp) / 5);
      return GEOLOGY.strata + ((band % GEOLOGY.strataCount) + GEOLOGY.strataCount) % GEOLOGY.strataCount;
    },
  };
}

/** One sampler per immutable landscape seed; bind one column per worker column. */
export function createGeologySampler(seedKey: string) {
  const phase = seedPhase(seedKey);
  return {
    column: (x: number, z: number) => columnAtPhase(x, z, phase),
    sample: (s: Omit<GeologySample, 'seedKey'>) => columnAtPhase(s.x, s.z, phase)
      .material(s.y, s.surfaceY, s.slope, s.snowline, s.exposure, s.talus),
  };
}

/** Convenience for isolated queries; bulk generation should retain the sampler. */
export function createGeologyColumn(x: number, z: number, seedKey: string) {
  return columnAtPhase(x, z, seedPhase(seedKey));
}

/** Slow, continuous band warp makes rock read as geology across chunk borders. */
export function strataBand(x: number, y: number, z: number, seedKey: string): number {
  return createGeologyColumn(x, z, seedKey).band(y);
}

/** Snow is confined to high ledges; steep faces show rock. Callers supply actual terrain slope. */
export function sampleGeology(s: GeologySample): number {
  return createGeologyColumn(s.x, s.z, s.seedKey).material(s.y, s.surfaceY, s.slope, s.snowline, s.exposure, s.talus);
}

/** Colours parallel the grand granite palette; output can also be mapped to its palette IDs. */
export const GEOLOGY_COLOURS: Readonly<Record<number, string>> = {
  14: '#7d7c82', 15: '#8c8a8e', 16: '#6e6e76', 17: '#9a9692',
  18: '#a6a29c', 19: '#807e86', 20: '#6a6870', 21: '#948f8a',
  22: '#b0aaa2', 23: '#85838a', 24: '#77767e', 25: '#a09a94',
  26: '#8a8786', 27: '#73737b', 28: '#9b9690', 29: '#aca69e',
  30: '#938b87', 32: '#f0f3f3', 33: '#d3dfec',
};

function mountainHeight(x: number, z: number, phase: number): number {
  // One spine with irregular peaks, saddles and folded offshoots; not isolated random cones.
  const spine = -8 + 4 * Math.sin(x / 19 + phase);
  const across = Math.abs(z - spine);
  const peak = 29 + 30 * Math.pow(Math.max(0, Math.sin(x / 13 + phase)), 2)
    + 15 * Math.pow(Math.max(0, Math.cos(x / 8 - phase)), 5);
  const mountain = Math.max(0, 1 - across / (27 + 3 * Math.sin(x / 17)));
  const ridge = peak * Math.pow(mountain, 1.28);
  const jag = 5 * Math.max(0, Math.sin(x / 3.7 + z / 5 + phase)) * mountain ** 3;
  return Math.max(3, Math.round(6 + ridge + jag));
}

/** A non-authoritative sample range to judge bands, snowline, slopes and a talus apron. */
export function createGeologyReview(seedKey: string): ArtisanKit {
  const b = new KitBuilder(), phase = seedPhase(seedKey), sampler = createGeologySampler(seedKey), step = 2;
  for (let z = -44; z < 36; z += step) for (let x = -74; x < 74; x += step) {
    const top = mountainHeight(x, z, phase);
    const slope = Math.max(Math.abs(mountainHeight(x + step, z, phase) - top),
      Math.abs(mountainHeight(x, z + step, phase) - top)) / step;
    const column = sampler.column(x, z), talus = top < 22 && slope > 0.35;
    let start = 0;
    let prev = column.material(0, top, slope, 43, 0.4, talus);
    for (let y = 1; y <= top + 1; y++) {
      const material = y <= top ? column.material(y, top, slope, 43, 0.4, talus) : -1;
      if (material === prev) continue;
      b.box(x, start, z, step, y - start, step, GEOLOGY_COLOURS[prev]!);
      start = y; prev = material;
    }
  }
  return b.finish('geology-range', { summit: [0, 65, -8], foot: [0, 6, 32] });
}

export interface WaterReach { readonly z: number; readonly x: number; readonly y: number; readonly halfWidth: number }
/** Contiguous, descending stream profile, widening toward the sea; units are half-metre cells. */
export function watercourseProfile(): readonly WaterReach[] {
  const reaches: WaterReach[] = [];
  for (let z = 0; z <= 88; z++) reaches.push({ z, x: Math.round(4 * Math.sin(z / 23)), y: z < 25 ? 13 : z < 56 ? 11 : 9, halfWidth: Math.floor(4 + z / 11) });
  return reaches;
}

function disc(b: KitBuilder, cx: number, y: number, cz: number, rx: number, rz: number, colour: string): void {
  for (let z = -rz; z <= rz; z++) {
    const half = Math.floor(rx * Math.sqrt(Math.max(0, 1 - z * z / (rz * rz))));
    b.box(cx - half, y, cz + z, half * 2 + 1, 1, 1, colour);
  }
}

/**
 * A composed material study: source, a proper drop, receiving pool, meandering reach, mouth,
 * sea stacks and foam. Surfaces are static; hydrology and animation remain builder-owned.
 */
export function createWatercourse(seedKey: string): ArtisanKit {
  const b = new KitBuilder(), rng = random(seedKey + ':coast');
  const water = '#66a7b0', deep = '#4b8a9b', light = '#a9d5d2', rock = '#8f8987';
  // Solid valley bed under the complete scene, plateau and cliff from which the fall spills.
  b.box(-58, 0, -58, 116, 7, 160, CLAY.earth);
  b.box(-58, 7, -58, 116, 2, 160, CLAY.grass);
  b.box(-58, 9, -58, 116, 24, 48, rock);
  for (let y = 10; y < 33; y += 5) b.box(-58, y, -10, 116, 2, 1, GEOLOGY_COLOURS[14 + (Math.floor(y / 5) % 16)]!);
  b.box(-58, 33, -58, 116, 2, 48, CLAY.grass);
  // Upper source meets the fall exactly at z=-10; the drop terminates in its pool.
  disc(b, 0, 35, -39, 15, 17, water);
  b.box(-4, 35, -21, 9, 1, 12, water);
  b.box(-4, 13, -10, 9, 23, 1, water);
  b.box(-3, 14, -9, 2, 20, 1, light);
  b.box(1, 17, -9, 1, 17, 1, '#86bdc3');
  // Dark bed is below the water; layered pool and river meet the fall, then descend.
  disc(b, 0, 11, 0, 15, 13, deep);
  disc(b, 0, 12, 0, 14, 12, water);
  for (const r of watercourseProfile()) {
    b.box(r.x - r.halfWidth - 3, r.y - 3, r.z, r.halfWidth * 2 + 7, 1, 1, '#8e866e');
    b.box(r.x - r.halfWidth, r.y - 2, r.z, r.halfWidth * 2 + 1, 2, 1, deep);
    b.box(r.x - r.halfWidth, r.y, r.z, r.halfWidth * 2 + 1, 1, 1, water);
    // A graded soft bank sits above the base without blocking the channel.
    for (const side of [-1, 1] as const) {
      const edge = r.x + side * (r.halfWidth + 1);
      b.box(side < 0 ? edge - 3 : edge, r.y - 1, r.z, 4, 1, 1, CLAY.sand);
    }
  }
  // Sea top meets the mouth. Keeping it translucent is a renderer concern, not model occupancy.
  b.box(-58, 9, 89, 116, 1, 13, '#679fab');
  for (const [x, z, rx, rz] of [[0, -5, 12, 4], [-2, 90, 19, 3], [30, 96, 11, 2], [-37, 98, 8, 2]] as const) {
    for (let i = -rx; i < rx; i += 4) {
      const yy = z < 0 ? 14 : 10;
      const zz = Math.round(z + rz * (1 - (i / rx) ** 2));
      b.box(x + i, yy, zz, 3, 1, 1, CLAY.foam);
    }
  }
  // Two freestanding layered sea stacks; no emissive stones that could imply a citizen.
  for (const [sx, sz, h] of [[-37, 93, 20], [38, 96, 14]] as const) {
    for (let y = 0; y < h; y += 3) {
      const r = Math.max(2, Math.round(5 * (1 - y / (h * 1.35))));
      b.box(sx - r, 9 + y, sz - r, 2 * r + 1, Math.min(3, h - y), 2 * r + 1,
        GEOLOGY_COLOURS[14 + (Math.floor(y / 5) + Math.floor(rng() * 3)) % 16]!);
    }
    b.box(sx - 2, 9 + h, sz - 2, 5, 1, 5, '#718d5e');
  }
  return b.finish('watercourse', { source: [0, 35, -39], mere: [0, 35, -39], falls: [0, 24, -10], pool: [0, 13, 0], mouth: [0, 9, 88], coast: [0, 10, 99] });
}
