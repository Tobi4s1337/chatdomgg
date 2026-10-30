import { fbm, hash2, hashString, ridge } from './noise';
import type { Layout, PlacedChannel, Tier } from './layout';

/**
 * Draft land for the survey preview: a smooth union of each community's ground, roughened by seeded noise into
 * coasts and bays, with every holding guaranteed dry. Coasts are traced with marching squares and simplified; the
 * client adds fine fractal detail while drawing, keyed to world position so neighbouring tiles agree.
 */
export const LAND_SEED = hashString('chatdom:survey-preview:land:1');
export const CELL = 1;
export const SEA_MARGIN = 150;
/** Coordinates are written as integers of 1/20 unit. */
export const COORD_SCALE = 20;

export interface Bounds { minX: number; minY: number; maxX: number; maxY: number }

export interface LandField {
  bounds: Bounds;
  width: number;
  height: number;
  values: Float32Array;
  /** Index of the region whose ground dominates each cell, or -1 at sea. */
  owner: Int16Array;
}

export interface Ring {
  region: number;
  /** Closed polyline in world units (first point not repeated). */
  points: number[];
  area: number;
}

const BLEND = 7;
/** Half-width of the sea kept between two languages' land, before the fine coastal noise. */
const STRAIT = 5;

function regionNoiseAmplitude(r: number): number {
  return Math.max(4, Math.min(24, r * 0.09));
}

export function layoutBounds(layout: Layout): Bounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const region of layout.regions) {
    minX = Math.min(minX, region.x - region.r);
    minY = Math.min(minY, region.y - region.r);
    maxX = Math.max(maxX, region.x + region.r);
    maxY = Math.max(maxY, region.y + region.r);
  }
  return {
    minX: Math.floor(minX - SEA_MARGIN), minY: Math.floor(minY - SEA_MARGIN),
    maxX: Math.ceil(maxX + SEA_MARGIN), maxY: Math.ceil(maxY + SEA_MARGIN),
  };
}

