import type { Box, Viewport } from './camera';
import { childrenOf, levelFor, parentOf, TILE_PX, tileKey, tilesFor, type Pyramid, type TileKey } from './pyramid';

/**
 * What the land layer draws each frame, decided without Pixi so it can be tested. The rules (Spec 01 R10):
 * - the level that matches the screen is drawn in front; a tile fades in over FADE_MS from the frame it is first
 *   shown, and whatever it replaces stays beneath it until it is fully opaque;
 * - beneath a missing, failed or fading tile go the ready tiles that cover it: its ancestors up to the nearest
 *   opaque one, and (when zooming out) its ready descendants up to DESCENT levels down, coarse under fine;
 * - the root tile is always wanted first and always kept, so no part of the pyramid is ever without a stand-in;
 * - where the nearest opaque stand-in sits more than BRIDGE levels up, the tile's ancestor BRIDGE levels up is
 *   wanted right after the root, so a deep view sharpens through one soft step instead of a magnified smear;
 * - the tiles of the opening view and their ancestors are kept once baked (and baked last when missing), so the
 *   way home, and every deep view's coarsest stand-in, is the home drawing itself rather than a magnified root;
 * - visible tiles are wanted nearest the centre first, then a flight's destination, only as far as the texture
 *   budget leaves room beside what this frame draws (otherwise the prefetch would evict itself and bake again).
 */
export const FADE_MS = 240;
/** How many levels down cached tiles may stand in for a missing one. Four or sixteen textures per tile at most. */
export const DESCENT = 2;
/** The most levels a stand-in may sit above the tile it covers before its nearer ancestor is baked first. */
export const BRIDGE = 2;
/** Tiles just off-screen are planned too, so a short pan reveals ink rather than the fallback. */
export const MARGIN_PX = 8;

const MiB = 1024 * 1024;
/** Texture memory for land tiles. A phone also holds the wash and the overlay, a laptop has more to spare. */
export const TILE_BUDGET_BYTES = { phone: 48 * MiB, laptop: 112 * MiB } as const;
/** RGBA bytes of one tile baked at a device pixel ratio. */
export const tileBytes = (pixelRatio: number) => Math.round(TILE_PX * pixelRatio) ** 2 * 4;

export interface CameraState { x: number; y: number; scale: number }
/** A baked tile. `unseen` marks one that has never been drawn: as the front tile it fades in from that frame. */
export interface ReadyTile { bornAt: number; unseen?: boolean }
export interface TileLookup { get(id: string): ReadyTile | undefined }
export interface KeySet { has(id: string): boolean }

export interface PlanInput {
  pyramid: Pyramid;
  camera: CameraState;
  view: Viewport;
  now: number;
  ready: TileLookup;
  /** Tiles that will not bake: never wanted, their stand-ins stay. */
  failed?: KeySet;
  /** Tiles already being baked. */
  pending?: KeySet;
  /** The destination of a flight in progress; its tiles are wanted after the visible ones. */
  prefetch?: CameraState | null;
  /** Tiles the texture cache holds; the prefetch never asks for more than fit beside this frame's tiles. */
  capacity?: number;
  /** The opening view's tiles and their ancestors (`homeTiles`): kept once ready, wanted after everything else. */
  home?: readonly TileKey[];
}

export interface DrawnTile { key: TileKey; id: string; alpha: number }

export interface TilePlan {
  level: number;
  visible: TileKey[];
  /** Stand-ins, coarse → fine, each at its own fade. */
  back: DrawnTile[];
  /** The current level, drawn above the stand-ins. */
  front: DrawnTile[];
  /** Front tiles shown for the first time this frame: their fade starts now. */
  reveal: string[];
  /** Bake requests in priority order, deduplicated. */
  wanted: TileKey[];
  /** Tiles this frame needs; the cache must not evict them. */
  keep: string[];
  /** Ready destination tiles worth keeping recent, but not pinned. */
  warm: string[];
  /** Every visible tile is baked (or has failed) and fully faded in. */
  complete: boolean;
  /** Visible tiles whose area is not fully covered by something opaque: paper shows through. */
  uncovered: number;
  /** Drawn tiles still fading in. */
  fading: number;
}

