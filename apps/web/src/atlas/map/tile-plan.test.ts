// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { Box, Viewport } from './camera';
import { childrenOf, MAX_LEVEL, parentOf, pyramidFor, TILE_PX, tileBox, tileKey, tilesFor, type TileKey } from './pyramid';
import {
  BRIDGE, DESCENT, FADE_MS, homeTiles, MARGIN_PX, planTiles, ROOT, TILE_BUDGET_BYTES, TileCache, tileBytes, visibleBox, type CameraState, type ReadyTile,
  type TilePlan,
} from './tile-plan';

/** The bounds of a real survey preview (world units). */
const BOUNDS: Box = { minX: -1230, minY: -1445, maxX: 1360, maxY: 878 };
const pyramid = pyramidFor(BOUNDS);
const LAPTOP: Viewport = { width: 1440, height: 900 };
const PHONE: Viewport = { width: 390, height: 844 };
const OLD = -1e6; // baked long ago: fully faded in

function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1_664_525) + 1_013_904_223) >>> 0) / 2 ** 32);
}

/** A scale in the middle of a level's range, so the planner draws exactly that level. */
const scaleFor = (level: number) => (2 ** (level - 0.5) * TILE_PX) / pyramid.size;
const at = (level: number, x = 40, y = -200): CameraState => ({ x, y, scale: scaleFor(level) });

function everyTile(level: number): TileKey[] {
  const keys: TileKey[] = [];
  for (let ty = 0; ty < 2 ** level; ty++) for (let tx = 0; tx < 2 ** level; tx++) keys.push({ level, tx, ty });
  return keys;
}

function cache(keys: Iterable<TileKey>, tile: ReadyTile = { bornAt: OLD }): Map<string, ReadyTile> {
  const ready = new Map<string, ReadyTile>();
  for (const key of keys) ready.set(tileKey(key), { ...tile });
  return ready;
}

const visibleAt = (camera: CameraState, view: Viewport) => planTiles({ pyramid, camera, view, now: 0, ready: new Map() }).visible;

/** The ancestors BRIDGE levels up of some tiles, once each, in the tiles' order. */
function bridgesOf(keys: TileKey[]): TileKey[] {
  const out = new Map<string, TileKey>();
  for (const key of keys) {
    let up: TileKey = key;
    for (let i = 0; i < BRIDGE; i++) up = parentOf(up)!;
    if (!out.has(tileKey(up))) out.set(tileKey(up), up);
  }
  return [...out.values()];
}

/**
 * An oracle that does not trust the planner's own count: sample points across each visible tile (one inside every
 * grandchild's square) and check that some tile the plan draws opaque contains each one.
 */
function bareTiles(plan: TilePlan): string[] {
  const opaque = [...plan.back, ...plan.front].filter((tile) => tile.alpha >= 1).map((tile) => tileBox(pyramid, tile.key));
  const bare: string[] = [];
  for (const key of plan.visible) {
    const box = tileBox(pyramid, key);
    const inside = (fx: number, fy: number) => {
      const x = box.minX + (box.maxX - box.minX) * fx;
      const y = box.minY + (box.maxY - box.minY) * fy;
      return opaque.some((b) => x >= b.minX && x <= b.maxX && y >= b.minY && y <= b.maxY);
    };
    const samples = [0.02, 0.27, 0.5, 0.73, 0.98];
    if (!samples.every((fx) => samples.every((fy) => inside(fx, fy)))) bare.push(tileKey(key));
  }
  return bare;
}

