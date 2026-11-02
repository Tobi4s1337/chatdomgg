// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { CollisionGrid, overlaps, type Rect } from './collide';
import { comparePlacement, FADE_MS, fadeIn, HoldingLabels, MEMORY_LIMIT, onScreen, plan, Placer, SHIELD_LIMIT, type PlacementItem, type Placed } from './placement';

function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1_664_525) + 1_013_904_223) >>> 0) / 2 ** 32);
}

const VIEW = { width: 1440, height: 900 };

/** A holding at a screen point, with a stamp-sized name block on four sides (below, right, left, above). */
interface Site { id: string; tierRank: number; average: number; x: number; y: number; forced?: boolean }

function itemsAt(sites: readonly Site[], transform: (x: number, y: number) => { x: number; y: number }): PlacementItem[] {
  return sites.map((site) => {
    const p = transform(site.x, site.y);
    return {
      key: `n:${site.id}`,
      tierRank: site.tierRank,
      average: site.average,
      id: site.id,
      ...(site.forced ? { forced: true } : {}),
      candidates: HoldingLabels.candidates({ x: p.x, y: p.y, w: 24, h: 18 }, 46 + (Number(site.id) % 5) * 9, 14),
    };
  });
}

function scene(seed: number, count: number): Site[] {
  const random = seeded(seed);
  return Array.from({ length: count }, (_, i) => ({
    id: String(1000 + i),
    tierRank: Math.floor(random() * 4),
    average: [25, 60, 520, 900, 6_000][Math.floor(random() * 5)]!,
    x: random() * VIEW.width,
    y: random() * VIEW.height,
  }));
}

const identity = (x: number, y: number) => ({ x, y });
const pan = (dx: number, dy: number) => (x: number, y: number) => ({ x: x + dx, y: y + dy });
const zoom = (factor: number, ax: number, ay: number) => (x: number, y: number) => ({ x: ax + (x - ax) * factor, y: ay + (y - ay) * factor });

function frame(placer: Placer, items: readonly PlacementItem[], now = 0, grid = new CollisionGrid(VIEW.width, VIEW.height)): Map<string, Placed> {
  placer.begin(now, false);
  const out = plan(items, grid, placer);
  placer.end();
  return out;
}

const sides = (placed: Map<string, Placed>) => new Map([...placed].map(([key, p]) => [key, p.index]));

function shuffle<T>(list: readonly T[], random: () => number): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

describe('plan with hamlets', () => {
  it('gives a contested place to the village before any hamlet, and a hamlet still takes free paper', () => {
    const box: Rect = { x: 100, y: 100, w: 20, h: 20 };
    const items: PlacementItem[] = [
      { key: 'hamlet-loud', tierRank: 4, average: 4_000, id: '1', candidates: [box] },
      { key: 'village', tierRank: 3, average: 25, id: '99', candidates: [box] },
      { key: 'hamlet-free', tierRank: 4, average: 3, id: '2', candidates: [{ x: 300, y: 100, w: 12, h: 12 }] },
    ];
    const placed = plan(items, new CollisionGrid(800, 600), new Placer());
    expect([...placed.keys()].sort()).toEqual(['hamlet-free', 'village']);
  });
});

