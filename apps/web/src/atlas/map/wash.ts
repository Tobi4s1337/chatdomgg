import { CanvasSource, Container, RenderTexture, Sprite, Texture, type Renderer } from 'pixi.js';
import type { SettlerStore } from '../data/model';
import type { LivePaint } from '../live/paint';
import { DISTANCE_SCALE, type Camera, type Viewport } from './camera';
import { BLOT_SIZE, BLOT_VARIANTS, paintBlot, paintDensity } from './live-marks';
import { VERMILION } from './theme';

/**
 * The vermilion wash (Spec 01 R8, Atlas.md §5.1, §8.3): a separate painted layer between the land and the overlay.
 * Blots of pigment density are laid into one render texture with ordinary alpha, so where they overlap the density
 * rises toward full pigment and stops there; that one texture is then multiplied into the paper. The result can only
 * darken the paper toward vermilion, never past it, never toward black and never as a glow. At world distance it is
 * one density layer; closer, the wash softens under the pennants and is capped for phones.
 */

/** Wash radius in world units per live class (1–5): a little wider than the holding the class usually holds. */
export const WASH_RADIUS = [0, 13, 7.6, 4.2, 3, 1.5] as const;
/** On-screen radius bounds in CSS px, so a capital never floods a continent and a small stream stays a dab. */
export const WASH_PX: readonly (readonly [number, number])[] = [[0, 0], [15, 120], [9, 78], [5.5, 46], [4, 30], [2.6, 15]];
/** Pigment per class: the classes grade by size first; alpha only keeps the small ones from shouting. */
export const WASH_ALPHA = [0, 0.8, 0.72, 0.62, 0.54, 0.42] as const;
/** Density weight per class at world distance, and the most pigment the density layer may reach. */
export const DENSITY_ALPHA = [0, 0.9, 0.7, 0.42, 0.3, 0.12] as const;
export const DENSITY_CAP = 0.64;
/** Washes drawn one by one at realm distance and closer (R7 phone budget, shared with pennants). */
export const CLOSE_WASH_LIMIT = { phone: 2_000, laptop: 4_000 } as const;

const ramp = (value: number, from: number, to: number) => Math.min(1, Math.max(0, (value - from) / (to - from)));

/**
 * 0 from afar, where every live holding is a soft stain graded by its class and the stains run together into one
 * density layer (Atlas.md §5.1); 1 from just before realm distance, where each holding has its own watercolour
 * bloom under its pennant.
 */
export function washDetail(scale: number): number {
  return ramp(scale, DISTANCE_SCALE.continent * 1.3, DISTANCE_SCALE.realm * 0.8);
}

/** How much the wash steps back as pennants take over: full from afar, two thirds at realm distance, about half closer in. */
export function washSoftening(scale: number): number {
  return 1 - 0.48 * ramp(scale, DISTANCE_SCALE.realm * 0.6, DISTANCE_SCALE.realm * 1.2);
}

export function washPx(liveClass: number, scale: number): number {
  const [min, max] = WASH_PX[liveClass] ?? [0, 0];
  return Math.min(max, Math.max(min, (WASH_RADIUS[liveClass as 1] ?? 0) * scale));
}

function blotTexture(variant: number): Texture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = BLOT_SIZE;
  if (variant < 0) paintDensity(canvas.getContext('2d')!);
  else paintBlot(canvas.getContext('2d')!, variant);
  return new Texture({ source: new CanvasSource({ resource: canvas, resolution: 1, autoGenerateMipmaps: true, scaleMode: 'linear' }) });
}

export class WashLayer {
  /** The composited wash, placed between the land tiles and the overlay. */
  readonly sprite: Sprite;
  private readonly stage = new Container();
  private readonly blots: Texture[];
  private readonly density: Texture;
  private readonly pool: Sprite[] = [];
  private target: RenderTexture;
  private used = 0;
  private readonly tint = parseInt(VERMILION.slice(1), 16);
  /** Washes laid in the last paint, for evidence and the director's budget. */
  drawn = 0;

  constructor(view: Viewport, private readonly pixelRatio: number, private readonly phone: boolean) {
    this.blots = Array.from({ length: BLOT_VARIANTS }, (_, i) => blotTexture(i));
    this.density = blotTexture(-1);
    this.target = this.createTarget(view);
    this.sprite = new Sprite(this.target);
    this.sprite.blendMode = 'multiply';
    this.sprite.eventMode = 'none';
  }

  private createTarget(view: Viewport): RenderTexture {
    return RenderTexture.create({ width: view.width, height: view.height, resolution: Math.min(1.5, this.pixelRatio) });
  }

  /** A new target at the new size: resizing one in place leaves the sprite stretched over its old frame. */
  resize(view: Viewport): void {
    const old = this.target;
    this.target = this.createTarget(view);
    this.sprite.texture = this.target;
    this.sprite.width = view.width;
    this.sprite.height = view.height;
    old.destroy(true);
  }

