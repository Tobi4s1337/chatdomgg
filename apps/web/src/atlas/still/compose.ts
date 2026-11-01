import type { Geography, GeoRealm, Settler, SettlerStore } from '../data/model';
import type { PreviewWorld } from '../data/preview';
import { SHIELD_ASPECT } from '../heraldry/geometry';
import { Camera, DISTANCE_SCALE, distanceFor, NO_INSETS, type Box, type Distance, type Insets, type Viewport } from '../map/camera';
import { CollisionGrid, comparePriority, type Rect } from '../map/collide';
import type { Stamp } from '../map/paint';
import { decorBand, levelFor, parentOf, pyramidFor, tileBox, tilesFor, type Pyramid, type TileKey } from '../map/pyramid';
import { formatMoment, formatTime, TIER_NAMES } from '../ui/format';

/**
 * The still of the Atlas (Spec 01 R10): where WebGL is missing, the home view of the same survey revision is drawn
 * once with Canvas 2D and its holdings are real buttons. This module is the pure half: which view, which tiles, where
 * each mark, shield and name goes, which washes are laid and what the ribbon says. It touches no DOM or canvas, so it
 * is tested in Node, and it imports nothing that carries Pixi, so the still's chunk stays light.
 *
 * The overlay's and the wash's drawing rules live beside their Pixi renderers (`map/overlay.ts`, `map/wash.ts`); the
 * still restates the few it needs below, and `parity.test.ts` holds both copies to the same numbers.
 */

// ── The overlay's rules (map/overlay.ts) ─────────────────────────────────────────────────────────

export const FACE_TEXT = '"IM Fell English", "Alegreya", "Noto Serif", Georgia, serif';
export const FACE_CAPS = '"IM Fell English SC", "IM Fell English", "Alegreya", "Noto Serif", Georgia, serif';
export const FACE_ITALIC = '"IM Fell English", "Alegreya", "Noto Serif", Georgia, serif';

export const STAMP_SCALE = [0, DISTANCE_SCALE.continent, DISTANCE_SCALE.realm, DISTANCE_SCALE.kingdom] as const;
export const MARKED_TIERS = [1, 2, 3, 4, 4] as const;
const STAMP_PX: readonly (readonly [number, number])[] = [[30, 132], [18, 108], [16, 84], [14, 64]];
export const LABEL_PX = [15, 13, 12, 11.5] as const;
export const SHIELD_PX = [15, 13, 12, 11] as const;
export const SHIELD_LIMIT = 300;
/** Survey-mark diameters in CSS px by tier, as the overlay's mark textures draw them. */
export const MARK_PX = [9, 7, 5, 3.6] as const;
export const REALM_LABEL_FROM = DISTANCE_SCALE.continent * 0.4;
/** The world file carries capitals and cities; towns and villages arrive per region and are never marked on a still. */
const HEAD_TIERS = 2;
const STAMP_GROUPS = ['capital', 'city', 'town', 'village'] as const;

const ramp = (value: number, from: number, to: number) => Math.min(1, Math.max(0, (value - from) / (to - from)));

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

export function regionLabelFade(scale: number): number {
  return 1 - ramp(scale, DISTANCE_SCALE.continent * 1.6, DISTANCE_SCALE.realm);
}

export function realmLabelFade(scale: number): number {
  return ramp(scale, REALM_LABEL_FROM, REALM_LABEL_FROM * 1.5) * (1 - ramp(scale, DISTANCE_SCALE.realm * 1.5, DISTANCE_SCALE.kingdom));
}

export function realmLabelPx(screenR: number): number {
  return Math.round(Math.max(13, Math.min(21, screenR * 0.1)));
}

export function labelledRealms(realms: readonly GeoRealm[]): GeoRealm[] {
  return realms.filter((realm) => realm.kind === 'crossroads' || realm.kind === 'family' || realm.kind === 'wilds')
    .sort((a, b) => b.members - a.members || a.index - b.index);
}

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

export function hashId(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return h >>> 0;
}

// ── The wash's rules (map/wash.ts) ───────────────────────────────────────────────────────────────

