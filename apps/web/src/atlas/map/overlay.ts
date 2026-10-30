import { CanvasSource, Container, Graphics, Rectangle, Sprite, Text, Texture, type TextStyleOptions, type TextureSource } from 'pixi.js';
import { drawShield, shieldDesign, SHIELD_ASPECT } from '../heraldry';
import type { Geography, Settler, SettlerStore } from '../data/model';
import type { PreviewWorld } from '../data/preview';
import { DISTANCE_SCALE, type Camera, type Viewport } from './camera';
import { CollisionGrid, comparePriority, type Rect } from './collide';
import type { Stamp } from './paint';
import { decorBand } from './pyramid';
import { INK, LAND, PAPER } from './theme';

/** Display faces; Alegreya carries Cyrillic and Greek, the system serif anything else (CJK, Thai, Arabic…). */
export const FACE_TEXT = '"IM Fell English", "Alegreya", "Noto Serif", Georgia, serif';
export const FACE_CAPS = '"IM Fell English SC", "IM Fell English", "Alegreya", "Noto Serif", Georgia, serif';
export const FACE_ITALIC = '"IM Fell English", "Alegreya", "Noto Serif", Georgia, serif';

/** When a tier's holdings are drawn as pictorial stamps with names (Spec 01 R7); below that they are survey marks. */
export const STAMP_SCALE = [0, DISTANCE_SCALE.continent, DISTANCE_SCALE.realm, DISTANCE_SCALE.kingdom] as const;
/** Tiers that are at least marked on paper in each decor band; the survey keeps decor clear of exactly these. */
export const MARKED_TIERS = [1, 2, 3, 4, 4] as const;
const STAMP_PX: readonly (readonly [number, number])[] = [[30, 132], [18, 108], [16, 84], [14, 64]];
const LABEL_PX = [15, 13, 12, 11.5] as const;
const SHIELD_PX = [15, 13, 12, 11] as const;
/** Shields in view at once, Spec 01 R7. */
export const SHIELD_LIMIT = 300;

export function stampPx(tierRank: number, radius: number, scale: number): number {
  const [min, max] = STAMP_PX[tierRank]!;
  return Math.min(max, Math.max(min, 2 * radius * scale * 1.05));
}

export function stampVisible(tierRank: number, scale: number): boolean {
  return scale >= STAMP_SCALE[tierRank]!;
}

export function markedTiers(scale: number): number {
  return MARKED_TIERS[decorBand(scale)]!;
}

/** Something drawn that a pointer can pick: a stamp or a survey mark. */
export interface Drawn { settler: Settler; x: number; y: number; r: number }

class Pool<T extends Sprite | Text> {
  private readonly items: T[] = [];
  private used = 0;
  constructor(private readonly parent: Container, private readonly make: () => T) {}
  begin(): void {
    this.used = 0;
  }
  next(): T {
    let item = this.items[this.used];
    if (!item) {
      item = this.make();
      this.items.push(item);
      this.parent.addChild(item);
    }
    item.visible = true;
    this.used++;
    return item;
  }
  end(): void {
    for (let i = this.used; i < this.items.length; i++) this.items[i]!.visible = false;
  }
}

function hashId(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return h >>> 0;
}

interface StampTextures { ink: Texture; fill: Texture | null; aspect: number; anchorX: number; anchorY: number }