  /** Lays one item in the modes the distance calls for: density from afar, a watercolour blot close up, both between. */
  private lay(x: number, y: number, liveClass: number, scale: number, strength: number, variant: number, detail: number, soften: number): void {
    if (detail < 1) {
      // A stain a little wider than the bloom it stands for, so neighbours run together into one layer.
      const radius = washPx(liveClass, scale) * 1.2;
      // Fewer stains overlap as the camera closes in, so each carries a little more pigment.
      const closer = 1 + 0.5 * ramp(scale, DISTANCE_SCALE.continent * 0.35, DISTANCE_SCALE.continent);
      this.blot(x, y, radius, Math.min(1, DENSITY_ALPHA[liveClass as 1]! * closer) * strength * (1 - detail), -1);
    }
    if (detail > 0) this.blot(x, y, washPx(liveClass, scale) * (0.55 + 0.45 * strength), WASH_ALPHA[liveClass as 1]! * soften * strength * detail, variant);
  }

  private blot(x: number, y: number, radius: number, alpha: number, variant: number): void {
    let sprite = this.pool[this.used];
    if (!sprite) {
      sprite = new Sprite();
      sprite.anchor.set(0.5);
      this.pool.push(sprite);
      this.stage.addChild(sprite);
    }
    sprite.visible = true;
    const soft = variant < 0;
    sprite.texture = soft ? this.density : this.blots[variant % BLOT_VARIANTS]!;
    sprite.tint = this.tint;
    sprite.alpha = alpha;
    sprite.position.set(x, y);
    // A blot's rim sits at 86 % of its canvas (bleed beyond); the density stain fills its canvas.
    sprite.width = sprite.height = soft ? radius * 2 : radius * 2 / 0.86 * 1.12;
    sprite.rotation = soft ? 0 : (variant * 1.7) % (Math.PI * 2);
    this.used++;
  }

  /** Repaints the wash for the current camera and frame. Withheld holdings and loaded-but-gated slots paint nothing. */
  paint(renderer: Renderer, camera: Camera, view: Viewport, store: SettlerStore, live: LivePaint, now: number): void {
    this.used = 0;
    const scale = camera.scale;
    const soften = washSoftening(scale);
    const detail = washDetail(scale);
    const close = scale >= DISTANCE_SCALE.realm * 0.6;
    const limit = close ? (this.phone ? CLOSE_WASH_LIMIT.phone : CLOSE_WASH_LIMIT.laptop) : Infinity;
    const box = camera.visibleBox(view, 140 / scale);
    const inBox = (x: number, y: number) => x >= box.minX && x <= box.maxX && y >= box.minY && y <= box.maxY;
    if (live.frame) {
      // Holdings: biggest classes first, so a cap drops the smallest washes, never a capital's.
      const holdings = store.query(box.minX, box.minY, box.maxX, box.maxY, 3)
        .map((settler) => ({ settler, liveClass: live.liveClass(settler) }))
        .filter((item) => item.liveClass > 0)
        .sort((a, b) => a.liveClass - b.liveClass || a.settler.ordinal - b.settler.ordinal);
      for (const { settler, liveClass } of holdings) {
        if (this.used >= limit) break;
        const bloom = live.bloom(live.startedAt(settler), now);
        if (bloom <= 0.01) continue;
        const s = camera.worldToScreen(settler.x, settler.y, view);
        this.lay(s.x, s.y, liveClass, scale, bloom, settler.ordinal, detail, soften);
      }
      for (const dab of live.dabs) {
        if (this.used >= limit) break;
        if (!inBox(dab.x, dab.y)) continue;
        const bloom = live.bloom(dab.startedAt, now);
        if (bloom <= 0.01) continue;
        const s = camera.worldToScreen(dab.x, dab.y, view);
        this.lay(s.x, s.y, 5, scale, bloom, parseInt(dab.hash.slice(0, 4), 16), detail, soften);
      }
    }
    for (const dry of live.dryingWashes(now)) {
      if (!inBox(dry.x, dry.y)) continue;
      const s = camera.worldToScreen(dry.x, dry.y, view);
      this.lay(s.x, s.y, dry.liveClass, scale, dry.left, dry.ordinal, detail, soften);
    }
    for (const { dab, left } of live.dryingDabWashes(now)) {
      if (!inBox(dab.x, dab.y)) continue;
      const s = camera.worldToScreen(dab.x, dab.y, view);
      this.lay(s.x, s.y, 5, scale, left, parseInt(dab.hash.slice(0, 4), 16), detail, soften);
    }
    for (let i = this.used; i < this.pool.length; i++) this.pool[i]!.visible = false;
    this.drawn = this.used;
    renderer.render({ container: this.stage, target: this.target, clear: true, clearColor: [0, 0, 0, 0] });
    this.sprite.visible = this.used > 0;
    // The density layer can only deepen so far: a crowded continent reads as rich pigment, never as a red plate.
    this.sprite.alpha = DENSITY_CAP + (1 - DENSITY_CAP) * detail;
  }

  dispose(): void {
    for (const texture of this.blots) texture.destroy(true);
    this.density.destroy(true);
    this.target.destroy(true);
    this.stage.destroy({ children: true });
    this.sprite.destroy();
  }
}
