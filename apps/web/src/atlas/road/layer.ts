import { CanvasSource, Container, Graphics, Sprite, Texture } from 'pixi.js';
import { drawShield, SHIELD_ASPECT, shieldDesign, TINCTURES, type Tincture } from '../heraldry';
import type { Camera, Viewport } from '../map/camera';
import { GRAPHITE, INK, PAPER } from '../map/theme';
import { caravanLayout, type Marcher } from './caravan';
import { roadStretch, sampleRoad, type RoadPath } from './geometry';

/**
 * The raid's road and its torch column, drawn on the Atlas in the map's own media (Artstyle §12): sepia ink for the
 * road, pencil for the way still ahead, watercolour for cloaks and flames. The Atlas has no night, so a torch is a dab
 * of gamboge and burnt sienna on paper with a pale wash around it, never a glow. Drawn in screen space each frame, so
 * strokes keep their weight at every distance. The road lies under the holdings' marks and names; the column walks
 * over them.
 */

/** A layer the map draws with its own camera: `under` sits beneath the holdings' marks, `over` above them. */
export interface MapLayer {
  readonly under: Container;
  readonly over: Container;
  /** True while the layer changes by itself (the column walks, the torches flicker). */
  readonly animating: boolean;
  update(camera: Camera, view: Viewport, now: number): void;
}

/** Torch pigments: gamboge laid thin, burnt sienna at the heart, a pale ochre wash where the light falls. */
const GAMBOGE = '#e2a23a';
const SIENNA = '#b0532a';
const OCHRE_WASH = '#e8b864';
/** A road trodden into the paper under the ink line. */
const TRODDEN = '#a98457';

export interface RoadStyle {
  /** The raiding channel's ID: the column wears its tinctures and the bearer carries its arms. */
  sourceId: string;
  /** Figures in the column (see `caravanCount`). */
  count: number;
}

export interface RoadState {
  /** The head of the column, as a fraction of the road (it runs past 1 while the column files in). */
  head: number;
  /** How far the road is inked behind the column (0…1). The rest is drawn in pencil as the way ahead. */
  inked: number;
  /** Seconds of presentation time, for the walk and the flames. Frozen in reduced motion. */
  time: number;
  /** 0…1: the whole layer's opacity, for the rise in and the drawing's wake. */
  opacity: number;
  /** Whether the column walks at all (it waits at the gate before departure, and is gone after arrival). */
  marching: boolean;
}

export class RoadLayer implements MapLayer {
  readonly under = new Container();
  readonly over = new Container();
  private readonly road = new Graphics();
  private readonly column = new Graphics();
  private readonly shield: Sprite;
  private readonly cloth: { field: string; fieldDeep: string; second: string; secondDeep: string };
  private state: RoadState = { head: 0, inked: 0, time: 0, opacity: 1, marching: false };
  private changed = true;
  /** Screen position of the column's banner-bearer (or the head of the road) in the last frame drawn. */
  head: { x: number; y: number; visible: boolean } = { x: 0, y: 0, visible: false };
  /** Screen positions of both ends of the road in the last frame drawn. */
  ends: { from: { x: number; y: number }; to: { x: number; y: number } } = { from: { x: 0, y: 0 }, to: { x: 0, y: 0 } };

