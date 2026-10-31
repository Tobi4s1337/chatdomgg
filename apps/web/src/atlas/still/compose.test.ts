import { describe, expect, it } from 'vitest';
import stampSheet from '../assets/stamps.json';
import { columns, HEAD_ROWS, makeNames, makeWorld, type Row } from '../data/fixtures.test-support';
import { geographyOf, SettlerStore, type Settler } from '../data/model';
import type { PreviewWorld } from '../data/preview';
import { DISTANCE_SCALE, type Box } from '../map/camera';
import { overlaps } from '../map/collide';
import type { Stamp } from '../map/paint';
import { levelFor, tileBox, tileKey } from '../map/pyramid';
import { formatMoment } from '../ui/format';
import {
  ancestorCrop, ancestorsOf, DENSITY_CAP, layoutStill, SHIELD_LIMIT, sheetFrame, stillInsets, stillRibbon, stillView, tileRect, washStains,
  type LiveSource, type Measure, type StillLayout,
} from './compose';

const stamps = (stampSheet as { stamps: Stamp[] }).stamps;
/** A fixed advance per letter, so placement is decided by the rules alone. */
const measure: Measure = (text, font) => text.length * (font.size * 0.55 + font.spacing);
const LAPTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };
/** The real 2026-10-30 survey's sheet, in world units. */
const REAL_BOUNDS: Box = { minX: -1522, minY: -1596, maxX: 1776, maxY: 1574 };

function setup(world: PreviewWorld = makeWorld(), names = true, withheld: string[] = []) {
  const store = new SettlerStore(world, () => world.asOf);
  if (names) store.applyNames(makeNames(world, { withheld }));
  return { world, geo: geographyOf(world), store };
}

function layout(env: ReturnType<typeof setup>, view = LAPTOP, selected: Settler | null = null): StillLayout {
  const v = stillView(env.geo.bounds, view);
  return layoutStill({ ...env, camera: v.camera, view, stamps, measure, selected });
}

/** Everything but the settler objects, for comparing two runs. */
const plain = (result: StillLayout) => JSON.stringify(result, (key, value: unknown) => (key === 'settler' ? undefined : value));

function capitals(count: number): Row[] {
  return Array.from({ length: count }, (_, i) => ({
    id: String(1_000_000 + i), login: `capital${i}`, name: `Capital ${i}`, tier: 0,
    x: -1900 + (i % 20) * 210, y: -1100 + Math.floor(i / 20) * 100, average: 50_000 - i, game: 0, region: 0, realm: 1,
  }));
}

