import type { PlayMapView } from '../host';
import { trailStops } from './route';
import type { MapHome, MapStreet, TownMap, XZ } from './town';

/**
 * The kingdom's map, painted on parchment: watercolour washes for the water and the settled land, warm ink for the
 * streets, pale stone for the squares, a drawn castle and anvil, the homes as small roofs that all look alike. Over
 * it, every frame, the few things that are yours: your home in lantern gold, the lantern line to it, your brass
 * needle, and your friends' pins. Nobody else is ever on it: people come from `view.people` alone.
 *
 * The paper is cached per size and the town per (revision, scale, size), so a frame costs two image copies and the
 * handful of marks that move. Ink and wash only darken the paper (the town layer is laid on with multiply); a light
 * on the map is pigment, never glow.
 *
 * World axes: x east, z south. North (-z) is up, so screen y grows with z. Yaw 0 faces +z.
 */

export type MapStyle = 'mini' | 'page';

export interface MapFrame {
  /** CSS pixels. */
  readonly width: number;
  readonly height: number;
  readonly dpr: number;
  /** The world point (x, z) at the middle of the frame. */
  readonly centre: readonly [number, number];
  /** World metres per CSS pixel. */
  readonly metresPerPixel: number;
  readonly style: MapStyle;
  /** Seconds; the lantern line's slow shimmer reads it. Hold it still for reduced motion. */
  readonly time: number;
  /** Mid-gesture (a pinch or a wheel run): reuse the town already painted, scaled, rather than painting it anew. */
  readonly quick?: boolean;
}

type G = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
/** An offscreen surface: an OffscreenCanvas, a canvas element, or a test double. */
export interface MapSurface { width: number; height: number; getContext(kind: '2d'): unknown }
export type MapSurfaceFactory = (width: number, height: number) => MapSurface;

/** The colours that mark a person and nothing else, so a test can count people on a painted map. */
export const PERSON_INK = { you: '#2b1c0d', friend: '#1f2748' } as const;

const FACE_STORY = '"IM Fell English", Georgia, "Times New Roman", serif';
const FACE_LABEL = '"IM Fell English SC", Georgia, "Times New Roman", serif';
const FACE_BODY = 'Alegreya, Georgia, "Times New Roman", serif';

const INK = '#3a2717';
const INK_SOFT = '#5f4530';
const STONE = '#ddd0b3';
const STONE_DEEP = '#cbbb98';
const STONE_EDGE = '#5a4029';
const LAND = '#9fa56f';
const HILL = '#b49a72';
const ROOF = { lit: '#d2b48f', shade: '#a98767', edge: '#4f3824' };
const GOLD = { lit: '#eab650', shade: '#c4842a', edge: '#6a4210', halo: '224,158,48' };
const ROUTE = { dot: '#a66d19', lantern: '#efb64c', ring: '#5e3a0e', flame: '#fff2c8' };
const FRIEND = { fill: '#41508a', hi: '#8e9acb' };
const WATER = { wash: '#a7bcc1', deep: '#86a1ab', deeper: '#6d8d9a', pool: '#69858f', shore: '#2f4a56', lines: '#4c6874' };
const VERMILION = '#a8432b';
const WHITE = '#ffffff';

/* ------------------------------------------------------------------ noise, hashed and repeatable */

function hash(n: number): number {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
const hash2 = (x: number, y: number, seed: number) => hash(Math.imul(x | 0, 73856093) ^ Math.imul(y | 0, 19349663) ^ Math.imul(seed | 0, 83492791));
const smooth = (t: number) => t * t * (3 - 2 * t);
/** Smooth noise in [-1, 1] along a line. */
function noise1(t: number, seed: number): number {
  const i = Math.floor(t), f = smooth(t - i);
  return (hash2(i, 7, seed) * (1 - f) + hash2(i + 1, 7, seed) * f) * 2 - 1;
}
/** Smooth noise in [-1, 1] around a loop of `period` cells (t in [0, 1)). */
function loopNoise(t: number, period: number, seed: number): number {
  const x = t * period, i = Math.floor(x), f = smooth(x - i);
  const a = ((i % period) + period) % period, b = (a + 1) % period;
  return (hash2(a, 3, seed) * (1 - f) + hash2(b, 3, seed) * f) * 2 - 1;
}
/** Tileable value noise in [0, 1]. */
function noise2(x: number, y: number, period: number, seed: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), fx = smooth(x - xi), fy = smooth(y - yi);
  const w = (v: number) => ((v % period) + period) % period;
  const a = hash2(w(xi), w(yi), seed), b = hash2(w(xi + 1), w(yi), seed);
  const c = hash2(w(xi), w(yi + 1), seed), d = hash2(w(xi + 1), w(yi + 1), seed);
  return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
}
function seedOf(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/* ------------------------------------------------------------------ surfaces and their caches */

function defaultFactory(width: number, height: number): MapSurface {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  if (typeof document !== 'undefined') { const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height; return canvas; }
  throw new Error('No canvas to paint the map on');
}
const context = (surface: MapSurface) => surface.getContext('2d') as G | null;
const image = (surface: MapSurface) => surface as unknown as CanvasImageSource;

interface TownLayer {
  readonly key: string;
  readonly surface: MapSurface;
  /** World point at the layer's top-left, and metres per layer pixel. */
  readonly ox: number; readonly oz: number; readonly scale: number;
  readonly width: number; readonly height: number;
  readonly whole: boolean;
}

/** The paper and the painted town, kept between frames. One per map on screen. */
export interface MapLayers {
  /** Paint the paper and the town again on the next frame (the fonts arrived, the page changed size). */
  invalidate(): void;
  /** How many times the town layer has been painted (once per revision, scale, size and style). */
  readonly townPaints: number;
  /** How many times the paper has been laid (once per size and style). */
  readonly groundPaints: number;
}

/** Most pixels one town layer may hold before it covers only the frame and its surroundings. */
const LAYER_SIDE = 4096, LAYER_PIXELS = 12e6;
const TILE = 256;

class Layers implements MapLayers {
  townPaints = 0;
  groundPaints = 0;
  epoch = 0;
  ground: { key: string; surface: MapSurface } | null = null;
  town: TownLayer | null = null;
  tile: MapSurface | null = null;
  scratch: MapSurface | null = null;
  constructor(readonly make: MapSurfaceFactory) {}
  invalidate() { this.epoch++; this.ground = null; }

  /** A tileable square of paper grain: fibres, speckle and a soft cloud, brown in alpha over nothing. */
  grain(): MapSurface {
    if (this.tile) return this.tile;
    const surface = this.make(TILE, TILE), g = context(surface);
    this.tile = surface;
    if (!g) return surface;
    const pixels = g.createImageData(TILE, TILE), data = pixels.data;
    for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) {
      const cloud = noise2(x / 64, y / 64, TILE / 64, 11) * .55 + noise2(x / 16, y / 16, TILE / 16, 12) * .3 + noise2(x / 4, y / 4, TILE / 4, 13) * .15;
      const fleck = hash2(x, y, 14);
      let alpha = 6 + cloud * 26;
      if (fleck > .9965) alpha += 70; else if (fleck > .985) alpha += 18;
      const i = (y * TILE + x) * 4;
      data[i] = 104; data[i + 1] = 74; data[i + 2] = 40; data[i + 3] = alpha;
    }
    g.putImageData(pixels, 0, 0);
    // Long fibres laid in the pulp, mostly across the sheet; drawn three times so they wrap at the tile's edges.
    g.lineCap = 'round';
    for (let i = 0; i < 70; i++) {
      const x = hash2(i, 1, 21) * TILE, y = hash2(i, 2, 21) * TILE, length = 8 + hash2(i, 3, 21) * 26, angle = (hash2(i, 4, 21) - .5) * .7;
      const dark = hash2(i, 5, 21) > .4;
      g.strokeStyle = dark ? 'rgba(96,66,34,.16)' : 'rgba(255,248,226,.5)';
      g.lineWidth = .6 + hash2(i, 6, 21) * .7;
      for (const dx of [-TILE, 0, TILE]) for (const dy of [-TILE, 0, TILE]) {
        g.beginPath(); g.moveTo(x + dx, y + dy);
        g.quadraticCurveTo(x + dx + Math.cos(angle) * length * .5, y + dy + Math.sin(angle) * length * .5 + 1.5, x + dx + Math.cos(angle) * length, y + dy + Math.sin(angle) * length);
        g.stroke();
      }
    }
    return surface;
  }

  scratchOf(width: number, height: number): MapSurface {
    if (!this.scratch || this.scratch.width < width || this.scratch.height < height) {
      this.scratch = this.make(Math.max(width, this.scratch?.width ?? 0), Math.max(height, this.scratch?.height ?? 0));
    }
    return this.scratch;
  }
}