export function buildField(layout: Layout): LandField {
  const bounds = layoutBounds(layout);
  const width = Math.round((bounds.maxX - bounds.minX) / CELL) + 1;
  const height = Math.round((bounds.maxY - bounds.minY) / CELL) + 1;
  const sum = new Float64Array(width * height);
  const best = new Float32Array(width * height).fill(-Infinity);
  /** The strongest ground of any language other than the owner's, so a strait can separate the two. */
  const rival = new Float32Array(width * height).fill(-Infinity);
  const owner = new Int16Array(width * height).fill(-1);
  const reach = BLEND * 6;

  // Smooth union (log-sum-exp) of each community's disc, so neighbouring communities share one landmass.
  for (const cluster of layout.clusters) {
    const region = layout.regions[cluster.region]!;
    const inflate = region.kind === 'isle' ? 3 : 4.5;
    const radius = cluster.r + inflate;
    const x0 = Math.max(0, Math.floor((cluster.x - radius - reach - bounds.minX) / CELL));
    const x1 = Math.min(width - 1, Math.ceil((cluster.x + radius + reach - bounds.minX) / CELL));
    const y0 = Math.max(0, Math.floor((cluster.y - radius - reach - bounds.minY) / CELL));
    const y1 = Math.min(height - 1, Math.ceil((cluster.y + radius + reach - bounds.minY) / CELL));
    for (let j = y0; j <= y1; j++) {
      const py = bounds.minY + j * CELL;
      for (let i = x0; i <= x1; i++) {
        const px = bounds.minX + i * CELL;
        const value = radius - Math.hypot(px - cluster.x, py - cluster.y);
        const k = j * width + i;
        sum[k]! += Math.exp(value / BLEND);
        if (cluster.region === owner[k]) {
          if (value > best[k]!) best[k] = value;
        } else if (value > best[k]!) {
          rival[k] = best[k]!;
          best[k] = value;
          owner[k] = cluster.region;
        } else if (value > rival[k]!) {
          rival[k] = value;
        }
      }
    }
  }

  const values = new Float32Array(width * height);
  for (let j = 0; j < height; j++) {
    const py = bounds.minY + j * CELL;
    for (let i = 0; i < width; i++) {
      const k = j * width + i;
      const s = sum[k]!;
      if (s <= 0) {
        values[k] = -100;
        continue;
      }
      const px = bounds.minX + i * CELL;
      const region = layout.regions[owner[k]!]!;
      const amplitude = regionNoiseAmplitude(region.r);
      const base = BLEND * Math.log(s);
      const fine = 2.6 * fbm(LAND_SEED ^ 0x5bd1e995, px / 13, py / 13, 3);
      let value = base + amplitude * fbm(LAND_SEED, px / 85, py / 85, 4) + fine;
      // Two languages never share a landmass (R4): the blend and the noise would bridge close isles, so a strait
      // with a ragged coast follows the midline between their grounds.
      if (rival[k]! > -Infinity) value = Math.min(value, (best[k]! - rival[k]!) / 2 - STRAIT + fine);
      values[k] = Math.max(-100, value);
    }
  }

  // Every holding stands on dry land with a margin of shore, whatever the noise did.
  for (const settler of layout.settlers) {
    const keep = settler.r * 1.9 + 1.5;
    const x0 = Math.max(0, Math.floor((settler.x - keep - bounds.minX) / CELL));
    const x1 = Math.min(width - 1, Math.ceil((settler.x + keep - bounds.minX) / CELL));
    const y0 = Math.max(0, Math.floor((settler.y - keep - bounds.minY) / CELL));
    const y1 = Math.min(height - 1, Math.ceil((settler.y + keep - bounds.minY) / CELL));
    for (let j = y0; j <= y1; j++) {
      for (let i = x0; i <= x1; i++) {
        const k = j * width + i;
        const value = keep - Math.hypot(bounds.minX + i * CELL - settler.x, bounds.minY + j * CELL - settler.y);
        if (value > values[k]!) {
          values[k] = value;
          owner[k] = settler.region;
        }
      }
    }
  }
  // The frame is always sea, so every coast closes.
  for (let i = 0; i < width; i++) {
    values[i] = -100;
    values[(height - 1) * width + i] = -100;
  }
  for (let j = 0; j < height; j++) {
    values[j * width] = -100;
    values[j * width + width - 1] = -100;
  }
  return { bounds, width, height, values, owner };
}

/** Bilinear sample of the field in world units; outside the grid is open sea. */
export function sampleField(field: LandField, x: number, y: number): number {
  const fx = (x - field.bounds.minX) / CELL;
  const fy = (y - field.bounds.minY) / CELL;
  const i = Math.floor(fx);
  const j = Math.floor(fy);
  if (i < 0 || j < 0 || i >= field.width - 1 || j >= field.height - 1) return -100;
  const tx = fx - i;
  const ty = fy - j;
  const k = j * field.width + i;
  const a = field.values[k]!;
  const b = field.values[k + 1]!;
  const c = field.values[k + field.width]!;
  const d = field.values[k + field.width + 1]!;
  return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
}

/**
 * Marching squares at value 0. Crossing points live on grid edges; each edge point joins exactly two cell segments,
 * so chaining them gives closed rings. Saddles follow the cell's centre value.
 */