describe('planTiles: no empty paper', () => {
  it('asks for the root tile first on a cold start, then the bridge tiles, then the screen nearest the centre', () => {
    const camera = at(5);
    const plan = planTiles({ pyramid, camera, view: LAPTOP, now: 0, ready: new Map() });
    expect(plan.level).toBe(5);
    expect(plan.wanted[0]).toEqual(ROOT);
    const bridges = bridgesOf(plan.visible);
    expect(plan.wanted.slice(1)).toEqual([...bridges, ...plan.visible]);
    expect(plan.uncovered).toBe(plan.visible.length);
    expect(plan.complete).toBe(false);
  });

  it('covers every visible tile with the root while the deep tiles are still delayed', () => {
    for (const view of [LAPTOP, PHONE]) {
      const camera = at(7);
      const plan = planTiles({ pyramid, camera, view, now: 0, ready: cache([ROOT]) });
      expect(plan.front).toEqual([]);
      expect(plan.back.map((tile) => tile.id)).toEqual(['0/0/0']);
      expect(plan.uncovered).toBe(0);
      expect(bareTiles(plan)).toEqual([]);
      expect(plan.wanted).toEqual([...bridgesOf(plan.visible), ...plan.visible]);
      expect(plan.keep).toEqual(['0/0/0']);
      expect(plan.complete).toBe(false);
    }
  });

  it('keeps the parent under a sharpening child until the child is fully opaque', () => {
    const camera = at(5);
    const visible = visibleAt(camera, PHONE);
    const ready = cache(visible.map((key) => parentOf(key)!));
    for (const key of visible) ready.set(tileKey(key), { bornAt: 1000 });
    const half = planTiles({ pyramid, camera, view: PHONE, now: 1000 + FADE_MS / 2, ready });
    expect(half.front.every((tile) => Math.abs(tile.alpha - 0.5) < 1e-9)).toBe(true);
    expect(new Set(half.back.map((tile) => tile.key.level))).toEqual(new Set([4]));
    expect(half.uncovered).toBe(0);
    expect(bareTiles(half)).toEqual([]);
    expect(half.fading).toBe(visible.length);
    expect(half.complete).toBe(false);
    expect(half.wanted).toEqual([ROOT]);

    const done = planTiles({ pyramid, camera, view: PHONE, now: 1000 + FADE_MS, ready });
    expect(done.front.every((tile) => tile.alpha === 1)).toBe(true);
    expect(done.back).toEqual([]);
    expect(done.complete).toBe(true);
    expect(done.fading).toBe(0);
  });

  it('fades a tile in from the frame it is first shown, not from when it was baked', () => {
    const camera = at(4);
    const visible = visibleAt(camera, PHONE);
    const ready = cache([ROOT]);
    for (const key of visible) ready.set(tileKey(key), { bornAt: OLD, unseen: true });
    const plan = planTiles({ pyramid, camera, view: PHONE, now: 5000, ready });
    expect(plan.front.map((tile) => tile.alpha)).toEqual(visible.map(() => 0));
    expect(plan.reveal).toEqual(visible.map(tileKey));
    expect(plan.back.map((tile) => tile.id)).toEqual(['0/0/0']);
    expect(plan.uncovered).toBe(0);
  });

  it('does not count a stand-in that is itself still fading as cover', () => {
    const camera = at(3);
    const plan = planTiles({ pyramid, camera, view: PHONE, now: 100, ready: cache([ROOT], { bornAt: 0 }) });
    expect(plan.back).toEqual([{ key: ROOT, id: '0/0/0', alpha: 100 / FADE_MS }]);
    expect(plan.uncovered).toBe(plan.visible.length);
    expect(plan.fading).toBe(1);
  });

  it('keeps a failed tile’s ancestor drawn, never asks for it again, and still completes', () => {
    const camera = at(6);
    const visible = visibleAt(camera, LAPTOP);
    const broken = visible[3]!;
    const ready = cache([ROOT, ...visible.filter((key) => key !== broken)]);
    const failed = new Set([tileKey(broken)]);
    const plan = planTiles({ pyramid, camera, view: LAPTOP, now: 0, ready, failed });
    expect(plan.wanted).toEqual([]);
    expect(plan.back.map((tile) => tile.id)).toEqual(['0/0/0']);
    expect(plan.uncovered).toBe(0);
    expect(bareTiles(plan)).toEqual([]);
    expect(plan.complete).toBe(true);
  });

  it('stays incomplete while a stand-in under a failed tile is still fading in', () => {
    const camera = at(6);
    const visible = visibleAt(camera, LAPTOP);
    const broken = visible[3]!;
    const ready = cache([ROOT, ...visible.filter((key) => key !== broken)]);
    // The broken tile's parent arrives late (a home tile, baked after the screen) and starts its fade at 1000.
    ready.set(tileKey(parentOf(broken)!), { bornAt: 1000 });
    const failed = new Set([tileKey(broken)]);
    const early = planTiles({ pyramid, camera, view: LAPTOP, now: 1000 + FADE_MS / 4, ready, failed });
    expect(early.fading).toBe(1);
    expect(early.complete).toBe(false);
    const settled = planTiles({ pyramid, camera, view: LAPTOP, now: 1000 + FADE_MS, ready, failed });
    expect(settled.fading).toBe(0);
    expect(settled.complete).toBe(true);
  });

  it('zooms out over cached children and grandchildren, never fading to paper', () => {
    const camera = at(5);
    const visible = visibleAt(camera, LAPTOP);
    const children = cache(visible.flatMap(childrenOf));
    const out = planTiles({ pyramid, camera, view: LAPTOP, now: 0, ready: children });
    expect(out.front).toEqual([]);
    expect(out.back.every((tile) => tile.key.level === 6)).toBe(true);
    expect(out.uncovered).toBe(0);
    expect(bareTiles(out)).toEqual([]);
    expect(out.wanted.map(tileKey)).toEqual([ROOT, ...visible].map(tileKey));

    const grandchildren = cache(visible.flatMap(childrenOf).flatMap(childrenOf));
    const further = planTiles({ pyramid, camera, view: LAPTOP, now: 0, ready: grandchildren });
    expect(further.uncovered).toBe(0);
    expect(bareTiles(further)).toEqual([]);

    // Beyond DESCENT levels the stand-ins would be too many textures: that tile waits on the paper.
    const deeper = cache(visible.flatMap(childrenOf).flatMap(childrenOf).flatMap(childrenOf));
    expect(DESCENT).toBe(2);
    expect(planTiles({ pyramid, camera, view: LAPTOP, now: 0, ready: deeper }).uncovered).toBe(visible.length);
  });

  it('draws partial children above their ancestor, coarse under fine', () => {
    const camera = at(4);
    const visible = visibleAt(camera, PHONE);
    const ready = cache([ROOT, ...visible.flatMap((key) => childrenOf(key).slice(0, 3))]);
    const plan = planTiles({ pyramid, camera, view: PHONE, now: 0, ready });
    expect(plan.back[0]!.id).toBe('0/0/0');
    expect(plan.back.slice(1).every((tile) => tile.key.level === 5)).toBe(true);
    expect(plan.uncovered).toBe(0);
  });

  it('never leaves paper over a real-sized map at any zoom once an ancestor (or a near descendant) is ready', () => {
    const random = seeded(17);
    for (const seedLevel of [0, 1, 3, 5, 7]) {
      const ready = cache(everyTile(seedLevel));
      for (const view of [LAPTOP, PHONE]) {
        for (let i = 0; i < 40; i++) {
          const scale = 0.3 * (40 / 0.3) ** random();
          const camera = { x: BOUNDS.minX + random() * (BOUNDS.maxX - BOUNDS.minX), y: BOUNDS.minY + random() * (BOUNDS.maxY - BOUNDS.minY), scale };
          const plan = planTiles({ pyramid, camera, view, now: 0, ready });
          const label = `seed z${seedLevel} ${view.width}×${view.height} at ${JSON.stringify(camera)} (z${plan.level})`;
          if (plan.level >= seedLevel - DESCENT) {
            expect(plan.uncovered, label).toBe(0);
            expect(bareTiles(plan), label).toEqual([]);
          } else expect(plan.uncovered, label).toBe(plan.visible.length);
          for (let j = 1; j < plan.back.length; j++) expect(plan.back[j]!.key.level).toBeGreaterThanOrEqual(plan.back[j - 1]!.key.level);
          const drawn = [...plan.back, ...plan.front].map((tile) => tile.id);
          expect(new Set(drawn).size, label).toBe(drawn.length);
          expect(new Set(plan.keep)).toEqual(new Set(drawn));
        }
      }
    }
    // 400 plans over full caches of up to 16k tiles: seconds of pure CPU on a busy shared host.
  }, 30_000);

  it('agrees with the oracle over random caches, partial fades and failures', () => {
    const random = seeded(99);
    for (let round = 0; round < 60; round++) {
      const view = round % 2 ? PHONE : LAPTOP;
      const scale = 0.3 * (40 / 0.3) ** random();
      const camera = { x: BOUNDS.minX + random() * 2590, y: BOUNDS.minY + random() * 2323, scale };
      const level = planTiles({ pyramid, camera, view, now: 0, ready: new Map() }).level;
      const ready = new Map<string, ReadyTile>();
      const failed = new Set<string>();
      // Scatter tiles over the levels around the view, some still fading, some never shown, some failed.
      for (let l = Math.max(0, level - 3); l <= Math.min(MAX_LEVEL, level + 2); l++) {
        for (const key of tilesFor(pyramid, l, visibleBox(camera, view, MARGIN_PX))) {
          const roll = random();
          if (roll < 0.35) ready.set(tileKey(key), { bornAt: random() < 0.7 ? OLD : 1000 - random() * FADE_MS, unseen: random() < 0.1 });
          else if (roll < 0.4) failed.add(tileKey(key));
        }
      }
      const plan = planTiles({ pyramid, camera, view, now: 1000, ready, failed });
      const bare = bareTiles(plan);
      expect(plan.uncovered, `round ${round}`).toBe(bare.length);
      expect(plan.wanted.some((key) => failed.has(tileKey(key)) || ready.has(tileKey(key)))).toBe(false);
      // With the root baked nothing is ever bare.
      ready.set('0/0/0', { bornAt: OLD });
      const rooted = planTiles({ pyramid, camera, view, now: 1000, ready, failed });
      expect(rooted.uncovered, `round ${round}`).toBe(0);
      expect(bareTiles(rooted)).toEqual([]);
    }
  });
});