describe('plan', () => {
  it('places greedily without overlaps, the stronger holding first', () => {
    const placed = frame(new Placer(), itemsAt(scene(1, 600), identity));
    const rects = [...placed.values()].map((p) => p.rect);
    // Collect the offending pairs and assert once: one expectation per pair costs seconds on a busy host.
    const clashes: [number, number][] = [];
    for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) if (overlaps(rects[i]!, rects[j]!)) clashes.push([i, j]);
    expect(clashes).toEqual([]);
    expect(placed.size).toBeGreaterThan(100);
    expect(placed.size).toBeLessThan(600);
  });

  it('is deterministic and independent of the input order', () => {
    const random = seeded(7);
    const items = itemsAt(scene(2, 500), identity);
    const expected = sides(frame(new Placer(), items));
    for (let round = 0; round < 4; round++) expect(sides(frame(new Placer(), shuffle(items, random)))).toEqual(expected);
    // With memory too: the same history in any order gives the same placements.
    const a = new Placer();
    const b = new Placer();
    frame(a, items);
    frame(b, shuffle(items, random));
    const next = itemsAt(scene(2, 500), zoom(1.1, 700, 400));
    expect(sides(frame(a, next))).toEqual(sides(frame(b, shuffle(next, random))));
  });

  it('keeps the placed set and every side through a small pan', () => {
    const sites = scene(3, 700);
    const placer = new Placer();
    const before = sides(frame(placer, itemsAt(sites, identity)));
    for (const [dx, dy] of [[3, 0], [0, -3], [2.5, 1.5]] as const) {
      expect(sides(frame(placer, itemsAt(sites, pan(dx, dy))))).toEqual(before);
    }
    // A fresh planner agrees too: a pan moves every box together, so no contest changes.
    expect(sides(frame(new Placer(), itemsAt(sites, pan(3, 0))))).toEqual(before);
  });

  it('keeps a remembered side through a small zoom wherever it is still free', () => {
    const sites = scene(4, 700);
    const placer = new Placer();
    const before = sides(frame(placer, itemsAt(sites, identity)));
    const zoomed = itemsAt(sites, zoom(1.04, 600, 380));
    const after = frame(placer, zoomed);
    const fresh = sides(frame(new Placer(), zoomed));

    // Replay the frame in priority order: any item that moved must have found its old side taken by a stronger one.
    const order = [...zoomed].sort(comparePlacement);
    const claimed: Rect[] = [];
    let kept = 0;
    let moved = 0;
    for (const item of order) {
      const now = after.get(item.key);
      const old = before.get(item.key);
      if (old !== undefined && now) {
        if (now.index === old) kept++;
        else {
          moved++;
          expect(claimed.some((rect) => overlaps(rect, item.candidates[old]!)), item.key).toBe(true);
        }
      }
      if (now) claimed.push(now.rect);
    }
    expect(kept).toBeGreaterThan(moved * 10);
    // Without memory the same zoom flips more names back to their ordinary side.
    const flippedFresh = [...before].filter(([key, side]) => fresh.has(key) && fresh.get(key) !== side).length;
    expect(moved).toBeLessThan(flippedFresh);
  });

  it('lets a name that moved aside stay there when its first side frees up', () => {
    const placer = new Placer();
    const site: Site = { id: '200', tierRank: 2, average: 60, x: 400, y: 400 };
    const blocker: Site = { id: '100', tierRank: 0, average: 6_000, x: 400, y: 405 };
    const first = frame(placer, itemsAt([site, blocker], identity));
    const side = first.get('n:200')!.index;
    expect(side).not.toBe(0);
    // The capital's name goes away (zoomed past, or its chunk dropped): below is free again, the town stays put.
    expect(frame(placer, itemsAt([site], identity)).get('n:200')!.index).toBe(side);
    // A fresh view puts it below.
    expect(frame(new Placer(), itemsAt([site], identity)).get('n:200')!.index).toBe(0);
  });

  it('lets priority beat stickiness: a stronger holding always wins a contested box', () => {
    const placer = new Placer();
    const weak: PlacementItem = { key: 'weak', tierRank: 3, average: 25, id: '900', candidates: [{ x: 100, y: 100, w: 60, h: 14 }, { x: 300, y: 100, w: 60, h: 14 }] };
    expect(frame(placer, [weak]).get('weak')!.index).toBe(0);
    const strong: PlacementItem = { key: 'strong', tierRank: 0, average: 6_000, id: '5', candidates: [{ x: 120, y: 105, w: 60, h: 14 }] };
    for (const items of [[weak, strong], [strong, weak]]) {
      const fresh = new Placer();
      frame(fresh, [weak]);
      const placed = frame(fresh, items);
      expect(placed.get('strong')!.index).toBe(0);
      expect(placed.get('weak')!.index).toBe(1);
    }
    // And a weaker item with nowhere else to go yields entirely.
    const only: PlacementItem = { ...weak, candidates: [weak.candidates[0]!] };
    const p = new Placer();
    frame(p, [only]);
    const placed = frame(p, [only, strong]);
    expect(placed.has('weak')).toBe(false);
    expect(placed.has('strong')).toBe(true);
  });

  it('always places a forced item, claims it first and never lets anything onto it', () => {
    const grid = new CollisionGrid(VIEW.width, VIEW.height);
    grid.claim({ x: 0, y: 0, w: VIEW.width, h: VIEW.height }); // a region name over everything
    const selected: PlacementItem = { key: 'sel', tierRank: 3, average: 25, id: '77', forced: true, candidates: HoldingLabels.candidates({ x: 500, y: 500, w: 20, h: 16 }, 80, 14) };
    const capital: PlacementItem = { key: 'cap', tierRank: 0, average: 9_000, id: '1', candidates: [] };
    const placer = new Placer();
    placer.begin(0, true);
    const placed = plan([capital, selected], grid, placer);
    expect(placed.get('sel')!.index).toBe(0);

    // On open paper the forced item goes first, so a stronger holding on the same spot yields.
    const open = new CollisionGrid(VIEW.width, VIEW.height);
    const rival: PlacementItem = { key: 'rival', tierRank: 0, average: 9_000, id: '1', candidates: [selected.candidates[0]!] };
    placer.begin(1, true);
    const second = plan([rival, selected], open, placer);
    expect(second.get('sel')!.index).toBe(0);
    expect(second.has('rival')).toBe(false);

    // Covered again, it keeps the side it held rather than jumping back to the first.
    const sticky = new Placer();
    sticky.begin(0, true);
    const blocked = new CollisionGrid(VIEW.width, VIEW.height);
    blocked.claim(selected.candidates[0]!);
    expect(plan([selected], blocked, sticky).get('sel')!.index).toBe(1);
    sticky.begin(1, true);
    const covered = new CollisionGrid(VIEW.width, VIEW.height);
    covered.claim({ x: 0, y: 0, w: VIEW.width, h: VIEW.height });
    expect(plan([selected], covered, sticky).get('sel')!.index).toBe(1);
  });
});