export function traceCoasts(field: LandField): number[][] {
  const { width, height, values, bounds } = field;
  const edgeId = (i: number, j: number, vertical: boolean) => (j * width + i) * 2 + (vertical ? 1 : 0);
  const links = new Map<number, number[]>();
  const point = new Map<number, [number, number]>();
  const crossing = (i: number, j: number, vertical: boolean): number => {
    const id = edgeId(i, j, vertical);
    if (!point.has(id)) {
      const a = values[j * width + i]!;
      const b = vertical ? values[(j + 1) * width + i]! : values[j * width + i + 1]!;
      const t = a / (a - b);
      point.set(id, vertical ? [bounds.minX + i * CELL, bounds.minY + (j + t) * CELL] : [bounds.minX + (i + t) * CELL, bounds.minY + j * CELL]);
    }
    return id;
  };
  const link = (a: number, b: number) => {
    const la = links.get(a);
    if (la) la.push(b);
    else links.set(a, [b]);
    const lb = links.get(b);
    if (lb) lb.push(a);
    else links.set(b, [a]);
  };
  for (let j = 0; j < height - 1; j++) {
    for (let i = 0; i < width - 1; i++) {
      const tl = values[j * width + i]! > 0;
      const tr = values[j * width + i + 1]! > 0;
      const br = values[(j + 1) * width + i + 1]! > 0;
      const bl = values[(j + 1) * width + i]! > 0;
      const code = (tl ? 8 : 0) | (tr ? 4 : 0) | (br ? 2 : 0) | (bl ? 1 : 0);
      if (code === 0 || code === 15) continue;
      const top = () => crossing(i, j, false);
      const bottom = () => crossing(i, j + 1, false);
      const left = () => crossing(i, j, true);
      const right = () => crossing(i + 1, j, true);
      switch (code) {
        case 1: case 14: link(left(), bottom()); break;
        case 2: case 13: link(bottom(), right()); break;
        case 3: case 12: link(left(), right()); break;
        case 4: case 11: link(top(), right()); break;
        case 6: case 9: link(top(), bottom()); break;
        case 7: case 8: link(left(), top()); break;
        case 5: case 10: {
          const centre = (values[j * width + i]! + values[j * width + i + 1]! + values[(j + 1) * width + i]! + values[(j + 1) * width + i + 1]!) / 4 > 0;
          // Code 5 is tr+bl land; code 10 is tl+br land. A land centre joins the two land corners.
          if ((code === 5) === centre) {
            link(left(), top());
            link(bottom(), right());
          } else {
            link(top(), right());
            link(left(), bottom());
          }
          break;
        }
      }
    }
  }
  const visited = new Set<number>();
  const rings: number[][] = [];
  for (const start of [...links.keys()].sort((a, b) => a - b)) {
    if (visited.has(start)) continue;
    const ring: number[] = [];
    let previous = -1;
    let current = start;
    while (!visited.has(current)) {
      visited.add(current);
      const [x, y] = point.get(current)!;
      ring.push(x, y);
      const next = links.get(current)!.find((candidate) => candidate !== previous && !visited.has(candidate));
      if (next === undefined) break;
      previous = current;
      current = next;
    }
    if (ring.length >= 6) rings.push(ring);
  }
  return rings;
}

function perpendicular(points: number[], a: number, b: number, p: number): number {
  const ax = points[a * 2]!;
  const ay = points[a * 2 + 1]!;
  const dx = points[b * 2]! - ax;
  const dy = points[b * 2 + 1]! - ay;
  const length = Math.hypot(dx, dy);
  const px = points[p * 2]! - ax;
  const py = points[p * 2 + 1]! - ay;
  return length === 0 ? Math.hypot(px, py) : Math.abs(px * dy - py * dx) / length;
}

function simplifyOpen(points: number[], first: number, last: number, tolerance: number, keep: Uint8Array): void {
  const stack: [number, number][] = [[first, last]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let worst = -1;
    let worstDistance = tolerance;
    for (let p = a + 1; p < b; p++) {
      const d = perpendicular(points, a, b, p);
      if (d > worstDistance) {
        worst = p;
        worstDistance = d;
      }
    }
    if (worst >= 0) {
      keep[worst] = 1;
      stack.push([a, worst], [worst, b]);
    }
  }
}