export const ROOT: TileKey = { level: 0, tx: 0, ty: 0 };

/** The tiles the opening view draws and all their ancestors, coarse first: a handful, at most a screen's worth. */
export function homeTiles(pyramid: Pyramid, home: CameraState, view: Viewport): TileKey[] {
  const out = new Map<string, TileKey>();
  const level = levelFor(pyramid, home.scale, 1);
  for (const key of tilesFor(pyramid, level, visibleBox(home, view, MARGIN_PX))) {
    for (let up: TileKey | null = key; up; up = parentOf(up)) out.set(tileKey(up), up);
  }
  return [...out.values()].sort((a, b) => a.level - b.level);
}

export function visibleBox(camera: CameraState, view: Viewport, marginPx = 0): Box {
  const halfW = (view.width / 2 + marginPx) / camera.scale;
  const halfH = (view.height / 2 + marginPx) / camera.scale;
  return { minX: camera.x - halfW, minY: camera.y - halfH, maxX: camera.x + halfW, maxY: camera.y + halfH };
}

const fade = (tile: ReadyTile, now: number) => Math.max(0, Math.min(1, (now - tile.bornAt) / FADE_MS));

export function planTiles(input: PlanInput): TilePlan {
  const { pyramid, camera, view, now, ready, failed, pending, prefetch, capacity, home } = input;
  const level = levelFor(pyramid, camera.scale, 1);
  const visible = tilesFor(pyramid, level, visibleBox(camera, view, MARGIN_PX));
  const front: DrawnTile[] = [];
  const back = new Map<string, DrawnTile>();
  const reveal: string[] = [];
  const wanted: TileKey[] = [];
  const asked = new Set<string>();
  const bridges: TileKey[] = [];
  const bridged = new Set<string>();
  let complete = true;
  let uncovered = 0;

  const want = (key: TileKey, id: string) => {
    if (asked.has(id) || ready.get(id) || failed?.has(id) || pending?.has(id)) return;
    asked.add(id);
    wanted.push(key);
  };
  /** Draws a stand-in at its own fade; true when it is opaque. */
  const standIn = (key: TileKey): boolean | null => {
    const id = tileKey(key);
    const tile = ready.get(id);
    if (!tile) return null;
    const alpha = fade(tile, now);
    if (!back.has(id)) back.set(id, { key, id, alpha });
    return alpha >= 1;
  };
  /** Ready descendants that fill the tile, up to `depth` levels down; true when nothing of it is left bare. */
  const descendants = (key: TileKey, depth: number): boolean => {
    let full = true;
    for (const child of childrenOf(key)) {
      if (standIn(child)) continue;
      if (!(depth > 1 && descendants(child, depth - 1))) full = false;
    }
    return full;
  };

  if (level > 0) want(ROOT, tileKey(ROOT));
  for (const key of visible) {
    const id = tileKey(key);
    const tile = ready.get(id);
    let covered = false;
    if (tile) {
      const alpha = tile.unseen ? 0 : fade(tile, now);
      if (tile.unseen) reveal.push(id);
      front.push({ key, id, alpha });
      covered = alpha >= 1;
    } else if (!failed?.has(id)) want(key, id);
    if (covered) continue;
    if (!failed?.has(id)) complete = false;
    let held = false;
    let holder = -1;
    for (let parent = parentOf(key); parent && !held; parent = parentOf(parent)) {
      held = standIn(parent) === true;
      if (held) holder = parent.level;
    }
    // Children are drawn even beneath an opaque ancestor: on the way out they are sharper than it.
    const below = descendants(key, DESCENT);
    if (below) held = true;
    if (!held) uncovered++;
    // A stand-in many levels up shows its decor magnified into a smear: bake the ancestor BRIDGE levels up first
    // (one tile covers 4^BRIDGE of these), so the coarse view between levels is never more than that soft.
    if (!below && !failed?.has(id) && key.level - Math.max(0, holder) > BRIDGE) {
      let bridge: TileKey = key;
      for (let i = 0; i < BRIDGE; i++) bridge = parentOf(bridge)!;
      const bridgeId = tileKey(bridge);
      if (!ready.get(bridgeId) && !failed?.has(bridgeId) && !pending?.has(bridgeId) && !bridged.has(bridgeId)) {
        bridged.add(bridgeId);
        bridges.push(bridge);
      }
    }
  }
  // Bridges go right after the root, nearest the centre first (visible tiles were already in that order).
  if (bridges.length) {
    const at = wanted.length && tileKey(wanted[0]!) === tileKey(ROOT) ? 1 : 0;
    for (const bridge of bridges) asked.add(tileKey(bridge));
    wanted.splice(at, 0, ...bridges);
  }

  const backs = [...back.values()].sort((a, b) => a.key.level - b.key.level);
  const keep = new Set<string>([...backs.map((tile) => tile.id), ...front.map((tile) => tile.id)]);
  if (ready.get(tileKey(ROOT))) keep.add(tileKey(ROOT));
  for (const key of home ?? []) if (ready.get(tileKey(key))) keep.add(tileKey(key));

  const warm: string[] = [];
  if (prefetch) {
    let room = (capacity ?? Infinity) - keep.size;
    const destination = tilesFor(pyramid, levelFor(pyramid, prefetch.scale, 1), visibleBox(prefetch, view, MARGIN_PX));
    for (const key of destination) {
      const id = tileKey(key);
      if (keep.has(id) || asked.has(id) || failed?.has(id)) continue;
      if (room-- <= 0) break;
      if (ready.get(id)) warm.push(id);
      else want(key, id);
    }
  }

  for (const key of home ?? []) want(key, tileKey(key));

  const fading = backs.filter((tile) => tile.alpha < 1).length + front.filter((tile) => tile.alpha < 1).length;
  // A stand-in still fading in (under a failed tile, say) needs its frames even when every visible tile is settled.
  if (fading) complete = false;
  return { level, visible, back: backs, front, reveal, wanted, keep: [...keep], warm, complete, uncovered, fading };
}