export const WASH_RADIUS = [0, 13, 7.6, 4.2, 3, 1.5] as const;
export const WASH_PX: readonly (readonly [number, number])[] = [[0, 0], [15, 120], [9, 78], [5.5, 46], [4, 30], [2.6, 15]];
export const WASH_ALPHA = [0, 0.8, 0.72, 0.62, 0.54, 0.42] as const;
export const DENSITY_ALPHA = [0, 0.9, 0.7, 0.42, 0.3, 0.12] as const;
export const DENSITY_CAP = 0.64;
export const CLOSE_WASH_LIMIT = { phone: 2_000, laptop: 4_000 } as const;

export function washDetail(scale: number): number {
  return ramp(scale, DISTANCE_SCALE.continent * 1.3, DISTANCE_SCALE.realm * 0.8);
}

export function washSoftening(scale: number): number {
  return 1 - 0.48 * ramp(scale, DISTANCE_SCALE.realm * 0.6, DISTANCE_SCALE.realm * 1.2);
}

export function washPx(liveClass: number, scale: number): number {
  const [min, max] = WASH_PX[liveClass] ?? [0, 0];
  return Math.min(max, Math.max(min, (WASH_RADIUS[liveClass as 1] ?? 0) * scale));
}

// ── The view and its land ────────────────────────────────────────────────────────────────────────

export const phoneLayout = (view: Viewport) => Math.min(view.width, view.height) < 600;

/** Device pixels per CSS pixel for the still's canvases: the map's own rule, at most 2. */
export function stillPixelRatio(devicePixelRatio: number): number {
  return Math.min(2, Math.max(1, devicePixelRatio || 1));
}

/** Screen kept clear for the Atlas's panels, exactly as the moving map's opening view keeps it (index.tsx). */
export function stillInsets(view: Viewport): Insets {
  if (view.width < 720) return { left: 0, right: 0, top: 124, bottom: 60 };
  return NO_INSETS;
}

export interface StillView {
  camera: Camera;
  view: Viewport;
  pyramid: Pyramid;
  scale: number;
  distance: Distance;
  /** The one pyramid level the still is inked at, and its tiles over the visible sheet, centre first. */
  level: number;
  tiles: TileKey[];
}

/**
 * The opening view of the moving map (Camera.home: the whole map on a laptop, the map filling a phone held upright),
 * and the tiles of the single level that matches it. Tiles are baked at the device density, so the level is chosen
 * per CSS pixel, as the tile layer chooses it; only tiles that show some of the surveyed sheet are wanted.
 */
export function stillView(bounds: Box, view: Viewport, insets: Insets = stillInsets(view)): StillView {
  const camera = new Camera(bounds);
  camera.home(view, insets);
  const pyramid = pyramidFor(bounds);
  const level = levelFor(pyramid, camera.scale, 1);
  const seen = camera.visibleBox(view, 0);
  const sheet: Box = {
    minX: Math.max(seen.minX, bounds.minX), minY: Math.max(seen.minY, bounds.minY),
    maxX: Math.min(seen.maxX, bounds.maxX), maxY: Math.min(seen.maxY, bounds.maxY),
  };
  const tiles = sheet.maxX > sheet.minX && sheet.maxY > sheet.minY ? tilesFor(pyramid, level, sheet) : [];
  return { camera, view, pyramid, scale: camera.scale, distance: distanceFor(camera.scale), level, tiles };
}

/** A tile's place on the still in device pixels, edges rounded from shared positions so neighbours meet exactly. */
export function tileRect(pyramid: Pyramid, key: TileKey, camera: Camera, view: Viewport, pixelRatio: number): Rect {
  const box = tileBox(pyramid, key);
  const a = camera.worldToScreen(box.minX, box.minY, view);
  const b = camera.worldToScreen(box.maxX, box.maxY, view);
  const x0 = Math.round(a.x * pixelRatio);
  const y0 = Math.round(a.y * pixelRatio);
  return { x: x0, y: y0, w: Math.round(b.x * pixelRatio) - x0, h: Math.round(b.y * pixelRatio) - y0 };
}

/** Every ancestor of a tile, nearest first: where a tile could not be baked, the nearest baked one stands in. */
export function ancestorsOf(key: TileKey): TileKey[] {
  const out: TileKey[] = [];
  for (let parent = parentOf(key); parent; parent = parentOf(parent)) out.push(parent);
  return out;
}

/** The part of an ancestor's image that covers a tile, as fractions of the ancestor's side. */
export function ancestorCrop(key: TileKey, ancestor: TileKey): { x: number; y: number; size: number } {
  const depth = key.level - ancestor.level;
  const n = 2 ** depth;
  return { x: (key.tx - ancestor.tx * n) / n, y: (key.ty - ancestor.ty * n) / n, size: 1 / n };
}

