import { CanvasSource, Container, Graphics, Rectangle, Sprite, Text, Texture, type TextStyleOptions, type TextureSource } from 'pixi.js';
import { drawShield, shieldDesign, SHIELD_ASPECT } from '../heraldry';
import type { Circle, Geography, GeoRealm, Settler, SettlerStore } from '../data/model';
import type { Dab, LivePaint } from '../live/paint';
import { pencilFlagImage, standardImage, type StandardImage } from './live-marks';
import { holdingRadii, type PreviewWorld } from '../data/preview';
import { DISTANCE_SCALE, type Camera, type Viewport } from './camera';
import { CollisionGrid, comparePriority, MARK_PX, underLettering, type Rect } from './collide';
import type { Stamp } from './paint';
import { HoldingLabels, onScreen, Placer, SHIELD_PAD, type Placed } from './placement';
import { decorBand } from './pyramid';
import { GRAPHITE, INK, LAND, PAPER } from './theme';
import type { FoundMark } from './found';

/** Display faces; Alegreya carries Cyrillic and Greek, the system serif anything else (CJK, Thai, Arabic…). */
export const FACE_TEXT = '"IM Fell English", "Alegreya", "Noto Serif", Georgia, serif';
export const FACE_CAPS = '"IM Fell English SC", "IM Fell English", "Alegreya", "Noto Serif", Georgia, serif';
export const FACE_ITALIC = '"IM Fell English", "Alegreya", "Noto Serif", Georgia, serif';

/**
 * When a tier's holdings are drawn as pictorial stamps with names (Spec 01 R7); below that they are survey marks. A
 * hamlet (an edition's tier 4) keeps a village's zoom band.
 */
export const STAMP_SCALE = [0, DISTANCE_SCALE.continent, DISTANCE_SCALE.realm, DISTANCE_SCALE.kingdom, DISTANCE_SCALE.kingdom] as const;
/**
 * How many tier ranks are at least marked on paper in each decor band (rank < count); the survey keeps decor clear
 * of exactly these. Where villages are marked, hamlets are too.
 */
export const MARKED_TIERS = [1, 2, 3, 5, 5] as const;
/** Stamp widths by tier; a hamlet draws a village's stamp one step smaller. */
const STAMP_PX: readonly (readonly [number, number])[] = [[30, 132], [18, 108], [16, 84], [14, 64], [12, 48]];
const LABEL_PX = [15, 13, 12, 11.5, 11] as const;
const SHIELD_PX = [15, 13, 12, 11, 10] as const;
/** Stamp groups of the sheet by tier: hamlets borrow the village drawings. */
export const STAMP_GROUPS = ['capital', 'city', 'town', 'village', 'village'] as const;
/** Ink strength of a tier's stamp and survey mark: villages a little quieter than towns, hamlets quieter still. */
export const STAMP_ALPHA = [1, 1, 1, 1, 0.82] as const;
export const MARK_ALPHA = [1, 1, 1, 0.75, 0.6] as const;
export { SHIELD_LIMIT } from './placement';
/** Standards (bare or flying a pennant) are raised from here, as the wash softens (R7: realm distance). */
export const STANDARD_FROM = DISTANCE_SCALE.realm * 0.85;
/** Pencil flags of small live channels in view at once, by layout (R7: at most 2,000 near live marks on a phone). */
export const PENCIL_LIMIT = { phone: 600, laptop: 1_500 } as const;

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

const ramp = (value: number, from: number, to: number) => Math.min(1, Math.max(0, (value - from) / (to - from)));

/** Language names: full across the world distance, fading out as a continent fills the screen. */
export function regionLabelFade(scale: number): number {
  return 1 - ramp(scale, DISTANCE_SCALE.continent * 1.6, DISTANCE_SCALE.realm);
}

/** Realm names are written in from here: a large continent fills the screen and its realms are big enough to name. */
export const REALM_LABEL_FROM = DISTANCE_SCALE.continent * 0.4;

/**
 * Realm names (R7: "Continent: realms, cities"): absent at world distance, written in on the way to continent
 * distance (once a continent fills the screen), and giving way to the patches inside a realm on the way to kingdom
 * distance.
 */
export function realmLabelFade(scale: number): number {
  return ramp(scale, REALM_LABEL_FROM, REALM_LABEL_FROM * 1.5) * (1 - ramp(scale, DISTANCE_SCALE.realm * 1.5, DISTANCE_SCALE.kingdom));
}

/** Game patches inside a realm: from realm distance on, quieter than the realm names, gone when holdings take over. */
export function clusterLabelFade(scale: number): number {
  return ramp(scale, DISTANCE_SCALE.realm * 0.85, DISTANCE_SCALE.realm * 1.15) * (1 - ramp(scale, DISTANCE_SCALE.kingdom, DISTANCE_SCALE.kingdom + 8));
}

/** Type sizes in CSS px for a realm and for a patch of a given screen radius; a patch is always set smaller. */
export function realmLabelPx(screenR: number): number {
  return Math.round(Math.max(13, Math.min(21, screenR * 0.1)));
}
export function clusterLabelPx(screenR: number): number {
  return Math.round(Math.max(10.5, Math.min(12.5, screenR * 0.06)) * 2) / 2;
}