/** Fresh layers for one map. Pass a factory to paint somewhere other than an OffscreenCanvas (a test, a worker). */
export function createMapLayers(make: MapSurfaceFactory = defaultFactory): MapLayers {
  return new Layers(make);
}

let shared: Layers | null = null;

/* ------------------------------------------------------------------ the paper */

function paper(layers: Layers, width: number, height: number, style: MapStyle, k: number): MapSurface | null {
  const key = `${width}x${height}:${style}:${layers.epoch}`;
  if (layers.ground?.key === key) return layers.ground.surface;
  const surface = layers.make(width, height), g = context(surface);
  if (!g) return null;
  layers.groundPaints++;
  const base = g.createLinearGradient(0, 0, width * .35, height);
  base.addColorStop(0, '#f6ead0'); base.addColorStop(.55, '#f0e1bd'); base.addColorStop(1, '#e6d1a2');
  g.fillStyle = base; g.fillRect(0, 0, width, height);
  const grain = g.createPattern(image(layers.grain()), 'repeat');
  if (grain) { g.fillStyle = grain; g.fillRect(0, 0, width, height); }
  // A few soft tide marks where the sheet has been handled.
  const reach = Math.max(width, height);
  for (let i = 0; i < 5; i++) {
    const x = hash2(i, width, 31) * width, y = hash2(i, height, 32) * height, r = reach * (.18 + hash2(i, 9, 33) * .3);
    const stain = g.createRadialGradient(x, y, r * .2, x, y, r);
    stain.addColorStop(0, 'rgba(176,132,74,0)'); stain.addColorStop(.86, 'rgba(176,132,74,.07)'); stain.addColorStop(1, 'rgba(176,132,74,0)');
    g.fillStyle = stain; g.fillRect(0, 0, width, height);
  }
  // Light on the sheet from the upper left; the rim browned. The minimap is read at dusk, by candle.
  const light = g.createRadialGradient(width * .3, height * .22, 0, width * .3, height * .22, reach * .8);
  light.addColorStop(0, 'rgba(255,250,232,.5)'); light.addColorStop(1, 'rgba(255,250,232,0)');
  g.fillStyle = light; g.fillRect(0, 0, width, height);
  const mini = style === 'mini';
  const rim = g.createRadialGradient(width / 2, height / 2, reach * (mini ? .22 : .4), width / 2, height / 2, reach * (mini ? .52 : .78));
  rim.addColorStop(0, 'rgba(139,96,48,0)'); rim.addColorStop(1, mini ? 'rgba(122,74,30,.42)' : 'rgba(139,96,48,.28)');
  g.fillStyle = rim; g.fillRect(0, 0, width, height);
  if (mini) { g.fillStyle = 'rgba(232,170,96,.10)'; g.fillRect(0, 0, width, height); }
  void k;
  layers.ground = { key, surface };
  return surface;
}

/* ------------------------------------------------------------------ drawing helpers */

type Flat = number[];
interface Box { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number }
const overlaps = (boxes: readonly Box[], b: Box) => boxes.some(o => b.x0 < o.x1 && b.x1 > o.x0 && b.y0 < o.y1 && b.y1 > o.y0);

/** A polyline (already in pixels) redrawn by hand: subdivided, nudged sideways by a slow wobble that dies at its ends. */
function hand(points: readonly (readonly [number, number])[], seed: number, amp: number, step: number): Flat {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += Math.hypot(points[i]![0] - points[i - 1]![0], points[i]![1] - points[i - 1]![1]);
  const out: Flat = [];
  if (!points.length) return out;
  let travelled = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!, b = points[i]!, dx = b[0] - a[0], dy = b[1] - a[1], span = Math.hypot(dx, dy);
    const n = Math.max(1, Math.ceil(span / step)), nx = span > 0 ? -dy / span : 0, ny = span > 0 ? dx / span : 0;
    for (let j = 0; j < n; j++) {
      const t = j / n, d = travelled + span * t;
      const taper = Math.min(1, d / (step * 2), (total - d) / (step * 2));
      const off = amp > 0 ? noise1(d / (step * 3.2), seed) * amp * Math.max(0, taper) : 0;
      out.push(a[0] + dx * t + nx * off, a[1] + dy * t + ny * off);
    }
    travelled += span;
  }
  const last = points[points.length - 1]!;
  out.push(last[0], last[1]);
  return out;
}

function trace(g: G, flat: Flat, close = false) {
  g.beginPath();
  if (flat.length < 2) return;
  g.moveTo(flat[0]!, flat[1]!);
  for (let i = 2; i < flat.length; i += 2) g.lineTo(flat[i]!, flat[i + 1]!);
  if (close) g.closePath();
}

/** An ellipse with a hand-drawn edge, as flat pixels. */
function wobblyEllipse(cx: number, cy: number, rx: number, ry: number, seed: number, amp: number, grow = 0): Flat {
  const out: Flat = [], n = Math.max(24, Math.min(160, Math.round((rx + ry) * .6)));
  for (let i = 0; i < n; i++) {
    const t = i / n, angle = t * Math.PI * 2;
    const r = 1 + amp * (loopNoise(t, 9, seed) * .7 + loopNoise(t, 23, seed + 1) * .3);
    out.push(cx + Math.cos(angle) * (rx * r + grow), cy + Math.sin(angle) * (ry * r + grow));
  }
  return out;
}

const inside = (poly: readonly (readonly [number, number])[], x: number, y: number) => {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!, b = poly[j]!;
    if ((a[1] > y) !== (b[1] > y) && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1] || 1e-9) + a[0]) hit = !hit;
  }
  return hit;
};

/* ------------------------------------------------------------------ the streets, joined and named */

interface Chain { readonly name: string; readonly width: number; readonly points: XZ[]; readonly length: number }

const lengthOf = (points: readonly XZ[]) => {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += Math.hypot(points[i]![0] - points[i - 1]![0], points[i]![1] - points[i - 1]![1]);
  return total;
};

/** Streets of one name joined end to end into the longest runs that keep going roughly straight. */
function chainsOf(streets: readonly MapStreet[]): Chain[] {
  const groups = new Map<string, MapStreet[]>();
  for (const street of streets) {
    if ((street.kind !== 'main' && street.kind !== 'lane') || !street.name) continue;
    const list = groups.get(street.name) ?? []; list.push(street); groups.set(street.name, list);
  }
  const key = (p: XZ) => `${Math.round(p[0] * 2)}:${Math.round(p[1] * 2)}`;
  const chains: Chain[] = [];
  for (const [name, list] of groups) {
    const ends = new Map<string, number[]>();
    list.forEach((street, index) => {
      for (const p of [street.points[0]!, street.points[street.points.length - 1]!]) { const k = key(p); const at = ends.get(k) ?? []; at.push(index); ends.set(k, at); }
    });
    const used = new Set<number>();
    const order = list.map((street, index) => ({ index, length: lengthOf(street.points) })).sort((a, b) => b.length - a.length);
    for (const { index } of order) {
      if (used.has(index)) continue;
      used.add(index);
      let points = [...list[index]!.points];
      // Grow at the tail, then turn the run round and grow at the other end.
      for (let pass = 0; pass < 2; pass++) {
        for (let guard = 0; guard < list.length; guard++) {
          const tail = points[points.length - 1]!, before = points[Math.max(0, points.length - 3)]!;
          const dx = tail[0] - before[0], dz = tail[1] - before[1], span = Math.hypot(dx, dz) || 1;
          let best = -1, bestDot = .45, bestFlip = false;
          for (const candidate of ends.get(key(tail)) ?? []) {
            if (used.has(candidate)) continue;
            const street = list[candidate]!.points, flip = key(street[0]!) !== key(tail);
            const a = flip ? street[street.length - 1]! : street[0]!, b = flip ? street[Math.max(0, street.length - 3)]! : street[Math.min(street.length - 1, 2)]!;
            const ex = b[0] - a[0], ez = b[1] - a[1], dot = (dx * ex + dz * ez) / (span * (Math.hypot(ex, ez) || 1));
            if (dot > bestDot) { bestDot = dot; best = candidate; bestFlip = flip; }
          }
          if (best < 0) break;
          used.add(best);
          const next = bestFlip ? [...list[best]!.points].reverse() : list[best]!.points;
          points = points.concat(next.slice(1));
        }
        points.reverse();
      }
      chains.push({ name, width: list[index]!.width, points, length: lengthOf(points) });
    }
  }
  return chains.sort((a, b) => b.length - a.length);
}