/** The sheet's edge as the map draws it (view.ts drawFrame): deeper paper outside the survey and a double neatline. */
export function sheetFrame(bounds: Box, camera: Camera, view: Viewport): { margin: Rect[]; inner: Rect; outer: Rect } {
  const a = camera.worldToScreen(bounds.minX, bounds.minY, view);
  const c = camera.worldToScreen(bounds.maxX, bounds.maxY, view);
  const W = view.width;
  const H = view.height;
  const margin: Rect[] = [];
  const top = Math.max(0, a.y);
  const bottom = Math.min(H, c.y);
  if (a.y > 0) margin.push({ x: 0, y: 0, w: W, h: a.y });
  if (c.y < H) margin.push({ x: 0, y: c.y, w: W, h: H - c.y });
  if (a.x > 0 && bottom > top) margin.push({ x: 0, y: top, w: a.x, h: bottom - top });
  if (c.x < W && bottom > top) margin.push({ x: c.x, y: top, w: W - c.x, h: bottom - top });
  return {
    margin,
    inner: { x: a.x, y: a.y, w: c.x - a.x, h: c.y - a.y },
    outer: { x: a.x - 5, y: a.y - 5, w: c.x - a.x + 10, h: c.y - a.y + 10 },
  };
}

// ── Lettering and marks ──────────────────────────────────────────────────────────────────────────

export type Face = 'text' | 'caps' | 'italic';
export interface Font { face: Face; size: number; spacing: number }
/** Advance width of a line of type in CSS px (letter spacing included). The still measures with a 2D context. */
export type Measure = (text: string, font: Font) => number;

/** Lines of type sit this many font sizes apart; a single line is this tall before its paper stroke. */
export const LINE = 1.24;

/** A name lettered over the land: a language, an archipelago or a realm. */
export interface StillText {
  kind: 'region' | 'subtitle' | 'archipelago' | 'realm';
  lines: string[];
  font: Font;
  /** Paper stroke width behind the ink, as the map sets it. */
  stroke: number;
  /** Top-left and size of the lettered box in CSS px; lines are centred in it. */
  x: number;
  y: number;
  w: number;
  h: number;
  lineHeight: number;
  alpha: number;
}

/** One holding on the still, as a button: its stamp or survey mark, then its shield and name where they fit. */
export interface StillMark {
  id: string;
  settler: Settler;
  /** The button itself: the stamp as drawn, or a touch-sized square around a survey mark. */
  box: Rect;
  stamp: { group: string; index: number; x: number; y: number; w: number; h: number } | null;
  mark: { size: number } | null;
  /** Top-left of the shield's canvas (the shield is `width` wide inside a 3 px paper halo). */
  shield: { x: number; y: number; width: number } | null;
  name: { text: string; x: number; y: number; w: number; h: number; size: number; spacing: number } | null;
  /** The surveyor's selection ring around what was drawn. */
  ring: { x: number; y: number; r: number };
  /** What the button is called: the name when known, else the arms alone ("Unnamed city in …"). */
  label: string;
}

export interface StillLayout {
  marks: StillMark[];
  texts: StillText[];
  shields: number;
  names: number;
  /** Tiers marked at this distance (1 = capitals, 2 = capitals and cities). */
  tiers: number;
  /** Every box claimed, in claim order: stamps, name plates and lettering. They never overlap. */
  claims: Rect[];
}

export interface LayoutInput {
  world: PreviewWorld;
  geo: Geography;
  store: SettlerStore;
  camera: Camera;
  view: Viewport;
  stamps: readonly Stamp[];
  measure: Measure;
  /** Drawn first and always (unless withheld), as the moving map draws a selection. */
  selected?: Settler | null;
}

/** The accessible name of a holding's button. Withheld holdings never reach this. */
export function markLabel(settler: Settler, geo: Geography): string {
  const tier = TIER_NAMES[settler.tierRank]!.toLowerCase();
  const region = geo.regions[settler.region];
  const where = region && region.kind === 'continent' && region.name !== settler.realmName ? `${settler.realmName}, ${region.name}` : settler.realmName || region?.name || 'the survey';
  return settler.name === null ? `Unnamed ${tier} in ${where}` : `${settler.name}, ${tier} in ${where}`;
}