/**
 * A byte-bounded LRU of tile payloads. Tiles drawn this frame are pinned and never evicted, even over budget (the
 * frame needs them); a tile that has just arrived is safe until the next frame says whether it is drawn, so a
 * tight budget cannot evict a tile on arrival and ask for it again. Least recently used goes first.
 */
export class TileCache<T> {
  private readonly entries = new Map<string, T>();
  private pinned: ReadonlySet<string> = new Set();
  private readonly fresh = new Set<string>();
  /** Tiles that fit in the budget. */
  readonly capacity: number;

  constructor(readonly budgetBytes: number, readonly tileBytes: number, private readonly release: (value: T, id: string) => void) {
    this.capacity = Math.floor(budgetBytes / tileBytes);
  }

  get count(): number {
    return this.entries.size;
  }

  get bytes(): number {
    return this.entries.size * this.tileBytes;
  }

  /** Looks a tile up without making it recent. */
  get(id: string): T | undefined {
    return this.entries.get(id);
  }

  /** Stores a tile as the most recent; a tile it replaces is released. */
  put(id: string, value: T): void {
    const old = this.entries.get(id);
    this.entries.delete(id);
    if (old !== undefined && old !== value) this.release(old, id);
    this.entries.set(id, value);
    this.fresh.add(id);
    this.trim();
  }

  /** One frame's use: `warm` becomes recent, `keep` becomes most recent and is pinned until the next call. */
  use(keep: Iterable<string>, warm: Iterable<string> = []): void {
    for (const id of warm) this.touch(id);
    const pinned = new Set<string>();
    for (const id of keep) if (this.touch(id)) pinned.add(id);
    this.pinned = pinned;
    this.fresh.clear();
    this.trim();
  }

  private touch(id: string): boolean {
    const value = this.entries.get(id);
    if (value === undefined) return false;
    this.entries.delete(id);
    this.entries.set(id, value);
    return true;
  }

  private trim(): void {
    if (this.bytes <= this.budgetBytes) return;
    for (const [id, value] of this.entries) {
      if (this.bytes <= this.budgetBytes) return;
      if (this.pinned.has(id) || this.fresh.has(id)) continue;
      this.entries.delete(id);
      this.release(value, id);
    }
  }

  clear(): void {
    for (const [id, value] of this.entries) this.release(value, id);
    this.entries.clear();
    this.fresh.clear();
    this.pinned = new Set();
  }
}