/**
 * Words set along a path, letter by letter, the right way up, beside the line by `offset` pixels. Tries the
 * straightest stretches first; gives up rather than collide with another word or glyph.
 */
function wordsAlong(g: G, flat: Flat, text: string, size: number, offset: number, boxes: Box[], halo: number, colour: string): boolean {
  const n = flat.length / 2;
  if (n < 2) return false;
  const cumulative: number[] = [0];
  for (let i = 1; i < n; i++) cumulative.push(cumulative[i - 1]! + Math.hypot(flat[i * 2]! - flat[i * 2 - 2]!, flat[i * 2 + 1]! - flat[i * 2 - 1]!));
  const total = cumulative[n - 1]!;
  const tracking = size * .05;
  const widths = [...text].map(ch => g.measureText(ch).width + tracking);
  const width = widths.reduce((sum, w) => sum + w, 0);
  const pad = size * 1.2;
  if (width + pad * 2 > total) return false;
  const at = (s: number) => {
    let i = 1;
    while (i < n - 1 && cumulative[i]! < s) i++;
    const s0 = cumulative[i - 1]!, s1 = cumulative[i]!, t = s1 > s0 ? (s - s0) / (s1 - s0) : 0;
    const ax = flat[i * 2 - 2]!, ay = flat[i * 2 - 1]!, bx = flat[i * 2]!, by = flat[i * 2 + 1]!;
    return { x: ax + (bx - ax) * t, y: ay + (by - ay) * t, angle: Math.atan2(by - ay, bx - ax) };
  };
  const candidates: { start: number; score: number }[] = [];
  const step = Math.max(6, size);
  for (let start = pad; start + width <= total - pad; start += step) {
    let turn = 0, prev = at(start).angle;
    for (let q = 1; q <= 6; q++) {
      const angle = at(start + width * q / 6).angle;
      let d = angle - prev; d = Math.atan2(Math.sin(d), Math.cos(d)); turn += Math.abs(d); prev = angle;
    }
    if (turn > .55) continue;
    candidates.push({ start, score: turn + Math.abs(start + width / 2 - total / 2) / total * .25 });
  }
  candidates.sort((a, b) => a.score - b.score);
  for (const { start } of candidates.slice(0, 6)) {
    const head = at(start), tail = at(start + width);
    const reversed = tail.x < head.x;
    const glyphs: { ch: string; x: number; y: number; angle: number }[] = [];
    const placed: Box[] = [];
    let along = 0, clear = true;
    [...text].forEach((ch, i) => {
      const middle = along + widths[i]! / 2; along += widths[i]!;
      const p = at(reversed ? start + width - middle : start + middle);
      const angle = p.angle + (reversed ? Math.PI : 0);
      const ux = Math.sin(angle), uy = -Math.cos(angle);
      const x = p.x + ux * offset, y = p.y + uy * offset;
      glyphs.push({ ch, x, y, angle });
      const r = size * .55;
      const box = { x0: x - r, y0: y - r, x1: x + r, y1: y + r };
      if (overlaps(boxes, box)) clear = false;
      placed.push(box);
    });
    if (!clear) continue;
    boxes.push(...placed);
    for (const pass of ['halo', 'ink'] as const) {
      for (const glyph of glyphs) {
        g.save(); g.translate(glyph.x, glyph.y); g.rotate(glyph.angle);
        if (pass === 'halo') { g.strokeStyle = WHITE; g.lineWidth = halo; g.lineJoin = 'round'; g.strokeText(glyph.ch, 0, 0); }
        else { g.fillStyle = colour; g.fillText(glyph.ch, 0, 0); }
        g.restore();
      }
    }
    return true;
  }
  return false;
}

/** A word set flat, centred, with a paper halo; skipped when it would sit on another. */
function word(g: G, text: string, x: number, y: number, size: number, halo: number, colour: string, boxes: Box[]): boolean {
  const width = g.measureText(text).width;
  const box = { x0: x - width / 2 - 2, y0: y - size * .62, x1: x + width / 2 + 2, y1: y + size * .5 };
  if (overlaps(boxes, box)) return false;
  boxes.push(box);
  g.strokeStyle = WHITE; g.lineWidth = halo; g.lineJoin = 'round'; g.strokeText(text, x, y);
  g.fillStyle = colour; g.fillText(text, x, y);
  return true;
}

/* ------------------------------------------------------------------ one home, drawn small */

interface House { readonly minX: number; readonly maxX: number; readonly minZ: number; readonly maxZ: number; readonly ridge: 'x' | 'z' }

/** The house on a lot: set toward the street, its ridge along the frontage. The same glyph for every home. */
export function houseOf(home: MapHome): House {
  const { lot } = home, cx = (lot.minX + lot.maxX) / 2, cz = (lot.minZ + lot.maxZ) / 2;
  const spanX = Math.max(.5, lot.maxX - lot.minX), spanZ = Math.max(.5, lot.maxZ - lot.minZ);
  const dx = home.door[0] - cx, dz = home.door[2] - cz;
  const facesX = Math.abs(dx) / spanX > Math.abs(dz) / spanZ;
  if (facesX) {
    const depth = spanX * .44, across = spanZ * .74, x = cx + Math.sign(dx || 1) * spanX * .14;
    return { minX: x - depth / 2, maxX: x + depth / 2, minZ: cz - across / 2, maxZ: cz + across / 2, ridge: 'z' };
  }
  const depth = spanZ * .44, across = spanX * .74, z = cz + Math.sign(dz || 1) * spanZ * .14;
  return { minX: cx - across / 2, maxX: cx + across / 2, minZ: z - depth / 2, maxZ: z + depth / 2, ridge: 'x' };
}

/** A roof seen from above, lit from the north-west: the far half shaded, an inked edge and ridge. */
function roof(g: G, x0: number, y0: number, x1: number, y1: number, ridge: 'x' | 'z', colours: { lit: string; shade: string; edge: string }, k: number) {
  const w = x1 - x0, h = y1 - y0;
  if (w < 3 * k || h < 3 * k) { g.fillStyle = colours.shade; g.fillRect(x0, y0, Math.max(w, 1.6 * k), Math.max(h, 1.6 * k)); return; }
  g.fillStyle = colours.lit; g.fillRect(x0, y0, w, h);
  g.fillStyle = colours.shade;
  if (ridge === 'z') g.fillRect(x0 + w / 2, y0, w / 2, h); else g.fillRect(x0, y0 + h / 2, w, h / 2);
  g.strokeStyle = colours.edge; g.lineWidth = Math.max(.8 * k, Math.min(w, h) * .07); g.lineJoin = 'round';
  g.strokeRect(x0, y0, w, h);
  g.lineWidth = .7 * k; g.beginPath();
  if (ridge === 'z') { g.moveTo(x0 + w / 2, y0 + h * .08); g.lineTo(x0 + w / 2, y1 - h * .08); } else { g.moveTo(x0 + w * .08, y0 + h / 2); g.lineTo(x1 - w * .08, y0 + h / 2); }
  g.stroke();
}

/* ------------------------------------------------------------------ the town layer */

interface Projector { x(x: number): number; y(z: number): number; readonly s: number; readonly k: number }