/**
 * Places everything the moving map places at this camera, in its order and by its rules (map/overlay.ts update):
 * language names first, then each holding in stable priority (tier, observed average, channel ID) with its stamp
 * (or survey mark when the stamp would crowd a stronger one), then its shield and name together below, right, left
 * or above it; realm names go down after the capitals. At most SHIELD_LIMIT shields. Withheld holdings never appear.
 */
export function layoutStill(input: LayoutInput): StillLayout {
  const { world, geo, store, camera, view, measure } = input;
  const scale = camera.scale;
  const grid = new CollisionGrid(view.width, view.height);
  const claims: Rect[] = [];
  const claim = (rect: Rect) => {
    grid.claim(rect);
    claims.push(rect);
  };
  const take = (rect: Rect) => {
    if (!grid.free(rect)) return false;
    claim(rect);
    return true;
  };
  const box = camera.visibleBox(view, 160);
  const tiers = Math.min(markedTiers(scale), HEAD_TIERS);
  const selected = input.selected && !input.selected.withheld && store.byId.get(input.selected.id) === input.selected ? input.selected : null;
  const visible = store.query(box.minX, box.minY, box.maxX, box.maxY, Math.max(0, tiers - 1), []).sort(comparePriority);
  if (selected) {
    const at = visible.indexOf(selected);
    if (at >= 0) visible.splice(at, 1);
    const inView = selected.x >= box.minX && selected.x <= box.maxX && selected.y >= box.minY && selected.y <= box.maxY;
    if (inView) visible.unshift(selected);
  }

  const texts: StillText[] = [];
  placeRegions(geo, camera, view, measure, take, texts);

  const radius = world.tiers.holdingRadius;
  const radii = [radius.capital, radius.city, radius.town, radius.village];
  const choicesByTier = STAMP_GROUPS.map((group) => input.stamps.filter((stamp) => stamp.group === group));
  const marks: StillMark[] = [];
  let shields = 0;
  let names = 0;
  let realmsPlaced = false;

  const placeName = (settler: Settler, sx: number, sy: number, w: number, h: number, forced: boolean): Pick<StillMark, 'shield' | 'name'> => {
    const tier = settler.tierRank;
    const size = LABEL_PX[tier]! + (scale >= DISTANCE_SCALE.kingdom ? 1.5 : 0);
    const shieldW = SHIELD_PX[tier]! + (scale >= DISTANCE_SCALE.kingdom ? 3 : 0);
    const spacing = tier === 0 ? 0.6 : 0.2;
    const text = settler.name;
    const labelW = text === null ? 0 : Math.ceil(measure(text, { face: 'text', size, spacing }) + 3.2);
    const labelH = text === null ? 0 : Math.ceil(size * LINE + 3.2);
    const withShield = shields < SHIELD_LIMIT;
    if (text === null && !withShield) return { shield: null, name: null };
    const gap = withShield ? shieldW + (text === null ? 0 : 4) : 0;
    const totalW = labelW + gap;
    const height = Math.max(labelH, withShield ? shieldW * SHIELD_ASPECT : 0);
    const mid = sy - h / 2;
    const candidates: Rect[] = [
      { x: sx - totalW / 2, y: sy + 2, w: totalW, h: height },
      { x: sx + w * 0.42, y: mid - height / 2, w: totalW, h: height },
      { x: sx - w * 0.42 - totalW, y: mid - height / 2, w: totalW, h: height },
      { x: sx - totalW / 2, y: sy - h - height - 1, w: totalW, h: height },
    ];
    const rect = candidates.find((candidate) => grid.free(candidate)) ?? (forced ? candidates[0]! : null);
    if (!rect) return { shield: null, name: null };
    claim(rect);
    const name = text === null ? null : { text, x: Math.round(rect.x + gap), y: Math.round(rect.y + (rect.h - labelH) / 2), w: labelW, h: labelH, size, spacing };
    if (name) names++;
    if (!withShield) return { shield: null, name };
    shields++;
    const shieldTop = Math.round(rect.y + (rect.h - shieldW * SHIELD_ASPECT) / 2 - 3);
    return { shield: { x: Math.round(rect.x - 3), y: shieldTop, width: shieldW }, name };
  };

  for (const settler of visible) {
    const forced = settler === selected;
    if (!realmsPlaced && settler.tierRank > 0 && !forced) {
      placeRealms(geo, camera, view, measure, take, texts);
      realmsPlaced = true;
    }
    const s = camera.worldToScreen(settler.x, settler.y, view);
    const r = radii[settler.tierRank]!;
    const choices = choicesByTier[settler.tierRank] ?? [];
    const label = markLabel(settler, geo);
    if ((forced || stampVisible(settler.tierRank, scale)) && choices.length) {
      const w = stampPx(settler.tierRank, r, scale);
      const index = hashId(settler.id) % choices.length;
      const choice = choices[index]!;
      const aspect = choice.ink.h / choice.ink.w;
      const h = w * aspect;
      const rect: Rect = { x: s.x - w * choice.anchor.x + w * 0.12, y: s.y - h * choice.anchor.y + h * 0.18, w: w * 0.76, h: h * 0.76 };
      if (forced || grid.free(rect)) {
        claim(rect);
        const drawn = { x: s.x - w * choice.anchor.x, y: s.y - h * choice.anchor.y, w, h };
        const plate = placeName(settler, s.x, s.y, w, h * choice.anchor.y, forced);
        marks.push({
          id: settler.id, settler, box: drawn, label,
          stamp: { group: STAMP_GROUPS[settler.tierRank]!, index, ...drawn },
          mark: null,
          ...plate,
          ring: { x: s.x, y: s.y - h * choice.anchor.y * 0.45, r: Math.max(w, h) * 0.45 + 7 },
        });
        continue;
      }
    }
    if (settler.tierRank >= tiers && !forced) continue;
    const hit = 24;
    marks.push({
      id: settler.id, settler, label,
      box: { x: s.x - hit / 2, y: s.y - hit / 2, w: hit, h: hit },
      stamp: null,
      mark: { size: MARK_PX[settler.tierRank]! },
      shield: null,
      name: null,
      ring: { x: s.x, y: s.y, r: Math.max(5, r * scale) + 7 },
    });
  }
  if (!realmsPlaced) placeRealms(geo, camera, view, measure, take, texts);
  // Holdings in the margin are placed (so the screen's own give way to them as the map's do) but are not drawn here:
  // a button for one would sit off screen, reachable by Tab and a screen reader, and scroll the still to it.
  const onScreen = marks.filter((mark) => mark.box.x < view.width && mark.box.y < view.height && mark.box.x + mark.box.w > 0 && mark.box.y + mark.box.h > 0);
  return { marks: onScreen, texts, shields, names, tiers, claims };
}