/** Survey marks: the small ink symbols old maps use for settlements too small to draw. */
function markTexture(tierRank: number, pixelRatio: number): Texture {
  const css = [9, 7, 5, 3.6][tierRank]!;
  const size = Math.ceil((css + 2) * pixelRatio);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(pixelRatio, pixelRatio);
  const c = size / pixelRatio / 2;
  const r = css / 2;
  ctx.fillStyle = LAND;
  ctx.strokeStyle = INK;
  ctx.lineWidth = tierRank < 2 ? 1.1 : 0.9;
  if (tierRank === 3) {
    ctx.fillStyle = INK;
    ctx.globalAlpha = 0.72;
    ctx.beginPath();
    ctx.arc(c, c, r * 0.62, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.arc(c, c, r - 0.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = INK;
    ctx.beginPath();
    ctx.arc(c, c, tierRank === 0 ? r * 0.42 : r * 0.3, 0, Math.PI * 2);
    ctx.fill();
  }
  return new Texture({ source: new CanvasSource({ resource: canvas, resolution: pixelRatio }) });
}

interface LabelEntry { text: Text; usedAt: number }

const PAPER_HEX = parseInt(PAPER.slice(1), 16);
const INK_HEX = parseInt(INK.slice(1), 16);
const LAND_HEX = parseInt('f6eed8', 16);

/**
 * Everything drawn above the land tiles: holdings (survey marks or settlement stamps), seeded shields, names,
 * language-region names, community (category) names and the selection ring. Positions are recomputed in screen
 * space whenever the camera moves, so stamps and type keep their size while the land zooms beneath them.
 */
export class Overlay {
  readonly container = new Container();
  private readonly regionLayer = new Container();
  private readonly marks = new Container();
  private readonly fills = new Container();
  private readonly inks = new Container();
  private readonly shields = new Container();
  private readonly labels = new Container();
  private readonly selection = new Graphics();
  private readonly markPool: Pool<Sprite>;
  private readonly fillPool: Pool<Sprite>;
  private readonly inkPool: Pool<Sprite>;
  private readonly shieldPool: Pool<Sprite>;
  private readonly markTextures: Texture[];
  private readonly stampsByTier: StampTextures[][];
  private readonly textCache = new Map<string, LabelEntry>();
  private readonly shieldCache = new Map<string, { texture: Texture; usedAt: number }>();
  private readonly scratch: Settler[] = [];
  private frame = 0;
  /** Pickable things from the last update, highest priority first. */
  drawn: Drawn[] = [];

  constructor(private readonly world: PreviewWorld, private readonly geo: Geography, private readonly store: SettlerStore, sheet: TextureSource | null, stamps: Stamp[], private readonly pixelRatio: number) {
    this.container.addChild(this.marks, this.fills, this.inks, this.selection, this.regionLayer, this.shields, this.labels);
    this.markTextures = [0, 1, 2, 3].map((tier) => markTexture(tier, pixelRatio));
    this.markPool = new Pool(this.marks, () => {
      const sprite = new Sprite();
      sprite.anchor.set(0.5);
      return sprite;
    });
    this.fillPool = new Pool(this.fills, () => new Sprite());
    this.inkPool = new Pool(this.inks, () => new Sprite());
    this.shieldPool = new Pool(this.shields, () => new Sprite());
    const groups = ['capital', 'city', 'town', 'village'];
    this.stampsByTier = groups.map((group) => {
      if (!sheet) return [];
      return stamps.filter((stamp) => stamp.group === group).map((stamp) => ({
        ink: new Texture({ source: sheet, frame: new Rectangle(stamp.ink.x, stamp.ink.y, stamp.ink.w, stamp.ink.h) }),
        fill: stamp.fill ? new Texture({ source: sheet, frame: new Rectangle(stamp.fill.x, stamp.fill.y, stamp.fill.w, stamp.fill.h) }) : null,
        aspect: stamp.ink.h / stamp.ink.w,
        anchorX: stamp.anchor.x,
        anchorY: stamp.anchor.y,
      }));
    });
  }

  private text(key: string, value: string, style: TextStyleOptions): Text {
    let entry = this.textCache.get(key);
    if (!entry) {
      const text = new Text({ text: value, style, resolution: this.pixelRatio, roundPixels: true });
      this.labels.addChild(text);
      entry = { text, usedAt: this.frame };
      this.textCache.set(key, entry);
    }
    entry.usedAt = this.frame;
    entry.text.visible = true;
    return entry.text;
  }

  private shieldTexture(settler: Settler, width: number): Texture {
    const key = `${settler.id}:${width}`;
    let entry = this.shieldCache.get(key);
    if (!entry) {
      const pad = 3;
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil((width + pad * 2) * this.pixelRatio);
      canvas.height = Math.ceil((width * SHIELD_ASPECT + pad * 2) * this.pixelRatio);
      const ctx = canvas.getContext('2d')!;
      ctx.scale(this.pixelRatio, this.pixelRatio);
      drawShield(ctx, shieldDesign(settler.id), pad, pad, width, { halo: true, pixelRatio: this.pixelRatio });
      entry = { texture: new Texture({ source: new CanvasSource({ resource: canvas, resolution: this.pixelRatio }) }), usedAt: this.frame };
      this.shieldCache.set(key, entry);
    }
    entry.usedAt = this.frame;
    return entry.texture;
  }

  update(camera: Camera, view: Viewport, focus: { selected: Settler | null; hovered: Settler | null }): void {
    this.frame++;
    const scale = camera.scale;
    const grid = new CollisionGrid(view.width, view.height);
    const margin = 160;
    const box = camera.visibleBox(view, margin);
    const tiers = markedTiers(scale);
    const forced = new Set<Settler>();
    if (focus.selected && !focus.selected.withheld) forced.add(focus.selected);
    if (focus.hovered && !focus.hovered.withheld) forced.add(focus.hovered);

    const visible = this.store.query(box.minX, box.minY, box.maxX, box.maxY, Math.max(0, tiers - 1), this.scratch).sort(comparePriority);
    for (const settler of forced) if (!visible.includes(settler)) visible.unshift(settler);
    visible.sort((a, b) => (forced.has(a) ? 0 : 1) - (forced.has(b) ? 0 : 1) || comparePriority(a, b));

    this.markPool.begin();
    this.fillPool.begin();
    this.inkPool.begin();
    this.shieldPool.begin();
    for (const entry of this.textCache.values()) entry.text.visible = false;
    const drawn: Drawn[] = [];
    const radius = this.world.tiers.holdingRadius;
    const radii = [radius.capital, radius.city, radius.town, radius.village];

    // Each holding's name and shield go down right after its stamp, so a stronger holding's name is never pushed
    // aside by a weaker holding's stamp. Below the stamp first, then beside it, then above. A holding whose name is
    // stale or not yet received keeps its shield alone: the arms come from the channel ID, not from raw content.
    let shields = 0;
    const placeName = (item: { settler: Settler; sx: number; sy: number; w: number; h: number }): void => {
      const { settler } = item;
      const tier = settler.tierRank;
      const size = LABEL_PX[tier]! + (scale >= DISTANCE_SCALE.kingdom ? 1.5 : 0);
      const shieldW = SHIELD_PX[tier]! + (scale >= DISTANCE_SCALE.kingdom ? 3 : 0);
      const label = settler.name === null ? null : this.text(`n:${settler.id}:${size}:${settler.name}`, settler.name, {
        fontFamily: FACE_TEXT,
        fontSize: size,
        fill: INK_HEX,
        letterSpacing: tier === 0 ? 0.6 : 0.2,
        stroke: { color: PAPER_HEX, width: 3.2, join: 'round' },
        padding: 4,
      });
      const withShield = shields < SHIELD_LIMIT;
      if (!label && !withShield) return;
      const gap = withShield ? shieldW + (label ? 4 : 0) : 0;
      const totalW = (label?.width ?? 0) + gap;
      const height = Math.max(label?.height ?? 0, withShield ? shieldW * SHIELD_ASPECT : 0);
      const mid = item.sy - item.h / 2;
      const candidates: Rect[] = [
        { x: item.sx - totalW / 2, y: item.sy + 2, w: totalW, h: height },
        { x: item.sx + item.w * 0.42, y: mid - height / 2, w: totalW, h: height },
        { x: item.sx - item.w * 0.42 - totalW, y: mid - height / 2, w: totalW, h: height },
        { x: item.sx - totalW / 2, y: item.sy - item.h - height - 1, w: totalW, h: height },
      ];
      const isForced = forced.has(settler);
      const rect = candidates.find((candidate) => grid.free(candidate)) ?? (isForced ? candidates[0]! : null);
      if (!rect) {
        if (label) label.visible = false;
        return;
      }
      grid.claim(rect);
      const top = rect.y;
      label?.position.set(Math.round(rect.x + gap), Math.round(top + (rect.h - label.height) / 2));
      if (withShield) {
        shields++;
        const shield = this.shieldPool.next();
        shield.texture = this.shieldTexture(settler, shieldW);
        shield.position.set(Math.round(rect.x - 3), Math.round(top + (rect.h - shieldW * SHIELD_ASPECT) / 2 - 3));
        shield.width = shieldW + 6;
        shield.height = shieldW * SHIELD_ASPECT + 6;
      }
    };

    // 1. Language regions: the largest type on the map, written across the land at world and continent distance.
    this.placeRegions(camera, view, grid);

    // 2. Stamps and names, in priority order; a stamp that would crowd a stronger one stays a survey mark.
    for (const settler of visible) {
      const s = camera.worldToScreen(settler.x, settler.y, view);
      const r = radii[settler.tierRank]!;
      const wantsStamp = forced.has(settler) || stampVisible(settler.tierRank, scale);
      const choices = this.stampsByTier[settler.tierRank]!;
      if (wantsStamp && choices.length) {
        const w = stampPx(settler.tierRank, r, scale);
        const choice = choices[hashId(settler.id) % choices.length]!;
        const h = w * choice.aspect;
        const rect: Rect = { x: s.x - w * choice.anchorX + w * 0.12, y: s.y - h * choice.anchorY + h * 0.18, w: w * 0.76, h: h * 0.76 };
        if (forced.has(settler) || grid.free(rect)) {
          grid.claim(rect);
          if (choice.fill) {
            const fill = this.fillPool.next();
            fill.texture = choice.fill;
            fill.tint = LAND_HEX;
            fill.position.set(s.x - w * choice.anchorX, s.y - h * choice.anchorY);
            fill.width = w;
            fill.height = h;
          }
          const ink = this.inkPool.next();
          ink.texture = choice.ink;
          ink.tint = 0xffffff;
          ink.position.set(s.x - w * choice.anchorX, s.y - h * choice.anchorY);
          ink.width = w;
          ink.height = h;
          placeName({ settler, sx: s.x, sy: s.y, w, h: h * choice.anchorY });
          drawn.push({ settler, x: s.x, y: s.y - h * choice.anchorY * 0.45, r: Math.max(w, h) * 0.45 });
          continue;
        }
      }
      if (settler.tierRank >= tiers && !forced.has(settler)) continue;
      const mark = this.markPool.next();
      mark.texture = this.markTextures[settler.tierRank]!;
      mark.position.set(Math.round(s.x * this.pixelRatio) / this.pixelRatio, Math.round(s.y * this.pixelRatio) / this.pixelRatio);
      mark.scale.set(1);
      mark.alpha = settler.tierRank === 3 ? 0.75 : 1;
      drawn.push({ settler, x: s.x, y: s.y, r: Math.max(5, r * scale) });
    }

    // 3. Community names (the observed main category of a cluster) once a realm is close.
    this.placeClusters(camera, view, grid);

    // 4. Selection: a double ink ring with four ticks, like a surveyor's mark.
    this.selection.clear();
    if (focus.selected) {
      const target = drawn.find((item) => item.settler === focus.selected);
      if (target) {
        const r = target.r + 7;
        this.selection.circle(target.x, target.y, r).stroke({ color: PAPER_HEX, width: 5, alpha: 0.85 });
        this.selection.circle(target.x, target.y, r).stroke({ color: INK_HEX, width: 1.6 });
        this.selection.circle(target.x, target.y, r + 3.5).stroke({ color: INK_HEX, width: 0.8, alpha: 0.8 });
        for (let i = 0; i < 4; i++) {
          const a = (i * Math.PI) / 2;
          this.selection.moveTo(target.x + Math.cos(a) * (r + 3), target.y + Math.sin(a) * (r + 3)).lineTo(target.x + Math.cos(a) * (r + 10), target.y + Math.sin(a) * (r + 10));
        }
        this.selection.stroke({ color: INK_HEX, width: 1.4 });
      }
    }

    this.markPool.end();
    this.fillPool.end();
    this.inkPool.end();
    this.shieldPool.end();
    this.drawn = drawn;
    this.evict();
  }

  private placeRegions(camera: Camera, view: Viewport, grid: CollisionGrid): void {
    const scale = camera.scale;
    const fade = scale >= DISTANCE_SCALE.realm ? 0 : scale >= DISTANCE_SCALE.continent * 1.6 ? 1 - (scale - DISTANCE_SCALE.continent * 1.6) / (DISTANCE_SCALE.realm - DISTANCE_SCALE.continent * 1.6) : 1;
    if (fade <= 0.02) return;
    const regions = [...this.geo.regions].sort((a, b) => b.members - a.members || a.index - b.index);
    for (const region of regions) {
      const screenR = region.r * scale;
      if (screenR < (region.kind === 'continent' ? 26 : 16)) continue;
      const continent = region.kind === 'continent';
      const size = Math.round(Math.max(continent ? 15 : 11.5, Math.min(continent ? 34 : 17, screenR * (continent ? 0.16 : 0.2))));
      const label = this.text(`r:${region.index}:${size}`, region.name, {
        fontFamily: continent ? FACE_CAPS : FACE_ITALIC,
        fontStyle: continent ? 'normal' : 'italic',
        fontSize: size,
        fill: INK_HEX,
        letterSpacing: continent ? size * 0.32 : size * 0.08,
        stroke: { color: PAPER_HEX, width: continent ? 4 : 3, join: 'round' },
        padding: 6,
      });
      const subtitle = region.englishName !== region.name && continent ? region.englishName : null;
      const sub = subtitle ? this.text(`rs:${region.index}:${size}`, subtitle, {
        fontFamily: FACE_ITALIC,
        fontStyle: 'italic',
        fontSize: Math.max(11, Math.round(size * 0.42)),
        fill: INK_HEX,
        letterSpacing: 1,
        stroke: { color: PAPER_HEX, width: 3, join: 'round' },
        padding: 4,
      }) : null;
      const c = camera.worldToScreen(region.x, region.y, view);
      const height = label.height + (sub ? sub.height - 4 : 0);
      const width = Math.max(label.width, sub?.width ?? 0);
      let placed = false;
      for (const dy of [0, -0.34, 0.34, -0.6, 0.6]) {
        const rect: Rect = { x: c.x - width / 2, y: c.y + dy * screenR - height / 2, w: width, h: height };
        if (rect.x + rect.w < -40 || rect.x > view.width + 40 || rect.y + rect.h < -40 || rect.y > view.height + 40) break;
        if (!grid.free(rect)) continue;
        grid.claim(rect);
        label.position.set(Math.round(c.x - label.width / 2), Math.round(rect.y));
        label.alpha = 0.78 * fade;
        if (sub) {
          sub.position.set(Math.round(c.x - sub.width / 2), Math.round(rect.y + label.height - 4));
          sub.alpha = 0.72 * fade;
        }
        placed = true;
        break;
      }
      if (!placed) {
        label.visible = false;
        if (sub) sub.visible = false;
      }
    }
    const isles = this.geo.isles;
    if (isles && isles.r * scale > 30) {
      const size = Math.round(Math.max(13, Math.min(24, isles.r * scale * 0.09)));
      const label = this.text(`isles:${size}`, isles.name, {
        fontFamily: FACE_ITALIC,
        fontStyle: 'italic',
        fontSize: size,
        fill: INK_HEX,
        letterSpacing: size * 0.18,
        stroke: { color: PAPER_HEX, width: 3.5, join: 'round' },
        padding: 6,
      });
      const top = Math.max(isles.y - isles.r * 0.92, this.geo.bounds.minY + 40);
      const c = camera.worldToScreen(isles.x, top, view);
      const rect: Rect = { x: c.x - label.width / 2, y: c.y, w: label.width, h: label.height };
      if (grid.take(rect)) {
        label.position.set(Math.round(rect.x), Math.round(rect.y));
        label.alpha = 0.8 * fade;
      } else label.visible = false;
    }
  }

  private placeClusters(camera: Camera, view: Viewport, grid: CollisionGrid): void {
    const scale = camera.scale;
    if (scale < DISTANCE_SCALE.continent) return;
    const fade = Math.min(1, (scale - DISTANCE_SCALE.continent) / 0.8) * (scale > DISTANCE_SCALE.kingdom ? Math.max(0, 1 - (scale - DISTANCE_SCALE.kingdom) / 8) : 1);
    if (fade <= 0.02) return;
    const box = camera.visibleBox(view, 80);
    const clusters = this.geo.clusters
      .map((cluster, index) => ({ cluster, index }))
      .filter(({ cluster }) => cluster.r * scale >= 46 && cluster.x + cluster.r > box.minX && cluster.x - cluster.r < box.maxX && cluster.y + cluster.r > box.minY && cluster.y - cluster.r < box.maxY)
      .sort((a, b) => b.cluster.members - a.cluster.members || a.index - b.index);
    for (const { cluster, index } of clusters) {
      const name = cluster.name;
      if (!name) continue;
      const size = Math.round(Math.max(12, Math.min(19, cluster.r * scale * 0.08)));
      const label = this.text(`c:${index}:${size}`, name, {
        fontFamily: FACE_ITALIC,
        fontStyle: 'italic',
        fontSize: size,
        fill: 0x5a4a3a,
        letterSpacing: size * 0.22,
        stroke: { color: PAPER_HEX, width: 3, join: 'round' },
        padding: 4,
      });
      const c = camera.worldToScreen(cluster.x, cluster.y, view);
      const r = cluster.r * scale;
      let placed = false;
      for (const dy of [-0.92, 0.92, -0.5, 0.5, 0]) {
        const rect: Rect = { x: c.x - label.width / 2, y: c.y + dy * r - label.height / 2, w: label.width, h: label.height };
        if (!grid.free(rect)) continue;
        grid.claim(rect);
        label.position.set(Math.round(rect.x), Math.round(rect.y));
        label.alpha = 0.82 * fade;
        placed = true;
        break;
      }
      if (!placed) label.visible = false;
    }
  }

  private evict(): void {
    if (this.textCache.size > 900) {
      const old = [...this.textCache.entries()].filter(([, entry]) => entry.usedAt < this.frame).sort((a, b) => a[1].usedAt - b[1].usedAt);
      for (const [key, entry] of old.slice(0, this.textCache.size - 700)) {
        entry.text.destroy();
        this.textCache.delete(key);
      }
    }
    if (this.shieldCache.size > 700) {
      const old = [...this.shieldCache.entries()].filter(([, entry]) => entry.usedAt < this.frame).sort((a, b) => a[1].usedAt - b[1].usedAt);
      for (const [key, entry] of old.slice(0, this.shieldCache.size - 500)) {
        entry.texture.destroy(true);
        this.shieldCache.delete(key);
      }
    }
  }

  /** The pickable thing nearest a screen point, if any lies within reach (more generous for touch). */
  pick(x: number, y: number, slop: number): Settler | null {
    let best: Drawn | null = null;
    let bestD = Infinity;
    for (const item of this.drawn) {
      const d = Math.hypot(item.x - x, item.y - y);
      if (d <= item.r + slop && d < bestD) {
        best = item;
        bestD = d;
      }
    }
    return best?.settler ?? null;
  }

  dispose(): void {
    for (const entry of this.shieldCache.values()) entry.texture.destroy(true);
    for (const texture of this.markTextures) texture.destroy(true);
    this.container.destroy({ children: true });
  }
}
