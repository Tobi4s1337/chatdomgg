/**
 * Placement that holds still while the map moves (Spec 01 R7, R9). Every update the overlay re-runs greedy collision
 * in stable priority order; on its own that lets a name flip from one side of its stamp to another, or blink out and
 * back, whenever a neighbour's box shifts by a pixel. The `Placer` remembers, per key, which candidate an item used
 * last and when it appeared:
 *
 * - **Sticky side.** An item tries the candidate it used last time first, then its ordinary order. The idea is the
 *   one Mapbox GL uses for variable label anchors (previous anchor first); priority still decides every contest,
 *   because items are offered strongest first and a weaker item's remembered spot is only free if no stronger item
 *   took it this frame.
 * - **Forced.** The selected and hovered holdings are offered first and always placed: on a free candidate if there
 *   is one (remembered side first), otherwise on the remembered or first candidate regardless.
 * - **Fade-in.** An item that was not placed in the previous update fades in over `FADE_MS`; one that stays placed
 *   keeps its alpha. Reduced motion (or the very first view) shows it at once. Nothing fades out: a dropped item is
 *   gone in the frame it loses its place, so the paper never shows two labels in one spot.
 *
 * Pure: no Pixi, no DOM, no clock. The caller passes `now` and the motion preference.
 */
import { blockPieces, CollisionGrid, comparePriority, SHIELD_GAP, type Rect } from './collide';

/** How long a newly placed name, shield, stamp or region name takes to fade in. */
export const FADE_MS = 140;
/** Shields in view at once, Spec 01 R7. */
export const SHIELD_LIMIT = 300;
/** Memory is dropped for a key not offered in this many updates (about two seconds of continuous motion)… */
export const FORGET_AFTER = 120;
/** …and the oldest entries go first whenever the memory holds more than this many keys. */
export const MEMORY_LIMIT = 8_192;

/** Ease-out alpha of an item placed since `since`; 1 at once under reduced motion. */
export function fadeIn(now: number, since: number, reduceMotion: boolean): number {
  if (reduceMotion) return 1;
  const t = Math.min(1, Math.max(0, (now - since) / FADE_MS));
  return 1 - (1 - t) * (1 - t);
}

/** A rect expanded by `margin` on every side lies at least partly within a `width` × `height` screen. */
export function onScreen(rect: Rect, width: number, height: number, margin = 0): boolean {
  return rect.x + rect.w > -margin && rect.x < width + margin && rect.y + rect.h > -margin && rect.y < height + margin;
}

/** One item's outcome: the candidate used, its rect, and the alpha to draw it with this frame. */
export interface Placed { index: number; rect: Rect; alpha: number; fresh: boolean }

interface Memory {
  /** Candidate index used the last time the item was placed. */
  side: number;
  /** Update serial of the last placement, and of the last time the item was offered at all. */
  placedAt: number;
  seenAt: number;
  /** Time at which the current unbroken run of placements began (drives the fade-in). */
  since: number;
}

export class Placer {
  private readonly memory = new Map<string, Memory>();
  private serial = 0;
  private now = 0;
  private instant = false;
  /** True when any item placed in the current update is still fading in. */
  fading = false;

  constructor(private readonly forgetAfter = FORGET_AFTER, private readonly limit = MEMORY_LIMIT) {}

  /** Starts an update. `instant` shows new items at full alpha (reduced motion, or the map's first view). */
  begin(now: number, instant: boolean): void {
    this.serial++;
    this.now = now;
    this.instant = instant;
    this.fading = false;
  }

  /**
   * Chooses and claims one of `candidates` for `key`: the remembered candidate if it is free, else the first free one
   * in order. A forced item is placed even when none is free. Returns null when the item stays off the paper.
   */
  choose(grid: CollisionGrid, key: string, candidates: readonly Rect[], forced = false): Placed | null {
    let entry = this.memory.get(key);
    if (entry) entry.seenAt = this.serial;
    if (!candidates.length) return null;
    const sticky = entry && entry.side < candidates.length ? entry.side : -1;
    let index = sticky >= 0 && grid.free(candidates[sticky]!) ? sticky : -1;
    for (let i = 0; index < 0 && i < candidates.length; i++) if (i !== sticky && grid.free(candidates[i]!)) index = i;
    if (index < 0 && forced) index = Math.max(0, sticky);
    if (index < 0) return null;
    const rect = candidates[index]!;
    grid.claim(rect);
    const held = !!entry && entry.placedAt >= this.serial - 1;
    if (!entry) {
      entry = { side: index, placedAt: this.serial, seenAt: this.serial, since: this.now };
      this.memory.set(key, entry);
    }
    if (!held) entry.since = this.instant ? -Infinity : this.now;
    entry.side = index;
    entry.placedAt = this.serial;
    const alpha = this.instant ? 1 : fadeIn(this.now, entry.since, false);
    if (alpha < 1) this.fading = true;
    return { index, rect, alpha, fresh: !held };
  }

  /** The candidate index `key` used when last placed, if it is still remembered. */
  side(key: string): number | undefined {
    return this.memory.get(key)?.side;
  }

  get size(): number {
    return this.memory.size;
  }