type Take = (rect: Rect) => boolean;

function lettering(kind: StillText['kind'], text: string, font: Font, stroke: number, measure: Measure, lineHeight = font.size * LINE): Omit<StillText, 'x' | 'y' | 'alpha'> {
  const lines = text.split('\n');
  const w = Math.ceil(Math.max(...lines.map((line) => measure(line, font))) + stroke);
  const h = Math.ceil(lineHeight * (lines.length - 1) + font.size * LINE + stroke);
  return { kind, lines, font, stroke, w, h, lineHeight };
}

const outside = (rect: Rect, view: Viewport) => rect.x + rect.w < -40 || rect.x > view.width + 40 || rect.y + rect.h < -40 || rect.y > view.height + 40;

/** Language names across the land, biggest first: continents in spaced capitals, isles in italic (overlay placeRegions). */
function placeRegions(geo: Geography, camera: Camera, view: Viewport, measure: Measure, take: Take, out: StillText[]): void {
  const scale = camera.scale;
  const fade = regionLabelFade(scale);
  if (fade <= 0.02) return;
  const regions = geo.regions.filter((region) => region.kind !== 'outer').sort((a, b) => b.members - a.members || a.index - b.index);
  for (const region of regions) {
    const screenR = region.r * scale;
    const continent = region.kind === 'continent';
    if (screenR < (continent ? 26 : 16)) continue;
    const size = Math.round(Math.max(continent ? 15 : 11.5, Math.min(continent ? 34 : 17, screenR * (continent ? 0.16 : 0.2))));
    const label = lettering('region', region.name, { face: continent ? 'caps' : 'italic', size, spacing: continent ? size * 0.32 : size * 0.08 }, continent ? 4 : 3, measure);
    const subSize = Math.max(11, Math.round(size * 0.42));
    const sub = continent && region.englishName !== region.name ? lettering('subtitle', region.englishName, { face: 'italic', size: subSize, spacing: 1 }, 3, measure) : null;
    const c = camera.worldToScreen(region.x, region.y, view);
    const height = label.h + (sub ? sub.h - 4 : 0);
    const width = Math.max(label.w, sub?.w ?? 0);
    for (const dy of [0, -0.34, 0.34, -0.6, 0.6]) {
      const rect: Rect = { x: c.x - width / 2, y: c.y + dy * screenR - height / 2, w: width, h: height };
      if (outside(rect, view)) break;
      if (!take(rect)) continue;
      out.push({ ...label, x: c.x - label.w / 2, y: rect.y, alpha: 0.78 * fade });
      if (sub) out.push({ ...sub, x: c.x - sub.w / 2, y: rect.y + label.h - 4, alpha: 0.72 * fade });
      break;
    }
  }
  if (geo.isles) placeArchipelago(geo.isles, geo, camera, view, measure, take, fade, out);
  placeArchipelago(geo.outer, geo, camera, view, measure, take, fade, out);
}