function paintTown(g: G, layers: Layers, town: TownMap, style: MapStyle, P: Projector, width: number, height: number) {
  const { s, k } = P, page = style === 'page';
  const pattern = g.createPattern(image(layers.grain()), 'repeat');
  const visible = (minX: number, minZ: number, maxX: number, maxZ: number, pad = 0) =>
    P.x(maxX) >= -pad && P.x(minX) <= width + pad && P.y(maxZ) >= -pad && P.y(minZ) <= height + pad;
  const streets = town.streets.filter(street => {
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    for (const p of street.points) { minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]); minZ = Math.min(minZ, p[1]); maxZ = Math.max(maxZ, p[1]); }
    return visible(minX, minZ, maxX, maxZ, 40 / s);
  });
  const inked = new Map<string, Flat>();
  for (const street of streets) {
    inked.set(street.id, hand(street.points.map(p => [P.x(p[0]), P.y(p[1])] as const), seedOf(street.id), street.kind === 'main' ? .55 * k : .45 * k, 7 * k));
  }

  // 1. The settled land: a sage wash that follows the streets out, in three soft passes on scratch paper.
  const settled = streets.filter(street => street.kind !== 'trail');
  if (settled.length) {
    const scratch = layers.scratchOf(width, height), w = context(scratch);
    if (w) {
      for (const [metres, alpha] of [[38, .07], [26, .08], [15, .09]] as const) {
        w.clearRect(0, 0, width, height);
        w.strokeStyle = LAND; w.lineCap = 'round'; w.lineJoin = 'round'; w.lineWidth = Math.max(6 * k, metres / s);
        for (const street of settled) { trace(w, inked.get(street.id)!); w.stroke(); }
        g.globalAlpha = alpha; g.drawImage(image(scratch), 0, 0, width, height, 0, 0, width, height);
      }
      g.globalAlpha = 1;
    }
  }

  // 2. The castle's rise: an ochre wash and hachures falling away from it.
  const cb = town.castle.bounds;
  if ([cb.minX, cb.maxX, cb.minZ, cb.maxZ].every(Number.isFinite) && cb.maxX > cb.minX && cb.maxZ > cb.minZ) {
    const cx = P.x((cb.minX + cb.maxX) / 2), cy = P.y((cb.minZ + cb.maxZ) / 2);
    const rx = ((cb.maxX - cb.minX) / 2 + 18) / s, ry = ((cb.maxZ - cb.minZ) / 2 + 18) / s;
    for (const [grow, alpha] of [[1.0, .16], [.86, .14], [.7, .1]] as const) {
      trace(g, wobblyEllipse(cx, cy, rx * grow, ry * grow, 41 + grow * 10, .06), true);
      g.fillStyle = HILL; g.globalAlpha = alpha; g.fill();
    }
    g.globalAlpha = 1;
    const ring = wobblyEllipse(cx, cy, rx * .98, ry * .98, 41, .06);
    const count = ring.length / 2;
    g.strokeStyle = INK_SOFT; g.lineCap = 'round';
    const every = Math.max(1, Math.round(count / Math.max(24, (rx + ry) * Math.PI / (5 * k))));
    for (let i = 0; i < count; i += every) {
      const x = ring[i * 2]!, y = ring[i * 2 + 1]!, nx = (x - cx) / rx, ny = (y - cy) / ry, nl = Math.hypot(nx, ny) || 1;
      const length = (4 + hash2(i, 5, 43) * 5) * k;
      g.globalAlpha = .28 + hash2(i, 6, 43) * .14; g.lineWidth = .7 * k;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + nx / nl * length, y + ny / nl * length); g.stroke();
    }
    g.globalAlpha = 1;
  }

  // 3. Water: lines out from the shore, layered washes deepening inward, pigment pooled at the edge, ripples.
  for (const water of town.waters) {
    if (![water.x, water.z, water.radiusX, water.radiusZ].every(Number.isFinite) || water.radiusX <= 0 || water.radiusZ <= 0) continue;
    if (!visible(water.x - water.radiusX, water.z - water.radiusZ, water.x + water.radiusX, water.z + water.radiusZ, 30 / s)) continue;
    const seed = seedOf(water.id), cx = P.x(water.x), cy = P.y(water.z), rx = water.radiusX / s, ry = water.radiusZ / s;
    g.strokeStyle = WATER.lines; g.lineWidth = .7 * k;
    for (const [grow, alpha] of [[3.2, .5], [6.6, .32], [10.5, .18], [15, .09]] as const) {
      trace(g, wobblyEllipse(cx, cy, rx, ry, seed, .05, grow * k), true); g.globalAlpha = alpha; g.stroke();
    }
    g.globalAlpha = 1;
    const shore = wobblyEllipse(cx, cy, rx, ry, seed, .05);
    trace(g, shore, true); g.fillStyle = WATER.wash; g.globalAlpha = .85; g.fill();
    trace(g, wobblyEllipse(cx - rx * .05, cy - ry * .06, rx * .78, ry * .74, seed + 2, .08), true); g.fillStyle = WATER.deep; g.globalAlpha = .45; g.fill();
    trace(g, wobblyEllipse(cx - rx * .02, cy - ry * .02, rx * .5, ry * .46, seed + 3, .1), true); g.fillStyle = WATER.deeper; g.globalAlpha = .35; g.fill();
    g.globalAlpha = 1;
    if (pattern) { g.save(); trace(g, shore, true); g.clip(); g.fillStyle = pattern; g.globalAlpha = .9; g.fillRect(cx - rx * 1.2, cy - ry * 1.2, rx * 2.4, ry * 2.4); g.restore(); }
    trace(g, shore, true); g.strokeStyle = WATER.pool; g.lineWidth = 3.2 * k; g.globalAlpha = .4; g.stroke();
    g.globalAlpha = 1; g.strokeStyle = WATER.shore; g.lineWidth = 1.15 * k; g.stroke();
    // Ripples: short paper-pale strokes with a darker one under each, in loose rows.
    const ripples = Math.round(Math.min(40, (rx * ry) / (220 * k * k)));
    g.lineCap = 'round';
    for (let i = 0; i < ripples; i++) {
      const a = hash2(i, 1, seed) * Math.PI * 2, r = Math.sqrt(hash2(i, 2, seed)) * .72;
      const x = cx + Math.cos(a) * rx * r, y = cy + Math.sin(a) * ry * r, half = (4 + hash2(i, 3, seed) * 6) * k;
      g.beginPath(); g.moveTo(x - half, y); g.quadraticCurveTo(x, y - 1.6 * k, x + half, y);
      g.strokeStyle = WHITE; g.globalAlpha = .55; g.lineWidth = 1 * k; g.stroke();
      g.beginPath(); g.moveTo(x - half * .7, y + 1.4 * k); g.quadraticCurveTo(x, y + .2 * k, x + half * .7, y + 1.4 * k);
      g.strokeStyle = WATER.lines; g.globalAlpha = .35; g.lineWidth = .6 * k; g.stroke();
    }
    g.globalAlpha = 1;
  }

  // 4. Streams: a tapered wash, its thread of ink down the middle.
  for (const stream of town.streams) {
    const pts = stream.points.filter(p => Number.isFinite(p.at[0]) && Number.isFinite(p.at[1]));
    if (pts.length < 2) continue;
    g.lineCap = 'round'; g.lineJoin = 'round'; g.strokeStyle = WATER.wash;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]!, b = pts[i]!, w = Math.max(1.4 * k, ((a.width + b.width) / 2) / s);
      g.lineWidth = w + 1.6 * k; g.globalAlpha = .45; g.strokeStyle = WATER.pool;
      g.beginPath(); g.moveTo(P.x(a.at[0]), P.y(a.at[1])); g.lineTo(P.x(b.at[0]), P.y(b.at[1])); g.stroke();
      g.lineWidth = w; g.globalAlpha = .9; g.strokeStyle = WATER.wash; g.stroke();
    }
    g.globalAlpha = .75; g.strokeStyle = WATER.shore; g.lineWidth = .6 * k;
    trace(g, hand(pts.map(p => [P.x(p.at[0]), P.y(p.at[1])] as const), seedOf(stream.id), .4 * k, 6 * k)); g.stroke();
    g.globalAlpha = 1;
  }

  // 5. Lots, faint dotted pencil, on the big map only.
  if (page) {
    g.strokeStyle = INK_SOFT; g.lineWidth = .55 * k; g.globalAlpha = .22; g.setLineDash([1.2 * k, 2.2 * k]);
    for (const home of town.homes) {
      const { lot } = home;
      if (!visible(lot.minX, lot.minZ, lot.maxX, lot.maxZ)) continue;
      const w = (lot.maxX - lot.minX) / s, h = (lot.maxZ - lot.minZ) / s;
      if (w < 7 * k || h < 7 * k) continue;
      g.strokeRect(P.x(lot.minX), P.y(lot.minZ), w, h);
    }
    g.setLineDash([]); g.globalAlpha = 1;
  }

  // 6. Streets: approaches and trails as single lines, then the cased roads, all casings before any fill so the
  // junctions run together like a pen that never lifted.
  g.lineCap = 'round'; g.lineJoin = 'round';
  for (const street of streets) {
    const flat = inked.get(street.id)!, w = street.width / s;
    if (street.kind === 'approach' && w < 3 * k) {
      trace(g, flat); g.strokeStyle = INK_SOFT; g.globalAlpha = .7; g.lineWidth = Math.max(.75 * k, w * .45); g.stroke();
    } else if (street.kind === 'trail') {
      g.setLineDash([3 * k, 2.6 * k]); trace(g, flat); g.strokeStyle = INK_SOFT; g.globalAlpha = .75; g.lineWidth = Math.max(.8 * k, w * .3); g.stroke(); g.setLineDash([]);
    }
  }
  g.globalAlpha = 1;
  const cased = streets.filter(street => street.kind === 'main' || street.kind === 'lane' || (street.kind === 'approach' && street.width / s >= 3 * k));
  for (const street of cased) {
    const w = Math.max(1.6 * k, street.width / s), edge = street.kind === 'main' ? 1.25 * k : street.kind === 'lane' ? 1 * k : .7 * k;
    trace(g, inked.get(street.id)!); g.strokeStyle = street.kind === 'main' ? INK : '#4e3622'; g.globalAlpha = street.kind === 'main' ? .92 : .8;
    g.lineWidth = w + edge * 2; g.stroke();
  }
  g.globalAlpha = 1;
  for (const street of cased) {
    const w = Math.max(1.6 * k, street.width / s);
    trace(g, inked.get(street.id)!); g.strokeStyle = WHITE; g.lineWidth = w; g.stroke();
  }
  // The main road carries a warm ochre wash down its middle: the road everyone takes.
  for (const street of cased) {
    if (street.kind !== 'main') continue;
    trace(g, inked.get(street.id)!); g.strokeStyle = '#dcc08a'; g.globalAlpha = .55; g.lineWidth = Math.max(1 * k, street.width / s * .55); g.stroke();
  }
  g.globalAlpha = 1;

  // 7. Squares in pale stone: the greens, the castle court, the market with its cobbles.
  const square = (boundary: readonly XZ[], fill: string, seed: number, cobbles: boolean) => {
    if (boundary.length < 3) return;
    const poly = boundary.map(p => [P.x(p[0]), P.y(p[1])] as const);
    const flat = hand([...poly, poly[0]!], seed, .35 * k, 6 * k);
    trace(g, flat, true); g.fillStyle = WHITE; g.fill();
    g.fillStyle = fill; g.globalAlpha = .9; g.fill(); g.globalAlpha = 1;
    if (pattern) { g.save(); trace(g, flat, true); g.clip(); g.fillStyle = pattern; g.globalAlpha = .7; g.fill(); g.restore(); g.globalAlpha = 1; }
    if (cobbles) {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const p of poly) { minX = Math.min(minX, p[0]); maxX = Math.max(maxX, p[0]); minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]); }
      const step = Math.max(3.2 * k, 1.6 / s);
      g.fillStyle = INK_SOFT;
      let row = 0;
      for (let y = minY + step * .6; y < maxY; y += step, row++) {
        for (let x = minX + step * (row % 2 ? .4 : .9); x < maxX; x += step) {
          const jx = x + (hash2(Math.round(x), Math.round(y), seed) - .5) * step * .5, jy = y + (hash2(Math.round(y), Math.round(x), seed) - .5) * step * .5;
          if (!inside(poly, jx, jy)) continue;
          g.globalAlpha = .16 + hash2(Math.round(jx), Math.round(jy), seed + 1) * .16;
          g.beginPath(); g.arc(jx, jy, .55 * k, 0, Math.PI * 2); g.fill();
        }
      }
      g.globalAlpha = 1;
    }
    trace(g, flat, true); g.strokeStyle = STONE_EDGE; g.lineWidth = 1.05 * k; g.stroke();
  };
  town.courts.forEach((court, i) => square(court, '#d3d0ac', 61 + i, false));
  square(town.castle.court, STONE, 71, true);
  square(town.market, STONE, 81, true);

  // 8. The homes, every one alike.
  for (const home of town.homes) {
    const house = houseOf(home);
    if (!visible(house.minX, house.minZ, house.maxX, house.maxZ, 4)) continue;
    g.globalAlpha = .82;
    roof(g, P.x(house.minX), P.y(house.minZ), P.x(house.maxX), P.y(house.maxZ), house.ridge, ROOF, k);
  }
  g.globalAlpha = 1;

  // 9. The castle, drawn as the plan's curtain with its four round towers, the gate toward the court, the keep behind.
  const glyphs: Box[] = [];
  if (cb.maxX > cb.minX && cb.maxZ > cb.minZ) glyphs.push(paintCastle(g, town, P));

  // 10. The anvil of the Forge, in black ink with an ember.
  const forge = town.places.find(place => place.id === 'forge');
  if (forge && forge.at.every(Number.isFinite)) glyphs.push(anvil(g, P.x(forge.at[0]), P.y(forge.at[1]), (page ? 1.05 : .9) * k));

  // 10b. The places the founded scene names by piece (the Tavern, the Pier): a small inked marker each.
  const pieces = town.places.filter(place => (place.id === 'tavern' || place.id === 'pier') && place.at.every(Number.isFinite));
  for (const place of pieces) glyphs.push(placeMark(g, P.x(place.at[0]), P.y(place.at[1]), (page ? 1.05 : .9) * k));

  // 11. The names: the places, then the streets along their lines (big map only), never over another word.
  const boxes: Box[] = [...glyphs];
  g.textAlign = 'center'; g.textBaseline = 'middle';
  const castle = town.places.find(place => place.id === 'castle');
  if (castle && cb.maxZ > cb.minZ) {
    const size = (page ? 19 : 12.5) * k;
    g.font = page ? `${size}px ${FACE_STORY}` : `${size}px ${FACE_LABEL}`;
    word(g, castle.name, P.x((cb.minX + cb.maxX) / 2), P.y(cb.minZ) - size * .9, size, 3.4 * k, INK, boxes);
  }
  const market = town.places.find(place => place.id === 'market');
  if (market && town.market.length) {
    const size = (page ? 16 : 12) * k;
    let maxZ = -Infinity; for (const p of town.market) maxZ = Math.max(maxZ, p[1]);
    g.font = page ? `${size}px ${FACE_STORY}` : `${size}px ${FACE_LABEL}`;
    word(g, market.name, P.x(market.at[0]), P.y(maxZ) + size * .95, size, 3.2 * k, INK, boxes);
  }
  if (forge && page) {
    const size = 13 * k;
    g.font = `${size}px ${FACE_LABEL}`; g.textAlign = 'left';
    word(g, forge.name, P.x(forge.at[0]) + 10 * k + g.measureText(forge.name).width / 2, P.y(forge.at[1]), size, 3 * k, INK, boxes);
    g.textAlign = 'center';
  }
  for (const place of pieces) {
    const size = (page ? 13 : 11) * k;
    g.font = `${size}px ${FACE_LABEL}`;
    word(g, place.name, P.x(place.at[0]) + 8 * k + g.measureText(place.name).width / 2, P.y(place.at[1]), size, 3 * k, INK, boxes);
  }
  if (page) {
    const size = 13 * k;
    g.font = `italic ${size}px ${FACE_STORY}`;
    const shown = new Map<string, { x: number; y: number }[]>();
    let placedCount = 0;
    for (const chain of chainsOf(streets)) {
      if (placedCount >= 28) break;
      const flat = hand(chain.points.map(p => [P.x(p[0]), P.y(p[1])] as const), 0, 0, 6 * k);
      const mid = flat.length >> 2 << 1;
      const centre = { x: flat[mid] ?? 0, y: flat[mid + 1] ?? 0 };
      if (centre.x < -40 * k || centre.x > width + 40 * k || centre.y < -40 * k || centre.y > height + 40 * k) continue;
      const near = (shown.get(chain.name) ?? []).some(p => Math.hypot(p.x - centre.x, p.y - centre.y) < 320 * k);
      if (near) continue;
      if (wordsAlong(g, flat, chain.name, size, Math.max(1.6 * k, chain.width / s) / 2 + size * .62, boxes, 3 * k, '#4b3320')) {
        const list = shown.get(chain.name) ?? []; list.push(centre); shown.set(chain.name, list); placedCount++;
      }
    }
  }
}

