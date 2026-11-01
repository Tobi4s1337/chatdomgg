import { pointBounds, rectangleDistance, segmentProjection } from '../../../settlement/geometry';
import type { BoundsXZ, PublicSquare, XZ } from '../../../settlement/types';
import { closeMask, components, distanceField, fillHoles, MaskGrid, outlineLoops, signedArea } from './grid';
import type { WallSite } from './site';
import type { RingSpanKind } from './types';

/** Half-metre field: the land lattice, fine enough to thread a wall between a lot and the region's edge. */
const CELL = 0.5;
/** The footprint grows this far around every enclosed lot and square before it is closed. */
const MARGIN = 7.5;
/** Half the wall's footprint at its plinth. */
export const WALL_HALF = 1.25;
/** The ring's centre line keeps this far from every enclosed lot: the wall's inner face stands ≥ 4 m clear. */
export const RING_LOT_CLEAR = 5.5;
/** The ring's centre line keeps this far inside the region: the outer face stays > 2 m inside. */
export const RING_REGION_CLEAR = 3.5;
/** Wet ground keeps the ring this far off; the shore then closes the circuit. */
const WATER_CLEAR = 1.5;
/** Successive closing radii: concave where the town is lobed, widened only until every lot is one town. */
const CLOSING_RADII = [16, 24, 36, 54, 81, 120] as const;
/** A clash with a street corridor longer than this is the wall running along a street, not across it. */
const MAX_CROSSING = 30;
/** An installed street that leaves the town and returns within this many metres is taken inside. */
const MAX_LOOP = 320;
/** Shorter wall stubs between closures are left open. */
const MIN_WALL_RUN = 10;

export interface RingSpan { readonly kind: RingSpanKind; readonly points: XZ[] }
export interface RingPlan {
  /** Positive-area (interior on the left) closed outline; spans tile it in order, each sharing its end point. */
  readonly loop: readonly XZ[];
  readonly spans: readonly RingSpan[];
  /** True when the whole circuit is one wall with no castle, shore or opening in it. */
  readonly cyclic: boolean;
  readonly enclosedLots: ReadonlySet<string>;
  readonly enclosedSquares: ReadonlySet<string>;
  /** Clearance query: may the ring's centre line pass here? */
  readonly ringClear: (x: number, z: number, crossing: boolean) => boolean;
  readonly waterDistance: (x: number, z: number) => number;
}

const inside = (b: BoundsXZ, inset: number, box: BoundsXZ) =>
  box.minX - inset >= b.minX && box.maxX + inset <= b.maxX && box.minZ - inset >= b.minZ && box.maxZ + inset <= b.maxZ;

function dry(site: WallSite, box: BoundsXZ): boolean {
  for (let i = 0; i <= 2; i++) for (let j = 0; j <= 2; j++)
    if (site.water(box.minX + (box.maxX - box.minX) * i / 2, box.minZ + (box.maxZ - box.minZ) * j / 2) !== null) return false;
  return true;
}

/**
 * The circuit the wall follows: the town's footprint (every enclosable lot and square grown by a margin, joined to the
 * castle, closed so it stays concave where the town is lobed), clipped to the region, held off the water and any lot
 * left beyond, then traced and split into spans — wall, castle, shore, or open where no wall can lawfully stand.
 */
