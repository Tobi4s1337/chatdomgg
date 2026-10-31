import type { Vec3 } from '@chatdom/shared';
import { Boxes } from '../../../civic/kit';
import { MAT, type StyleKey } from '../../../materials';
import { NO_METADATA, type SeatEdge, type WalkStrip, type WaterPiece } from '../place-piece';
import {
  cells, checkStyle, checkVariant, checkWater, disc, discRow, groundFooting, hash, rockTones, shoreBlueprint,
  type Disc, type Region,
} from './shape';

type Axis = 'x' | 'z';
type Read = ReturnType<typeof cells>;

/**
 * Shore stones: the pebble shoal under the shallows, the flat fishing rock and the run of stepping stones that
 * leads out to it. Every piece stands on y = 0, where the host sets it on the bed; the water pieces take the
 * depth of water over that bed in cells, so the surface lies on the plane y = water.
 */

/** A one-cell blade that curves out as it rises, bridging each sideways step so it stays face-connected. */
function blade(b: Boxes, x: number, z: number, axis: Axis, lean: number, height: number, paint: (y: number) => number): void {
  const at = (a0: number, a1: number, y0: number, y1: number, m: number) =>
    axis === 'x' ? b.add(x + a0, y0, z, x + a1, y1, z + 1, m) : b.add(x, y0, z + a0, x + 1, y1, z + a1, m);
  let previous = 0, run: { a0: number; a1: number; y0: number; m: number } | undefined, y = 0;
  const flush = () => { if (run) at(run.a0, run.a1, run.y0, y, run.m); };
  for (; y < height; y++) {
    const o = Math.round(lean * ((y + 0.5) / height) ** 2);
    const a0 = Math.min(previous, o), a1 = Math.max(previous, o) + 1, m = paint(y);
    if (!run || run.a0 !== a0 || run.a1 !== a1 || run.m !== m) { flush(); run = { a0, a1, y0: y, m }; }
    previous = o;
  }
  flush();
}

/** The cells of a disc's plan, row by row. */
function footprint(d: Disc): { z: number; x: readonly [number, number] }[] {
  const rows: { z: number; x: readonly [number, number] }[] = [];
  for (let z = Math.floor(d.cz - d.rz); z < Math.ceil(d.cz + d.rz); z++) {
    const row = discRow(d, z);
    if (row) rows.push({ z, x: row });
  }
  return rows;
}

/** An authored layout that strays outside its blueprint is a bug, not something to clip quietly. */
function inside(b: Boxes, size: Vec3, form: string): void {
  for (const box of b.list) for (let a = 0; a < 3; a++) {
    if (box.from[a]! < 0 || box.to[a]! > size[a]!) throw new Error(`${form}: box ${JSON.stringify(box)} leaves ${size.join('×')}.`);
  }
}

const range = ([a, c]: readonly [number, number]): number[] => Array.from({ length: c - a }, (_, i) => a + i);

const scaled = (d: Disc, f: number, shift: readonly [number, number] = [0, 0]): Disc =>
  ({ cx: d.cx + shift[0], cz: d.cz + shift[1], rx: d.rx * f, rz: d.rz * f, ...(d.power === undefined ? {} : { power: d.power }) });

// ─── Pebble shoal ────────────────────────────────────────────────────────────────────────────────────────────

type Grade = 'big' | 'medium' | 'small' | 'stray';

interface ShoalLayout {
  readonly size: Vec3;
  /** The drift runs from its dense head to its thin tail; stones crowd the head and string out along the tail. */
  readonly head: readonly [number, number];
  readonly tail: readonly [number, number];
  /** Half-width of the drift at its head, in cells; it narrows to half of that at the tail. */
  readonly spread: number;
  readonly counts: Readonly<Record<Grade, number>>;
  /** Waterweed roots, kept clear of stones. */
  readonly weeds: readonly (readonly [x: number, z: number])[];
}

/**
 * 0 is a broad fan that thins to a short tail; 1 a long narrow spit of small stones with two weed tufts; 2 a
 * bar led by four big stones with fewer, scattered small ones. 2–3 m across; no stone stands over three cells.
 */
const SHOAL_LAYOUTS: readonly ShoalLayout[] = [
  { size: [22, 4, 18], head: [7, 7], tail: [18, 13], spread: 5.5, counts: { big: 3, medium: 7, small: 28, stray: 4 }, weeds: [[11, 12]] },
  { size: [17, 4, 24], head: [9, 18], tail: [7, 4], spread: 4, counts: { big: 2, medium: 8, small: 28, stray: 5 }, weeds: [[4, 16], [12, 10]] },
  { size: [24, 4, 17], head: [19, 9], tail: [4, 8], spread: 5, counts: { big: 4, medium: 6, small: 20, stray: 3 }, weeds: [[10, 4]] },
];