describe('stillView', () => {
  it('shows the whole sheet on a laptop, clear of the cartouche, as the moving map opens', () => {
    const v = stillView(REAL_BOUNDS, LAPTOP);
    const a = v.camera.worldToScreen(REAL_BOUNDS.minX, REAL_BOUNDS.minY, LAPTOP);
    const c = v.camera.worldToScreen(REAL_BOUNDS.maxX, REAL_BOUNDS.maxY, LAPTOP);
    expect(a.x).toBeGreaterThanOrEqual(stillInsets(LAPTOP).left);
    expect(c.x).toBeLessThanOrEqual(LAPTOP.width);
    expect(a.y).toBeGreaterThanOrEqual(0);
    expect(c.y).toBeLessThanOrEqual(LAPTOP.height);
    expect(v.distance).toBe('world');
  });

  it('fills a phone held upright with the map, centred, rather than shrinking it to fit', () => {
    const phone = stillView(REAL_BOUNDS, PHONE);
    const laptop = stillView(REAL_BOUNDS, LAPTOP);
    const height = (REAL_BOUNDS.maxY - REAL_BOUNDS.minY) * phone.scale;
    expect(height).toBeGreaterThan(PHONE.height * 0.88);
    expect((REAL_BOUNDS.maxX - REAL_BOUNDS.minX) * phone.scale).toBeGreaterThan(PHONE.width);
    const contain = Math.min(PHONE.width / (REAL_BOUNDS.maxX - REAL_BOUNDS.minX), PHONE.height / (REAL_BOUNDS.maxY - REAL_BOUNDS.minY));
    expect(phone.scale).toBeGreaterThan(contain * 1.5);
    expect(phone.scale).not.toBeCloseTo(laptop.scale, 3);
  });

  it('inks one level, the one the tile layer would choose, with tiles covering every visible part of the sheet', () => {
    for (const size of [LAPTOP, PHONE, { width: 1920, height: 1080 }]) {
      const v = stillView(REAL_BOUNDS, size);
      expect(v.level).toBe(levelFor(v.pyramid, v.scale, 1));
      expect(new Set(v.tiles.map((key) => key.level))).toEqual(new Set([v.level]));
      const seen = v.camera.visibleBox(size, 0);
      // Sample the visible sheet: every point lies in some wanted tile.
      for (let i = 0; i <= 20; i++) {
        for (let j = 0; j <= 20; j++) {
          const x = Math.max(seen.minX, REAL_BOUNDS.minX) + ((Math.min(seen.maxX, REAL_BOUNDS.maxX) - Math.max(seen.minX, REAL_BOUNDS.minX)) * i) / 20;
          const y = Math.max(seen.minY, REAL_BOUNDS.minY) + ((Math.min(seen.maxY, REAL_BOUNDS.maxY) - Math.max(seen.minY, REAL_BOUNDS.minY)) * j) / 20;
          const covered = v.tiles.some((key) => {
            const box = tileBox(v.pyramid, key);
            return x >= box.minX && x <= box.maxX && y >= box.minY && y <= box.maxY;
          });
          expect(covered).toBe(true);
        }
      }
      expect(new Set(v.tiles.map(tileKey)).size).toBe(v.tiles.length);
    }
  });

  it('places neighbouring tiles edge to edge in device pixels, with no seam or overlap', () => {
    const v = stillView(REAL_BOUNDS, LAPTOP);
    for (const key of v.tiles) {
      const a = tileRect(v.pyramid, key, v.camera, LAPTOP, 2);
      const right = v.tiles.find((other) => other.tx === key.tx + 1 && other.ty === key.ty);
      const below = v.tiles.find((other) => other.tx === key.tx && other.ty === key.ty + 1);
      if (right) expect(tileRect(v.pyramid, right, v.camera, LAPTOP, 2).x).toBe(a.x + a.w);
      if (below) expect(tileRect(v.pyramid, below, v.camera, LAPTOP, 2).y).toBe(a.y + a.h);
    }
  });

  it('crops the right quarter of each ancestor for a failed tile', () => {
    const key = { level: 3, tx: 5, ty: 2 };
    expect(ancestorsOf(key)).toEqual([{ level: 2, tx: 2, ty: 1 }, { level: 1, tx: 1, ty: 0 }, { level: 0, tx: 0, ty: 0 }]);
    expect(ancestorCrop(key, { level: 2, tx: 2, ty: 1 })).toEqual({ x: 0.5, y: 0, size: 0.5 });
    expect(ancestorCrop(key, { level: 0, tx: 0, ty: 0 })).toEqual({ x: 5 / 8, y: 2 / 8, size: 1 / 8 });
  });

  it('frames the sheet with deep paper outside it and a double neatline, as the map does', () => {
    const v = stillView(REAL_BOUNDS, LAPTOP);
    const frame = sheetFrame(REAL_BOUNDS, v.camera, LAPTOP);
    const a = v.camera.worldToScreen(REAL_BOUNDS.minX, REAL_BOUNDS.minY, LAPTOP);
    expect(frame.inner.x).toBeCloseTo(a.x, 9);
    expect(frame.outer.x).toBeCloseTo(a.x - 5, 9);
    expect(frame.outer.w).toBeCloseTo(frame.inner.w + 10, 9);
    // The margin to the left of the sheet runs under the cartouche.
    expect(frame.margin.some((rect) => rect.x === 0 && rect.w >= stillInsets(LAPTOP).left)).toBe(true);
  });
});