export function planRing(site: WallSite): RingPlan {
  const { plan, region } = site;
  const grid = MaskGrid.over(region, CELL);
  // A home is always inside. A reservation or court joins the town only if its whole margin fits the region and it is dry.
  const enclosedLots = new Set<string>();
  for (const entry of site.lots)
    if (entry.home || (inside(region, RING_LOT_CLEAR + RING_REGION_CLEAR, entry.lot) && dry(site, entry.lot))) enclosedLots.add(entry.id);
  const enclosedSquares = new Set<string>([plan.market.id]);
  for (const court of plan.courts) {
    const box = pointBounds(court.boundary);
    if (inside(region, RING_LOT_CLEAR + RING_REGION_CLEAR, box) && dry(site, box)) enclosedSquares.add(court.id);
  }
  const enclosedSquare = (square: PublicSquare) => enclosedSquares.has(square.id);
  const castleCourt = plan.castle.court.id;

  const seeds = new Uint8Array(grid.count), excluded = new Uint8Array(grid.count), castle = new Uint8Array(grid.count);
  const representatives: number[] = [];
  const stamp = (mask: Uint8Array, box: BoundsXZ) => grid.forRect(box, index => { mask[index] = 1; });
  for (const entry of site.lots) {
    if (enclosedLots.has(entry.id)) {
      stamp(seeds, entry.lot);
      const index = grid.at((entry.lot.minX + entry.lot.maxX) / 2, (entry.lot.minZ + entry.lot.maxZ) / 2);
      if (index >= 0) representatives.push(index);
    } else stamp(excluded, entry.lot);
  }
  for (const square of site.squares) {
    if (square.id === castleCourt) continue;
    const box = pointBounds(square.boundary);
    if (enclosedSquare(square)) {
      stamp(seeds, box);
      const index = grid.at((box.minX + box.maxX) / 2, (box.minZ + box.maxZ) / 2);
      if (index >= 0) representatives.push(index);
    } else stamp(excluded, box);
  }
  stamp(castle, site.castle);

  const wet = wetMask(site, grid);
  const corridor = corridorMask(site, grid, WALL_HALF + 0.25);
  const waterField = distanceField(wet, grid), excludedField = distanceField(excluded, grid), seedField = distanceField(seeds, grid);
  const allowed = new Uint8Array(grid.count);
  for (let j = 0; j < grid.h; j++) for (let i = 0; i < grid.w; i++) {
    const index = i + j * grid.w, x = grid.cx(i), z = grid.cz(j);
    allowed[index] = site.regionDistance(x, z) >= RING_REGION_CLEAR && waterField[index]! > WATER_CLEAR && excludedField[index]! > WALL_HALF + 1 ? 1 : 0;
  }
  const base = new Uint8Array(grid.count);
  for (let i = 0; i < grid.count; i++) base[i] = seedField[i]! <= MARGIN || castle[i] ? 1 : 0;

  const shape = (grown: Uint8Array, radius: number): Uint8Array | null => {
    const closed = closeMask(grown, grid, radius);
    for (let i = 0; i < grid.count; i++) closed[i] = closed[i]! & allowed[i]!;
    const { labels } = components(closed, grid);
    const main = labels[representatives[0] ?? -1];
    if (!main || representatives.some(index => labels[index] !== main)) return null;
    const town = new Uint8Array(grid.count);
    for (let i = 0; i < grid.count; i++) town[i] = labels[i] === main ? 1 : 0;
    fillHoles(town, grid);
    return town;
  };
  let radius: number = CLOSING_RADII[0], first: Uint8Array | null = null;
  for (const candidate of CLOSING_RADII) { radius = candidate; first = shape(base, candidate); if (first) break; }
  if (!first) throw new Error('The town cannot be walled as one circuit inside its region');
  const town0 = first;

  // Streets belong to the town where they run along its edge (inside it, or just outside within a corridor's reach):
  // the wall then passes beyond their verges instead of along them. A street leaving the town is taken only where it
  // is deep inside, so the wall still meets it square at a gate.
  const outside = new Uint8Array(grid.count);
  for (let i = 0; i < grid.count; i++) outside[i] = town0[i] ? 0 : 1;
  const depth = distanceField(outside, grid), away = distanceField(town0, grid), grown = base.slice();
  const signed = (x: number, z: number) => { const index = grid.at(x, z); return index < 0 ? -Infinity : town0[index] ? depth[index]! : -away[index]!; };
  for (const street of plan.streets) {
    const reach = street.width / 2 + street.verge + WALL_HALF + 1.25;
    for (let k = 1; k < street.points.length; k++) {
      const a = street.points[k - 1]!, b = street.points[k]!, length = Math.hypot(b[0] - a[0], b[2] - a[2]);
      if (length < 1e-6) continue;
      const dx = (b[0] - a[0]) / length, dz = (b[2] - a[2]) / length;
      for (let t = 0; t <= length; t += CELL) {
        const x = a[0] + dx * t, z = a[2] + dz * t, index = grid.at(x, z);
        if (index < 0 || castle[index]) continue;
        const d = signed(x, z);
        if (d < -reach) continue;
        const gx = signed(x + CELL, z) - signed(x - CELL, z), gz = signed(x, z + CELL) - signed(x, z - CELL);
        const g = Math.hypot(gx, gz), along = g > 1e-6 && Number.isFinite(g) ? Math.abs(dx * gx + dz * gz) / g : 0;
        if (along < 0.5 || d >= reach) grid.forRect({ minX: x - reach, maxX: x + reach, minZ: z - reach, maxZ: z + reach }, (cell, cx, cz) => {
          if ((cx - x) ** 2 + (cz - z) ** 2 <= reach * reach) grown[cell] = 1;
        });
      }
    }
  }
  // An installed street that leaves the town and comes back (a processional loop) is folded inside the walls, so the
  // wall never meets one road twice at a slant.
  const active = new Set(plan.activeStreetIds);
  for (const street of plan.streets) {
    if (!active.has(street.id) || street.kind === 'approach') continue;
    const reach = street.width / 2 + street.verge + WALL_HALF + 1.25, samples: { x: number; z: number; inside: boolean; s: number }[] = [];
    let s = 0;
    for (let k = 1; k < street.points.length; k++) {
      const a = street.points[k - 1]!, b = street.points[k]!, length = Math.hypot(b[0] - a[0], b[2] - a[2]);
      for (let t = 0; t < length; t += CELL) {
        const x = a[0] + (b[0] - a[0]) * t / length, z = a[2] + (b[2] - a[2]) * t / length, index = grid.at(x, z);
        samples.push({ x, z, inside: index >= 0 && town0[index] === 1, s: s + t });
      }
      s += length;
    }
    for (let i = 0; i < samples.length;) {
      if (samples[i]!.inside) { i++; continue; }
      let j = i;
      while (j < samples.length && !samples[j]!.inside) j++;
      if (i > 0 && j < samples.length && samples[j]!.s - samples[i]!.s <= MAX_LOOP) {
        for (let k = Math.max(0, i - 4); k < Math.min(samples.length, j + 4); k++) {
          const { x, z } = samples[k]!;
          grid.forRect({ minX: x - reach, maxX: x + reach, minZ: z - reach, maxZ: z + reach }, (cell, cx, cz) => {
            if ((cx - x) ** 2 + (cz - z) ** 2 <= reach * reach) grown[cell] = 1;
          });
        }
      }
      i = j;
    }
  }
  const town = shape(grown, radius) ?? town0;

  const loops = outlineLoops(town, grid);
  let loop = loops.reduce<XZ[]>((best, next) => Math.abs(signedArea(next)) > Math.abs(signedArea(best)) ? next : best, loops[0] ?? []);
  if (loop.length < 8) throw new Error('The town outline is degenerate');
  if (signedArea(loop) < 0) loop = [...loop].reverse();
  loop = resampleClosed(loop, 1);

  const waterDistance = (x: number, z: number) => grid.sample(waterField, x, z, Infinity);
  const anyLot = site.lotDistance.bind(site);
  const ringClear = (x: number, z: number, crossing: boolean): boolean => {
    if (site.regionDistance(x, z) < RING_REGION_CLEAR - 0.1) return false;
    if (waterDistance(x, z) <= WATER_CLEAR) return false;
    if (rectangleDistance(site.castle, x, z) < 1) return false;
    if (anyLot(x, z, lot => enclosedLots.has(lot.id)) < RING_LOT_CLEAR) return false;
    if (anyLot(x, z) < WALL_HALF + 0.75) return false;
    if (site.squareDistance(x, z, square => square.id !== castleCourt && enclosedSquare(square)) < RING_LOT_CLEAR) return false;
    if (site.squareDistance(x, z) < WALL_HALF + 0.75) return false;
    if (crossing) return true;
    const cell = grid.at(x, z);
    return cell < 0 || !corridor[cell];
  };

  // Classify the traced outline point by point, then gather runs.
  const kinds: RawKind[] = loop.map(([x, z]) => {
    if (rectangleDistance(site.castle, x, z) <= 1.25) return 'castle';
    if (waterDistance(x, z) <= WATER_CLEAR + 1) return 'water';
    if (anyLot(x, z) < WALL_HALF + 0.75 || site.squareDistance(x, z) < WALL_HALF + 0.75) return 'open';
    const cell = grid.at(x, z);
    return cell >= 0 && corridor[cell] ? 'street' : 'wall';
  });
  // Outline points are a metre apart, so a run's step count is its length in metres.
  let runs = merge(gather(kinds).map(run => run.kind === 'street' ? { ...run, kind: run.length <= MAX_CROSSING ? 'wall' : 'open' } : run));
  if (runs.length > 1) {
    runs = runs.map(run => run.kind === 'wall' && run.length < MIN_WALL_RUN ? { ...run, kind: 'open' } : run);
    runs = merge(runs);
  }
  const cyclic = runs.length === 1 && runs[0]!.kind === 'wall';
  // Rotate so the loop starts where a span starts (or at the sharpest corner of an unbroken wall, where a tower will stand).
  const start = cyclic ? sharpestCorner(loop) : runs[0]!.start;
  loop = [...loop.slice(start), ...loop.slice(0, start)];
  const n = loop.length;
  const spans: RingSpan[] = [];
  if (cyclic) spans.push({ kind: 'wall', points: [...loop, loop[0]!] });
  else for (const run of runs) {
    const from = (run.start - start + n) % n, points: XZ[] = [];
    for (let k = 0; k <= run.length; k++) points.push(loop[(from + k) % n]!);
    spans.push({ kind: run.kind === 'street' ? 'wall' : run.kind, points });
  }
  // Smooth each wall span within the clearances; its ends stay where the castle, shore or opening meets it.
  for (const span of spans) if (span.kind === 'wall') {
    const smoothed = smoothSpan(span.points, ringClear, cyclic);
    span.points.splice(0, span.points.length, ...smoothed);
  } else {
    const simple = simplify(span.points, 0.4);
    span.points.splice(0, span.points.length, ...simple);
  }
  const ring: XZ[] = [];
  for (const span of spans) ring.push(...span.points.slice(0, -1));
  return { loop: ring, spans, cyclic, enclosedLots, enclosedSquares, ringClear, waterDistance };
}