/** The pebble tones a kit's shore throws up, with weights. Big stones take only the first two. */
const PEBBLE_TONES: Readonly<Record<StyleKey, readonly (readonly [material: number, weight: number])[]>> = {
  hearth: [[MAT.limestone, 0.4], [MAT.darkStone, 0.25], [MAT.cream, 0.2], [MAT.earth, 0.15]],
  tide: [[MAT.stone, 0.45], [MAT.darkStone, 0.3], [MAT.cream, 0.15], [MAT.earth, 0.1]],
  grove: [[MAT.darkStone, 0.5], [MAT.earth, 0.2], [MAT.cream, 0.15], [MAT.moss, 0.15]],
};

const GRADES: Readonly<Record<Grade, { readonly r: readonly [number, number]; readonly courses: readonly number[]; readonly gap: number }>> = {
  // Each course's plan as a fraction of the stone's own, from the bed up: a dome, a cushion, a single cell.
  big: { r: [1.7, 2.3], courses: [1, 0.78, 0.48], gap: 1 },
  medium: { r: [1.15, 1.65], courses: [1, 0.6], gap: 0 },
  small: { r: [0.55, 1.15], courses: [1], gap: 0 },
  stray: { r: [0.55, 0.95], courses: [1], gap: 1 },
};

function pickTone(style: StyleKey, roll: number, grade: Grade): number {
  const tones = grade === 'big' ? PEBBLE_TONES[style].slice(0, 2) : PEBBLE_TONES[style];
  const total = tones.reduce((s, [, w]) => s + w, 0);
  let t = roll * total;
  for (const [m, w] of tones) { if (t < w) return m; t -= w; }
  return tones[tones.length - 1]![0];
}

/**
 * A pebble shoal lying on the bed under clear shallows, which the noon water reveals in turquoise: big domed
 * stones at the head of the drift, cushions and single pebbles crowding round them and stringing out along its
 * tail, a few strays beyond. Stones come in the kit's stone, dark stone and pale or earthy flecks; patches of
 * earth lie between them and a tuft or two of waterweed rises among them. Nothing stands more than four cells
 * (0.5 m) above the bed, so the host sets it in water at least that deep.
 */