  constructor(private readonly path: RoadPath, private readonly style: RoadStyle, private readonly pixelRatio = 1) {
    const design = shieldDesign(style.sourceId);
    const swatch = (t: Tincture) => TINCTURES[t];
    this.cloth = { field: swatch(design.field).pigment, fieldDeep: swatch(design.field).pooled, second: swatch(design.second).pigment, secondDeep: swatch(design.second).pooled };
    const width = 22;
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil((width + 8) * pixelRatio);
    canvas.height = Math.ceil((width * SHIELD_ASPECT + 8) * pixelRatio);
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.scale(pixelRatio, pixelRatio);
      drawShield(ctx, design, 4, 4, width, { halo: true, pixelRatio });
    }
    this.shield = new Sprite(new Texture({ source: new CanvasSource({ resource: canvas, resolution: pixelRatio }) }));
    this.shield.anchor.set(0.5, 1);
    this.under.addChild(this.road);
    this.over.addChild(this.column, this.shield);
  }

  get animating(): boolean {
    return this.changed;
  }

  set(next: Partial<RoadState>): void {
    const merged = { ...this.state, ...next };
    if (merged.head === this.state.head && merged.inked === this.state.inked && merged.time === this.state.time
      && merged.opacity === this.state.opacity && merged.marching === this.state.marching) return;
    this.state = merged;
    this.changed = true;
  }

  update(camera: Camera, view: Viewport): void {
    this.changed = false;
    const { head, inked, time, opacity, marching } = this.state;
    this.under.alpha = opacity;
    this.over.alpha = opacity;
    const screen = (points: number[]) => {
      const out: number[] = [];
      for (let i = 0; i < points.length; i += 2) {
        const s = camera.worldToScreen(points[i]!, points[i + 1]!, view);
        out.push(s.x, s.y);
      }
      return out;
    };
    const from = sampleRoad(this.path, 0), to = sampleRoad(this.path, 1);
    this.ends = { from: camera.worldToScreen(from.x, from.y, view), to: camera.worldToScreen(to.x, to.y, view) };
    this.drawRoad(screen, inked);
    this.drawColumn(camera, view, marching ? head : -1, time);
  }

  private drawRoad(screen: (points: number[]) => number[], inked: number): void {
    const g = this.road;
    g.clear();
    const ahead = screen(roadStretch(this.path, inked, 1));
    const behind = screen(roadStretch(this.path, 0, inked));
    // The way ahead in pencil: a light dotted survey line the column will ink as it passes.
    dashed(g, ahead, 2.6, 5.2);
    g.stroke({ color: GRAPHITE, width: 1.3, alpha: 0.55, cap: 'round' });
    if (behind.length >= 4) {
      if (this.path.sea) {
        dashed(g, behind, 7, 5);
        g.stroke({ color: INK, width: 1.9, alpha: 0.85, cap: 'round' });
        return;
      }
      polyline(g, behind);
      g.stroke({ color: TRODDEN, width: 7, alpha: 0.2, cap: 'round', join: 'round' });
      polyline(g, behind);
      g.stroke({ color: INK, width: 2.1, alpha: 0.88, cap: 'round', join: 'round' });
      // The last stretch is still wet: a touch heavier where the pen has just passed.
      const wet = screen(roadStretch(this.path, Math.max(0, inked - 0.035), inked));
      if (wet.length >= 4) {
        polyline(g, wet);
        g.stroke({ color: INK, width: 2.8, alpha: 0.95, cap: 'round', join: 'round' });
      }
    }
  }

  private drawColumn(camera: Camera, view: Viewport, head: number, time: number): void {
    const g = this.column;
    g.clear();
    this.shield.visible = false;
    this.head.visible = false;
    if (head < 0) return;
    const marchers = caravanLayout(this.path, head, this.style.count, camera.scale, time);
    const h = figureHeight(camera.scale);
    // Back to front, so the banner-bearer is drawn last and nearest.
    for (let i = marchers.length - 1; i >= 0; i--) {
      const m = marchers[i]!;
      const s = camera.worldToScreen(m.x, m.y, view);
      this.figure(g, m, s.x, s.y, h);
      if (m.role === 'standard') {
        this.head = { x: s.x, y: s.y, visible: true };
        this.shield.visible = true;
        this.shield.position.set(Math.round(s.x + (Math.cos(m.angle) >= 0 ? 1 : -1) * h * 0.18), Math.round(s.y - h * 1.72));
      }
    }
  }

  /** One marcher in ink and wash, standing upright on the paper and facing the way the road runs. */
  private figure(g: Graphics, m: Marcher, x: number, y: number, h: number): void {
    const dir = Math.cos(m.angle) >= 0 ? 1 : -1;
    const swing = Math.sin(m.phase * Math.PI * 2);
    const bob = Math.abs(Math.cos(m.phase * Math.PI * 2)) * h * 0.03;
    const top = y - bob;
    const alt = m.index % 3 === 2;
    const cloak = alt ? this.cloth.second : this.cloth.field;
    const trim = alt ? this.cloth.field : this.cloth.second;
    // A shadow pooled under the feet.
    g.ellipse(x, y + 0.5, h * 0.26, h * 0.07).fill({ color: INK, alpha: 0.16 });
    // Legs.
    const hipY = top - h * 0.34;
    g.moveTo(x - h * 0.03, hipY).lineTo(x - h * 0.03 + swing * h * 0.13, y);
    g.moveTo(x + h * 0.03, hipY).lineTo(x + h * 0.03 - swing * h * 0.13, y);
    g.stroke({ color: INK, width: Math.max(1, h * 0.075), cap: 'round' });
    // A cloak in the raider's colours, with a hem of the other tincture.
    const sh = top - h * 0.74, hem = top - h * 0.3;
    g.poly([x - h * 0.11, sh, x + h * 0.11, sh, x + h * 0.2, hem, x - h * 0.2, hem]).fill({ color: cloak, alpha: 0.95 }).stroke({ color: INK, width: 0.9, alpha: 0.9, join: 'round' });
    g.moveTo(x - h * 0.19, hem - h * 0.05).lineTo(x + h * 0.19, hem - h * 0.05).stroke({ color: trim, width: Math.max(1, h * 0.06), alpha: 0.9 });
    // Head.
    g.circle(x + dir * h * 0.01, top - h * 0.85, h * 0.105).fill({ color: PAPER }).stroke({ color: INK, width: 0.9 });
    if (m.role === 'standard') {
      // The kingdom's banner: a pole and a swallow-tailed cloth in both tinctures.
      const px = x + dir * h * 0.18;
      const poleTop = top - h * 1.62;
      g.moveTo(px, top - h * 0.1).lineTo(px, poleTop).stroke({ color: INK, width: Math.max(1.1, h * 0.07), cap: 'round' });
      const w = h * 0.5 * dir, bh = h * 0.42, fy = poleTop + h * 0.06;
      const flutter = Math.sin(m.phase * Math.PI * 2 * 0.5) * h * 0.04;
      g.poly([px, fy, px + w, fy + flutter, px + w * 0.82, fy + bh * 0.5 + flutter, px + w, fy + bh + flutter, px, fy + bh]).fill({ color: this.cloth.field }).stroke({ color: INK, width: 0.9, join: 'round' });
      g.moveTo(px + w * 0.45, fy + flutter * 0.5).lineTo(px + w * 0.45, fy + bh + flutter * 0.5).stroke({ color: this.cloth.second, width: Math.max(1.2, h * 0.09) });
      return;
    }
    // A torch held up and forward: the stick in ink, the flame in gamboge and sienna, a pale wash where it lights.
    const hand = { x: x + dir * h * 0.2, y: top - h * 0.7 };
    g.moveTo(x + dir * h * 0.07, top - h * 0.66).lineTo(hand.x, hand.y).stroke({ color: INK, width: Math.max(0.9, h * 0.06), cap: 'round' });
    const tip = { x: hand.x + dir * h * 0.08, y: hand.y - h * 0.32 };
    g.moveTo(hand.x - dir * h * 0.02, hand.y + h * 0.08).lineTo(tip.x, tip.y).stroke({ color: INK, width: Math.max(1, h * 0.06), cap: 'round' });
    const flick = 0.85 + 0.15 * Math.sin(m.phase * 7.1 + m.index);
    g.circle(tip.x, tip.y - h * 0.08, h * 0.36).fill({ color: OCHRE_WASH, alpha: 0.13 });
    const fh = h * 0.26 * flick, fw = h * 0.085;
    const lean = Math.sin(m.phase * 3.3 + m.index * 1.3) * fw * 0.6 - dir * fw * 0.4;
    g.poly([tip.x - fw, tip.y, tip.x - fw * 0.6, tip.y - fh * 0.55, tip.x + lean, tip.y - fh, tip.x + fw * 0.7, tip.y - fh * 0.5, tip.x + fw, tip.y]).fill({ color: GAMBOGE, alpha: 0.95 });
    g.circle(tip.x, tip.y - fh * 0.28, fw * 0.62).fill({ color: SIENNA, alpha: 0.85 });
  }
}