function placeArchipelago(circle: { name: string; x: number; y: number; r: number }, geo: Geography, camera: Camera, view: Viewport, measure: Measure, take: Take, fade: number, out: StillText[]): void {
  const scale = camera.scale;
  if (circle.r * scale <= 30) return;
  const size = Math.round(Math.max(13, Math.min(24, circle.r * scale * 0.09)));
  const label = lettering('archipelago', circle.name, { face: 'italic', size, spacing: size * 0.18 }, 3.5, measure);
  const top = Math.max(circle.y - circle.r * 0.92, geo.bounds.minY + 40);
  const c = camera.worldToScreen(circle.x, top, view);
  const rect: Rect = { x: c.x - label.w / 2, y: c.y, w: label.w, h: label.h };
  if (take(rect)) out.push({ ...label, x: rect.x, y: rect.y, alpha: 0.8 * fade });
}

/** Realm names across a continent once it is big enough to carry them (overlay placeRealms). */
function placeRealms(geo: Geography, camera: Camera, view: Viewport, measure: Measure, take: Take, out: StillText[]): void {
  const scale = camera.scale;
  const fade = realmLabelFade(scale);
  if (fade <= 0.02) return;
  const box = camera.visibleBox(view, 40);
  for (const realm of labelledRealms(geo.realms)) {
    const screenR = realm.r * scale;
    if (screenR < 30 || realm.x + realm.r < box.minX || realm.x - realm.r > box.maxX || realm.y + realm.r < box.minY || realm.y - realm.r > box.maxY) continue;
    const size = realmLabelPx(screenR);
    const font: Font = { face: 'italic', size, spacing: size * 0.12 };
    let label = lettering('realm', realm.name, font, 3.2, measure, size * 1.08);
    if (label.w > screenR * 1.9 && realm.name.includes(' ')) label = lettering('realm', realmLines(realm.name), font, 3.2, measure, size * 1.08);
    if (label.w > screenR * 2.4) continue;
    const c = camera.worldToScreen(realm.x, realm.y, view);
    for (const dy of [0, 0.42, -0.42, 0.7, -0.7]) {
      const rect: Rect = { x: c.x - label.w / 2, y: c.y + dy * screenR - label.h / 2, w: label.w, h: label.h };
      if (!take(rect)) continue;
      out.push({ ...label, x: rect.x, y: rect.y, alpha: 0.86 * fade });
      break;
    }
  }
}

// ── The vermilion wash ───────────────────────────────────────────────────────────────────────────

/** What the still reads of the live layer; `LivePaint` is one. */
export interface LiveSource {
  readonly frame: { asOf: number } | null;
  liveClass(settler: Settler): number;
  startedAt(settler: Settler): number | null;
  bloom(startedAt: number | null, at?: number): number;
  readonly dabs: readonly { x: number; y: number; hash: string; startedAt: number; placed: boolean }[];
  dryingWashes(at?: number): Iterable<{ ordinal: number; liveClass: number; x: number; y: number; left: number }>;
  dryingDabWashes(at?: number): Iterable<{ dab: { x: number; y: number; hash: string; placed: boolean }; left: number }>;
}

/** One deposit of pigment in screen CSS px: a rimless density stain (variant −1) or a seeded watercolour blot. */
export interface Stain { x: number; y: number; size: number; alpha: number; variant: number; rotation: number }