/** Douglas–Peucker on a closed ring, split at its first point and the point farthest from it. */
export function simplifyRing(ring: number[], tolerance: number): number[] {
  const n = ring.length / 2;
  const closed = [...ring, ring[0]!, ring[1]!];
  let far = 0;
  let farDistance = -1;
  for (let p = 1; p < n; p++) {
    const d = Math.hypot(ring[p * 2]! - ring[0]!, ring[p * 2 + 1]! - ring[1]!);
    if (d > farDistance) {
      far = p;
      farDistance = d;
    }
  }
  const keep = new Uint8Array(n + 1);
  keep[0] = 1;
  keep[far] = 1;
  keep[n] = 1;
  simplifyOpen(closed, 0, far, tolerance, keep);
  simplifyOpen(closed, far, n, tolerance, keep);
  const out: number[] = [];
  for (let p = 0; p < n; p++) if (keep[p]) out.push(ring[p * 2]!, ring[p * 2 + 1]!);
  return out;
}

export function ringArea(points: readonly number[]): number {
  let area = 0;
  const n = points.length / 2;
  for (let p = 0; p < n; p++) {
    const q = (p + 1) % n;
    area += points[p * 2]! * points[q * 2 + 1]! - points[q * 2]! * points[p * 2 + 1]!;
  }
  return area / 2;
}

export interface RingBox { minX: number; minY: number; maxX: number; maxY: number }

export function ringBox(points: readonly number[]): RingBox {
  const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (let p = 0; p < points.length; p += 2) {
    box.minX = Math.min(box.minX, points[p]!);
    box.maxX = Math.max(box.maxX, points[p]!);
    box.minY = Math.min(box.minY, points[p + 1]!);
    box.maxY = Math.max(box.maxY, points[p + 1]!);
  }
  return box;
}

/** Even-odd point test across all rings: holes (lakes) inside land count as water. A ring's box can only skip it. */
export function insideLand(rings: readonly (Pick<Ring, 'points'> & { box?: RingBox })[], x: number, y: number): boolean {
  let inside = false;
  for (const ring of rings) {
    const box = ring.box;
    if (box && (x < box.minX || x > box.maxX || y < box.minY || y > box.maxY)) continue;
    const pts = ring.points;
    const n = pts.length / 2;
    for (let p = 0, q = n - 1; p < n; q = p++) {
      const yi = pts[p * 2 + 1]!;
      const yj = pts[q * 2 + 1]!;
      if ((yi > y) !== (yj > y)) {
        const xi = pts[p * 2]!;
        const xj = pts[q * 2]!;
        if (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
      }
    }
  }
  return inside;
}

export function extractRings(field: LandField, layout: Layout): Ring[] {
  const rings: Ring[] = [];
  for (const raw of traceCoasts(field)) {
    const points = simplifyRing(raw, 0.12);
    if (points.length < 6) continue;
    const area = ringArea(points);
    // Noise specks smaller than a village are not islands worth drawing.
    if (Math.abs(area) < 3) continue;
    rings.push({ region: ringRegion(field, layout, points), points, area });
  }
  return rings;
}

function ringRegion(field: LandField, layout: Layout, points: readonly number[]): number {
  const votes = new Map<number, number>();
  for (let p = 0; p < points.length; p += 2) {
    const i = Math.round((points[p]! - field.bounds.minX) / CELL);
    const j = Math.round((points[p + 1]! - field.bounds.minY) / CELL);
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        const owner = field.owner[(j + dj) * field.width + i + di] ?? -1;
        if (owner >= 0) votes.set(owner, (votes.get(owner) ?? 0) + 1);
      }
    }
  }
  let best = -1;
  let bestVotes = -1;
  for (const [region, count] of [...votes.entries()].sort((a, b) => a[0] - b[0])) {
    if (count > bestVotes) {
      best = region;
      bestVotes = count;
    }
  }
  if (best >= 0) return best;
  let nearest = 0;
  let nearestDistance = Infinity;
  for (const region of layout.regions) {
    const d = Math.hypot(points[0]! - region.x, points[1]! - region.y) - region.r;
    if (d < nearestDistance) {
      nearest = region.index;
      nearestDistance = d;
    }
  }
  return nearest;
}