export function createPebbles(style: StyleKey, variant: number): WaterPiece {
  checkStyle('pebbles', style);
  checkVariant('pebbles', variant);
  const layout = SHOAL_LAYOUTS[variant]!, size = layout.size, [W, , D] = size, b = new Boxes();
  const key = (x: number, z: number) => x + W * z;
  const taken = new Set<number>();
  const [hx, hz] = layout.head, [tx, tz] = layout.tail;
  const len = Math.hypot(tx - hx, tz - hz), px = -(tz - hz) / len, pz = (tx - hx) / len;
  const along = (t: number, u: number) => [hx + (tx - hx) * t + px * u, hz + (tz - hz) * t + pz * u] as const;

  // Earth settles in the lee of the head, in faceted patches the stones then sit in.
  for (let p = 0; p < 3; p++) {
    const [cx, cz] = along(0.12 + 0.22 * p + 0.1 * hash(variant, p, 40), (hash(variant, p, 41) - 0.5) * layout.spread);
    const r = 1.5 + 1.1 * hash(variant, p, 42);
    disc(b, size, { cx, cz, rx: r * 1.2, rz: r * 0.85, power: 1.6 }, 0, 1, MAT.earth);
  }
  // Weed roots keep clear water round the whole tuft, so no blade grows through a stone.
  for (const [x, z] of layout.weeds) for (let u = -1; u <= 2; u++) for (let v = -1; v <= 1; v++) taken.add(key(x + u, z + v));

  const grades: readonly Grade[] = ['big', 'medium', 'small', 'stray'];
  grades.forEach((grade, g) => {
    const spec = GRADES[grade];
    let placed = 0;
    for (let k = 0; placed < layout.counts[grade] && k < layout.counts[grade] * 80; k++) {
      const h = (n: number) => hash(variant, g, k, n);
      // Density falls along the drift: big stones hold the head, strays lie past the tail and wide of it.
      // Big stones are spaced down the head in turn, alternating sides, so they lead the drift as a loose bar.
      const slot = (placed + 0.25 + 0.5 * h(1)) / layout.counts[grade];
      const t = grade === 'stray' ? 0.75 + 0.4 * h(1) : grade === 'big' ? 0.85 * slot : grade === 'medium' ? 0.8 * h(1) ** 1.2 : h(1) ** 1.15;
      const u = grade === 'big' ? ((placed + k) % 2 ? 1 : -1) * (0.3 + 0.4 * h(2)) * layout.spread
        : (2 * h(2) - 1) * layout.spread * (grade === 'stray' ? 1.5 : 1 - 0.5 * Math.min(1, t));
      const [cx, cz] = along(t, u);
      const r = spec.r[0] + (spec.r[1] - spec.r[0]) * h(3), e = 0.8 + 0.45 * h(4);
      const stone: Disc = { cx, cz, rx: r * e, rz: r / e, power: 1.8 + 0.7 * h(5) };
      const rows = footprint(stone);
      if (!rows.length || rows.some(row => row.z < 0 || row.z >= D || row.x[0] < 0 || row.x[1] > W)) continue;
      let clear = true;
      for (const row of rows) for (let x = row.x[0]; x < row.x[1] && clear; x++) {
        for (let u2 = -spec.gap; u2 <= spec.gap && clear; u2++) for (let v = -spec.gap; v <= spec.gap; v++) {
          if (taken.has(key(x + u2, row.z + v))) { clear = false; break; }
        }
      }
      if (!clear) continue;
      for (const row of rows) for (let x = row.x[0]; x < row.x[1]; x++) taken.add(key(x, row.z));
      const tone = pickTone(style, h(6), grade);
      spec.courses.forEach((f, y) => disc(b, size, scaled(stone, f), y, y + 1, tone));
      if (grade === 'big') {
        // A fleck on the shoulder: a pale vein or an earthy stain, so a big stone reads as a stone, not a lump.
        const crown = new Set(footprint(scaled(stone, spec.courses[2]!)).flatMap(row => range(row.x).map(x => key(x, row.z))));
        const shoulder = footprint(scaled(stone, spec.courses[1]!)).flatMap(row => range(row.x).map(x => [x, row.z] as const))
          .filter(([x, z]) => !crown.has(key(x, z)));
        const fleck = shoulder[Math.floor(h(8) * shoulder.length)];
        if (fleck) b.add(fleck[0], 1, fleck[1], fleck[0] + 1, 2, fleck[1] + 1, h(7) < 0.5 ? MAT.cream : MAT.earth);
      }
      placed++;
    }
    // Placement is seeded, so a shortfall is an authoring bug in the layout, never something to hide.
    if (placed < layout.counts[grade]) throw new Error(`pebbles ${variant}: only ${placed} of ${layout.counts[grade]} ${grade} stones fit.`);
  });

  layout.weeds.forEach(([x, z], w) => {
    // A moss root and three waving blades of waterweed, the tallest four cells with a mossy tip.
    b.add(x, 0, z, x + 2, 1, z + 1, MAT.moss);
    const lean = hash(variant, w, 50) < 0.5 ? -1 : 1;
    blade(b, x, z, 'x', -1.6 * lean, 4, y => y >= 3 ? MAT.moss : MAT.leaf);
    blade(b, x + 1, z, 'z', 1.4 * lean, 3, () => MAT.leaf);
    blade(b, x + 1, z, 'x', 1.2 * lean, 3, () => MAT.leaf);
  });
  inside(b, size, 'pebbles');
  const blueprint = shoreBlueprint(`water-${style}-pebbles-${variant}`, style, 'prop', size, b);
  return { ...NO_METADATA, blueprint, footings: [{ id: 'bed', box: groundFooting(cells(blueprint.boxes, size), size) }] };
}

// ─── Fishing rock ────────────────────────────────────────────────────────────────────────────────────────────

/** A smaller boulder leaning on the rock: its plan, how far its crown clears the surface and its lean per course. */
interface Companion { readonly disc: Disc; readonly above: number; readonly lean: readonly [number, number] }
type Side = 'west' | 'east' | 'north';

interface RockLayout {
  readonly size: readonly [x: number, z: number];
  /** The boulder's plan at the bed; its beds step in as they rise. */
  readonly body: Disc;
  /** The top slab's plan: shifted towards the water (+Z), so its lip overhangs there and steps back to the shore. */
  readonly slab: Disc;
  /** Walking height of the top above the surface, in cells. */
  readonly rise: 3 | 4;
  /** Thickness of each bed from the bottom, cycled. */
  readonly beds: readonly number[];
  /** Where the top drops one course, with a one-cell jog halfway along the step so it is never a ruled line. */
  readonly tilt?: { readonly axis: Axis; readonly at: number; readonly jog: number };
  readonly shade: Side;
  readonly companions: readonly Companion[];
  /** Start of the moss-filled crack across the top, and the side it wanders towards. */
  readonly crack: { readonly x: number; readonly z: number; readonly axis: Axis; readonly length: number };
}