describe('fade-in', () => {
  it('ramps from 0 to 1 over the fade time, and is 1 at once under reduced motion', () => {
    expect(fadeIn(1000, 1000, false)).toBe(0);
    let previous = 0;
    for (let t = 0; t <= FADE_MS; t += 10) {
      const alpha = fadeIn(1000 + t, 1000, false);
      expect(alpha).toBeGreaterThanOrEqual(previous);
      previous = alpha;
    }
    expect(fadeIn(1000 + FADE_MS / 2, 1000, false)).toBeGreaterThan(0.5);
    expect(fadeIn(1000 + FADE_MS / 2, 1000, false)).toBeLessThan(1);
    expect(fadeIn(1000 + FADE_MS, 1000, false)).toBe(1);
    expect(fadeIn(1000 + 10 * FADE_MS, 1000, false)).toBe(1);
    expect(fadeIn(1000, 1000, true)).toBe(1);
    expect(fadeIn(900, 1000, false)).toBe(0);
  });

  it('fades in what newly finds room, keeps what stays placed, and reports while anything is fading', () => {
    const placer = new Placer();
    const a: PlacementItem = { key: 'a', tierRank: 1, average: 900, id: '1', candidates: [{ x: 0, y: 0, w: 50, h: 10 }] };
    const b: PlacementItem = { key: 'b', tierRank: 1, average: 900, id: '2', candidates: [{ x: 200, y: 0, w: 50, h: 10 }] };

    let placed = frame(placer, [a], 1000);
    expect(placed.get('a')).toMatchObject({ alpha: 0, fresh: true });
    expect(placer.fading).toBe(true);

    placed = frame(placer, [a, b], 1000 + FADE_MS / 2);
    expect(placed.get('a')!.alpha).toBeGreaterThan(0.5);
    expect(placed.get('a')!.fresh).toBe(false);
    expect(placed.get('b')).toMatchObject({ alpha: 0, fresh: true });

    placed = frame(placer, [a, b], 1000 + FADE_MS);
    expect(placed.get('a')!.alpha).toBe(1);
    expect(placer.fading).toBe(true);

    placed = frame(placer, [a, b], 1000 + FADE_MS * 2);
    expect(placed.get('b')!.alpha).toBe(1);
    expect(placer.fading).toBe(false);

    // Dropped for one update, it fades in again when it returns.
    frame(placer, [b], 2000);
    expect(frame(placer, [a, b], 2010).get('a')).toMatchObject({ alpha: 0, fresh: true });
  });

  it('shows everything at once on an instant update (reduced motion, or the first view)', () => {
    const placer = new Placer();
    const a: PlacementItem = { key: 'a', tierRank: 1, average: 900, id: '1', candidates: [{ x: 0, y: 0, w: 50, h: 10 }] };
    placer.begin(1000, true);
    expect(plan([a], new CollisionGrid(100, 100), placer).get('a')!.alpha).toBe(1);
    expect(placer.fading).toBe(false);
    // And it stays at full alpha when motion is allowed again.
    expect(frame(placer, [a], 1001).get('a')!.alpha).toBe(1);
  });
});