/**
 * The washes the moving map lays at this camera (map/wash.ts paint): from afar a soft density stain per live holding,
 * graded by class, closer a seeded bloom; biggest classes first so a cap only drops the smallest. The layer is then
 * multiplied into the paper at `opacity`, which holds a crowded continent to rich pigment rather than a red plate.
 */
export function washStains(store: SettlerStore, live: LiveSource, camera: Camera, view: Viewport, now: number): { stains: Stain[]; opacity: number } {
  const scale = camera.scale;
  const soften = washSoftening(scale);
  const detail = washDetail(scale);
  const close = scale >= DISTANCE_SCALE.realm * 0.6;
  const limit = close ? (phoneLayout(view) ? CLOSE_WASH_LIMIT.phone : CLOSE_WASH_LIMIT.laptop) : Infinity;
  const box = camera.visibleBox(view, 140 / scale);
  const inBox = (x: number, y: number) => x >= box.minX && x <= box.maxX && y >= box.minY && y <= box.maxY;
  const stains: Stain[] = [];
  const lay = (wx: number, wy: number, liveClass: number, strength: number, variant: number) => {
    const s = camera.worldToScreen(wx, wy, view);
    if (detail < 1) {
      const radius = washPx(liveClass, scale) * 1.2;
      const closer = 1 + 0.5 * ramp(scale, DISTANCE_SCALE.continent * 0.35, DISTANCE_SCALE.continent);
      stains.push({ x: s.x, y: s.y, size: radius * 2, alpha: Math.min(1, DENSITY_ALPHA[liveClass as 1]! * closer) * strength * (1 - detail), variant: -1, rotation: 0 });
    }
    if (detail > 0) {
      const radius = washPx(liveClass, scale) * (0.55 + 0.45 * strength);
      stains.push({ x: s.x, y: s.y, size: (radius * 2) / 0.86 * 1.12, alpha: WASH_ALPHA[liveClass as 1]! * soften * strength * detail, variant, rotation: (variant * 1.7) % (Math.PI * 2) });
    }
  };
  if (live.frame) {
    const holdings = store.query(box.minX, box.minY, box.maxX, box.maxY, 3)
      .map((settler) => ({ settler, liveClass: live.liveClass(settler) }))
      .filter((item) => item.liveClass > 0)
      .sort((a, b) => a.liveClass - b.liveClass || a.settler.ordinal - b.settler.ordinal);
    for (const { settler, liveClass } of holdings) {
      if (stains.length >= limit) break;
      const bloom = live.bloom(live.startedAt(settler), now);
      if (bloom > 0.01) lay(settler.x, settler.y, liveClass, bloom, settler.ordinal);
    }
    for (const dab of live.dabs) {
      if (stains.length >= limit) break;
      if (!dab.placed || !inBox(dab.x, dab.y)) continue;
      const bloom = live.bloom(dab.startedAt, now);
      if (bloom > 0.01) lay(dab.x, dab.y, 5, bloom, parseInt(dab.hash.slice(0, 4), 16));
    }
  }
  for (const dry of live.dryingWashes(now)) if (inBox(dry.x, dry.y)) lay(dry.x, dry.y, dry.liveClass, dry.left, dry.ordinal);
  for (const { dab, left } of live.dryingDabWashes(now)) if (dab.placed && inBox(dab.x, dab.y)) lay(dab.x, dab.y, 5, left, parseInt(dab.hash.slice(0, 4), 16));
  return { stains, opacity: DENSITY_CAP + (1 - DENSITY_CAP) * detail };
}

// ── The ribbon ───────────────────────────────────────────────────────────────────────────────────

/** What the still says about itself: what it is, when it was observed and drawn, and why it is not moving. */
export function stillRibbon(input: { asOf: number; drawnAt: number; liveAsOf: number | null; now: number; landMissing: boolean }): { title: string; facts: string[]; live: string | null; why: string } {
  return {
    title: 'A still of the survey',
    facts: [`observed to ${formatMoment(input.asOf)}`, `drawn ${formatTime(input.drawnAt, input.now)}`],
    live: input.liveAsOf === null ? null : `Live as of ${formatTime(input.liveAsOf, input.now)}`,
    why: input.landMissing
      ? 'This browser cannot draw the moving map (WebGL is off), and some of the land could not be inked here; it is left as bare paper.'
      : 'This browser cannot draw the moving map (WebGL is off). Every holding drawn here opens its card.',
  };
}