describe('planTiles: what to bake', () => {
  it('asks for a flight’s destination only after everything visible, without repeats', () => {
    const camera = at(4, -600, -900);
    const destination = at(7, 700, 300);
    const visible = visibleAt(camera, LAPTOP);
    const there = visibleAt(destination, LAPTOP);
    const ready = cache([ROOT, there[0]!]);
    const failed = new Set([tileKey(there[1]!)]);
    const plan = planTiles({ pyramid, camera, view: LAPTOP, now: 0, ready, failed, prefetch: destination });
    const ids = plan.wanted.map(tileKey);
    const near = [...bridgesOf(visible), ...visible].map(tileKey);
    expect(ids.slice(0, near.length)).toEqual(near);
    expect(ids.slice(near.length)).toEqual(there.slice(2).map(tileKey));
    expect(new Set(ids).size).toBe(ids.length);
    expect(plan.warm).toEqual([tileKey(there[0]!)]);
    expect(plan.keep).not.toContain(tileKey(there[0]!));
  });

  it('prefetches only as many tiles as the cache has room for beside this frame', () => {
    const camera = at(6);
    const visible = visibleAt(camera, PHONE);
    const ready = cache([ROOT, ...visible]);
    const destination = at(8, 900, 500);
    const capacity = visible.length + 1 + 5;
    const plan = planTiles({ pyramid, camera, view: PHONE, now: 0, ready, prefetch: destination, capacity });
    expect(plan.keep.length).toBe(visible.length + 1);
    expect(plan.wanted.map(tileKey)).toEqual(visibleAt(destination, PHONE).slice(0, 5).map(tileKey));
    expect(planTiles({ pyramid, camera, view: PHONE, now: 0, ready, prefetch: destination, capacity: visible.length }).wanted).toEqual([]);
  });

  it('leaves tiles already being baked off the list', () => {
    const camera = at(5);
    const visible = visibleAt(camera, PHONE);
    const pending = new Set([tileKey(ROOT), tileKey(visible[0]!)]);
    const bridges = bridgesOf(visible);
    pending.add(tileKey(bridges[0]!));
    const plan = planTiles({ pyramid, camera, view: PHONE, now: 0, ready: new Map(), pending });
    expect(plan.wanted).toEqual([...bridges.slice(1), ...visible.slice(1)]);
  });

  it('bridges a deep view whose only stand-in is far up, and stops once a near ancestor is ready', () => {
    for (const view of [LAPTOP, PHONE]) {
      const camera = at(8, 300, -400);
      const visible = visibleAt(camera, view);
      const bridges = bridgesOf(visible);
      // One bridge tile covers up to sixteen screen tiles: a handful bake before the screen's own.
      expect(bridges.length).toBeLessThanOrEqual(Math.ceil(visible.length / 4));
      const cold = planTiles({ pyramid, camera, view, now: 0, ready: cache([ROOT]) });
      expect(cold.wanted.slice(0, bridges.length)).toEqual(bridges);
      expect(cold.uncovered).toBe(0);
      // With the bridges ready the screen is two levels from sharp: nothing more to bridge.
      const near = planTiles({ pyramid, camera, view, now: 0, ready: cache([ROOT, ...bridges]) });
      expect(near.wanted).toEqual(visible);
      expect(near.back.map((tile) => tile.key.level)).toContain(8 - BRIDGE);
      // A parent one level up is near enough too.
      const parents = new Map(visible.map((key) => [tileKey(parentOf(key)!), parentOf(key)!]));
      expect(planTiles({ pyramid, camera, view, now: 0, ready: cache([ROOT, ...parents.values()]) }).wanted).toEqual(visible);
      // Zooming out over ready children needs no bridge either.
      const children = visible.flatMap((key) => childrenOf(key));
      expect(planTiles({ pyramid, camera, view, now: 0, ready: cache([ROOT, ...children]) }).wanted).toEqual(visible);
      // A failed tile asks for nothing on its behalf.
      const failed = new Set(visible.map(tileKey));
      expect(planTiles({ pyramid, camera, view, now: 0, ready: cache([ROOT]), failed }).wanted).toEqual([]);
    }
  });
});