describe('Placer memory', () => {
  it('forgets keys not offered for a while and never grows past its limit', () => {
    const placer = new Placer(10, 500);
    const item = (i: number): PlacementItem => ({ key: `k${i}`, tierRank: 2, average: 60, id: String(i), candidates: [{ x: (i % 40) * 30, y: Math.floor(i / 40) * 12, w: 20, h: 10 }] });
    frame(placer, Array.from({ length: 400 }, (_, i) => item(i)));
    expect(placer.size).toBe(400);
    // Keep offering the first 50 only; the rest are forgotten after the window.
    for (let i = 0; i < 64; i++) frame(placer, Array.from({ length: 50 }, (_, j) => item(j)));
    expect(placer.size).toBe(50);
    expect(placer.side('k0')).toBe(0);
    expect(placer.side('k399')).toBeUndefined();
    // Far more keys than the limit in one update: trimmed at its end, the oldest first.
    frame(placer, Array.from({ length: 1200 }, (_, i) => item(i + 1000)));
    expect(placer.size).toBeLessThanOrEqual(500);
    expect(MEMORY_LIMIT).toBeGreaterThan(SHIELD_LIMIT * 4);
  });
});

describe('HoldingLabels', () => {
  it('puts a shield on at most SHIELD_LIMIT names and still writes the names after that', () => {
    const placer = new Placer();
    const names = new HoldingLabels(placer);
    placer.begin(0, true);
    names.begin();
    const grid = new CollisionGrid(4000, 4000);
    const out = Array.from({ length: 420 }, (_, i) => names.place(grid, `n:${i}`, { x: (i % 20) * 190 + 40, y: Math.floor(i / 20) * 180 + 40, w: 30, h: 20 }, { w: 70, h: 16 }, { w: 12, h: 14.4 }));
    expect(out.every(Boolean)).toBe(true);
    expect(names.shields).toBe(SHIELD_LIMIT);
    expect(out.filter((p) => p!.shield).length).toBe(SHIELD_LIMIT);
    expect(out.slice(SHIELD_LIMIT).every((p) => !p!.shield && !p!.standard && p!.label)).toBe(true);
    // Past the limit a holding without a received name shows nothing at all.
    expect(names.place(grid, 'n:x', { x: 3900, y: 3900, w: 10, h: 10 }, null, { w: 12, h: 14.4 })).toBeNull();
  });

  it('draws the shield left of the name, both centred in the block, and the standard on the shield', () => {
    const placer = new Placer();
    const names = new HoldingLabels(placer);
    placer.begin(0, true);
    names.begin();
    const placed = names.place(new CollisionGrid(VIEW.width, VIEW.height), 'n:1', { x: 200, y: 200, w: 40, h: 30 }, { w: 60, h: 18 }, { w: 12, h: 14 })!;
    expect(placed.index).toBe(0);
    expect(placed.rect).toEqual({ x: 200 - 38, y: 202, w: 76, h: 18 });
    expect(placed.shield).toEqual({ x: 159, y: 201 });
    expect(placed.label).toEqual({ x: 178, y: 202 });
    expect(placed.standard).toEqual({ x: 168, y: 204.5 });
  });

  it('keeps a selected holding’s name readable when everything around it is taken', () => {
    const placer = new Placer();
    const names = new HoldingLabels(placer);
    placer.begin(0, true);
    names.begin();
    const grid = new CollisionGrid(VIEW.width, VIEW.height);
    grid.claim({ x: 0, y: 0, w: VIEW.width, h: VIEW.height });
    expect(names.place(grid, 'n:2', { x: 300, y: 300, w: 20, h: 16 }, { w: 60, h: 14 }, { w: 11, h: 13 })).toBeNull();
    expect(names.place(grid, 'n:3', { x: 300, y: 300, w: 20, h: 16 }, { w: 60, h: 14 }, { w: 11, h: 13 }, true)?.label).toBeTruthy();
  });
});

describe('onScreen', () => {
  it('counts a box touching the screen plus margin and nothing beyond it', () => {
    expect(onScreen({ x: -50, y: 10, w: 49, h: 10 }, 100, 100)).toBe(false);
    expect(onScreen({ x: -50, y: 10, w: 51, h: 10 }, 100, 100)).toBe(true);
    expect(onScreen({ x: -50, y: 10, w: 20, h: 10 }, 100, 100, 40)).toBe(true);
    expect(onScreen({ x: 141, y: 10, w: 20, h: 10 }, 100, 100, 40)).toBe(false);
    expect(onScreen({ x: 10, y: 139, w: 20, h: 10 }, 100, 100, 40)).toBe(true);
  });
});