// ── Decoration: mountains, hills, forests, marsh, and open-sea ships and monsters ─────────────────────────────
export const DECOR_KINDS = ['mountain', 'hill', 'forest', 'marsh', 'monster', 'ship'] as const;
export type DecorKind = typeof DECOR_KINDS[number];
/** Grid spacing (world units) per detail level; coarser levels are subsets of finer ones. */
export const DECOR_SPACING = [96, 48, 24, 12, 6] as const;
const FINEST = DECOR_SPACING.length - 1;

/**
 * A decor mark has a fixed position and kind, and a band mask: the zoom bands (one per spacing) at which it is drawn.
 * A mark appears from its own band down to finer ones while its stamp still clears the holdings drawn at that band,
 * so a mountain seen from afar stays the same mountain closer in, and steps aside only where towns appear.
 */
export interface Decor { kind: DecorKind; bands: number; variant: number; x: number; y: number }

/** Tiers whose stamps are drawn at each band; decor keeps clear of them. */
const VISIBLE_TIERS: readonly (readonly Tier[])[] = [
  ['capital'], ['capital', 'city'], ['capital', 'city', 'town'], ['capital', 'city', 'town', 'village'], ['capital', 'city', 'town', 'village'],
];

class SettlerIndex {
  private readonly grid = new Map<string, PlacedChannel[]>();
  constructor(settlers: readonly PlacedChannel[], private readonly cell: number) {
    for (const settler of settlers) {
      const key = `${Math.floor(settler.x / cell)},${Math.floor(settler.y / cell)}`;
      const bucket = this.grid.get(key);
      if (bucket) bucket.push(settler);
      else this.grid.set(key, [settler]);
    }
  }

  /** True when no holding of the given tiers lies within its radius plus `clearance` of the point. */
  clear(x: number, y: number, clearance: number, tiers: readonly Tier[]): boolean {
    const span = Math.ceil((clearance + 8) / this.cell);
    const cx = Math.floor(x / this.cell);
    const cy = Math.floor(y / this.cell);
    for (let gx = cx - span; gx <= cx + span; gx++) {
      for (let gy = cy - span; gy <= cy + span; gy++) {
        for (const settler of this.grid.get(`${gx},${gy}`) ?? []) {
          if (!tiers.includes(settler.tier)) continue;
          const limit = settler.r * 1.2 + clearance;
          const dx = settler.x - x;
          const dy = settler.y - y;
          if (dx * dx + dy * dy < limit * limit) return false;
        }
      }
    }
    return true;
  }
}

