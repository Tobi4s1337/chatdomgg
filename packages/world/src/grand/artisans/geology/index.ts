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
  // A continuous mountain backbone, with narrow transverse ridges and notches. Unlike
  // radial cones, each broken fin shares its root and runs across the main spine.
  const spine = -15 + 6 * Math.sin(x / 38 + phase);
  const across = Math.abs(z - spine);
  const longRidge = 40 + 9 * Math.sin(x / 37 + phase) + 5 * Math.sin(x / 17 - phase);
  const finA = Math.pow(Math.max(0, 1 - Math.abs(Math.sin(x / 9 + phase))), 2.8);
  const finB = Math.pow(Math.max(0, 1 - Math.abs(Math.sin(x / 5.5 - phase / 2))), 5);
  const ridgeHeight = longRidge + 24 * finA + 15 * finB;
  const cliff = Math.max(0, 1 - Math.max(0, across - 3) / (30 + 4 * Math.sin(x / 27)));
  const base = 4 + ridgeHeight * Math.pow(cliff, 0.58);
  const oblique = (5 * Math.sin(x / 7 + z / 18 + phase) + 2.5 * Math.sin(x / 3.7 - z / 8))
    * Math.max(0, 1 - across / 30);
  const shoulder = 8 * Math.exp(-(((z - 17 - 5 * Math.sin(x / 23)) / 14) ** 2));
  return Math.max(3, Math.round(base + shoulder + oblique));
}

/** A non-authoritative sample range to judge bands, snowline, slopes and a talus apron. */
export function createGeologyReview(seedKey: string): ArtisanKit {
  const b = new KitBuilder(), phase = seedPhase(seedKey), sampler = createGeologySampler(seedKey), step = 2;
  let summitX = 0, summitZ = 0, summitY = 0;
  for (let z = -54; z < 48; z += step) for (let x = -78; x < 78; x += step) {
    const top = mountainHeight(x, z, phase);
    if (top > summitY) { summitX = x; summitY = top; summitZ = z; }
    const slope = Math.max(Math.abs(mountainHeight(x + step, z, phase) - top),
      Math.abs(mountainHeight(x, z + step, phase) - top)) / step;
    const column = sampler.column(x, z), talus = top < 27 && slope > 0.7;
    const colourAt = (y: number): string => {
      // Living foothills and a thin earth lip take the rectangular quarry edge off the range.
      if (top < 20 && slope < 1.4 && y >= top - 1) return y === top ? '#788d59' : '#796c55';
      return GEOLOGY_COLOURS[column.material(y, top, slope, 32, 0.3, talus)]!;
    };
    let start = 0, prev = colourAt(0);
    for (let y = 1; y <= top + 1; y++) {
      const colour = y <= top ? colourAt(y) : '';
      if (colour === prev) continue;
      b.box(x, start, z, step, y - start, step, prev);
      start = y; prev = colour;
    }
  }
  return b.finish('geology-range', { summit: [summitX, summitY, summitZ], foot: [0, 6, 43] });
}

