import type { DecorMark, Ring } from '../data/model';
import { DECOR_SPACING, TILE_PX, decorBand, levelScale, tileBox, type Pyramid, type TileKey } from './pyramid';
import { GRAPHITE, INK, LAND, SEA, SEA_WASH, mixHex, regionTint, rgba } from './theme';

/**
 * Paints one land tile with Canvas 2D: sea and coastal wash, ink ripple lines, watercolour land with community
 * blooms and pooled edges, an ink coast with fine fractal detail, graphite on waiting land, stamped terrain and
 * paper grain. Everything is keyed to world position or seeded, so two workers baking neighbouring tiles agree
 * along their shared edge. Runs in a worker (OffscreenCanvas) or, without workers, on the main thread.
 */
export type Canvas2D = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;
/**
 * Tiles are rasterised on the CPU inside the bakers. A GPU-backed 2D canvas would defer every path to the one GPU
 * process and stall the map's own WebGL uploads behind it; CPU canvases keep baking parallel and predictable.
 */
export const SOFTWARE = { willReadFrequently: true } as const;
export type MakeCanvas = (width: number, height: number) => OffscreenCanvas | HTMLCanvasElement;

export interface StampFrame { x: number; y: number; w: number; h: number }
export interface Stamp { group: string; ink: StampFrame; fill: StampFrame | null; anchor: { x: number; y: number }; w: number; h: number }
export interface StampSheet { image: CanvasImageSource; stamps: Stamp[] }

/** A patch of ground (a cluster) or a whole realm, washed in its realm's tint. */
export interface PaintCluster { x: number; y: number; r: number; region: number; tint: string }
export interface PaintRealm { x: number; y: number; r: number; tint: string }

export interface PaintScene {
  pyramid: Pyramid;
  rings: Ring[];
  regionCount: number;
  /** The base pigment of each region's land, by region index. */
  regionTints: string[];
  realms: PaintRealm[];
  clusters: PaintCluster[];
  decor: DecorMark[];
  stamps: StampSheet | null;
}

const RIPPLES = [4, 8.5, 13.5, 19.5, 26.5, 34.5];
const RIPPLE_ALPHA = [0.5, 0.4, 0.31, 0.23, 0.16, 0.1];
const MARGIN_PX = 76;
const REALM_WASH = [[0, 0.34], [0.72, 0.28], [1, 0]] as const;
const CLUSTER_BLOOM = [[0, 0.26], [0.7, 0.18], [1, 0]] as const;