/**
 * 0 is a broad slab tipped one course towards the water, a single companion propped on its shaded flank; 1 a
 * level table rock three cells proud with two companions; 2 a longer rock, tipped one course sideways, with its
 * moss on the shore side and a companion leaning at its shoreward corner.
 */
const ROCK_LAYOUTS: readonly RockLayout[] = [
  {
    size: [30, 28], body: { cx: 15.5, cz: 13, rx: 11.5, rz: 10.5, power: 2.6 }, slab: { cx: 15.5, cz: 15, rx: 10, rz: 9.5, power: 3 },
    rise: 4, beds: [3, 4, 3], tilt: { axis: 'z', at: 19, jog: 1 }, shade: 'west',
    companions: [{ disc: { cx: 4.5, cz: 8, rx: 4, rz: 3.5, power: 2.2 }, above: 2, lean: [0.35, 0] }],
    crack: { x: 13, z: 9, axis: 'x', length: 7 },
  },
  {
    size: [32, 26], body: { cx: 16, cz: 12, rx: 12.5, rz: 9.5, power: 3.2 }, slab: { cx: 16, cz: 13.5, rx: 11.5, rz: 8.5, power: 3.4 },
    rise: 3, beds: [4, 3], shade: 'east',
    companions: [
      { disc: { cx: 27, cz: 5.5, rx: 3.5, rz: 4, power: 2.2 }, above: 2, lean: [-0.35, 0.15] },
      { disc: { cx: 4, cz: 4.5, rx: 3, rz: 2.5, power: 2 }, above: 1, lean: [0.3, 0.2] },
    ],
    crack: { x: 10, z: 8, axis: 'z', length: 8 },
  },
  {
    size: [26, 32], body: { cx: 13, cz: 16, rx: 9.5, rz: 12.5, power: 2.4 }, slab: { cx: 13, cz: 17.5, rx: 8.5, rz: 11.5, power: 2.9 },
    rise: 4, beds: [3, 3, 4], tilt: { axis: 'x', at: 16, jog: -1 }, shade: 'north',
    companions: [{ disc: { cx: 5, cz: 5, rx: 3.5, rz: 3.5, power: 2.1 }, above: 2, lean: [0.3, 0.3] }],
    crack: { x: 8, z: 20, axis: 'x', length: 6 },
  },
];

/** Walking height of a fishing rock's highest top, in cells above its bed. */
export function fishingRockTop(variant: number, water: number): number {
  checkVariant('fishing rock', variant);
  checkWater('fishing rock', water);
  return water + ROCK_LAYOUTS[variant]!.rise;
}

function shadeRegion(side: Side, d: Disc, f: number, jitter: number): Region {
  if (side === 'west') return { x: [0, Math.round(d.cx - f * d.rx + jitter)] };
  if (side === 'east') return { x: [Math.round(d.cx + f * d.rx + jitter), 256] };
  return { z: [0, Math.round(d.cz - f * d.rz + jitter)] };
}

/**
 * The flat fishing rock the stepping stones lead to: a broad boulder rising from the bed in rounded beds that
 * step in as they rise, their joints showing as recessed bedding lines, to a top slab whose lip overhangs the
 * water (+Z) and steps back towards the shore. The slab stands three or four cells above the surface, tipped
 * one course at most, with a moss-filled crack across it and a cleft in its rim. It is darkened wet to a cell
 * above the waterline, mossed on its shaded side, and one or two smaller boulders lean against it.
 * The top is a genuine standing place (the walk) and its water-facing rim a sitting edge with the legs hanging
 * clear down to the water (the seat); both are read off the finished cells.
 */