/** The castle glyph; returns the box it covers so no word is set over it. */
function paintCastle(g: G, town: TownMap, P: Projector): Box {
  const { k, s } = P, b = town.castle.bounds;
  const x0 = P.x(b.minX), y0 = P.y(b.minZ), x1 = P.x(b.maxX), y1 = P.y(b.maxZ), w = x1 - x0, h = y1 - y0;
  const wall = Math.max(1.8 * k, 3 / s), tower = Math.max(3.2 * k, 6 / s);
  // The gate is in the wall nearest the court.
  const court = town.castle.court;
  const ccx = court.length ? court.reduce((sum, p) => sum + P.x(p[0]), 0) / court.length : (x0 + x1) / 2;
  const ccy = court.length ? court.reduce((sum, p) => sum + P.y(p[1]), 0) / court.length : y1;
  const sides = [{ side: 'n', d: ccy - y0 }, { side: 's', d: y1 - ccy }, { side: 'w', d: ccx - x0 }, { side: 'e', d: x1 - ccx }] as const;
  const gate = [...sides].sort((a, b2) => a.d - b2.d)[0]!.side;
  // Curtain: an inked double line with stone between.
  g.lineJoin = 'miter';
  g.strokeStyle = INK; g.lineWidth = wall + 2.2 * k; g.strokeRect(x0 + wall / 2, y0 + wall / 2, w - wall, h - wall);
  g.strokeStyle = STONE_DEEP; g.lineWidth = wall; g.strokeRect(x0 + wall / 2, y0 + wall / 2, w - wall, h - wall);
  // The gate's opening, flanked by two small towers.
  const gw = Math.max(2.4 * k, 6 / s), gt = Math.max(2.4 * k, 4 / s);
  const gx = gate === 'w' ? x0 + wall / 2 : gate === 'e' ? x1 - wall / 2 : (x0 + x1) / 2;
  const gy = gate === 'n' ? y0 + wall / 2 : gate === 's' ? y1 - wall / 2 : (y0 + y1) / 2;
  const across = gate === 'n' || gate === 's';
  g.fillStyle = WHITE;
  if (across) g.fillRect(gx - gw / 2, gy - wall, gw, wall * 2); else g.fillRect(gx - wall, gy - gw / 2, wall * 2, gw);
  for (const sign of [-1, 1]) {
    const tx = across ? gx + sign * (gw / 2 + gt / 2) : gx, ty = across ? gy : gy + sign * (gw / 2 + gt / 2);
    g.fillStyle = STONE; g.fillRect(tx - gt / 2 - .6 * k, ty - gt / 2 - .6 * k, gt + 1.2 * k, gt + 1.2 * k);
    g.strokeStyle = INK; g.lineWidth = 1 * k; g.strokeRect(tx - gt / 2 - .6 * k, ty - gt / 2 - .6 * k, gt + 1.2 * k, gt + 1.2 * k);
  }
  // Keep: a square tower set back from the gate, roof lines and a shaded half, the realm's pennant on top.
  const size = Math.max(6 * k, Math.min(w, h) * .38);
  const back = gate === 'n' ? [0, 1] : gate === 's' ? [0, -1] : gate === 'w' ? [1, 0] : [-1, 0];
  const kx = (x0 + x1) / 2 + back[0]! * (w / 2 - size / 2 - wall * 1.6) * .55, ky = (y0 + y1) / 2 + back[1]! * (h / 2 - size / 2 - wall * 1.6) * .55;
  const kx0 = kx - size / 2, ky0 = ky - size / 2;
  g.fillStyle = STONE_DEEP; g.fillRect(kx0, ky0, size, size);
  g.save(); g.beginPath(); g.moveTo(kx0 + size, ky0); g.lineTo(kx0 + size, ky0 + size); g.lineTo(kx0, ky0 + size); g.closePath(); g.clip();
  g.strokeStyle = INK_SOFT; g.globalAlpha = .55; g.lineWidth = .6 * k;
  for (let t = -size; t < size; t += 2.4 * k) { g.beginPath(); g.moveTo(kx0 + t, ky0 + size); g.lineTo(kx0 + t + size, ky0); g.stroke(); }
  g.restore(); g.globalAlpha = 1;
  g.strokeStyle = INK; g.lineWidth = 1.4 * k; g.strokeRect(kx0, ky0, size, size);
  g.lineWidth = .8 * k; g.strokeRect(kx0 + size * .22, ky0 + size * .22, size * .56, size * .56);
  g.beginPath(); g.moveTo(kx0, ky0); g.lineTo(kx0 + size * .22, ky0 + size * .22); g.moveTo(kx0 + size, ky0); g.lineTo(kx0 + size * .78, ky0 + size * .22);
  g.moveTo(kx0, ky0 + size); g.lineTo(kx0 + size * .22, ky0 + size * .78); g.moveTo(kx0 + size, ky0 + size); g.lineTo(kx0 + size * .78, ky0 + size * .78); g.stroke();
  // Crenels along the keep's top edge.
  if (size > 14 * k) {
    g.fillStyle = INK;
    for (let i = 0, n = Math.max(3, Math.round(size / (4 * k))); i < n; i += 2) g.fillRect(kx0 + (i / n) * size, ky0 - 1.4 * k, size / n, 1.4 * k);
  }
  const pole = Math.max(9 * k, size * .7);
  g.strokeStyle = INK; g.lineWidth = 1 * k; g.lineCap = 'round';
  g.beginPath(); g.moveTo(kx, ky); g.lineTo(kx, ky - pole); g.stroke();
  g.beginPath(); g.moveTo(kx + .5 * k, ky - pole); g.quadraticCurveTo(kx + pole * .4, ky - pole * .92, kx + pole * .62, ky - pole * .78);
  g.quadraticCurveTo(kx + pole * .36, ky - pole * .72, kx + .5 * k, ky - pole * .56); g.closePath();
  g.fillStyle = VERMILION; g.fill(); g.strokeStyle = INK; g.lineWidth = .7 * k; g.stroke();
  // Round towers at the four corners, with crenel ticks when large enough.
  for (const [tx, ty] of [[x0, y0], [x1, y0], [x0, y1], [x1, y1]] as const) {
    const cx = tx + (tx === x0 ? tower * .45 : -tower * .45), cy = ty + (ty === y0 ? tower * .45 : -tower * .45);
    g.beginPath(); g.arc(cx, cy, tower, 0, Math.PI * 2); g.fillStyle = STONE; g.fill();
    g.strokeStyle = INK; g.lineWidth = 1.2 * k; g.stroke();
    if (tower > 5 * k) {
      g.beginPath(); g.arc(cx, cy, tower * .55, 0, Math.PI * 2); g.lineWidth = .6 * k; g.stroke();
      g.lineWidth = .9 * k;
      for (let i = 0; i < 10; i++) {
        const a = i / 10 * Math.PI * 2; g.beginPath();
        g.moveTo(cx + Math.cos(a) * tower, cy + Math.sin(a) * tower); g.lineTo(cx + Math.cos(a) * (tower - 1.6 * k), cy + Math.sin(a) * (tower - 1.6 * k)); g.stroke();
      }
    }
  }
  return { x0: x0 - tower, y0: Math.min(y0 - tower, ky - pole), x1: x1 + tower, y1: y1 + tower };
}