export function placeDecor(field: LandField, layout: Layout): Decor[] {
  const seed = hashString('chatdom:survey-preview:decor:1');
  const index = new SettlerIndex(layout.settlers, 12);
  const step = DECOR_SPACING[FINEST]!;
  const { bounds } = field;
  const decor: Decor[] = [];
  const gx0 = Math.ceil(bounds.minX / step);
  const gx1 = Math.floor(bounds.maxX / step);
  const gy0 = Math.ceil(bounds.minY / step);
  const gy1 = Math.floor(bounds.maxY / step);
  for (let gy = gy0; gy <= gy1; gy++) {
    for (let gx = gx0; gx <= gx1; gx++) {
      let level = FINEST;
      for (let k = 0; k < FINEST; k++) {
        const stride = 2 ** (FINEST - k);
        if (gx % stride === 0 && gy % stride === 0) {
          level = k;
          break;
        }
      }
      const spacing = DECOR_SPACING[level]!;
      // Jitter within the cell this point owns at its own level, so coarse marks are spread, not gridded.
      const jx = (hash2(seed, gx, gy) - 0.5) * spacing * 0.7;
      const jy = (hash2(seed ^ 0x2545f491, gx, gy) - 0.5) * spacing * 0.7;
      const x = gx * step + jx;
      const y = gy * step + jy;
      const value = sampleField(field, x, y);
      if (value < 1.2 + spacing * 0.08) continue;
      const crest = ridge(seed, x / 150, y / 150, 3);
      const wet = fbm(seed ^ 0x1b873593, x / 70, y / 70, 3);
      const open = hash2(seed ^ 0x7f4a7c15, gx, gy);
      let kind: DecorKind | null;
      if (crest > 0.66) kind = 'mountain';
      else if (crest > 0.54) kind = open < 0.8 ? 'hill' : null;
      else if (wet > 0.18) kind = open < 0.85 ? 'forest' : null;
      else if (wet < -0.4 && value < 16) kind = open < 0.4 ? 'marsh' : null;
      else kind = open < 0.25 ? 'forest' : open < 0.37 ? 'hill' : null;
      if (!kind) continue;
      let bands = 0;
      for (let band = level; band <= FINEST; band++) {
        // A stamp is drawn about 0.8 of its band's spacing wide.
        const clearance = 0.5 + DECOR_SPACING[band]! * 0.36;
        if (index.clear(x, y, clearance, VISIBLE_TIERS[band]!)) bands |= 1 << band;
      }
      if (bands) decor.push({ kind, bands, variant: Math.floor(hash2(seed ^ 0x68e31da4, gx, gy) * 128), x, y });
    }
  }
  decor.push(...openSea(field, seed));
  return decor;
}

/** A few ships and one or two sea monsters, far out in open water: decoration that never links two kingdoms. */
function openSea(field: LandField, seed: number): Decor[] {
  const { bounds } = field;
  const step = 40;
  const candidates: { x: number; y: number; depth: number; h: number }[] = [];
  for (let y = bounds.minY + step; y < bounds.maxY - step; y += step) {
    for (let x = bounds.minX + step; x < bounds.maxX - step; x += step) {
      // Open water around the point, out to 260 units (a monster's half-width at world distance).
      let nearest = Infinity;
      for (let dy = -10; dy <= 10; dy++) {
        for (let dx = -10; dx <= 10; dx++) {
          const d = Math.hypot(dx, dy) * 26;
          if (d >= nearest || d > 260) continue;
          if (sampleField(field, x + dx * 26, y + dy * 26) > -2) nearest = d;
        }
      }
      if (nearest > 52) candidates.push({ x, y, depth: nearest, h: hash2(seed ^ 0x3c6ef372, x, y) });
    }
  }
  candidates.sort((a, b) => a.h - b.h);
  const chosen: Decor[] = [];
  const far = (x: number, y: number, min: number) => chosen.every((other) => Math.hypot(other.x - x, other.y - y) > min);
  // Stamps keep a steady screen size, so at world distance a monster spans ~400 units and a ship ~150; both are
  // anchored at their base. Keep them wholly inside the sheet's neatline.
  const inside = (x: number, y: number, side: number, above: number) =>
    x > bounds.minX + side && x < bounds.maxX - side && y > bounds.minY + above && y < bounds.maxY - 60;
  for (const c of candidates) {
    const monsters = chosen.filter((d) => d.kind === 'monster').length;
    if (monsters < 2 && c.depth > 240 && inside(c.x, c.y, 280, 380) && far(c.x, c.y, 420)) chosen.push({ kind: 'monster', bands: 0b11111, variant: monsters, x: c.x, y: c.y }); // never the same beast twice
    else if (chosen.length - monsters < 6 && c.depth > 90 && inside(c.x, c.y, 110, 130) && far(c.x, c.y, 260)) chosen.push({ kind: 'ship', bands: 0b11110, variant: Math.floor(c.h * 128 * 89) % 128, x: c.x, y: c.y });
    if (chosen.length >= 8) break;
  }
  return chosen;
}