export function createFishingRock(style: StyleKey, variant: number, water: number): WaterPiece {
  checkStyle('fishing rock', style);
  checkVariant('fishing rock', variant);
  checkWater('fishing rock', water);
  const layout = ROCK_LAYOUTS[variant]!, tones = rockTones(style), b = new Boxes();
  const H = water + layout.rise, bodyTop = H - 2;
  const size: Vec3 = [layout.size[0], H, layout.size[1]], [W, , D] = size;
  const wetTop = water + 1;
  // The wet band reaches a cell above the surface on the water side and flanks; the shoreward lee stays dry.
  const lee: Region = { z: [0, Math.round(layout.body.cz - 0.35 * layout.body.rz)] };
  const wetSide: Region = { z: [lee.z![1], D] };
  const paint = (d: Disc, y0: number, y1: number, dry: number) => {
    disc(b, size, d, y0, y1, dry);
    disc(b, size, d, y0, Math.min(y1, water), tones.wet);
    disc(b, size, d, Math.max(y0, water), Math.min(y1, wetTop), tones.wet, wetSide);
  };

  // The companions go down first, so the rock's own beds read in front where the two meet.
  layout.companions.forEach((c, n) => {
    const height = Math.max(2, Math.min(bodyTop, water + c.above));
    for (let y = 0; y < height; y += 2) {
      const y1 = Math.min(height, y + 2), f = 1 - 0.28 * (y / height) ** 1.5;
      const d = scaled(c.disc, f, [c.lean[0] * Math.min(y, 6), c.lean[1] * Math.min(y, 6)]);
      paint(d, y, y1, y1 === height ? tones.top : tones.side);
      // A cap of moss on its shaded side, where the rock above keeps the sun off.
      if (y1 > wetTop) disc(b, size, d, Math.max(y, wetTop), y1, MAT.moss, shadeRegion(layout.shade, d, 0.25, hash(variant, n, 60)));
    }
  });

  // The beds from the bed up to the slab, stepping in as they rise.
  const beds: { y0: number; y1: number; d: Disc }[] = [];
  for (let y = 0, s = 0; y < bodyTop; s++) {
    let y1 = Math.min(bodyTop, y + layout.beds[s % layout.beds.length]!);
    if (bodyTop - y1 < 2) y1 = bodyTop;
    const f = 1 - 0.13 * ((y + y1) / 2 / Math.max(1, bodyTop)) + (hash(variant, s, 1) - 0.5) * 0.05;
    beds.push({ y0: y, y1, d: scaled(layout.body, f, [(hash(variant, s, 2) - 0.5) * 1.4, (hash(variant, s, 3) - 0.5) * 0.8]) });
    y = y1;
  }
  beds.forEach(({ y0, y1, d }, s) => {
    paint(d, y0, y1, tones.side);
    if (y0 > 0) {
      // The bedding joint: a recessed course round part of the stone, its back in the band (wet under water).
      const span = 0.35 + 0.3 * hash(variant, s, 4), from = hash(variant, s, 5);
      const keep: Region = hash(variant, s, 6) < 0.5
        ? { x: [Math.round(d.cx - d.rx + 2 * d.rx * from * (1 - span)), Math.round(d.cx - d.rx + 2 * d.rx * (from * (1 - span) + span))] }
        : { z: [Math.round(d.cz - d.rz + 2 * d.rz * from * (1 - span)), Math.round(d.cz - d.rz + 2 * d.rz * (from * (1 - span) + span))] };
      disc(b, size, d, y0, y0 + 1, MAT.air, keep);
      disc(b, size, scaled(d, 1 - 1.2 / Math.min(d.rx, d.rz)), y0, y0 + 1, y0 < wetTop ? tones.wet : tones.band, keep);
    }
    if (y1 > wetTop) disc(b, size, d, Math.max(y0, wetTop), y1, MAT.moss, shadeRegion(layout.shade, d, 0.5, (hash(variant, s, 7) - 0.5) * 3));
  });

  // The slab: a course of bedding round its foot on the dry sides, its top course dry stone.
  const slab = layout.slab;
  paint(slab, bodyTop, H - 1, tones.side);
  disc(b, size, slab, bodyTop, H - 1, tones.band, lee);
  disc(b, size, scaled(slab, 1 - 1.6 / Math.min(slab.rx, slab.rz)), bodyTop, H - 1, tones.side, lee);
  disc(b, size, slab, H - 1, H, tones.top);
  if (layout.tilt) {
    const { axis, at, jog } = layout.tilt, mid = Math.round(axis === 'z' ? slab.cx : slab.cz);
    const [nearA, farA] = axis === 'z' ? [[0, mid], [mid, W]] as const : [[0, mid], [mid, D]] as const;
    const step = (cut: number, span: readonly [number, number]): Region => axis === 'z'
      ? { z: [cut, D], x: [span[0], span[1]] } : { x: [cut, W], z: [span[0], span[1]] };
    disc(b, size, slab, H - 1, H, MAT.air, step(at, nearA));
    disc(b, size, slab, H - 1, H, MAT.air, step(at + jog, farA));
  }
  // Moss creeps over the shaded shoulder of the slab.
  disc(b, size, slab, bodyTop, H, MAT.moss, shadeRegion(layout.shade, slab, 0.8, 0));
  disc(b, size, slab, bodyTop, H - 1, MAT.moss, shadeRegion(layout.shade, slab, 0.6, 0.5));

  // A cleft splits the slab's sunny rim, mossed at its foot.
  {
    const row = Math.round(layout.shade === 'north' ? slab.cz + slab.rz * 0.2 : slab.cz - slab.rz * 0.15);
    const extent = discRow(slab, row);
    if (extent) {
      const sunnyEast = layout.shade !== 'east';
      const x = sunnyEast ? extent[1] - 1 : extent[0], back = sunnyEast ? x - 1 : x + 1;
      b.add(x, bodyTop, row, x + 1, H, row + 1, MAT.air);
      b.add(back, H - 1, row, back + 1, H, row + 1, MAT.air);
      b.add(back, H - 2, row, back + 1, H - 1, row + 1, MAT.moss);
    }
  }
  // A moss-filled crack wandering across the top, flush with it so the standing place stays flat.
  {
    const read = cells(b.list, size);
    let { x, z } = layout.crack;
    for (let i = 0; i < layout.crack.length; i++) {
      const y = read.top(x, z) - 1;
      if (y >= H - 2) b.add(x, y, z, x + 1, y + 1, z + 1, MAT.moss);
      const r = hash(variant, i, 70), drift = r < 0.3 ? -1 : r > 0.72 ? 1 : 0;
      if (layout.crack.axis === 'x') { x++; z += drift; } else { z++; x += drift; }
    }
  }

  inside(b, size, 'fishing rock');
  const blueprint = shoreBlueprint(`water-${style}-fishing-rock-${variant}-${water}`, style, 'prop', size, b);
  const read = cells(blueprint.boxes, size);
  const walk = standingStrip(read, size, h => h >= water + 3 && h <= H, 'top');
  if (!walk) throw new Error(`fishing rock ${variant}: no standing place on the top.`);
  const seat = rimSeat(read, size, water, H);
  if (!seat) throw new Error(`fishing rock ${variant}: no sitting edge over the water.`);
  return {
    ...NO_METADATA, blueprint, footings: [{ id: 'bed', box: groundFooting(read, size) }], walks: [walk], seats: [seat],
  };
}