describe('layoutStill', () => {
  it('is deterministic: the same survey and screen place every mark, shield and name the same way', () => {
    expect(plain(layout(setup()))).toBe(plain(layout(setup())));
    expect(plain(layout(setup(), PHONE))).toBe(plain(layout(setup(), PHONE)));
  });

  it('marks the holdings the map marks at this distance, strongest first, as stamps with arms and names', () => {
    const result = layout(setup());
    expect(result.marks.map((mark) => mark.id)).toEqual(HEAD_ROWS.map((row) => row.id));
    for (const mark of result.marks) {
      expect(mark.stamp).not.toBeNull();
      expect(mark.shield).not.toBeNull();
      expect(mark.name?.text).toBe(mark.settler.name);
    }
    expect(result.marks[0]!.label).toBe('zackrawrr, capital in Just Chatting & IRL, English');
    expect(result.marks[2]!.label).toBe('GRONKH, city in Deutsch');
    expect(result.names).toBe(3);
    expect(result.shields).toBe(3);
  });

  it('never draws a withheld holding, even when it is the selection', () => {
    const env = setup(makeWorld(), true, [HEAD_ROWS[1]!.id]);
    const withheld = env.store.byId.get(HEAD_ROWS[1]!.id)!;
    for (const result of [layout(env), layout(env, LAPTOP, withheld), layout(env, PHONE, withheld)]) {
      expect(result.marks.some((mark) => mark.id === withheld.id)).toBe(false);
      expect(result.marks.some((mark) => mark.label.includes('HasanAbi'))).toBe(false);
    }
  });

  it('gives an unnamed holding its arms alone and an honest name for its button', () => {
    const result = layout(setup(makeWorld(), false));
    expect(result.names).toBe(0);
    for (const mark of result.marks) {
      expect(mark.name).toBeNull();
      expect(mark.shield).not.toBeNull();
    }
    expect(result.marks.map((mark) => mark.label)).toEqual([
      'Unnamed capital in Just Chatting & IRL, English',
      'Unnamed city in Just Chatting & IRL, English',
      'Unnamed city in Deutsch',
    ]);
  });

  it('never lets a stamp, a name plate or a lettered name overlap another', () => {
    const world = makeWorld();
    world.head = columns([...HEAD_ROWS, ...capitals(120).map((row) => ({ ...row, x: (row.x % 2200) / 1, y: row.y % 1000 }))]);
    for (const view of [LAPTOP, PHONE, { width: 1920, height: 1080 }]) {
      const result = layout(setup(world), view);
      for (let i = 0; i < result.claims.length; i++) {
        for (let j = i + 1; j < result.claims.length; j++) expect(overlaps(result.claims[i]!, result.claims[j]!)).toBe(false);
      }
      // Crowded capitals fall back to survey marks rather than piling up.
      expect(result.marks.some((mark) => mark.mark)).toBe(true);
    }
  });

  it('draws at most 300 shields; names go on without them', () => {
    const world = makeWorld();
    world.head = columns(capitals(400));
    world.counts.capital = 400;
    const store = new SettlerStore(world, () => world.asOf);
    store.applyNames({ ...makeNames(world), ids: world.head.ids, logins: world.head.ids.map((_, i) => `capital${i}`), names: world.head.ids.map((_, i) => `Capital ${i}`), freshUntil: world.head.ids.map(() => world.asOf + 86_400_000) });
    const big = { width: 20_000, height: 10_000 };
    const result = layout({ world, geo: geographyOf(world), store }, big);
    expect(result.marks.length).toBe(400);
    expect(result.shields).toBe(SHIELD_LIMIT);
    expect(result.marks.filter((mark) => mark.shield).length).toBe(SHIELD_LIMIT);
    expect(result.names).toBe(400);
    // The strongest holdings carry the arms.
    expect(result.marks.slice(0, SHIELD_LIMIT).every((mark) => mark.shield)).toBe(true);
  });

  it('gives no button to a holding in the margin past the screen edge', () => {
    const world = makeWorld();
    world.head = columns(capitals(400));
    world.counts.capital = 400;
    const store = new SettlerStore(world, () => world.asOf);
    const geo = geographyOf(world);
    const view = { width: 900, height: 500 };
    // The camera that fits the map to a screen twice as wide: this one sees only its middle.
    const camera = stillView(geo.bounds, { width: 1800, height: 1000 }).camera;
    const near = camera.visibleBox(view, 160);
    const seen = camera.visibleBox(view, 0);
    // Well past the edge: further out than a capital's stamp reaches back in (100 px of the 160 px margin).
    const slack = 100 / camera.scale;
    const inMargin = world.head.ids.filter((id) => {
      const at = store.byId.get(id)!;
      const inNear = at.x >= near.minX && at.x <= near.maxX && at.y >= near.minY && at.y <= near.maxY;
      const inSeen = at.x >= seen.minX - slack && at.x <= seen.maxX + slack && at.y >= seen.minY - slack && at.y <= seen.maxY + slack;
      return inNear && !inSeen;
    });
    expect(inMargin.length).toBeGreaterThan(0);
    const result = layoutStill({ world, geo, store, camera, view, stamps, measure, selected: null });
    expect(result.marks.length).toBeGreaterThan(0);
    for (const mark of result.marks) {
      expect(mark.box.x < view.width && mark.box.y < view.height && mark.box.x + mark.box.w > 0 && mark.box.y + mark.box.h > 0).toBe(true);
    }
    expect(result.marks.some((mark) => inMargin.includes(mark.id))).toBe(false);
  });

  it('draws the selection first, even where it would otherwise give way', () => {
    const env = setup();
    const city = env.store.byId.get(HEAD_ROWS[2]!.id)!;
    const result = layout(env, LAPTOP, city);
    expect(result.marks[0]!.settler).toBe(city);
    expect(result.marks[0]!.name).not.toBeNull();
  });

  it('marks only capitals at the whole-world view of a real-sized survey, as the map does', () => {
    const world = makeWorld();
    const k = world.coordScale;
    world.bounds = { minX: REAL_BOUNDS.minX * k, minY: REAL_BOUNDS.minY * k, maxX: REAL_BOUNDS.maxX * k, maxY: REAL_BOUNDS.maxY * k };
    const result = layout(setup(world));
    expect(result.tiers).toBe(1);
    expect(result.marks.map((mark) => mark.settler.tierRank)).toEqual([0]);
  });
});