export interface WaterReach { readonly z: number; readonly x: number; readonly y: number; readonly halfWidth: number }
/** Contiguous, descending stream profile, widening toward the sea; units are half-metre cells. */
export function watercourseProfile(): readonly WaterReach[] {
  const reaches: WaterReach[] = [];
  for (let z = 0; z <= 88; z++) reaches.push({
    z, x: Math.round(13 * Math.sin(z / 19) + 4 * Math.sin(z / 37)),
    y: z < 25 ? 13 : z < 56 ? 11 : 9,
    halfWidth: Math.floor(4 + z / 11),
  });
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
  const b = new KitBuilder(), rng = random(seedKey + ':coast'), sampler = createGeologySampler(seedKey);
  const water = '#66a7b0', deep = '#4b8a9b', light = '#a9d5d2';
  const reaches = watercourseProfile();
  // Build a shaped headland in two-cell columns. The fall is at its one deliberately low
  // notch. Curved cliff edges and living foothills surround rather than frame the water.
  for (let z = -58; z < 98; z += 2) for (let x = -68; x < 68; x += 2) {
    const coastline = 82 - 8 * Math.sin(x / 18) - 4 * Math.sin(x / 9);
    const coastWidth = 58 + 6 * Math.sin(z / 24);
    if (Math.abs(x) > coastWidth || z > coastline) continue;
    const edge = -10 + Math.min(1, Math.abs(x) / 9) * (7 * Math.sin(x / 18) + 5 * Math.sin(x / 10));
    let top: number;
    if (z < edge) {
      // The mere has a flat rim; outside it, the crown rolls into irregular stone.
      const nearMere = Math.abs(x) < 23 && z > -58 && z < -21;
      top = nearMere ? 33 : 33 + Math.round(2 * Math.sin(x / 9 + z / 13) + 2 * Math.sin(z / 11));
    } else {
      const reach = reaches[Math.min(88, Math.max(0, z))]!;
      const distance = Math.abs(x - reach.x) - reach.halfWidth;
      top = (z < 0 ? 10 : reach.y - 2) + Math.round(Math.min(5, Math.max(0, distance) * 0.35));
      if (z < 14 && Math.hypot(x, z) < 16) top = 10; // pool's carved basin
    }
    top = Math.max(3, top);
    const column = sampler.column(x, z);
    let start = 0;
    let prior = GEOLOGY_COLOURS[column.band(0) + GEOLOGY.strata]!;
    for (let y = 1; y <= top + 1; y++) {
      const material = y > top ? '' : y === top ? (z > coastline - 8 ? CLAY.sand : CLAY.grass)
        : GEOLOGY_COLOURS[column.band(y) + GEOLOGY.strata]!;
      if (material === prior) continue;
      b.box(x, start, z, 2, y - start, 2, prior);
      start = y; prior = material;
    }
  }
  // Upper mere, its short stream, waterfall and receiving pool are one connected route.
  disc(b, 0, 34, -39, 15, 17, water);
  b.box(-4, 34, -21, 9, 1, 12, water);
  b.box(-4, 12, -10, 9, 23, 1, water);
  b.box(-3, 14, -9, 2, 20, 1, light);
  b.box(1, 17, -9, 1, 17, 1, '#86bdc3');
  disc(b, 0, 11, 0, 15, 13, deep);
  disc(b, 0, 12, 0, 14, 12, water);
  for (const r of reaches) {
    b.box(r.x - r.halfWidth, r.y - 2, r.z, r.halfWidth * 2 + 1, 2, 1, deep);
    b.box(r.x - r.halfWidth, r.y, r.z, r.halfWidth * 2 + 1, 1, 1, water);
    // Unequal banks break into the countryside at different widths.
    for (const side of [-1, 1] as const) {
      const edge = r.x + side * (r.halfWidth + 1), width = 1 + Math.round(1.2 * (1 + Math.sin(r.z / 9 + side)));
      b.box(side < 0 ? edge - width + 1 : edge, r.y - 1, r.z, width, 1, 1, CLAY.sand);
    }
  }
  // Mouth broadens into sea; the coast line intersects it rather than forming a canal end.
  b.box(-72, 9, 86, 144, 1, 18, '#679fab');
  for (const [x, z, rx, rz] of [[0, -5, 12, 4], [-2, 90, 19, 3], [32, 96, 10, 2], [-37, 98, 8, 2]] as const) {
    for (let i = -rx; i < rx; i += 5) {
      const yy = z < 0 ? 14 : 10, zz = Math.round(z + rz * (1 - (i / rx) ** 2));
      b.box(x + i, yy, zz, 3, 1, 1, CLAY.foam);
    }
  }
  // Weathered, asymmetrical stacks: uneven eroded cross-sections and narrow crowns.
  for (const [sx, sz, h] of [[-48, 92, 21], [48, 95, 16]] as const) {
    const phase = rng() * Math.PI * 2;
    for (let y = 0; y < h; y++) {
      const radius = 2.2 + (1 - y / h) * 3 + 0.6 * Math.sin(y / 3 + phase);
      for (let dz = -6; dz <= 6; dz++) {
        const half = Math.floor(Math.sqrt(Math.max(0, radius * radius - dz * dz)));
        if (Math.abs(dz) > radius || half < 1) continue;
        const lean = Math.round(y / h * 2 + Math.sin(dz / 3 + phase));
        b.box(sx + lean - half, 9 + y, sz + dz, half * 2 + 1, 1, 1,
          GEOLOGY_COLOURS[GEOLOGY.strata + Math.floor((y + 2 * Math.sin(dz / 5 + phase)) / 5 + 32) % 16]!);
      }
    }
  }
  return b.finish('watercourse', { source: [0, 34, -39], mere: [0, 34, -39], falls: [0, 24, -10], pool: [0, 13, 0], mouth: [0, 9, 88], coast: [0, 10, 99] });
}