/**
 * The largest rectangle of columns, walked along Z, where every row across it stands at one admitted height and
 * neighbouring rows differ by at most a cell: the honest standing place, read off the real cells.
 */
function standingStrip(read: Read, size: Vec3, admit: (h: number) => boolean, id: string, region: Region = {}): WalkStrip | undefined {
  const [rx0, rx1] = region.x ?? [0, size[0]], [rz0, rz1] = region.z ?? [0, size[2]];
  let best: WalkStrip | undefined, area = 0;
  for (let x0 = rx0; x0 < rx1; x0++) for (let x1 = x0 + 2; x1 <= rx1; x1++) {
    const level = (z: number): number => {
      const h = read.top(x0, z);
      if (!admit(h)) return -1;
      for (let x = x0 + 1; x < x1; x++) if (read.top(x, z) !== h) return -1;
      return h;
    };
    let start = -1, tops: number[] = [];
    const close = (end: number) => {
      const a = (x1 - x0) * tops.length;
      if (start >= 0 && tops.length >= 2 && a > area) { area = a; best = { id, axis: 'z', along: [start, end], across: [x0, x1], tops }; }
    };
    for (let z = rz0; z <= rz1; z++) {
      const h = z < rz1 ? level(z) : -1;
      if (h >= 0 && start >= 0 && Math.abs(h - tops[tops.length - 1]!) <= 1) { tops.push(h); continue; }
      close(z);
      [start, tops] = h >= 0 ? [z, [h]] : [-1, []];
    }
  }
  return best;
}

/**
 * The longest straight run of rim cells on one Z row at a sitting height three or four cells above the surface,
 * where the cell in front (+Z) is open air all the way down to the water, so a sitter's legs hang over it.
 */