type RawKind = RingSpanKind | 'street';
interface Run { kind: RawKind; start: number; length: number }

/**
 * Wet cells. The sampler is read on a two-metre lattice first; cells are read one by one only near a wet sample, or
 * where neighbouring samples disagree, so a broad lake costs its shore rather than its area.
 */
function wetMask(site: WallSite, grid: MaskGrid): Uint8Array {
  const wet = new Uint8Array(grid.count), stride = 4, cw = Math.ceil(grid.w / stride) + 1, ch = Math.ceil(grid.h / stride) + 1;
  const coarse = new Uint8Array(cw * ch);
  for (let b = 0; b < ch; b++) for (let a = 0; a < cw; a++) {
    const i = Math.min(grid.w - 1, a * stride), j = Math.min(grid.h - 1, b * stride);
    coarse[a + b * cw] = site.water(grid.cx(i), grid.cz(j)) !== null ? 1 : 0;
  }
  for (let b = 0; b < ch - 1; b++) for (let a = 0; a < cw - 1; a++) {
    let near = false;
    for (let db = -1; db <= 2 && !near; db++) for (let da = -1; da <= 2; da++) {
      const aa = a + da, bb = b + db;
      if (aa >= 0 && bb >= 0 && aa < cw && bb < ch && coarse[aa + bb * cw]) { near = true; break; }
    }
    if (!near) continue;
    for (let j = b * stride; j < Math.min(grid.h, (b + 1) * stride); j++) for (let i = a * stride; i < Math.min(grid.w, (a + 1) * stride); i++)
      if (site.water(grid.cx(i), grid.cz(j)) !== null) wet[i + j * grid.w] = 1;
  }
  return wet;
}

