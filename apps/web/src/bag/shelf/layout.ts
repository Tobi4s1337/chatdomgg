import { SHELF_BAY_SLOTS, SHELF_SLOTS, type ItemRecord, type ShelfPiece } from '@chatdom/shared';
import { SHELF_MAX_BAYS, shelfBaysFor, shelfPlaceOf } from '../../../../../packages/content/src/keepsakes/shelf';

/*
 * The shelf's pure arithmetic: which records stand where, which bays are drawn, how the camera frames a page of the
 * shelf inside the room the controls leave, and how focus walks between places. No DOM and no WebGL here.
 */

/** A thing that belongs on the shelf: a keepsake, or anything kept and numbered. */
export const isKeepsake = (item: Pick<ItemRecord, 'branch' | 'number'>): boolean => item.branch === 'kept' || item.number !== null;

/** Keepsakes waiting in your bag, newest first, so the one you just earned is the first in the drawer. */
export function drawerItems(items: readonly ItemRecord[]): ItemRecord[] {
  return items.filter(item => item.place === 'bag' && isKeepsake(item))
    .sort((a, b) => b.createdAt - a.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export interface Placement { readonly id: string; readonly defId: string; readonly slot: number; readonly number: number | null }

const validSlot = (slot: number | null | undefined): slot is number => Number.isInteger(slot) && slot! >= 0 && slot! < SHELF_SLOTS;

/** What stands on the shelf, one thing per place; a second claim on a place (never expected) is left in the bag view. */
export function shelfPlacements(items: readonly (Pick<ItemRecord, 'id' | 'defId' | 'place' | 'slot' | 'number' | 'revision'> | ShelfPiece)[]): Placement[] {
  const taken = new Map<number, Placement>();
  for (const item of items) {
    if ('place' in item && item.place !== 'shelf') continue;
    if (!validSlot(item.slot) || taken.has(item.slot)) continue;
    taken.set(item.slot, { id: item.id, defId: item.defId, slot: item.slot, number: Number.isInteger(item.number) && item.number! > 0 ? item.number : null });
  }
  return [...taken.values()].sort((a, b) => a.slot - b.slot);
}

/** Bays to draw: room for every keepsake you have (shelved and waiting), and never fewer than the highest place used. */
export function baysFor(placed: readonly number[], waiting = 0): number {
  const highest = placed.reduce((most, slot) => Math.max(most, Math.floor(slot / SHELF_BAY_SLOTS) + 1), 1);
  return Math.min(SHELF_MAX_BAYS, Math.max(highest, shelfBaysFor(placed.length + Math.max(0, waiting))));
}

/** One view of the shelf: a run of whole bays on a wide screen, half a bay on a phone. */
export interface ShelfPage { readonly first: number; readonly last: number; readonly part: 'whole' | 'left' | 'right' }

export function shelfPages(bays: number, compact: boolean): ShelfPage[] {
  const pages: ShelfPage[] = [];
  if (compact) for (let b = 0; b < bays; b++) pages.push({ first: b, last: b, part: 'left' }, { first: b, last: b, part: 'right' });
  else for (let b = 0; b < bays; b += 2) pages.push({ first: b, last: Math.min(bays - 1, b + 1), part: 'whole' });
  return pages;
}

/** The page a place is seen on. */
export function pageOfSlot(pages: readonly ShelfPage[], slot: number): number {
  const { bay, column } = shelfPlaceOf(slot);
  const index = pages.findIndex(page => bay >= page.first && bay <= page.last
    && (page.part === 'whole' || (page.part === 'left') === (column < 2)));
  return Math.max(0, index);
}

/** The span of a page across the shelf, in shelf cells: whole bays, or half a bay with a little of its neighbour. */
export function pageSpan(page: ShelfPage, bayX: readonly (readonly [number, number])[]): [number, number] {
  const [x0] = bayX[page.first]!, [, x1] = bayX[page.last]!;
  if (page.part === 'whole') return [x0, x1];
  const centre = (x0 + x1) / 2, overlap = 8;
  return page.part === 'left' ? [x0, centre + overlap] : [centre - overlap, x1];
}

export interface Insets { readonly top: number; readonly right: number; readonly bottom: number; readonly left: number }
export interface FrameInput {
  /** The canvas, in CSS pixels. */
  readonly width: number;
  readonly height: number;
  /** Room the controls take at each edge; the page is framed in what is left. */
  readonly insets: Insets;
  /** What must be seen: the page's front face, in metres. */
  readonly min: readonly [number, number, number];
  readonly max: readonly [number, number, number];
  /** Vertical field of view across the framed room, in degrees. */
  readonly fov: number;
  /** How far above level the camera looks down, in radians. */
  readonly elevation: number;
  /** Breathing room around the page, as a share of its size. */
  readonly margin: number;
}
export interface Frame {
  readonly position: [number, number, number];
  readonly target: [number, number, number];
  /** For `PerspectiveCamera.fov` with `setViewOffset(full[0], full[1], offset[0], offset[1], width, height)`. */
  readonly fov: number;
  readonly full: [number, number];
  readonly offset: [number, number];
  /** Pixels per metre at the page's face. */
  readonly scale: number;
}

/**
 * Frames a page in the room the controls leave: the page's face fits the free rectangle with its margin, and the
 * page's centre sits at that rectangle's centre through a view offset, so the shelf never hides under the drawer.
 */
export function frameView(input: FrameInput): Frame {
  const width = Math.max(1, input.width), height = Math.max(1, input.height);
  const left = Math.min(width * .4, Math.max(0, input.insets.left)), right = Math.min(width * .4, Math.max(0, input.insets.right));
  const top = Math.min(height * .45, Math.max(0, input.insets.top)), bottom = Math.min(height * .45, Math.max(0, input.insets.bottom));
  const sw = Math.max(1, width - left - right), sh = Math.max(1, height - top - bottom);
  const focal = (sh / 2) / Math.tan((input.fov * Math.PI / 180) / 2);
  const bw = Math.max(.01, input.max[0] - input.min[0]) * (1 + 2 * input.margin);
  const bh = Math.max(.01, input.max[1] - input.min[1]) * (1 + 2 * input.margin);
  const distance = Math.max(bw * focal / sw, bh * focal / sh);
  const target: [number, number, number] = [(input.min[0] + input.max[0]) / 2, (input.min[1] + input.max[1]) / 2, input.max[2]];
  const position: [number, number, number] = [target[0], target[1] + Math.sin(input.elevation) * distance, target[2] + Math.cos(input.elevation) * distance];
  const cx = left + sw / 2, cy = top + sh / 2;
  const ox = cx - width / 2, oy = cy - height / 2;
  const full: [number, number] = [width + 2 * Math.abs(ox), height + 2 * Math.abs(oy)];
  const offset: [number, number] = [full[0] / 2 - cx, full[1] / 2 - cy];
  const fov = 2 * Math.atan((full[1] / 2) / focal) * 180 / Math.PI;
  return { position, target, fov, full, offset, scale: focal / distance };
}

export type Direction = 'left' | 'right' | 'up' | 'down';
/** A place's centre in shelf cells: x to the right, y upward (the bottom shelf is lowest). */
export interface PlacePoint { readonly slot: number; readonly x: number; readonly y: number }

/** The nearest place in a direction, by the shelf's own layout: across first, a row change costs twice as much. */
export function neighbourSlot(points: readonly PlacePoint[], from: number, direction: Direction): number | null {
  const here = points.find(point => point.slot === from);
  if (!here) return points[0]?.slot ?? null;
  let best: PlacePoint | null = null, bestScore = Infinity;
  for (const point of points) {
    if (point.slot === from) continue;
    const dx = point.x - here.x, dy = point.y - here.y;
    const along = direction === 'right' ? dx : direction === 'left' ? -dx : direction === 'up' ? dy : -dy;
    const across = direction === 'left' || direction === 'right' ? Math.abs(dy) : Math.abs(dx);
    if (along <= 1e-6) continue;
    const score = along + 2 * across;
    if (score < bestScore) { bestScore = score; best = point; }
  }
  return best?.slot ?? null;
}

/** The place under a point, from the places' screen rectangles; the nearest centre wins where two overlap. */
export function slotAtPoint(rects: readonly { readonly slot: number; readonly x: number; readonly y: number; readonly w: number; readonly h: number }[], x: number, y: number): number | null {
  let best: number | null = null, bestDistance = Infinity;
  for (const rect of rects) {
    if (x < rect.x || y < rect.y || x > rect.x + rect.w || y > rect.y + rect.h) continue;
    const distance = Math.hypot(x - (rect.x + rect.w / 2), y - (rect.y + rect.h / 2));
    if (distance < bestDistance) { bestDistance = distance; best = rect.slot; }
  }
  return best;
}

const TIERS = ['Bottom shelf', 'Middle shelf', 'Top shelf'] as const;
const COLUMNS = ['far left', 'left of centre', 'right of centre', 'far right'] as const;

/** "Middle shelf, left of centre"; on a long shelf, "Second section, middle shelf, left of centre". */
export function placeWords(slot: number, bays: number): string {
  const { bay, tier, column } = shelfPlaceOf(slot);
  const where = `${TIERS[tier]}, ${COLUMNS[column]}`;
  if (bays <= 1) return where;
  const ordinal = ['First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth'][bay] ?? `Section ${bay + 1}`;
  return `${ordinal} section, ${where.charAt(0).toLowerCase()}${where.slice(1)}`;
}

/** "1 keepsake", "12 keepsakes"; empty for none. */
export function keepsakeCount(count: number): string {
  if (!Number.isInteger(count) || count < 1) return '';
  return `${count} ${count === 1 ? 'keepsake' : 'keepsakes'}`;
}

/** A visitor's title: "Juniper's shelf", or "A neighbour's shelf" when the name is hidden. */
export function visitTitle(name: string | null): string {
  const clean = name?.trim();
  if (!clean) return 'A neighbour’s shelf';
  return `${clean}’s shelf`;
}

/** A tiny steady turn per keepsake, so a row looks set out by hand, never stamped: about two degrees either way. */
export function handTurn(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return (((h >>> 0) / 4294967296) - .5) * .07;
}