describe('planTiles: the home drawing', () => {
  // The opening view: the whole map, a little smaller than the screen.
  const homeOf = (view: Viewport): CameraState => ({ x: 65, y: -283, scale: Math.min(view.width / 2590, view.height / 2323) * 0.9 });

  it('is a handful of tiles with all their ancestors, coarse first', () => {
    for (const view of [LAPTOP, PHONE]) {
      const home = homeTiles(pyramid, homeOf(view), view);
      expect(home[0]).toEqual(ROOT);
      expect(home.length).toBeLessThanOrEqual(21);
      for (let i = 1; i < home.length; i++) expect(home[i]!.level).toBeGreaterThanOrEqual(home[i - 1]!.level);
      const ids = new Set(home.map(tileKey));
      for (const key of home) if (key.level) expect(ids.has(tileKey(parentOf(key)!))).toBe(true);
    }
  });

  it('keeps the home tiles while deep, so the way home never falls back to a magnified root', () => {
    for (const view of [LAPTOP, PHONE]) {
      const home = homeTiles(pyramid, homeOf(view), view);
      const camera = at(7, 300, -400);
      const plan = planTiles({ pyramid, camera, view, now: 0, ready: cache(home), home });
      for (const key of home) expect(plan.keep).toContain(tileKey(key));
      // Deep tiles now stand on a home tile, not the root.
      expect(Math.min(...plan.back.map((tile) => tile.key.level))).toBeGreaterThan(0);
      const back = planTiles({ pyramid, camera: homeOf(view), view, now: 0, ready: cache(home), home });
      expect(back.complete).toBe(true);
      expect(back.wanted).toEqual([]);
    }
  });

  it('bakes missing home tiles only after everything the screen needs', () => {
    const home = homeTiles(pyramid, homeOf(LAPTOP), LAPTOP);
    const camera = at(6, 300, -400);
    const plan = planTiles({ pyramid, camera, view: LAPTOP, now: 0, ready: cache([ROOT]), home });
    const ids = plan.wanted.map(tileKey);
    const visible = plan.visible.map(tileKey);
    const lastVisible = Math.max(...visible.map((id) => ids.indexOf(id)));
    const rest = home.map(tileKey).filter((id) => id !== tileKey(ROOT) && !ids.slice(0, lastVisible + 1).includes(id));
    expect(ids.slice(lastVisible + 1)).toEqual(rest);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('TileCache', () => {
  const tile = 1000;
  const make = (budget: number) => {
    const released: string[] = [];
    const store = new TileCache<string>(budget, tile, (_, id) => released.push(id));
    return { store, released };
  };

  it('evicts the least recently used tile first and reports its size', () => {
    const { store, released } = make(3 * tile);
    for (const id of ['a', 'b', 'c']) store.put(id, id);
    store.use(['a']); // b and c are now older than a
    store.use([]);
    store.put('d', 'd');
    expect(released).toEqual(['b']);
    store.use([]);
    store.put('e', 'e');
    expect(released).toEqual(['b', 'c']);
    expect(store.count).toBe(3);
    expect(store.bytes).toBe(3 * tile);
    expect(store.capacity).toBe(3);
  });

  it('never evicts a tile the frame draws, even over budget, and trims once the pins release', () => {
    const { store, released } = make(2 * tile);
    for (const id of ['a', 'b', 'c', 'd']) store.put(id, id);
    store.use(['a', 'b', 'c', 'd']);
    expect(released).toEqual([]);
    expect(store.bytes).toBe(4 * tile);
    store.use(['c']);
    expect(released).toEqual(['a', 'b']);
    expect(store.bytes).toBeLessThanOrEqual(2 * tile);
    expect(store.get('c')).toBe('c');
  });

  it('keeps a tile that has just arrived until the next frame decides', () => {
    const { store, released } = make(1 * tile);
    store.put('a', 'a');
    store.use(['a']);
    store.put('b', 'b');
    expect(released).toEqual([]);
    store.use(['b']);
    expect(released).toEqual(['a']);
  });

  it('keeps warm tiles recent without pinning them', () => {
    const { store, released } = make(2 * tile);
    store.put('old', 'old');
    store.put('flight', 'flight');
    store.use([]);
    store.use([], ['old']); // the destination tile is warm, the passing one is not
    store.put('new', 'new');
    expect(released).toEqual(['flight']);
  });

  it('releases a replaced tile and everything on clear', () => {
    const { store, released } = make(4 * tile);
    store.put('a', 'a1');
    store.put('a', 'a2');
    expect(released).toEqual(['a']);
    expect(store.count).toBe(1);
    store.clear();
    expect(released).toEqual(['a', 'a']);
    expect(store.bytes).toBe(0);
  });

  it('budgets hold a full screen at the sharpest level plus its stand-ins, at device ratio 2', () => {
    expect(tileBytes(2)).toBe(512 * 512 * 4);
    expect(tileBytes(1.5)).toBe(384 * 384 * 4);
    expect(Math.floor(TILE_BUDGET_BYTES.phone / tileBytes(2))).toBe(48);
    expect(Math.floor(TILE_BUDGET_BYTES.laptop / tileBytes(2))).toBe(112);
    for (const [view, budget] of [[PHONE, TILE_BUDGET_BYTES.phone], [LAPTOP, TILE_BUDGET_BYTES.laptop]] as const) {
      const capacity = Math.floor(budget / tileBytes(2));
      for (let scale = 0.3; scale <= 40; scale *= 1.09) {
        const camera = { x: 60, y: -280, scale };
        const visible = visibleAt(camera, view);
        // Sharpening: every visible tile fading in over its parent, plus the root.
        const parents = new Set(visible.map((key) => tileKey(parentOf(key) ?? key)));
        expect(visible.length + parents.size + 1, `${view.width} at ${scale}`).toBeLessThanOrEqual(capacity);
      }
    }
  });
});