/** Cells within `pad` of any street's clear corridor. */
function corridorMask(site: WallSite, grid: MaskGrid, pad: number): Uint8Array {
  const mask = new Uint8Array(grid.count);
  for (const street of site.streets) {
    const reach = street.width / 2 + street.verge + pad;
    for (let k = 1; k < street.points.length; k++) {
      const a = street.points[k - 1]!, b = street.points[k]!;
      grid.forRect({ minX: Math.min(a[0], b[0]) - reach, maxX: Math.max(a[0], b[0]) + reach, minZ: Math.min(a[2], b[2]) - reach, maxZ: Math.max(a[2], b[2]) + reach }, (cell, x, z) => {
        if (!mask[cell] && segmentProjection([a[0], a[2]], [b[0], b[2]], x, z).distance < reach) mask[cell] = 1;
      });
    }
  }
  return mask;
}

/** Runs of equal kind around a closed sequence; `length` counts steps from the run's first point to the next run's. */
function gather(kinds: readonly RawKind[]): Run[] {
  const n = kinds.length;
  let first = 0;
  while (first < n && kinds[first] === kinds[(first - 1 + n) % n]) first++;
  if (first === n) return [{ kind: kinds[0]!, start: 0, length: n }];
  const runs: Run[] = [];
  for (let k = 0; k < n;) {
    const at = (first + k) % n, kind = kinds[at]!;
    let length = 0;
    while (k < n && kinds[(first + k) % n] === kind) { k++; length++; }
    runs.push({ kind, start: at, length });
  }
  return runs;
}