describe('washStains', () => {
  function live(classes: Record<string, number>, frame = true): LiveSource {
    return {
      frame: frame ? { asOf: 0 } : null,
      liveClass: (settler) => (settler.withheld ? 0 : classes[settler.id] ?? 0),
      startedAt: () => null,
      bloom: () => 1,
      dabs: [],
      dryingWashes: () => [],
      dryingDabWashes: () => [],
    };
  }

  it('lays one density stain per live holding from afar, biggest class first, multiplied at the density cap', () => {
    const world = makeWorld();
    const k = world.coordScale;
    world.bounds = { minX: REAL_BOUNDS.minX * k, minY: REAL_BOUNDS.minY * k, maxX: REAL_BOUNDS.maxX * k, maxY: REAL_BOUNDS.maxY * k };
    const env = setup(world);
    const v = stillView(env.geo.bounds, LAPTOP);
    const { stains, opacity } = washStains(env.store, live({ [HEAD_ROWS[1]!.id]: 3, [HEAD_ROWS[0]!.id]: 1 }), v.camera, LAPTOP, 0);
    expect(v.scale).toBeLessThan(DISTANCE_SCALE.continent);
    expect(stains.map((stain) => stain.variant)).toEqual([-1, -1]);
    expect(stains[0]!.size).toBeGreaterThan(stains[1]!.size);
    expect(opacity).toBe(DENSITY_CAP);
    for (const stain of stains) expect(stain.alpha).toBeLessThanOrEqual(1);
  });

  it('paints nothing for offline or withheld holdings, or without a frame', () => {
    const env = setup(makeWorld(), true, [HEAD_ROWS[0]!.id]);
    const v = stillView(env.geo.bounds, LAPTOP);
    expect(washStains(env.store, live({ [HEAD_ROWS[0]!.id]: 1 }), v.camera, LAPTOP, 0).stains).toEqual([]);
    expect(washStains(env.store, live({ [HEAD_ROWS[1]!.id]: 2 }, false), v.camera, LAPTOP, 0).stains).toEqual([]);
  });
});

describe('stillRibbon', () => {
  const asOf = Date.UTC(2026, 9, 30, 4, 2);
  const now = Date.UTC(2026, 9, 30, 10, 7);

  it('says what the still is, when it was observed and drawn, and why it does not move', () => {
    const text = stillRibbon({ asOf, drawnAt: now, liveAsOf: null, now, landMissing: false });
    expect(text.facts).toEqual([`observed to ${formatMoment(asOf)}`, 'drawn 10:07 UTC']);
    expect(text.live).toBeNull();
    expect(text.why).toMatch(/WebGL is off/);
  });

  it('adds the live frame’s own time, and owns up to land it could not ink', () => {
    const text = stillRibbon({ asOf, drawnAt: now, liveAsOf: now - 120_000, now, landMissing: true });
    expect(text.live).toBe('Live as of 10:05 UTC');
    expect(text.why).toMatch(/bare paper/);
  });
});