/** The anvil glyph, about 15 px wide at k = 1; returns its box. */
/** A place's marker: a small ink ring with a filled heart, like a pin on a paper map. */
function placeMark(g: G, x: number, y: number, k: number): Box {
  const r = 4.2 * k;
  g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2);
  g.fillStyle = WHITE; g.fill(); g.strokeStyle = INK; g.lineWidth = 1.6 * k; g.stroke();
  g.beginPath(); g.arc(x, y, r * .45, 0, Math.PI * 2); g.fillStyle = INK; g.fill();
  return { x0: x - r - 1, y0: y - r - 1, x1: x + r + 1, y1: y + r + 1 };
}

function anvil(g: G, x: number, y: number, k: number): Box {
  const u = k * 1.15;
  g.save(); g.translate(x, y);
  // Its stone hearth beneath: a soft soot ring.
  g.beginPath(); g.ellipse(0, 1.5 * u, 9.5 * u, 6 * u, 0, 0, Math.PI * 2); g.fillStyle = 'rgba(80,58,40,.18)'; g.fill();
  g.beginPath();
  g.moveTo(-7 * u, -3.4 * u); g.lineTo(5 * u, -3.4 * u); g.lineTo(8.4 * u, -3.4 * u); g.quadraticCurveTo(7.6 * u, -1.8 * u, 4.6 * u, -1.6 * u);
  g.quadraticCurveTo(2.6 * u, -.6 * u, 2.2 * u, .6 * u); g.lineTo(2.2 * u, 2.4 * u); g.lineTo(4.4 * u, 4.4 * u); g.lineTo(-4.4 * u, 4.4 * u); g.lineTo(-2.2 * u, 2.4 * u);
  g.lineTo(-2.2 * u, .6 * u); g.quadraticCurveTo(-3 * u, -1 * u, -7 * u, -1.7 * u); g.closePath();
  g.fillStyle = '#2e2119'; g.fill(); g.strokeStyle = INK; g.lineWidth = .7 * k; g.lineJoin = 'round'; g.stroke();
  g.beginPath(); g.moveTo(-6.2 * u, -3 * u); g.lineTo(4.8 * u, -3 * u); g.strokeStyle = 'rgba(255,240,210,.55)'; g.lineWidth = .6 * k; g.stroke();
  // An ember on the face and three sparks rising.
  g.beginPath(); g.arc(-.6 * u, -3.9 * u, 1.1 * u, 0, Math.PI * 2); g.fillStyle = VERMILION; g.fill();
  g.strokeStyle = VERMILION; g.lineWidth = .8 * k; g.lineCap = 'round';
  for (const [dx, dy, l] of [[-3, -6.5, 1.6], [.4, -7.6, 1.9], [3.2, -6.2, 1.5]] as const) {
    g.beginPath(); g.moveTo(dx * u, dy * u); g.lineTo((dx + dx * .12) * u, (dy - l) * u); g.stroke();
  }
  g.restore();
  return { x0: x - 10 * u, y0: y - 10 * u, x1: x + 10 * u, y1: y + 6 * u };
}