/**
 * The realms that get a name on the map, biggest first, ties by index. An isle's single realm is not named (the
 * isle's own name already says it), nor are the Outer Isles, which are named once as an archipelago.
 */
export function labelledRealms(realms: readonly GeoRealm[]): GeoRealm[] {
  return realms.filter((realm) => realm.kind === 'crossroads' || realm.kind === 'family' || realm.kind === 'wilds')
    .sort((a, b) => b.members - a.members || a.index - b.index);
}

/** A long realm name in two lines, broken near the middle and preferably before an ampersand. */
export function realmLines(name: string): string {
  let best = -1;
  let bestScore = Infinity;
  for (let i = 1; i < name.length - 1; i++) {
    if (name[i] !== ' ') continue;
    const score = Math.abs(i - name.length / 2) - (name[i + 1] === '&' ? 3 : 0);
    if (score < bestScore) {
      best = i;
      bestScore = score;
    }
  }
  return best < 0 ? name : `${name.slice(0, best)}\n${name.slice(best + 1)}`;
}

/** Counts from the last overlay update. */
export interface OverlayStats { stamps: number; marks: number; shields: number; labels: number; standards: number; pencils: number }

/** Something drawn that a pointer can pick: a stamp or a survey mark. */
export interface Drawn { settler: Settler; x: number; y: number; r: number }
/** A pencil flag in view: a small live channel at its pencil place. */
export interface DrawnDab { dab: Dab; x: number; y: number; r: number }
/** A found channel in view (see `found.ts`): its pencil flag, or its founded kingdom's hamlet and arms. */
export interface DrawnFound { mark: FoundMark; x: number; y: number; r: number }

/** A found channel's pencil flag is drawn this much larger than a live dab's: it is the place the visitor asked for. */
const FOUND_FLAG_SCALE = 1.7;
/** A found channel's name, a little larger than a hamlet's: pencilled in graphite, or inked for a founded kingdom. */
const FOUND_LABEL_PX = 12.5;
const GRAPHITE_HEX = parseInt(GRAPHITE.slice(1), 16);
/** A founded kingdom stands as a hamlet (tier rank 4) until the Atlas grants it land of its own. */
const FOUND_TIER = 4;

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

const phoneLayout = (view: Viewport) => Math.min(view.width, view.height) < 600;

function hashId(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return h >>> 0;
}

interface StampTextures { ink: Texture; fill: Texture | null; aspect: number; anchorX: number; anchorY: number }