function rimSeat(read: Read, size: Vec3, water: number, H: number): SeatEdge | undefined {
  let best: { x0: number; x1: number; z: number; s: number } | undefined;
  const open = (x: number, z: number, s: number) => { for (let y = water; y < s; y++) if (read.at(x, y, z)) return false; return true; };
  for (let z = size[2] - 1; z >= 0; z--) for (const s of [H, H - 1]) {
    if (s < water + 3) continue;
    let x0 = -1;
    for (let x = 0; x <= size[0]; x++) {
      const ok = x < size[0] && read.top(x, z) === s && open(x, z + 1, s);
      if (ok && x0 < 0) x0 = x;
      if (!ok && x0 >= 0) {
        if (!best || x - x0 > best.x1 - best.x0) best = { x0, x1: x, z, s };
        x0 = -1;
      }
    }
  }
  if (!best || best.x1 - best.x0 < 4) return undefined;
  return { id: 'rim', facing: 'south', box: { from: [best.x0, best.s - 1, best.z], to: [best.x1, best.s, best.z + 1] } };
}

// ─── Stepping stones ─────────────────────────────────────────────────────────────────────────────────────────

/** One stone: plan radii, squareness, how far its top clears the surface, its sideways offset and the gap after it. */
interface Step { readonly rx: number; readonly rz: number; readonly power: number; readonly rise: 1 | 2; readonly dx: number; readonly gap: 1 | 2 }

/**
 * 0 is five stones bowing gently east; 1 six smaller stones in a lazy S; 2 four broad stones bowing west with
 * longer hops. Every top clears the surface by one or two cells, so neighbours never differ by more than one.
 */
const STEP_LAYOUTS: readonly (readonly Step[])[] = [
  [
    { rx: 2.6, rz: 2.4, power: 3.2, rise: 1, dx: 0, gap: 1 }, { rx: 2.4, rz: 2.6, power: 3.6, rise: 2, dx: 1.5, gap: 2 },
    { rx: 2.9, rz: 2.5, power: 3, rise: 2, dx: 2.5, gap: 1 }, { rx: 2.5, rz: 2.3, power: 3.4, rise: 1, dx: 2, gap: 2 },
    { rx: 2.8, rz: 2.7, power: 3.1, rise: 2, dx: 0.5, gap: 1 },
  ],
  [
    { rx: 2.4, rz: 2.3, power: 3.4, rise: 1, dx: 0, gap: 2 }, { rx: 2.3, rz: 2.4, power: 3.6, rise: 1, dx: -1.5, gap: 1 },
    { rx: 2.6, rz: 2.3, power: 3.2, rise: 2, dx: -2.5, gap: 1 }, { rx: 2.4, rz: 2.5, power: 3.5, rise: 2, dx: -1, gap: 2 },
    { rx: 2.5, rz: 2.3, power: 3.3, rise: 1, dx: 1, gap: 1 }, { rx: 2.6, rz: 2.5, power: 3.1, rise: 2, dx: 2, gap: 1 },
  ],
  [
    { rx: 2.8, rz: 2.6, power: 3, rise: 2, dx: 0, gap: 2 }, { rx: 2.6, rz: 2.8, power: 3.3, rise: 1, dx: -2, gap: 2 },
    { rx: 2.8, rz: 2.7, power: 2.9, rise: 2, dx: -3, gap: 1 }, { rx: 2.7, rz: 2.8, power: 3.2, rise: 2, dx: -1.5, gap: 1 },
  ],
];

/**
 * A run of stepping stones from the shore (near z = 0) out along +Z to the fishing rock: four to six flat-topped
 * stones 0.5–0.7 m across in a gentle curve, each a short hop (one or two cells of open water) from the next,
 * their tops one or two cells above the surface. They sit on a shared gravel bar under the water; each is
 * darkened wet at and below the waterline and a few carry moss on their shaded (west) side. The walks are one
 * strip per stone top, in order from the shore out.
 */