/* ------------------------------------------------------------------ the frame */

function townLayer(layers: Layers, town: TownMap, frame: MapFrame, k: number, W: number, H: number, s: number): TownLayer | null {
  const left = frame.centre[0] - (W / 2) * s, top = frame.centre[1] - (H / 2) * s;
  const right = left + W * s, bottom = top + H * s;
  const existing = layers.town;
  const keyBase = `${town.revision}|${frame.style}|${k}|${layers.epoch}`;
  if (existing && frame.quick && existing.key.startsWith(`${keyBase}|`)) return existing;
  const b = town.bounds, margin = 60;
  const fine = [b.minX, b.maxX, b.minZ, b.maxZ].every(Number.isFinite) && b.maxX >= b.minX && b.maxZ >= b.minZ;
  const whole = fine ? { minX: b.minX - margin, minZ: b.minZ - margin, maxX: b.maxX + margin, maxZ: b.maxZ + margin }
    : { minX: left, minZ: top, maxX: right, maxZ: bottom };
  const wholeW = Math.ceil((whole.maxX - whole.minX) / s), wholeH = Math.ceil((whole.maxZ - whole.minZ) / s);
  const scaleKey = s.toPrecision(6);
  if (wholeW <= LAYER_SIDE && wholeH <= LAYER_SIDE && wholeW * wholeH <= LAYER_PIXELS) {
    const key = `${keyBase}|${scaleKey}|whole`;
    if (existing?.key === key) return existing;
    return render(layers, town, frame.style, key, whole.minX, whole.minZ, s, Math.max(1, wholeW), Math.max(1, wholeH), k, true);
  }
  // Too fine to hold the whole town: hold the frame and as much again around it, and paint again on leaving it.
  if (existing && existing.key.startsWith(`${keyBase}|${scaleKey}|window`) && !existing.whole &&
    left >= existing.ox && top >= existing.oz && right <= existing.ox + existing.width * s && bottom <= existing.oz + existing.height * s) return existing;
  const ww = Math.min(LAYER_SIDE, W * 2), wh = Math.min(LAYER_SIDE, H * 2);
  const ox = frame.centre[0] - (ww / 2) * s, oz = frame.centre[1] - (wh / 2) * s;
  return render(layers, town, frame.style, `${keyBase}|${scaleKey}|window|${ox.toFixed(2)},${oz.toFixed(2)}`, ox, oz, s, ww, wh, k, false);
}

function render(layers: Layers, town: TownMap, style: MapStyle, key: string, ox: number, oz: number, s: number, width: number, height: number, k: number, whole: boolean): TownLayer | null {
  // Reuse the surface when the size holds; a new revision or scale paints over it.
  const reuse = layers.town && layers.town.surface.width === width && layers.town.surface.height === height ? layers.town.surface : null;
  const surface = reuse ?? layers.make(width, height);
  const g = context(surface);
  if (!g) return null;
  layers.townPaints++;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, width, height);
  const P: Projector = { x: x => (x - ox) / s, y: z => (z - oz) / s, s, k };
  paintTown(g, layers, town, style, P, width, height);
  layers.town = { key, surface, ox, oz, scale: s, width, height, whole };
  return layers.town;
}

/** What a painted map shows of people: you, and the friends `people` names. Nothing else is ever read. */
export function peopleOnMap(view: Pick<PlayMapView, 'people'>): { you: PlayMapView['people']['you']; friends: PlayMapView['people']['friends'] } {
  const you = view.people.you && [view.people.you.x, view.people.you.z, view.people.you.heading].every(Number.isFinite) ? view.people.you : null;
  return { you, friends: view.people.friends.filter(friend => Number.isFinite(friend.x) && Number.isFinite(friend.z)) };
}