/** Figure height in CSS px at a map scale: small enough to read as marks, big enough to see the torches. */
export function figureHeight(scale: number): number {
  return Math.max(14, Math.min(24, 11 + scale * 0.45));
}

function polyline(g: Graphics, points: number[]): void {
  if (points.length < 4) return;
  g.moveTo(points[0]!, points[1]!);
  for (let i = 2; i < points.length; i += 2) g.lineTo(points[i]!, points[i + 1]!);
}

/** Dashes along a screen polyline: `dash` px drawn, `gap` px left. Pixi strokes have no dash pattern of their own. */
function dashed(g: Graphics, points: number[], dash: number, gap: number): void {
  let drawing = true;
  let left = dash;
  for (let i = 2; i < points.length; i += 2) {
    let ax = points[i - 2]!, ay = points[i - 1]!;
    const bx = points[i]!, by = points[i + 1]!;
    let length = Math.hypot(bx - ax, by - ay);
    while (length > 0) {
      const take = Math.min(left, length);
      const f = take / length;
      const nx = ax + (bx - ax) * f, ny = ay + (by - ay) * f;
      if (drawing) g.moveTo(ax, ay).lineTo(nx, ny);
      ax = nx; ay = ny; length -= take; left -= take;
      if (left <= 1e-6) {
        drawing = !drawing;
        left = drawing ? dash : gap;
      }
    }
  }
}