/** Survey marks: the small ink symbols old maps use for settlements too small to draw. */
function markTexture(tierRank: number, pixelRatio: number): Texture {
  const css = MARK_PX[tierRank]!;
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
  if (tierRank >= 3) {
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
/** Patch names: a softer sepia than the realm names above them. */
const CLUSTER_HEX = 0x6b5a48;

/**
 * Everything drawn above the land tiles: holdings (survey marks or settlement stamps), seeded shields, names,
 * language-region names, realm names, community (category) names and the selection ring. Positions are recomputed in screen
 * space whenever the camera moves, so stamps and type keep their size while the land zooms beneath them.
 */
export class Overlay {
  readonly container = new Container();
  private readonly regionLayer = new Container();
  private readonly marks = new Container();
  private readonly fills = new Container();
  private readonly inks = new Container();
  private readonly shields = new Container();
  private readonly standards = new Container();
  private readonly pencils = new Container();
  private readonly found = new Container();
  private readonly labels = new Container();
  private readonly selection = new Graphics();
  private readonly markPool: Pool<Sprite>;
  private readonly fillPool: Pool<Sprite>;
  private readonly inkPool: Pool<Sprite>;
  private readonly shieldPool: Pool<Sprite>;
  private readonly standardPool: Pool<Sprite>;
  private readonly pencilPool: Pool<Sprite>;
  private readonly foundPool: Pool<Sprite>;
  private readonly foundFlags = new Map<string, { texture: Texture; image: StandardImage }>();
  private foundMarks: readonly FoundMark[] = [];
  private readonly standardTextures = new Map<string, { texture: Texture; image: StandardImage }>();
  private live: LivePaint | null = null;
  private readonly markTextures: Texture[];
  private readonly stampsByTier: StampTextures[][];
  private readonly textCache = new Map<string, LabelEntry>();
  private readonly shieldCache = new Map<string, { texture: Texture; usedAt: number }>();
  private readonly scratch: Settler[] = [];
  private readonly realmOrder: GeoRealm[];
  private readonly placer = new Placer();
  /** Boxes of the names lettered this update (languages, archipelagos, realms): survey marks give way under them. */
  private lettering: Rect[] = [];
  private readonly names = new HoldingLabels(this.placer);
  private frame = 0;
  /** Show newly placed things at once instead of fading them in (prefers-reduced-motion); the view keeps it current. */
  reduceMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  /** Pickable things from the last update, highest priority first. */
  drawn: Drawn[] = [];
  drawnDabs: DrawnDab[] = [];
  drawnFound: DrawnFound[] = [];
  /** Pennants and pencil flags drawn in the last update, by live class 1–5 (evidence and budgets). */
  pennants = [0, 0, 0, 0, 0, 0];
  /** What the last update put on the paper (evidence and budgets): stamps, survey marks, shields, text, standards, pencil flags. */
  stats: OverlayStats = { stamps: 0, marks: 0, shields: 0, labels: 0, standards: 0, pencils: 0 };

  constructor(private readonly world: PreviewWorld, private readonly geo: Geography, private readonly store: SettlerStore, sheet: TextureSource | null, stamps: Stamp[], private readonly pixelRatio: number) {
    this.container.addChild(this.marks, this.pencils, this.fills, this.inks, this.found, this.selection, this.regionLayer, this.standards, this.shields, this.labels);
    this.realmOrder = labelledRealms(geo.realms);
    this.markTextures = MARK_PX.map((_, tier) => markTexture(tier, pixelRatio));
    this.markPool = new Pool(this.marks, () => {
      const sprite = new Sprite();
      sprite.anchor.set(0.5);
      return sprite;
    });
    this.fillPool = new Pool(this.fills, () => new Sprite());
    this.inkPool = new Pool(this.inks, () => new Sprite());
    this.shieldPool = new Pool(this.shields, () => new Sprite());
    this.standardPool = new Pool(this.standards, () => new Sprite());
    this.pencilPool = new Pool(this.pencils, () => new Sprite());
    this.foundPool = new Pool(this.found, () => new Sprite());
    this.stampsByTier = STAMP_GROUPS.map((group) => {
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

  setLive(live: LivePaint | null): void {
    this.live = live;
  }

  /** The found channels to draw (already gated: never withheld, never a drawn holding), oldest first. */
  setFound(marks: readonly FoundMark[]): void {
    this.foundMarks = marks;
  }

  private foundFlag(live: boolean): { texture: Texture; image: StandardImage } {
    const key = live ? 'live' : 'waiting';
    let entry = this.foundFlags.get(key);
    if (!entry) {
      const image = pencilFlagImage(this.pixelRatio, { scale: FOUND_FLAG_SCALE, live });
      entry = { image, texture: new Texture({ source: new CanvasSource({ resource: image.canvas, resolution: this.pixelRatio }) }) };
      this.foundFlags.set(key, entry);
    }
    return entry;
  }

  /** A standard's image: bare (0), a pennant (1–4) or the pencil flag (5), drawn once per class and variant. */
  private standard(liveClass: number, variant: number): { texture: Texture; image: StandardImage } {
    const key = `${liveClass}:${liveClass >= 1 && liveClass <= 4 ? variant % 3 : 0}`;
    let entry = this.standardTextures.get(key);
    if (!entry) {
      const image = liveClass === 5 ? pencilFlagImage(this.pixelRatio) : standardImage(liveClass, variant % 3, this.pixelRatio);
      entry = { image, texture: new Texture({ source: new CanvasSource({ resource: image.canvas, resolution: this.pixelRatio }) }) };
      this.standardTextures.set(key, entry);
    }
    return entry;
  }

  /** Raises a holding's standard on the top of its shield: bare when offline, its pennant when live (R8). */
  private raise(settler: Settler, x: number, y: number, alpha: number, grid: CollisionGrid): void {
    const liveClass = this.live?.liveClass(settler) ?? 0;
    // Before the first live frame nothing is known about who is live: no standard rather than a falsely bare one.
    if (!this.live?.frame && liveClass === 0) return;
    const { texture, image } = this.standard(liveClass, hashId(settler.id));
    const sprite = this.standardPool.next();
    sprite.texture = texture;
    sprite.width = image.width;
    sprite.height = image.height;
    const left = Math.round(x - image.anchorX * image.width);
    const top = Math.round(y - image.height);
    sprite.position.set(left, top);
    sprite.alpha = alpha;
    grid.claim({ x: left, y: top, w: image.width, h: image.height - 2 });
    this.pennants[liveClass]!++;
    this.stats.standards++;
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

  private shieldTexture(settler: { id: string }, width: number): Texture {
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

  /** True while something placed in the last update is still fading in; the view keeps drawing until it settles. */
  get animating(): boolean {
    return this.placer.fading;
  }

  update(camera: Camera, view: Viewport, focus: { selected: Settler | null; hovered: Settler | null; found?: string | null }, now: number): void {
    this.frame++;
    // The first view arrives whole with the map's own reveal; after that, whatever newly finds room fades in.
    this.placer.begin(now, this.reduceMotion || this.frame === 1);
    this.names.begin();
    const stats: OverlayStats = { stamps: 0, marks: 0, shields: 0, labels: 0, standards: 0, pencils: 0 };
    this.stats = stats;
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
    this.standardPool.begin();
    this.pencilPool.begin();
    this.foundPool.begin();
    this.pennants = [0, 0, 0, 0, 0, 0];
    const raising = scale >= STANDARD_FROM;
    for (const entry of this.textCache.values()) entry.text.visible = false;
    const drawn: Drawn[] = [];
    this.lettering = [];
    const radii = holdingRadii(this.world);
    const kingdom = scale >= DISTANCE_SCALE.kingdom;

    // Each holding's name and shield go down right after its stamp, so a stronger holding's name is never pushed
    // aside by a weaker holding's stamp. Below the stamp first, then beside it, then above, the side it held last
    // frame before any other. A holding whose name is stale or not yet received keeps its shield alone: the arms
    // come from the channel ID, not from raw content.
    const placeName = (settler: Settler, sx: number, sy: number, w: number, h: number): void => {
      const tier = settler.tierRank;
      const size = LABEL_PX[tier]! + (kingdom ? 1.5 : 0);
      const shieldW = SHIELD_PX[tier]! + (kingdom ? 3 : 0);
      const label = settler.name === null ? null : this.text(`n:${settler.id}:${size}:${settler.name}`, settler.name, {
        fontFamily: FACE_TEXT,
        fontSize: size,
        fill: INK_HEX,
        letterSpacing: tier === 0 ? 0.6 : 0.2,
        stroke: { color: PAPER_HEX, width: 3.2, join: 'round' },
        padding: 4,
      });
      const placed = this.names.place(grid, `n:${settler.id}`, { x: sx, y: sy, w, h }, label && { w: label.width, h: label.height }, { w: shieldW, h: shieldW * SHIELD_ASPECT }, forced.has(settler));
      if (!placed) {
        if (label) label.visible = false;
        return;
      }
      if (label && placed.label) {
        label.position.set(placed.label.x, placed.label.y);
        label.alpha = placed.alpha;
        stats.labels++;
      }
      if (placed.shield) {
        stats.shields++;
        const shield = this.shieldPool.next();
        shield.texture = this.shieldTexture(settler, shieldW);
        shield.position.set(placed.shield.x, placed.shield.y);
        shield.width = shieldW + SHIELD_PAD * 2;
        shield.height = shieldW * SHIELD_ASPECT + SHIELD_PAD * 2;
        shield.alpha = placed.alpha;
        if (raising && placed.standard) this.raise(settler, placed.standard.x, placed.standard.y, placed.alpha, grid);
      }
    };
    const placeMark = (settler: Settler, x: number, y: number, alpha: number): void => {
      const mark = this.markPool.next();
      mark.texture = this.markTextures[settler.tierRank]!;
      mark.position.set(Math.round(x * this.pixelRatio) / this.pixelRatio, Math.round(y * this.pixelRatio) / this.pixelRatio);
      mark.scale.set(1);
      mark.alpha = (MARK_ALPHA[settler.tierRank] ?? 1) * alpha;
    };

    // 1. Language regions: the largest type on the map, written across the land at world and continent distance.
    this.placeRegions(camera, view, grid);

    // 1b. Found channels, as a selected holding is: they always show, and every surveyed mark and name gives way.
    const liveFound = new Set<string>();
    this.drawnFound = this.placeFound(camera, view, grid, liveFound, focus.found ?? null);

    // 2. Stamps and names, in priority order; a stamp that would crowd a stronger one stays a survey mark. Realm
    // names go down after the capitals and before every smaller holding.
    let realmsPlaced = false;
    for (const settler of visible) {
      if (!realmsPlaced && settler.tierRank > 0 && !forced.has(settler)) {
        this.placeRealms(camera, view, grid);
        realmsPlaced = true;
      }
      const s = camera.worldToScreen(settler.x, settler.y, view);
      const r = radii[settler.tierRank]!;
      const isForced = forced.has(settler);
      const marked = settler.tierRank < tiers || isForced;
      const wantsStamp = isForced || stampVisible(settler.tierRank, scale);
      const choices = this.stampsByTier[settler.tierRank]!;
      if (wantsStamp && choices.length) {
        const w = stampPx(settler.tierRank, r, scale);
        const choice = choices[hashId(settler.id) % choices.length]!;
        const h = w * choice.aspect;
        const rect: Rect = { x: s.x - w * choice.anchorX + w * 0.12, y: s.y - h * choice.anchorY + h * 0.18, w: w * 0.76, h: h * 0.76 };
        const placed = this.placer.choose(grid, `s:${settler.id}`, [rect], isForced);
        if (placed) {
          stats.stamps++;
          // A stamp taking over from its survey mark: the mark gives way as the stamp is inked in.
          if (placed.alpha < 1 && marked) placeMark(settler, s.x, s.y, 1 - placed.alpha);
          if (choice.fill) {
            const fill = this.fillPool.next();
            fill.texture = choice.fill;
            fill.tint = LAND_HEX;
            fill.position.set(s.x - w * choice.anchorX, s.y - h * choice.anchorY);
            fill.width = w;
            fill.height = h;
            fill.alpha = placed.alpha;
          }
          const ink = this.inkPool.next();
          ink.texture = choice.ink;
          ink.tint = 0xffffff;
          ink.position.set(s.x - w * choice.anchorX, s.y - h * choice.anchorY);
          ink.width = w;
          ink.height = h;
          ink.alpha = (STAMP_ALPHA[settler.tierRank] ?? 1) * placed.alpha;
          placeName(settler, s.x, s.y, w, h * choice.anchorY);
          drawn.push({ settler, x: s.x, y: s.y - h * choice.anchorY * 0.45, r: Math.max(w, h) * 0.45 });
          continue;
        }
      }
      if (!marked) continue;
      // Names knock out the survey marks under them; a forced (selected or found) holding always shows.
      if (!isForced && underLettering(s.x, s.y, settler.tierRank, this.lettering)) continue;
      stats.marks++;
      placeMark(settler, s.x, s.y, 1);
      drawn.push({ settler, x: s.x, y: s.y, r: Math.max(5, r * scale) });
    }
    if (!realmsPlaced) this.placeRealms(camera, view, grid);

    // 3. Pencil flags of the small live channels at their pencil places, after every holding and its name.
    this.drawnDabs = raising ? this.placePencils(camera, view, grid, phoneLayout(view), liveFound) : [];
    stats.pencils += this.drawnDabs.length;

    // 4. Community names (the observed main category of a cluster) once a realm is close.
    this.placeClusters(camera, view, grid);

    // 5. Selection: a double ink ring with four ticks, like a surveyor's mark.
    this.selection.clear();
    const chosen = focus.selected ? drawn.find((item) => item.settler === focus.selected) : focus.found ? this.drawnFound.find((item) => item.mark.id === focus.found) : undefined;
    {
      const target = chosen;
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
    this.standardPool.end();
    this.pencilPool.end();
    this.foundPool.end();
    this.placer.end();
    this.drawn = drawn;
    this.evict();
  }

  /**
   * Found channels at their pencil places, forced like a selected holding, at every distance. A waiting channel is a
   * pencil flag with its name in graphite; on air its flag holds the live wash and its dab is not drawn again. A
   * founded kingdom is a hamlet's stamp with its arms and its kingdom's name in ink, flying a pennant while on air.
   * `liveFound` collects the dab hashes drawn here, so the live layer leaves them out.
   */
  private placeFound(camera: Camera, view: Viewport, grid: CollisionGrid, liveFound: Set<string>, selected: string | null): DrawnFound[] {
    if (!this.foundMarks.length) return [];
    const live = this.live?.frame ? this.live : null;
    const onAir = new Set<string>();
    if (live) {
      const wanted = new Set(this.foundMarks.map((mark) => mark.hash));
      for (const dab of live.dabs) if (wanted.has(dab.hash)) onAir.add(dab.hash);
    }
    const out: DrawnFound[] = [];
    const reach = camera.visibleBox(view, 120);
    const kingdom = camera.scale >= DISTANCE_SCALE.kingdom;
    const radii = holdingRadii(this.world);
    for (const mark of this.foundMarks) {
      if (mark.x < reach.minX || mark.x > reach.maxX || mark.y < reach.minY || mark.y > reach.maxY) continue;
      const s = camera.worldToScreen(mark.x, mark.y, view);
      const airing = onAir.has(mark.hash);
      if (airing) liveFound.add(mark.hash);
      const style: TextStyleOptions = mark.kind === 'kingdom'
        ? { fontFamily: FACE_TEXT, fontSize: FOUND_LABEL_PX + (kingdom ? 1.5 : 0), fill: INK_HEX, letterSpacing: 0.3, stroke: { color: PAPER_HEX, width: 3.2, join: 'round' }, padding: 4 }
        : { fontFamily: FACE_ITALIC, fontStyle: 'italic', fontSize: FOUND_LABEL_PX + (kingdom ? 1 : 0), fill: GRAPHITE_HEX, letterSpacing: 0.3, stroke: { color: PAPER_HEX, width: 3.2, join: 'round' }, padding: 4 };
      const label = mark.label === null ? null : this.text(`f:${mark.kind}:${mark.id}:${style.fontSize}:${mark.label}`, mark.label, style);
      if (mark.kind === 'kingdom') {
        const choices = this.stampsByTier[FOUND_TIER]!;
        const w = stampPx(FOUND_TIER, radii[FOUND_TIER]!, camera.scale);
        const choice = choices.length ? choices[hashId(mark.id) % choices.length]! : null;
        const h = choice ? w * choice.aspect : w * 0.7;
        const anchorX = choice?.anchorX ?? 0.5;
        const anchorY = choice?.anchorY ?? 0.8;
        const placed = this.placer.choose(grid, `fs:${mark.id}`, [{ x: s.x - w * anchorX + w * 0.12, y: s.y - h * anchorY + h * 0.18, w: w * 0.76, h: h * 0.76 }], true)!;
        this.lettering.push(placed.rect);
        if (choice) {
          if (choice.fill) {
            const fill = this.fillPool.next();
            fill.texture = choice.fill;
            fill.tint = LAND_HEX;
            fill.position.set(s.x - w * anchorX, s.y - h * anchorY);
            fill.width = w;
            fill.height = h;
            fill.alpha = placed.alpha;
          }
          const ink = this.inkPool.next();
          ink.texture = choice.ink;
          ink.tint = 0xffffff;
          ink.position.set(s.x - w * anchorX, s.y - h * anchorY);
          ink.width = w;
          ink.height = h;
          ink.alpha = placed.alpha;
        } else {
          const dot = this.markPool.next();
          dot.texture = this.markTextures[2]!;
          dot.position.set(Math.round(s.x), Math.round(s.y));
          dot.scale.set(1);
          dot.alpha = placed.alpha;
        }
        this.stats.stamps++;
        const shieldW = SHIELD_PX[FOUND_TIER]! + 2 + (kingdom ? 3 : 0);
        const block = this.names.place(grid, `fn:${mark.id}`, { x: s.x, y: s.y, w, h: h * anchorY }, label && { w: label.width, h: label.height }, { w: shieldW, h: shieldW * SHIELD_ASPECT }, true);
        if (label) label.visible = !!block?.label;
        if (block) this.lettering.push(block.rect);
        if (block?.label && label) {
          label.position.set(block.label.x, block.label.y);
          label.alpha = block.alpha;
          this.stats.labels++;
        }
        if (block?.shield) {
          this.stats.shields++;
          const shield = this.shieldPool.next();
          shield.texture = this.shieldTexture(mark, shieldW);
          shield.position.set(block.shield.x, block.shield.y);
          shield.width = shieldW + SHIELD_PAD * 2;
          shield.height = shieldW * SHIELD_ASPECT + SHIELD_PAD * 2;
          shield.alpha = block.alpha;
          // A founded kingdom on air flies the smallest pennant; off the air, its standard stands bare.
          if (block.standard && live) {
            const { texture, image } = this.standard(airing ? 4 : 0, hashId(mark.id));
            const flag = this.standardPool.next();
            flag.texture = texture;
            flag.width = image.width;
            flag.height = image.height;
            const left = Math.round(block.standard.x - image.anchorX * image.width);
            const top = Math.round(block.standard.y - image.height);
            flag.position.set(left, top);
            flag.alpha = block.alpha;
            grid.claim({ x: left, y: top, w: image.width, h: image.height - 2 });
            this.stats.standards++;
          }
        }
        out.push({ mark, x: s.x, y: s.y - h * anchorY * 0.45, r: Math.max(w, h) * 0.45 + 2 });
        continue;
      }
      const { texture, image } = this.foundFlag(airing);
      const left = Math.round(s.x - image.anchorX * image.width);
      const top = Math.round(s.y - image.height);
      const placed = this.placer.choose(grid, `fp:${mark.id}`, [{ x: left, y: top, w: image.width - 2, h: image.height }], true)!;
      this.lettering.push(placed.rect);
      const sprite = this.foundPool.next();
      sprite.texture = texture;
      sprite.width = image.width;
      sprite.height = image.height;
      sprite.position.set(left, top);
      sprite.alpha = placed.alpha;
      this.stats.pencils++;
      const pick = { x: s.x + image.width * 0.2, y: s.y - image.height * 0.55, r: Math.max(10, image.height * 0.5) };
      if (label) {
        // The name sits beside the flag, below its foot first, the side it held last frame before any other. While
        // its card is open the name stands outside the selection ring and its ticks.
        const ring = pick.r + 7 + 10;
        const candidates = mark.id === selected
          ? [
            { x: pick.x - label.width / 2, y: pick.y + ring + 1, w: label.width, h: label.height },
            { x: pick.x + ring + 3, y: pick.y - label.height / 2, w: label.width, h: label.height },
            { x: pick.x - ring - 3 - label.width, y: pick.y - label.height / 2, w: label.width, h: label.height },
            { x: pick.x - label.width / 2, y: pick.y - ring - label.height - 1, w: label.width, h: label.height },
          ]
          : HoldingLabels.candidates({ x: s.x + image.width * 0.22, y: s.y, w: image.width, h: image.height }, label.width, label.height);
        const at = this.placer.choose(grid, `fl:${mark.id}`, candidates, true);
        label.visible = !!at;
        if (at) {
          this.lettering.push(at.rect);
          label.position.set(Math.round(at.rect.x), Math.round(at.rect.y));
          label.alpha = at.alpha;
          this.stats.labels++;
        }
      }
      out.push({ mark, ...pick });
    }
    return out;
  }

  /** Pencil flags never push a name aside: each takes free paper or waits for a closer view. */
  private placePencils(camera: Camera, view: Viewport, grid: CollisionGrid, phone: boolean, skip: ReadonlySet<string> = new Set()): DrawnDab[] {
    const live = this.live;
    if (!live?.frame) return [];
    const { texture, image } = this.standard(5, 0);
    // A flag stands above its place: one whose foot is just below the screen still shows its top.
    const box = camera.visibleBox(view, image.height + 4);
    const limit = phone ? PENCIL_LIMIT.phone : PENCIL_LIMIT.laptop;
    const out: DrawnDab[] = [];
    for (const dab of live.dabs) {
      if (out.length >= limit) break;
      if (!dab.placed || dab.x < box.minX || dab.x > box.maxX || dab.y < box.minY || dab.y > box.maxY || skip.has(dab.hash)) continue;
      const s = camera.worldToScreen(dab.x, dab.y, view);
      const left = Math.round(s.x - image.anchorX * image.width);
      const top = Math.round(s.y - image.height);
      const placed = this.placer.choose(grid, `p:${dab.hash}`, [{ x: left, y: top, w: image.width - 2, h: image.height }]);
      if (!placed) continue;
      const sprite = this.pencilPool.next();
      sprite.texture = texture;
      sprite.width = image.width;
      sprite.height = image.height;
      sprite.position.set(left, top);
      sprite.alpha = (0.55 + 0.45 * live.bloom(dab.startedAt)) * placed.alpha;
      out.push({ dab, x: s.x + 2, y: s.y - image.height * 0.6, r: 7 });
      this.pennants[5]!++;
    }
    return out;
  }

  /**
   * Places an area name (region, realm, patch) on the first free of its candidates, the one it held last frame first,
   * or hides it. Returns the placement so the caller can set the alpha.
   */
  private placeArea(grid: CollisionGrid, key: string, candidates: readonly Rect[], ...texts: (Text | null)[]): Placed | null {
    const placed = this.placer.choose(grid, key, candidates);
    if (placed) this.lettering.push(placed.rect);
    for (const text of texts) {
      if (!text) continue;
      if (placed) this.stats.labels++;
      else text.visible = false;
    }
    return placed;
  }

  private placeRegions(camera: Camera, view: Viewport, grid: CollisionGrid): void {
    const scale = camera.scale;
    const fade = regionLabelFade(scale);
    if (fade <= 0.02) return;
    // The Outer Isles share one name, written once over the archipelago below.
    const regions = this.geo.regions.filter((region) => region.kind !== 'outer').sort((a, b) => b.members - a.members || a.index - b.index);
    const dys = [0, -0.34, 0.34, -0.6, 0.6];
    for (const region of regions) {
      const screenR = region.r * scale;
      if (screenR < (region.kind === 'continent' ? 26 : 16)) continue;
      const continent = region.kind === 'continent';
      const size = Math.round(Math.max(continent ? 15 : 11.5, Math.min(continent ? 34 : 17, screenR * (continent ? 0.16 : 0.2))));
      const subtitle = region.englishName !== region.name && continent ? region.englishName : null;
      const subSize = Math.max(11, Math.round(size * 0.42));
      const c = camera.worldToScreen(region.x, region.y, view);
      // Culled before any type is set: a generous reach (about an em per letter) around every candidate.
      const reachW = Math.max(Math.max(...region.name.split('\n').map(line => line.length)) * size * 0.62, (subtitle?.length ?? 0) * subSize * 0.62) + 8;
      const reachH = screenR * 0.6 + size * 1.6 + subSize * 1.4;
      if (!onScreen({ x: c.x - reachW, y: c.y - reachH, w: reachW * 2, h: reachH * 2 }, view.width, view.height, 40)) continue;
      const label = this.text(`r:${region.index}:${size}`, region.name, {
        fontFamily: continent ? FACE_CAPS : FACE_ITALIC,
        fontStyle: continent ? 'normal' : 'italic',
        fontSize: size,
        fill: INK_HEX,
        letterSpacing: continent ? size * 0.32 : size * 0.08,
        stroke: { color: PAPER_HEX, width: continent ? 4 : 3, join: 'round' },
        padding: 6,
      });
      const sub = subtitle ? this.text(`rs:${region.index}:${size}`, subtitle, {
        fontFamily: FACE_ITALIC,
        fontStyle: 'italic',
        fontSize: subSize,
        fill: INK_HEX,
        letterSpacing: 1,
        stroke: { color: PAPER_HEX, width: 3, join: 'round' },
        padding: 4,
      }) : null;
      const height = label.height + (sub ? sub.height - 4 : 0);
      const width = Math.max(label.width, sub?.width ?? 0);
      // Candidates up to the first that lies wholly off the screen: a name is not moved off the paper to find room.
      const candidates: Rect[] = [];
      for (const dy of dys) {
        const rect: Rect = { x: c.x - width / 2, y: c.y + dy * screenR - height / 2, w: width, h: height };
        if (!onScreen(rect, view.width, view.height, 40)) break;
        candidates.push(rect);
      }
      const placed = this.placeArea(grid, `r:${region.index}`, candidates, label, sub);
      if (!placed) continue;
      label.position.set(Math.round(c.x - label.width / 2), Math.round(placed.rect.y));
      label.alpha = 0.78 * fade * placed.alpha;
      if (sub) {
        sub.position.set(Math.round(c.x - sub.width / 2), Math.round(placed.rect.y + label.height - 4));
        sub.alpha = 0.72 * fade * placed.alpha;
      }
    }
    if (this.geo.isles) this.placeArchipelago('isles', this.geo.isles, camera, view, grid, fade);
    this.placeArchipelago('outer', this.geo.outer, camera, view, grid, fade);
  }

  /** A group of islands named once, along the top of the circle that holds them. */
  private placeArchipelago(key: string, circle: Circle, camera: Camera, view: Viewport, grid: CollisionGrid, fade: number): void {
    const scale = camera.scale;
    if (circle.r * scale <= 30) return;
    const size = Math.round(Math.max(13, Math.min(24, circle.r * scale * 0.09)));
    const top = Math.max(circle.y - circle.r * 0.92, this.geo.bounds.minY + 40);
    const c = camera.worldToScreen(circle.x, top, view);
    const reachW = circle.name.length * size * 0.8 + 8;
    if (!onScreen({ x: c.x - reachW, y: c.y, w: reachW * 2, h: size * 1.8 }, view.width, view.height, 40)) return;
    const label = this.text(`${key}:${size}`, circle.name, {
      fontFamily: FACE_ITALIC,
      fontStyle: 'italic',
      fontSize: size,
      fill: INK_HEX,
      letterSpacing: size * 0.18,
      stroke: { color: PAPER_HEX, width: 3.5, join: 'round' },
      padding: 6,
    });
    const placed = this.placeArea(grid, `a:${key}`, [{ x: c.x - label.width / 2, y: c.y, w: label.width, h: label.height }], label);
    if (!placed) return;
    label.position.set(Math.round(placed.rect.x), Math.round(placed.rect.y));
    label.alpha = 0.8 * fade * placed.alpha;
  }

  /** Realm names across a continent: the families of games, the Crossroads at its heart and the Wilds at its edge. */
  private placeRealms(camera: Camera, view: Viewport, grid: CollisionGrid): void {
    const scale = camera.scale;
    const fade = realmLabelFade(scale);
    if (fade <= 0.02) return;
    const box = camera.visibleBox(view, 40);
    for (const realm of this.realmOrder) {
      const screenR = realm.r * scale;
      // A realm's name may run a little past its circle (up to 2.4 r wide), so the reach is 1.2 r.
      const reach = realm.r * 1.2;
      if (screenR < 30 || realm.x + reach < box.minX || realm.x - reach > box.maxX || realm.y + reach < box.minY || realm.y - reach > box.maxY) continue;
      const size = realmLabelPx(screenR);
      const style: TextStyleOptions = {
        fontFamily: FACE_ITALIC,
        fontStyle: 'italic',
        fontSize: size,
        fill: INK_HEX,
        letterSpacing: size * 0.12,
        stroke: { color: PAPER_HEX, width: 3.2, join: 'round' },
        padding: 5,
        align: 'center',
        lineHeight: size * 1.08,
      };
      let label = this.text(`m:${realm.index}:${size}`, realm.name, style);
      if (label.width > screenR * 1.9 && realm.name.includes(' ')) {
        label.visible = false;
        label = this.text(`m2:${realm.index}:${size}`, realmLines(realm.name), style);
      }
      // A name much wider than its realm would read as its neighbour's; it waits for a closer view.
      if (label.width > screenR * 2.4) {
        label.visible = false;
        continue;
      }
      const c = camera.worldToScreen(realm.x, realm.y, view);
      const candidates = [0, 0.42, -0.42, 0.7, -0.7].map((dy): Rect => ({ x: c.x - label.width / 2, y: c.y + dy * screenR - label.height / 2, w: label.width, h: label.height }));
      const placed = this.placeArea(grid, `m:${realm.index}`, candidates, label);
      if (!placed) continue;
      label.position.set(Math.round(placed.rect.x), Math.round(placed.rect.y));
      label.alpha = 0.86 * fade * placed.alpha;
    }
  }

  private placeClusters(camera: Camera, view: Viewport, grid: CollisionGrid): void {
    const scale = camera.scale;
    const fade = clusterLabelFade(scale);
    if (fade <= 0.02) return;
    const box = camera.visibleBox(view, 80);
    const clusters = this.geo.clusters
      .map((cluster, index) => ({ cluster, index }))
      .filter(({ cluster }) => cluster.r * scale >= 46 && cluster.x + cluster.r > box.minX && cluster.x - cluster.r < box.maxX && cluster.y + cluster.r > box.minY && cluster.y - cluster.r < box.maxY)
      .sort((a, b) => b.cluster.members - a.cluster.members || a.index - b.index);
    for (const { cluster, index } of clusters) {
      const name = cluster.name;
      if (!name) continue;
      const size = clusterLabelPx(cluster.r * scale);
      const label = this.text(`c:${index}:${size}`, name, {
        fontFamily: FACE_ITALIC,
        fontStyle: 'italic',
        fontSize: size,
        fill: CLUSTER_HEX,
        letterSpacing: size * 0.16,
        stroke: { color: PAPER_HEX, width: 2.6, join: 'round' },
        padding: 4,
      });
      const c = camera.worldToScreen(cluster.x, cluster.y, view);
      const r = cluster.r * scale;
      const candidates = [-0.92, 0.92, -0.5, 0.5, 0].map((dy): Rect => ({ x: c.x - label.width / 2, y: c.y + dy * r - label.height / 2, w: label.width, h: label.height }));
      const placed = this.placeArea(grid, `c:${index}`, candidates, label);
      if (!placed) continue;
      label.position.set(Math.round(placed.rect.x), Math.round(placed.rect.y));
      label.alpha = 0.7 * fade * placed.alpha;
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

  /** The found channel nearest a screen point, if any lies within reach. */
  pickFound(x: number, y: number, slop: number): FoundMark | null {
    let best: DrawnFound | null = null;
    let bestD = Infinity;
    for (const item of this.drawnFound) {
      const d = Math.hypot(item.x - x, item.y - y);
      if (d <= item.r + slop && d < bestD) {
        best = item;
        bestD = d;
      }
    }
    return best?.mark ?? null;
  }

  /** The pencil flag nearest a screen point, if any lies within reach. */
  pickDab(x: number, y: number, slop: number): Dab | null {
    let best: DrawnDab | null = null;
    let bestD = Infinity;
    for (const item of this.drawnDabs) {
      const d = Math.hypot(item.x - x, item.y - y);
      if (d <= item.r + slop && d < bestD) {
        best = item;
        bestD = d;
      }
    }
    return best?.dab ?? null;
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
    for (const entry of this.standardTextures.values()) entry.texture.destroy(true);
    for (const entry of this.foundFlags.values()) entry.texture.destroy(true);
    for (const texture of this.markTextures) texture.destroy(true);
    this.container.destroy({ children: true });
  }
}