/** Paint one frame of the map. Pass the map's own layers (`createMapLayers`) so the paper and the town are kept. */
export function paintTownMap(g: CanvasRenderingContext2D, view: PlayMapView, frame: MapFrame, layers?: MapLayers): void {
  const cache = (layers as Layers | undefined) ?? (shared ??= new Layers(defaultFactory));
  const k = Math.min(3, Math.max(1, Number.isFinite(frame.dpr) ? frame.dpr : 1));
  const W = Math.max(0, Math.round(frame.width * k)), H = Math.max(0, Math.round(frame.height * k));
  if (!W || !H || !(frame.metresPerPixel > 0) || !frame.centre.every(Number.isFinite)) return;
  const s = frame.metresPerPixel / k;
  const left = frame.centre[0] - (W / 2) * s, top = frame.centre[1] - (H / 2) * s;
  const X = (x: number) => (x - left) / s, Y = (z: number) => (z - top) / s;
  const page = frame.style === 'page';

  g.save();
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
  g.clearRect(0, 0, W, H);
  const ground = paper(cache, W, H, frame.style, k);
  if (ground) g.drawImage(image(ground), 0, 0);

  const layer = townLayer(cache, view.town, frame, k, W, H, s);
  if (layer) {
    g.globalCompositeOperation = 'multiply';
    const ratio = layer.scale / s;
    g.drawImage(image(layer.surface), X(layer.ox), Y(layer.oz), layer.width * ratio, layer.height * ratio);
    g.globalCompositeOperation = 'source-over';
  }

  const radius = Math.min(W, H) / 2;
  const onFrame = (x: number, y: number, pad: number) => page ? x >= -pad && x <= W + pad && y >= -pad && y <= H + pad
    : Math.hypot(x - W / 2, y - H / 2) <= radius + pad;

  // Your home, in lantern gold, on a soft wash of the same pigment.
  const home = view.home ? view.town.homes.find(candidate => candidate.id === view.home) ?? null : null;
  if (home) {
    const house = houseOf(home);
    const hx = X((house.minX + house.maxX) / 2), hy = Y((house.minZ + house.maxZ) / 2);
    if (onFrame(hx, hy, 40 * k)) {
      const r = Math.max(16 * k, Math.max(house.maxX - house.minX, house.maxZ - house.minZ) / s * 1.8);
      const halo = g.createRadialGradient(hx, hy, 0, hx, hy, r);
      halo.addColorStop(0, `rgba(${GOLD.halo},.5)`); halo.addColorStop(.45, `rgba(${GOLD.halo},.24)`); halo.addColorStop(1, `rgba(${GOLD.halo},0)`);
      g.fillStyle = halo; g.beginPath(); g.arc(hx, hy, r, 0, Math.PI * 2); g.fill();
      const x0 = X(house.minX), y0 = Y(house.minZ), x1 = X(house.maxX), y1 = Y(house.maxZ);
      const grow = Math.max(0, 5 * k - Math.min(x1 - x0, y1 - y0)) / 2;
      roof(g, x0 - grow, y0 - grow, x1 + grow, y1 + grow, house.ridge, { lit: GOLD.lit, shade: GOLD.shade, edge: GOLD.edge }, k);
    } else if (!page) {
      // Off the minimap: a gold pip on the rim, pointing the way.
      const a = Math.atan2(hy - H / 2, hx - W / 2), r = radius - 7 * k;
      const px = W / 2 + Math.cos(a) * r, py = H / 2 + Math.sin(a) * r;
      g.save(); g.translate(px, py); g.rotate(a);
      g.beginPath(); g.moveTo(4.6 * k, 0); g.lineTo(-2.6 * k, -3.8 * k); g.lineTo(-1.2 * k, 0); g.lineTo(-2.6 * k, 3.8 * k); g.closePath();
      g.fillStyle = GOLD.lit; g.fill(); g.strokeStyle = GOLD.edge; g.lineWidth = 1 * k; g.lineJoin = 'round'; g.stroke();
      g.restore();
    }
  }

  // The lantern line: gold dots along the street route, a lantern where the town set one out, a ring at your door.
  const route = view.route;
  if (route && route.points.length >= 2) {
    const pts = route.points.map(p => [X(p[0]), Y(p[2])] as const);
    const gap = (page ? 5.6 : 5) * k, dot = (page ? 1.35 : 1.2) * k;
    let carry = 0, along = 0;
    g.fillStyle = ROUTE.dot;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]!, b = pts[i]!, span = Math.hypot(b[0] - a[0], b[1] - a[1]);
      for (let t = carry; t < span; t += gap) {
        const x = a[0] + (b[0] - a[0]) * (t / span), y = a[1] + (b[1] - a[1]) * (t / span), d = along + t;
        if (onFrame(x, y, 4 * k)) {
          const shimmer = .5 + .5 * Math.sin(d / (26 * k) - frame.time * 2.4);
          g.globalAlpha = .7 + shimmer * .3;
          g.beginPath(); g.arc(x, y, dot * (.9 + shimmer * .25), 0, Math.PI * 2); g.fill();
        }
      }
      carry = ((carry - span) % gap + gap) % gap;
      along += span;
    }
    g.globalAlpha = 1;
    const stops = trailStops(route);
    const stride = Math.max(1, Math.ceil((26 * frame.metresPerPixel) / 7));
    for (let i = 0; i < stops.length; i += stride) {
      const stop = stops[i]!, x = X(stop.position[0]), y = Y(stop.position[2]);
      if (!onFrame(x, y, 6 * k)) continue;
      const r = (page ? 2.7 : 2.3) * k;
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fillStyle = ROUTE.lantern; g.fill();
      g.strokeStyle = ROUTE.ring; g.lineWidth = .9 * k; g.stroke();
      g.beginPath(); g.arc(x - r * .25, y - r * .3, r * .38, 0, Math.PI * 2); g.fillStyle = ROUTE.flame; g.fill();
    }
    const dx = X(route.door[0]), dy = Y(route.door[2]);
    if (onFrame(dx, dy, 6 * k)) {
      g.beginPath(); g.arc(dx, dy, 3.6 * k, 0, Math.PI * 2); g.strokeStyle = ROUTE.ring; g.lineWidth = 1.2 * k; g.stroke();
      g.beginPath(); g.arc(dx, dy, 1.6 * k, 0, Math.PI * 2); g.fillStyle = ROUTE.lantern; g.fill();
    }
  }

  const people = peopleOnMap(view);

  // Friends: indigo pins, named on the big map, small dots on the minimap.
  for (const friend of people.friends) {
    const x = X(friend.x), y = Y(friend.z);
    if (!onFrame(x, y, page ? 2 * k : -4 * k)) continue;
    if (page) {
      g.beginPath(); g.moveTo(x, y);
      g.bezierCurveTo(x - 2.4 * k, y - 4 * k, x - 5.4 * k, y - 6.4 * k, x - 5.4 * k, y - 9.6 * k);
      g.arc(x, y - 9.6 * k, 5.4 * k, Math.PI, 0); g.bezierCurveTo(x + 5.4 * k, y - 6.4 * k, x + 2.4 * k, y - 4 * k, x, y); g.closePath();
      g.fillStyle = FRIEND.fill; g.fill(); g.strokeStyle = PERSON_INK.friend; g.lineWidth = 1 * k; g.lineJoin = 'round'; g.stroke();
      g.beginPath(); g.arc(x, y - 9.6 * k, 2 * k, 0, Math.PI * 2); g.fillStyle = '#f3ead6'; g.fill();
      const size = 13 * k;
      g.font = `italic ${size}px ${FACE_BODY}`; g.textAlign = 'left'; g.textBaseline = 'middle';
      g.strokeStyle = 'rgba(248,240,220,.92)'; g.lineWidth = 3.2 * k; g.lineJoin = 'round';
      g.strokeText(friend.name, x + 8 * k, y - 9.6 * k); g.fillStyle = PERSON_INK.friend; g.fillText(friend.name, x + 8 * k, y - 9.6 * k);
    } else {
      g.beginPath(); g.arc(x, y, 2.7 * k, 0, Math.PI * 2); g.fillStyle = FRIEND.fill; g.fill();
      g.strokeStyle = PERSON_INK.friend; g.lineWidth = .9 * k; g.stroke();
      g.beginPath(); g.arc(x - .6 * k, y - .7 * k, .9 * k, 0, Math.PI * 2); g.fillStyle = FRIEND.hi; g.fill();
    }
  }

  // You: the camera's sight as a faint fan of ink, and the brass needle along your heading.
  if (people.you) {
    const x = X(people.you.x), y = Y(people.you.z);
    if (onFrame(x, y, 8 * k)) {
      const scale = (page ? 1.2 : 1) * k;
      if (view.view !== null && Number.isFinite(view.view)) {
        const facing = Math.atan2(Math.cos(view.view), Math.sin(view.view)), reach = (page ? 40 : 30) * k;
        const fan = g.createRadialGradient(x, y, 0, x, y, reach);
        fan.addColorStop(0, 'rgba(74,52,30,.26)'); fan.addColorStop(1, 'rgba(74,52,30,0)');
        g.beginPath(); g.moveTo(x, y); g.arc(x, y, reach, facing - .55, facing + .55); g.closePath(); g.fillStyle = fan; g.fill();
      }
      g.save(); g.translate(x, y); g.rotate(Math.PI - people.you.heading); g.scale(scale, scale);
      // Its shadow on the paper, then the brass.
      g.beginPath(); g.moveTo(1, -8.6); g.lineTo(5.6, 3.4); g.lineTo(1, 1.4); g.lineTo(-3.6, 3.4); g.closePath(); g.fillStyle = 'rgba(40,24,10,.32)'; g.fill();
      g.beginPath(); g.moveTo(0, -10); g.lineTo(5.2, 3.6); g.lineTo(0, 1.2); g.lineTo(-5.2, 3.6); g.closePath();
      const brass = g.createLinearGradient(-5, 0, 5, 0);
      brass.addColorStop(0, '#fbe7b0'); brass.addColorStop(.48, '#d7ad63'); brass.addColorStop(.52, '#a57a3a'); brass.addColorStop(1, '#7c5a2a');
      g.fillStyle = brass; g.fill();
      g.strokeStyle = PERSON_INK.you; g.lineWidth = 1.05; g.lineJoin = 'round'; g.stroke();
      g.beginPath(); g.arc(0, -.6, 1.5, 0, Math.PI * 2); g.fillStyle = PERSON_INK.you; g.fill();
      g.restore();
    }
  }

  // The big map's scale, in metres that are true.
  if (page) scaleBar(g, frame.metresPerPixel, k, H);
  g.restore();
}

const NICE = [5, 10, 20, 25, 50, 100, 200, 250, 500, 1000];
function scaleBar(g: CanvasRenderingContext2D, mpp: number, k: number, H: number) {
  const metres = NICE.find(m => m / mpp >= 64) ?? NICE[NICE.length - 1]!;
  const length = (metres / mpp) * k, x = 16 * k, y = H - 18 * k, h = 4 * k;
  g.save();
  g.fillStyle = 'rgba(250,242,222,.75)'; g.fillRect(x - 6 * k, y - 18 * k, length + 12 * k, 30 * k);
  for (let i = 0; i < 4; i++) { g.fillStyle = i % 2 ? '#fbf3df' : INK; g.fillRect(x + (length / 4) * i, y, length / 4, h); }
  g.strokeStyle = INK; g.lineWidth = .9 * k; g.strokeRect(x, y, length, h);
  g.font = `${12 * k}px ${FACE_LABEL}`; g.textAlign = 'left'; g.textBaseline = 'alphabetic'; g.fillStyle = INK;
  g.fillText('0', x - 2 * k, y - 4 * k);
  g.textAlign = 'right'; g.fillText(`${metres} m`, x + length + 4 * k, y - 4 * k);
  g.restore();
}

/** A frame that fits the whole town into width × height CSS pixels, with `pad` pixels of paper around it. */
export function fitTown(town: TownMap, width: number, height: number, pad = 24): { centre: [number, number]; metresPerPixel: number } {
  const b = town.bounds;
  const fine = [b.minX, b.maxX, b.minZ, b.maxZ].every(Number.isFinite) && b.maxX > b.minX && b.maxZ > b.minZ;
  if (!fine || width <= pad * 2 || height <= pad * 2) return { centre: [0, 0], metresPerPixel: 1 };
  return {
    centre: [(b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2],
    metresPerPixel: Math.max((b.maxX - b.minX) / (width - pad * 2), (b.maxZ - b.minZ) / (height - pad * 2)),
  };
}