function merge(runs: Run[]): Run[] {
  if (runs.length < 2) return runs;
  const out: Run[] = [];
  for (const run of runs) {
    const last = out.at(-1);
    if (last && last.kind === run.kind) last.length += run.length; else out.push({ ...run });
  }
  if (out.length > 1 && out[0]!.kind === out.at(-1)!.kind) { const tail = out.pop()!; out[0] = { kind: tail.kind, start: tail.start, length: tail.length + out[0]!.length }; }
  return out;
}

function sharpestCorner(loop: readonly XZ[]): number {
  const n = loop.length, reach = Math.min(8, Math.floor(n / 4));
  let best = 0, bestTurn = -1;
  for (let i = 0; i < n; i++) {
    const a = loop[(i - reach + n) % n]!, b = loop[i]!, c = loop[(i + reach) % n]!;
    const turn = Math.abs(angleBetween([b[0] - a[0], b[1] - a[1]], [c[0] - b[0], c[1] - b[1]]));
    if (turn > bestTurn + 1e-9) { bestTurn = turn; best = i; }
  }
  return best;
}

export function angleBetween(a: XZ, b: XZ): number {
  return Math.atan2(a[0] * b[1] - a[1] * b[0], a[0] * b[0] + a[1] * b[1]);
}

/** Even arc-length spacing around a closed loop (the result does not repeat its first point). */
export function resampleClosed(loop: readonly XZ[], spacing: number): XZ[] {
  const closed = [...loop, loop[0]!], open = resample(closed, spacing);
  open.pop();
  return open;
}