export function createSteppingStones(style: StyleKey, variant: number, water: number): WaterPiece {
  checkStyle('stepping stones', style);
  checkVariant('stepping stones', variant);
  checkWater('stepping stones', water);
  const steps = STEP_LAYOUTS[variant]!, tones = rockTones(style), b = new Boxes();
  const low = Math.min(...steps.map(s => s.dx - s.rx)), high = Math.max(...steps.map(s => s.dx + s.rx));
  const x0 = Math.ceil(2 - low) + 0.5;
  // Lay the stones out along Z: each top's first row sits `gap` cells of water past the previous one's last.
  const stones: { d: Disc; top: number; rows: readonly number[] }[] = [];
  let cursor = 2;
  for (const s of steps) {
    const probe: Disc = { cx: x0 + s.dx, cz: 0, rx: s.rx, rz: s.rz, power: s.power };
    const rows0 = footprint({ ...probe, cz: s.rz + 0.5 }).map(r => r.z);
    const shift = cursor - rows0[0]!;
    const d: Disc = { ...probe, cz: s.rz + 0.5 + shift };
    const rows = rows0.map(z => z + shift);
    stones.push({ d, top: water + s.rise, rows });
    cursor = rows[rows.length - 1]! + 1 + s.gap;
  }
  const size: Vec3 = [Math.ceil(x0 + high + 2.5), water + 2, cursor - steps[steps.length - 1]!.gap + 2];
  const [W, , D] = size;

  // The gravel bar: an earthy ridge along the run, a cell or two under the surface, speckled with gravel.
  const bar = Math.max(1, Math.min(2, water - 1));
  stones.forEach(({ d }, i) => {
    const next = stones[i + 1]?.d;
    disc(b, size, { cx: d.cx, cz: d.cz, rx: d.rx + 1.3, rz: d.rz + 1.4, power: 1.8 }, 0, 1, MAT.earth);
    if (next) disc(b, size, { cx: (d.cx + next.cx) / 2, cz: (d.cz + next.cz) / 2, rx: Math.min(d.rx, next.rx) + 0.6, rz: 2, power: 1.7 }, 0, 1, MAT.earth);
    if (bar > 1) disc(b, size, { cx: d.cx, cz: d.cz, rx: d.rx + 0.6, rz: d.rz + 0.8, power: 2 }, 1, 2, tones.wet);
  });
  {
    const read = cells(b.list, size), gravel = [tones.side, MAT.darkStone, MAT.cream, tones.wet];
    for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) {
      const top = read.top(x, z), r = hash(variant, x, z, 80);
      if (top && r < 0.3) b.add(x, top - 1, z, x + 1, top, z + 1, gravel[Math.floor(hash(variant, x, z, 81) * gravel.length)]!);
    }
  }

  stones.forEach(({ d, top }, i) => {
    // A swollen foot under the water, a straight-sided body, dark at the waterline, and a dry flat tread.
    if (water > 1) disc(b, size, scaled(d, 1 + 0.6 / Math.min(d.rx, d.rz)), 0, water - 1, tones.wet);
    disc(b, size, d, Math.max(0, water - 1), top, tones.side);
    disc(b, size, d, Math.max(0, water - 1), Math.min(top - 1, water + 1), tones.wet);
    disc(b, size, d, top - 1, top, tones.top);
    if (hash(variant, i, 90) < 0.55) {
      // Moss on the shaded west shoulder, lapping onto the edge of the tread.
      disc(b, size, d, Math.max(water, top - 2), top, MAT.moss, { x: [0, Math.round(d.cx - d.rx * 0.55)] });
    }
  });

  inside(b, size, 'stepping stones');
  const blueprint = shoreBlueprint(`water-${style}-stepping-stones-${variant}-${water}`, style, 'prop', size, b);
  const read = cells(blueprint.boxes, size);
  const walks = stones.map(({ d, top, rows }, i) => {
    const extent = footprint(d).map(r => r.x);
    const region: Region = { x: [Math.min(...extent.map(e => e[0])), Math.max(...extent.map(e => e[1]))], z: [rows[0]!, rows[rows.length - 1]! + 1] };
    const walk = standingStrip(read, size, h => h === top, `stone-${i}`, region);
    if (!walk) throw new Error(`stepping stones ${variant}: stone ${i} has no tread.`);
    return walk;
  });
  return { ...NO_METADATA, blueprint, footings: [{ id: 'bed', box: groundFooting(read, size) }], walks };
}

/**
 * Each hop of a stepping-stone run, from the shore out: the open gap between one tread and the next (the
 * straight-line distance between the two strips' rectangles, in cells) and the change in walking height.
 */
export function steppingStoneHops(piece: WaterPiece): { gap: number; rise: number }[] {
  return piece.walks.slice(1).map((next, i) => {
    const prev = piece.walks[i]!;
    const rect = (w: WalkStrip) => (w.axis === 'z' ? { x: w.across, z: w.along } : { x: w.along, z: w.across });
    const a = rect(prev), c = rect(next);
    const dx = Math.max(0, c.x[0] - a.x[1], a.x[0] - c.x[1]), dz = Math.max(0, c.z[0] - a.z[1], a.z[0] - c.z[1]);
    return { gap: Math.hypot(dx, dz), rise: next.tops[0]! - prev.tops[prev.tops.length - 1]! };
  });
}