  /** Ends an update: forgets keys not offered for a while and keeps the memory under its limit. */
  end(): void {
    if (this.serial % 32 !== 0 && this.memory.size <= this.limit) return;
    const cutoff = this.serial - this.forgetAfter;
    for (const [key, entry] of this.memory) if (entry.seenAt < cutoff) this.memory.delete(key);
    if (this.memory.size <= this.limit) return;
    const oldest = [...this.memory].sort((a, b) => a[1].seenAt - b[1].seenAt);
    for (const [key] of oldest.slice(0, this.memory.size - this.limit)) this.memory.delete(key);
  }
}

/** An item to place in one batch: its stable priority (Spec 01 R7), whether it is forced, and its candidates. */
export interface PlacementItem {
  key: string;
  tierRank: number;
  average: number;
  id: string;
  forced?: boolean;
  candidates: readonly Rect[];
}

/** Forced items first, then tier, observed average and channel ID, then the key: a total order. */
export function comparePlacement(a: PlacementItem, b: PlacementItem): number {
  return (a.forced ? 0 : 1) - (b.forced ? 0 : 1) || comparePriority(a, b) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
}

/**
 * Places a batch greedily in priority order, whatever order it arrives in. The overlay interleaves its layers by hand
 * (stamps, then each stamp's name, realm names after the capitals) with `Placer.choose`; this is the same rule for one
 * layer at a time.
 */
export function plan(items: readonly PlacementItem[], grid: CollisionGrid, placer: Placer): Map<string, Placed> {
  const out = new Map<string, Placed>();
  for (const item of [...items].sort(comparePlacement)) {
    const placed = placer.choose(grid, item.key, item.candidates, item.forced);
    if (placed) out.set(item.key, placed);
  }
  return out;
}

/** The screen box of a holding's stamp (or mark): `x`, `y` its foot point, `w` its width, `h` its height above the foot. */
export interface Anchor { x: number; y: number; w: number; h: number }
/** A name (or a shield) as measured, in CSS px. */
export interface Size { w: number; h: number }

/** Where a holding's name block goes and where its pieces are drawn inside it. */
export interface HoldingLabel extends Placed {
  /** Top-left of the name text, rounded to whole px; null when the holding shows its shield alone. */
  label: { x: number; y: number } | null;
  /** Top-left of the shield's drawn box (its padding included), rounded; null past the shield limit. */
  shield: { x: number; y: number } | null;
  /** Foot of the standard raised on the shield's top edge. */
  standard: { x: number; y: number } | null;
}

/** Padding drawn around a shield texture (its halo). */
export const SHIELD_PAD = 3;

/**
 * Names and shields beside holdings. Each holding's block (shield, a small gap, the name; mirrored on the left, see
 * `blockPieces`) tries below its stamp, then right, then left, then above, the remembered side first. The first `limit` blocks placed carry a shield;
 * after that a holding shows its name alone, and a holding with no name and no shield left shows nothing.
 */
export class HoldingLabels {
  shields = 0;
  placed = 0;

  constructor(private readonly placer: Placer, private readonly limit = SHIELD_LIMIT) {}

  begin(): void {
    this.shields = 0;
    this.placed = 0;
  }

  /** The four candidate blocks around an anchor, in ordinary order: below, right, left, above. */
  static candidates(anchor: Anchor, w: number, h: number): Rect[] {
    const mid = anchor.y - anchor.h / 2;
    return [
      { x: anchor.x - w / 2, y: anchor.y + 2, w, h },
      { x: anchor.x + anchor.w * 0.42, y: mid - h / 2, w, h },
      { x: anchor.x - anchor.w * 0.42 - w, y: mid - h / 2, w, h },
      { x: anchor.x - w / 2, y: anchor.y - anchor.h - h - 1, w, h },
    ];
  }

  place(grid: CollisionGrid, key: string, anchor: Anchor, label: Size | null, shield: Size, forced = false): HoldingLabel | null {
    const withShield = this.shields < this.limit;
    if (!label && !withShield) return null;
    const gap = withShield ? shield.w + (label ? SHIELD_GAP : 0) : 0;
    const w = (label?.w ?? 0) + gap;
    const h = Math.max(label?.h ?? 0, withShield ? shield.h : 0);
    const placed = this.placer.choose(grid, key, HoldingLabels.candidates(anchor, w, h), forced);
    if (!placed) return null;
    this.placed++;
    const { rect } = placed;
    const { nameX, shieldX } = blockPieces(rect, placed.index, !!label, withShield ? shield.w : null);
    let shieldAt: HoldingLabel['shield'] = null;
    let standard: HoldingLabel['standard'] = null;
    if (shieldX !== null) {
      this.shields++;
      const top = Math.round(rect.y + (rect.h - shield.h) / 2 - SHIELD_PAD);
      shieldAt = { x: Math.round(shieldX - SHIELD_PAD), y: top };
      standard = { x: shieldX + shield.w / 2, y: top + SHIELD_PAD + 0.5 };
    }
    return {
      ...placed,
      label: label ? { x: Math.round(nameX), y: Math.round(rect.y + (rect.h - label.h) / 2) } : null,
      shield: shieldAt,
      standard,
    };
  }
}