/** Even arc-length spacing along a polyline, keeping both ends. */
export function resample(points: readonly XZ[], spacing: number): XZ[] {
  const lengths = [0];
  for (let i = 1; i < points.length; i++) lengths.push(lengths[i - 1]! + Math.hypot(points[i]![0] - points[i - 1]![0], points[i]![1] - points[i - 1]![1]));
  const total = lengths.at(-1)!, count = Math.max(1, Math.round(total / spacing)), out: XZ[] = [];
  let k = 1;
  for (let i = 0; i <= count; i++) {
    const s = total * i / count;
    while (k < points.length - 1 && lengths[k]! < s) k++;
    const a = points[k - 1]!, b = points[k]!, span = lengths[k]! - lengths[k - 1]!, t = span > 1e-9 ? (s - lengths[k - 1]!) / span : 0;
    out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
  }
  out[0] = points[0]!; out[out.length - 1] = points.at(-1)!;
  return out;
}

/** Douglas–Peucker with fixed ends. */
export function simplify(points: readonly XZ[], tolerance: number): XZ[] {
  if (points.length <= 2) return [...points];
  const keep = new Uint8Array(points.length); keep[0] = 1; keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop()!, a = points[i]!, b = points[j]!;
    let worst = -1, far = 0;
    for (let k = i + 1; k < j; k++) {
      const p = points[k]!, dx = b[0] - a[0], dz = b[1] - a[1], length = Math.hypot(dx, dz);
      const d = length > 1e-9 ? Math.abs((p[0] - a[0]) * dz - (p[1] - a[1]) * dx) / length : Math.hypot(p[0] - a[0], p[1] - a[1]);
      if (d > far) { far = d; worst = k; }
    }
    if (worst >= 0 && far > tolerance) { keep[worst] = 1; stack.push([i, worst], [worst, j]); }
  }
  return points.filter((_, k) => keep[k]);
}

/**
 * Taubin smoothing (shrink, then re-inflate) at two-metre spacing. A point only moves where the ring may stand, and a
 * point that was not on a street crossing may not drift onto one. Ends are fixed unless the span is the whole circuit.
 */
function smoothSpan(points: readonly XZ[], clear: (x: number, z: number, crossing: boolean) => boolean, cyclic: boolean): XZ[] {
  const source = resample(points, 2);
  // A cyclic span repeats its first point at the end; smooth the unique points around the circle.
  const p = (cyclic ? source.slice(0, -1) : source).map(q => [q[0], q[1]] as XZ);
  const n = p.length;
  if (n < 4) return source;
  const crossing = p.map(q => !clear(q[0], q[1], false) && clear(q[0], q[1], true));
  const step = (factor: number) => {
    const next = p.slice();
    for (let i = cyclic ? 0 : 1; i < (cyclic ? n : n - 1); i++) {
      const a = p[(i - 1 + n) % n]!, b = p[i]!, c = p[(i + 1) % n]!;
      const x = b[0] + factor * ((a[0] + c[0]) / 2 - b[0]), z = b[1] + factor * ((a[1] + c[1]) / 2 - b[1]);
      if (clear(x, z, crossing[i]!)) next[i] = [x, z];
    }
    for (let i = 0; i < n; i++) p[i] = next[i]!;
  };
  for (let iteration = 0; iteration < 48; iteration++) { step(0.5); step(-0.53); }
  const smoothed = cyclic ? [...p, p[0]!] : p;
  const out = resample(smoothed, 2);
  // Resampling cuts chords; keep a cut only where it is still clear.
  return out.map((q, i) => (i === 0 || i === out.length - 1 || clear(q[0], q[1], true)) ? q : nearest(smoothed, q));
}

function nearest(points: readonly XZ[], q: XZ): XZ {
  let best = points[0]!, d = Infinity;
  for (const p of points) { const e = (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2; if (e < d) { d = e; best = p; } }
  return best;
}