/** Seeded PRNG, so every worker draws the same paper. */
function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashPoint(x: number, y: number): number {
  let h = Math.imul(Math.round(x * 64) | 0, 0x27d4eb2d) ^ Math.imul(Math.round(y * 64) | 0, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

/** Periodic value noise on a size×size canvas: soft watercolour mottling and large paper stains. */
function mottleCanvas(make: MakeCanvas, size: number, seed: number): OffscreenCanvas | HTMLCanvasElement {
  const canvas = make(size, size);
  const ctx = canvas.getContext('2d', SOFTWARE) as Canvas2D;
  const image = ctx.createImageData(size, size);
  const random = mulberry(seed);
  const octaves = [8, 16, 32, 64].map((cells) => {
    const lattice = new Float32Array(cells * cells);
    for (let i = 0; i < lattice.length; i++) lattice[i] = random();
    return { cells, lattice };
  });
  const smooth = (t: number) => t * t * (3 - 2 * t);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let value = 0;
      let weight = 0;
      let amplitude = 1;
      for (const { cells, lattice } of octaves) {
        const fx = (x / size) * cells;
        const fy = (y / size) * cells;
        const x0 = Math.floor(fx);
        const y0 = Math.floor(fy);
        const tx = smooth(fx - x0);
        const ty = smooth(fy - y0);
        const at = (i: number, j: number) => lattice[((j % cells) * cells) + (i % cells)]!;
        const a = at(x0, y0);
        const b = at(x0 + 1, y0);
        const c = at(x0, y0 + 1);
        const d = at(x0 + 1, y0 + 1);
        value += amplitude * (a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty);
        weight += amplitude;
        amplitude *= 0.55;
      }
      const v = value / weight;
      const shade = Math.round(255 - Math.max(0, v - 0.28) * 120);
      const k = (y * size + x) * 4;
      image.data[k] = shade;
      image.data[k + 1] = Math.round(255 - Math.max(0, v - 0.28) * 132);
      image.data[k + 2] = Math.round(255 - Math.max(0, v - 0.28) * 150);
      image.data[k + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

/** Paper fibres and tooth, tiled seamlessly by drawing each fibre at its wrapped copies too. */
function grainCanvas(make: MakeCanvas, size: number, seed: number): OffscreenCanvas | HTMLCanvasElement {
  const canvas = make(size, size);
  const ctx = canvas.getContext('2d', SOFTWARE) as Canvas2D;
  const random = mulberry(seed);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size, size);
  const image = ctx.getImageData(0, 0, size, size);
  for (let i = 0; i < image.data.length; i += 4) {
    const n = (random() - 0.5) * 14;
    image.data[i] = 248 + n;
    image.data[i + 1] = 246 + n;
    image.data[i + 2] = 242 + n;
  }
  ctx.putImageData(image, 0, 0);
  ctx.lineCap = 'round';
  for (let i = 0; i < 260; i++) {
    const x = random() * size;
    const y = random() * size;
    const length = 6 + random() * 22;
    const angle = random() * Math.PI;
    const bend = (random() - 0.5) * 8;
    ctx.strokeStyle = `rgba(120, 96, 64, ${0.05 + random() * 0.08})`;
    ctx.lineWidth = 0.5 + random() * 0.7;
    for (const ox of [-size, 0, size]) {
      for (const oy of [-size, 0, size]) {
        ctx.beginPath();
        ctx.moveTo(x + ox, y + oy);
        ctx.quadraticCurveTo(x + ox + Math.cos(angle) * length * 0.5 - Math.sin(angle) * bend, y + oy + Math.sin(angle) * length * 0.5 + Math.cos(angle) * bend,
          x + ox + Math.cos(angle) * length, y + oy + Math.sin(angle) * length);
        ctx.stroke();
      }
    }
  }
  return canvas;
}

/** Loose graphite hatching for waiting land, seen from realm distance inwards. */
function hatchCanvas(make: MakeCanvas, size: number, seed: number): OffscreenCanvas | HTMLCanvasElement {
  const canvas = make(size, size);
  const ctx = canvas.getContext('2d', SOFTWARE) as Canvas2D;
  const random = mulberry(seed);
  ctx.lineCap = 'round';
  for (let i = 0; i < 70; i++) {
    const x = random() * size;
    const y = random() * size;
    const strokes = 3 + Math.floor(random() * 4);
    const length = 5 + random() * 6;
    ctx.strokeStyle = rgba(GRAPHITE, 0.16 + random() * 0.14);
    ctx.lineWidth = 0.6;
    for (let s = 0; s < strokes; s++) {
      const sx = x + s * 2.1;
      const sy = y + s * 0.4;
      for (const ox of [-size, 0, size]) {
        for (const oy of [-size, 0, size]) {
          ctx.beginPath();
          ctx.moveTo(sx + ox, sy + oy + length * 0.5);
          ctx.lineTo(sx + ox + length * 0.55, sy + oy - length * 0.5);
          ctx.stroke();
        }
      }
    }
  }
  return canvas;
}

interface PaperKit {
  mottle: OffscreenCanvas | HTMLCanvasElement;
  grain: OffscreenCanvas | HTMLCanvasElement;
  hatch: OffscreenCanvas | HTMLCanvasElement;
  layer: OffscreenCanvas | HTMLCanvasElement | null;
  tinted: Map<string, OffscreenCanvas | HTMLCanvasElement>;
  byGroup: Map<string, Stamp[]>;
  decorGrid: Map<string, DecorMark[]>;
}

const DECOR_CELL = 96;

export class TilePainter {
  private kit: PaperKit | null = null;

  constructor(private readonly scene: PaintScene, private readonly make: MakeCanvas) {}

  private prepare(): PaperKit {
    if (this.kit) return this.kit;
    const byGroup = new Map<string, Stamp[]>();
    for (const stamp of this.scene.stamps?.stamps ?? []) {
      const list = byGroup.get(stamp.group);
      if (list) list.push(stamp);
      else byGroup.set(stamp.group, [stamp]);
    }
    const decorGrid = new Map<string, DecorMark[]>();
    for (const mark of this.scene.decor) {
      const key = `${Math.floor(mark.x / DECOR_CELL)},${Math.floor(mark.y / DECOR_CELL)}`;
      const list = decorGrid.get(key);
      if (list) list.push(mark);
      else decorGrid.set(key, [mark]);
    }
    this.kit = {
      mottle: mottleCanvas(this.make, 512, 0x51a7e),
      grain: grainCanvas(this.make, 256, 0xf1b4e),
      hatch: hatchCanvas(this.make, 192, 0x9a7c4),
      layer: null,
      tinted: new Map(),
      byGroup,
      decorGrid,
    };
    return this.kit;
  }

  /** The stamp atlas with every fill silhouette tinted to a land colour (fills are white masks). */
  private tinted(kit: PaperKit, colour: string): OffscreenCanvas | HTMLCanvasElement | null {
    const sheet = this.scene.stamps;
    if (!sheet) return null;
    let canvas = kit.tinted.get(colour);
    if (!canvas) {
      const source = sheet.image as { width: number; height: number };
      canvas = this.make(source.width, source.height);
      const ctx = canvas.getContext('2d', SOFTWARE) as Canvas2D;
      ctx.drawImage(sheet.image, 0, 0);
      ctx.globalCompositeOperation = 'source-in';
      ctx.fillStyle = colour;
      ctx.fillRect(0, 0, source.width, source.height);
      kit.tinted.set(colour, canvas);
    }
    return canvas;
  }

  paint(ctx: Canvas2D, key: TileKey, pixelRatio: number): void {
    const kit = this.prepare();
    const { pyramid } = this.scene;
    const box = tileBox(pyramid, key);
    const scale = levelScale(pyramid, key.level);
    const marginWorld = MARGIN_PX / scale;
    const clip = { minX: box.minX - marginWorld, minY: box.minY - marginWorld, maxX: box.maxX + marginWorld, maxY: box.maxY + marginWorld };
    const toX = (x: number) => (x - box.minX) * scale;
    const toY = (y: number) => (y - box.minY) * scale;
    const size = TILE_PX;
    ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;

    // Paths per region, in tile CSS px.
    const byRegion = new Map<number, Path2D>();
    const all = new Path2D();
    let any = false;
    for (const ring of this.scene.rings) {
      if (ring.maxX < clip.minX || ring.minX > clip.maxX || ring.maxY < clip.minY || ring.minY > clip.maxY) continue;
      const points = clipPolygon(detailRing(ring.points, scale, clip), clip);
      if (points.length < 6) continue;
      const path = new Path2D();
      path.moveTo(toX(points[0]!), toY(points[1]!));
      for (let p = 2; p < points.length; p += 2) path.lineTo(toX(points[p]!), toY(points[p + 1]!));
      path.closePath();
      let regionPath = byRegion.get(ring.region);
      if (!regionPath) byRegion.set(ring.region, (regionPath = new Path2D()));
      regionPath.addPath(path);
      all.addPath(path);
      any = true;
    }

    // Sea: parchment with a cool wash gathering along the coasts.
    ctx.fillStyle = SEA;
    ctx.fillRect(0, 0, size, size);
    this.pattern(ctx, kit.mottle, key, 512, 'multiply', 0.22);
    if (any) {
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      for (const [width, alpha] of [[70, 0.07], [44, 0.08], [24, 0.1], [11, 0.12]] as const) {
        ctx.strokeStyle = rgba(SEA_WASH, alpha);
        ctx.lineWidth = width;
        ctx.stroke(all);
      }
      // Ripple lines, drawn outermost first on their own layer so each erases only what lies inside it.
      const layer = kit.layer ?? (kit.layer = this.make(size * pixelRatio, size * pixelRatio));
      if (layer.width !== size * pixelRatio) {
        layer.width = size * pixelRatio;
        layer.height = size * pixelRatio;
      }
      const lctx = layer.getContext('2d', SOFTWARE) as Canvas2D;
      lctx.setTransform(1, 0, 0, 1, 0, 0);
      lctx.clearRect(0, 0, layer.width, layer.height);
      lctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      lctx.lineJoin = 'round';
      const count = key.level <= 3 ? 4 : RIPPLES.length;
      for (let i = count - 1; i >= 0; i--) {
        const w = RIPPLES[i]!;
        lctx.globalCompositeOperation = 'source-over';
        lctx.strokeStyle = rgba(INK, RIPPLE_ALPHA[i]!);
        lctx.lineWidth = w * 2;
        lctx.stroke(all);
        lctx.globalCompositeOperation = 'destination-out';
        lctx.strokeStyle = '#000';
        lctx.lineWidth = w * 2 - 1.15;
        lctx.stroke(all);
      }
      lctx.globalCompositeOperation = 'source-over';
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(layer, 0, 0);
      ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);

      // Watercolour land, one tint per language.
      for (const [region, path] of byRegion) {
        ctx.fillStyle = mixHex(LAND, this.tint(region), 0.46);
        ctx.fill(path, 'evenodd');
      }
      ctx.save();
      ctx.clip(all, 'evenodd');
      this.pattern(ctx, kit.mottle, key, 512, 'multiply', 0.55);
      this.blooms(ctx, clip, toX, toY, scale);
      if (scale >= 2.5) this.pattern(ctx, kit.hatch, key, 192, 'source-over', Math.min(0.55, (scale - 2.5) * 0.18));
      // Pigment pools along the shore, darker at the very edge as wet paint does.
      for (const [region, path] of byRegion) {
        const edge = mixHex(this.tint(region), INK, 0.3);
        for (const [width, alpha] of [[18, 0.06], [9, 0.08], [3.5, 0.13]] as const) {
          ctx.strokeStyle = rgba(edge, alpha);
          ctx.lineWidth = width;
          ctx.stroke(path);
        }
      }
      ctx.restore();

      // The coast itself: one confident ink line.
      ctx.strokeStyle = rgba(INK, 0.9);
      ctx.lineWidth = key.level >= 6 ? 1.5 : 1.25;
      ctx.stroke(all);
      this.decor(ctx, kit, clip, toX, toY, scale);
    } else {
      this.decor(ctx, kit, clip, toX, toY, scale);
    }
    this.pattern(ctx, kit.grain, key, 256, 'multiply', 0.85);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }

  /** A seamless pattern, anchored to the level's pixel grid so neighbouring tiles continue it. */
  private pattern(ctx: Canvas2D, image: OffscreenCanvas | HTMLCanvasElement, key: TileKey, period: number, mode: GlobalCompositeOperation, alpha: number): void {
    const pattern = ctx.createPattern(image as CanvasImageSource, 'repeat');
    if (!pattern) return;
    const ox = -((key.tx * TILE_PX) % period);
    const oy = -((key.ty * TILE_PX) % period);
    ctx.save();
    ctx.globalCompositeOperation = mode;
    ctx.globalAlpha = alpha;
    ctx.translate(ox, oy);
    ctx.fillStyle = pattern;
    ctx.fillRect(-ox, -oy, TILE_PX, TILE_PX);
    ctx.restore();
  }

  private tint(region: number): string {
    return this.scene.regionTints[region] ?? regionTint(region);
  }

  /**
   * Each realm lays one soft wash over its ground, and its patches bloom in the same tint on top, so a realm reads
   * as one place and its neighbour as another.
   */
  private blooms(ctx: Canvas2D, clip: { minX: number; minY: number; maxX: number; maxY: number }, toX: (x: number) => number, toY: (y: number) => number, scale: number): void {
    const wash = (circle: PaintRealm, reach: number, stops: readonly (readonly [number, number])[]) => {
      if (circle.x + reach < clip.minX || circle.x - reach > clip.maxX || circle.y + reach < clip.minY || circle.y - reach > clip.maxY) return;
      const x = toX(circle.x);
      const y = toY(circle.y);
      const radius = reach * scale;
      const gradient = ctx.createRadialGradient(x, y, radius * 0.15, x, y, radius);
      for (const [at, alpha] of stops) gradient.addColorStop(at, rgba(circle.tint, alpha));
      ctx.fillStyle = gradient;
      ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    };
    for (const realm of this.scene.realms) wash(realm, realm.r * 1.08, REALM_WASH);
    for (const cluster of this.scene.clusters) wash(cluster, cluster.r * 1.15, CLUSTER_BLOOM);
  }

  private decor(ctx: Canvas2D, kit: PaperKit, clip: { minX: number; minY: number; maxX: number; maxY: number }, toX: (x: number) => number, toY: (y: number) => number, scale: number): void {
    const sheet = this.scene.stamps;
    if (!sheet) return;
    const band = decorBand(scale);
    const bit = 1 << band;
    const spacingPx = DECOR_SPACING[band]! * scale;
    const marks: DecorMark[] = [];
    const reach = 200 / scale;
    const gx0 = Math.floor((clip.minX - reach) / DECOR_CELL);
    const gx1 = Math.floor((clip.maxX + reach) / DECOR_CELL);
    const gy0 = Math.floor((clip.minY - reach) / DECOR_CELL);
    const gy1 = Math.floor((clip.maxY + reach) / DECOR_CELL);
    for (let gy = gy0; gy <= gy1; gy++) {
      for (let gx = gx0; gx <= gx1; gx++) {
        for (const mark of kit.decorGrid.get(`${gx},${gy}`) ?? []) if (mark.bands & bit) marks.push(mark);
      }
    }
    marks.sort((a, b) => a.y - b.y || a.x - b.x);
    const fillColour = mixHex(LAND, '#fffaf0', 0.35);
    const tinted = this.tinted(kit, fillColour);
    for (const mark of marks) {
      const stamps = kit.byGroup.get(mark.kind);
      if (!stamps?.length) continue;
      const stamp = stamps[mark.variant % stamps.length]!;
      const width = stampWidth(mark.kind, spacingPx, mark.variant);
      const height = (width * stamp.h) / stamp.w;
      const x = toX(mark.x) - stamp.anchor.x * width;
      const y = toY(mark.y) - stamp.anchor.y * height;
      if (x > TILE_PX + 4 || y > TILE_PX + 4 || x + width < -4 || y + height < -4) continue;
      if (stamp.fill && tinted) ctx.drawImage(tinted as CanvasImageSource, stamp.fill.x, stamp.fill.y, stamp.fill.w, stamp.fill.h, x, y, width, height);
      ctx.globalAlpha = mark.kind === 'monster' || mark.kind === 'ship' ? 0.82 : 0.9;
      ctx.drawImage(sheet.image, stamp.ink.x, stamp.ink.y, stamp.ink.w, stamp.ink.h, x, y, width, height);
      ctx.globalAlpha = 1;
    }
  }
}

/** On-screen stamp width: about the band's spacing, so the land reads as stamped, never as wallpaper. */
export function stampWidth(kind: DecorMark['kind'], spacingPx: number, variant: number): number {
  const jitter = 0.86 + ((variant * 37) % 29) / 100;
  switch (kind) {
    case 'mountain': return Math.min(68, Math.max(20, spacingPx * 0.92)) * jitter;
    case 'hill': return Math.min(50, Math.max(16, spacingPx * 0.66)) * jitter;
    case 'forest': return Math.min(46, Math.max(15, spacingPx * 0.6)) * jitter;
    case 'marsh': return Math.min(40, Math.max(14, spacingPx * 0.5)) * jitter;
    case 'ship': return 58 * jitter;
    case 'monster': return 150 * jitter;
  }
}

/**
 * Fine coast detail: segments near the tile are split with seeded midpoint displacement until they are a few
 * pixels long. The displacement depends only on the segment's own world endpoints, so every tile at this level
 * draws exactly the same coast.
 */
export function detailRing(points: Float64Array, scale: number, clip: { minX: number; minY: number; maxX: number; maxY: number }): number[] {
  const out: number[] = [];
  const n = points.length / 2;
  const minPx = 4.5;
  const split = (ax: number, ay: number, bx: number, by: number, depth: number) => {
    const dx = bx - ax;
    const dy = by - ay;
    const length = Math.hypot(dx, dy);
    if (length * scale <= minPx || depth > 9) {
      out.push(bx, by);
      return;
    }
    const h = hashPoint(ax + bx * 0.618, ay + by * 0.618) - 0.5;
    const offset = h * length * 0.28;
    const mx = (ax + bx) / 2 - (dy / length) * offset;
    const my = (ay + by) / 2 + (dx / length) * offset;
    split(ax, ay, mx, my, depth + 1);
    split(mx, my, bx, by, depth + 1);
  };
  for (let p = 0; p < n; p++) {
    const q = (p + 1) % n;
    const ax = points[p * 2]!;
    const ay = points[p * 2 + 1]!;
    const bx = points[q * 2]!;
    const by = points[q * 2 + 1]!;
    if (p === 0) out.push(ax, ay);
    // Displacement can carry a segment sideways by up to ~0.3 of its length, so a neighbour tile's detail may
    // reach into this one: widen the test by that much or the coast steps at the seam.
    const reach = Math.hypot(bx - ax, by - ay) * 0.3;
    const near = !(Math.max(ax, bx) + reach < clip.minX || Math.min(ax, bx) - reach > clip.maxX || Math.max(ay, by) + reach < clip.minY || Math.min(ay, by) - reach > clip.maxY);
    if (near) split(ax, ay, bx, by, 0);
    else out.push(bx, by);
  }
  out.length -= 2; // the closing point repeats the first
  return out;
}

/** Sutherland–Hodgman against an axis-aligned box; degenerate edges fall on the box, outside the visible tile. */
export function clipPolygon(points: number[], box: { minX: number; minY: number; maxX: number; maxY: number }): number[] {
  let input = points;
  const edges: [(x: number, y: number) => boolean, (ax: number, ay: number, bx: number, by: number) => [number, number]][] = [
    [(x) => x >= box.minX, (ax, ay, bx, by) => [box.minX, ay + ((by - ay) * (box.minX - ax)) / (bx - ax)]],
    [(x) => x <= box.maxX, (ax, ay, bx, by) => [box.maxX, ay + ((by - ay) * (box.maxX - ax)) / (bx - ax)]],
    [(_, y) => y >= box.minY, (ax, ay, bx, by) => [ax + ((bx - ax) * (box.minY - ay)) / (by - ay), box.minY]],
    [(_, y) => y <= box.maxY, (ax, ay, bx, by) => [ax + ((bx - ax) * (box.maxY - ay)) / (by - ay), box.maxY]],
  ];
  for (const [inside, cross] of edges) {
    const n = input.length / 2;
    if (n === 0) return [];
    const output: number[] = [];
    for (let p = 0; p < n; p++) {
      const ax = input[((p + n - 1) % n) * 2]!;
      const ay = input[((p + n - 1) % n) * 2 + 1]!;
      const bx = input[p * 2]!;
      const by = input[p * 2 + 1]!;
      const aIn = inside(ax, ay);
      const bIn = inside(bx, by);
      if (bIn) {
        if (!aIn) output.push(...cross(ax, ay, bx, by));
        output.push(bx, by);
      } else if (aIn) output.push(...cross(ax, ay, bx, by));
    }
    input = output;
  }
  return input;
}
