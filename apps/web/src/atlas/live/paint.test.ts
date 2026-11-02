// @vitest-environment node
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  ATLAS_SPECTACLE, AtlasManifestSchema, createAtlasAlignment, encodeDabsV1, encodeLiveV2,
  type AtlasAlignment, type AtlasDab, type AtlasLiveSlot, type AtlasManifest, type KingdomId,
} from '@chatdom/shared';
import { BASE, CHUNK_ROWS, FakeService, LATER_HAMLET, makeChunk, makeEdition, makeNames, makeWorld, publish, sha } from '../data/fixtures.test-support';
import { decodeRings, SettlerStore } from '../data/model';
import { PREVIEW_LABEL, TIER_CODES, type PreviewWorld } from '../data/preview';
import { LiveFeed, type LiveFrame } from './feed';
import { BLOOM_MS, chooseSpectacle, DRY_MS, LivePaint, pencilBase, SPECTACLE_PRIORITY } from './paint';
import { HAMLET_RADIUS, HOLDING_GAP, LandIndex, LATTICE, type RealmCircle } from './pencil';

const T = 1_793_325_387_307;
const MIN = 60_000;
const hashOf = (id: string) => createHash('sha256').update(id).digest('hex').slice(0, 16);

/**
 * The fixture land with square coasts: the English continent is the square (−50,−30)…(50,30) holding four realms,
 * the German isle the square (60,0)…(100,40) holding one; the Outer Isles realm has no land at all. Seven holdings:
 * three in the head (ordinals 0–2), two per land region (3–4 English, 5–6 German).
 */
function squareWorld(): PreviewWorld {
  const world = makeWorld();
  world.coasts = [
    { region: 0, points: [-1000, -600, 2000, 0, 0, 1200, -2000, 0] },
    { region: 1, points: [1200, 0, 800, 0, 0, 800, -800, 0] },
  ];
  publish(world); // pins chunk record counts, which number the ordinals
  return world;
}

interface Setup {
  world: PreviewWorld;
  store: SettlerStore;
  paint: LivePaint;
  clock: { now: number; reduce: boolean; held: number | null };
}

function setup(opts: { chunks?: boolean; world?: PreviewWorld } = {}): Setup {
  const world = opts.world ?? squareWorld();
  const clock = { now: T, reduce: false, held: null as number | null };
  const store = new SettlerStore(world, () => clock.now);
  if (opts.chunks !== false) for (const region of world.regions) store.addChunk(makeChunk(world, region.index));
  const paint = new LivePaint(world, store, decodeRings(world), () => clock.now, () => clock.reduce, () => clock.held);
  return { world, store, paint, clock };
}

let frameSerial = 0;
function frameOf(store: SettlerStore, spec: { asOf?: number; live?: Record<number, number>; spectacle?: Record<number, number>; starts?: Record<number, number | null>; dabs?: AtlasDab[] }): LiveFrame {
  const asOf = spec.asOf ?? T;
  const slots = new Uint8Array(store.total * 2);
  const starts = new Map<number, number | null>();
  for (const [ordinal, liveClass] of Object.entries(spec.live ?? {})) {
    slots[Number(ordinal) * 2] = liveClass;
    starts.set(Number(ordinal), spec.starts && ordinal in spec.starts ? spec.starts[Number(ordinal)]! : asOf - 20 * MIN);
  }
  for (const [ordinal, spectacle] of Object.entries(spec.spectacle ?? {})) slots[Number(ordinal) * 2 + 1] = spectacle;
  return { asOf, publishedAt: asOf, slots, starts, dabs: spec.dabs ?? [], path: `/frame-${++frameSerial}/live.bin` };
}

const circlesOf = (world: PreviewWorld): RealmCircle[] =>
  world.realms.map((realm) => ({ index: realm.index, region: realm.region, x: realm.x / world.coordScale, y: realm.y / world.coordScale, r: realm.r / world.coordScale }));

const dabsIn = (realmIndex: number, count: number, startedAt = T - 30 * MIN, seed = 'channel'): AtlasDab[] =>
  Array.from({ length: count }, (_, n) => ({ realmIndex, channelHash: hashOf(`${seed}-${realmIndex}-${n}`), startedAt }));

describe('LivePaint.liveClass', () => {
  it('reads each holding’s class from the slots by ordinal, never from the spectacle byte', () => {
    const { store, paint } = setup();
    paint.apply(frameOf(store, { live: { 0: 1, 4: 3, 6: 5 }, spectacle: { 0: ATLAS_SPECTACLE.crowning, 2: ATLAS_SPECTACLE.dragon } }));
    const classes = Array.from({ length: store.total }, (_, ordinal) => paint.liveClass(store.byOrdinal(ordinal)!));
    expect(classes).toEqual([1, 0, 0, 0, 3, 0, 5]);
    expect(paint.liveCount).toBe(3);
    expect(store.byOrdinal(4)!.id).toBe(CHUNK_ROWS[0]![1]!.id);
  });

  it('paints a withheld holding as bare land, whatever the frame says', () => {
    const { world, store, paint } = setup();
    paint.apply(frameOf(store, { live: { 0: 1, 4: 3 } }));
    store.applyNames(makeNames(world, { withheld: [store.byOrdinal(4)!.id] }));
    expect(paint.liveClass(store.byOrdinal(4)!)).toBe(0);
    expect(paint.classAt(4)).toBe(3);
    expect(paint.liveClass(store.byOrdinal(0)!)).toBe(1);
  });

  it('is 0 for everyone before the first frame', () => {
    const { store, paint } = setup();
    expect(store.all.every((settler) => paint.liveClass(settler) === 0)).toBe(true);
    expect(paint.frame).toBeNull();
  });
});

describe('LivePaint.bloom', () => {
  it('shows an unknown start full and never invents one', () => {
    const { paint } = setup();
    expect(paint.bloom(null)).toBe(1);
  });

  it('eases in over fifteen minutes from the real start', () => {
    const { paint, clock } = setup();
    expect(paint.bloom(clock.now)).toBeCloseTo(0, 12);
    expect(paint.bloom(clock.now - BLOOM_MS / 2)).toBeCloseTo(1 - 0.5 ** 3, 12);
    expect(paint.bloom(clock.now - 15 * MIN)).toBe(1);
    expect(paint.bloom(clock.now - 3 * 3_600_000)).toBe(1);
    // A start a little ahead of the clock is clamped, not negative.
    expect(paint.bloom(clock.now + MIN)).toBe(0);
  });

  it('is full under reduced motion', () => {
    const { paint, clock } = setup();
    clock.reduce = true;
    expect(paint.bloom(clock.now)).toBe(1);
    expect(paint.bloom(clock.now - MIN)).toBe(1);
  });

  it('stops at the held observation time: nothing blooms past it', () => {
    const { paint, clock } = setup();
    const start = clock.now - 15 * MIN;
    clock.held = start + BLOOM_MS / 2;
    expect(paint.bloom(start)).toBeCloseTo(1 - 0.5 ** 3, 12);
    expect(paint.bloom(start, clock.now + 3_600_000)).toBeCloseTo(1 - 0.5 ** 3, 12);
    clock.held = null;
    expect(paint.bloom(start)).toBe(1);
  });
});

describe('LivePaint drying', () => {
  it('dries a holding that left the air over DRY_MS from the frame that showed it', () => {
    const { store, paint, clock } = setup();
    paint.apply(frameOf(store, { live: { 0: 1, 5: 4 } }));
    clock.now += 3 * MIN;
    const at = clock.now;
    paint.apply(frameOf(store, { asOf: T + 3 * MIN, live: { 5: 4 } }));
    const settler = store.byOrdinal(0)!;
    expect([...paint.dryingWashes(at)]).toEqual([{ ordinal: 0, liveClass: 1, x: settler.x, y: settler.y, left: 1 }]);
    const lefts = [0.25, 0.5, 0.75].map((share) => [...paint.dryingWashes(at + DRY_MS * share)][0]!.left);
    expect(lefts[0]).toBeCloseTo(0.75, 12);
    expect(lefts[1]).toBeCloseTo(0.5, 12);
    expect(lefts[2]).toBeCloseTo(0.25, 12);
    expect([...paint.dryingWashes(at + DRY_MS)]).toEqual([]);
    // Once dried it is gone for good.
    expect([...paint.dryingWashes(at)]).toEqual([]);
    expect(paint.liveClass(settler)).toBe(0);
  });

  it('stops drying a holding that comes back on air', () => {
    const { store, paint, clock } = setup();
    paint.apply(frameOf(store, { live: { 3: 3 } }));
    clock.now += 3 * MIN;
    paint.apply(frameOf(store, { asOf: T + 3 * MIN }));
    expect([...paint.dryingWashes()]).toHaveLength(1);
    clock.now += 3 * MIN;
    paint.apply(frameOf(store, { asOf: T + 6 * MIN, live: { 3: 3 } }));
    expect([...paint.dryingWashes()]).toEqual([]);
  });

  it('dries a dab that left the air', () => {
    const { store, paint, clock } = setup();
    const [kept, gone] = dabsIn(1, 2);
    paint.apply(frameOf(store, { dabs: [kept!, gone!] }));
    clock.now += 3 * MIN;
    paint.apply(frameOf(store, { asOf: T + 3 * MIN, dabs: [kept!] }));
    const drying = [...paint.dryingDabWashes(clock.now + DRY_MS / 2)];
    expect(drying.map(({ dab }) => dab.hash)).toEqual([gone!.channelHash]);
    expect(drying[0]!.left).toBeCloseTo(0.5, 12);
    expect([...paint.dryingDabWashes(clock.now + DRY_MS)]).toEqual([]);
  });

  it('never dries a withheld holding back into view when the re-gated frame drops it', () => {
    const { world, store, paint, clock } = setup();
    paint.apply(frameOf(store, { live: { 0: 1, 4: 3 } }));
    store.applyNames(makeNames(world, { withheld: [store.byOrdinal(4)!.id] }));
    // The producer takes it off the same sweep, published later.
    clock.now += MIN;
    paint.apply({ ...frameOf(store, { live: { 0: 1 } }), publishedAt: T + MIN });
    expect([...paint.dryingWashes()]).toEqual([]);
    expect(paint.liveClass(store.byOrdinal(4)!)).toBe(0);
  });

  it('stops drying a holding the moment it is withheld', () => {
    const { world, store, paint, clock } = setup();
    paint.apply(frameOf(store, { live: { 4: 3 } }));
    clock.now += 3 * MIN;
    paint.apply(frameOf(store, { asOf: T + 3 * MIN }));
    expect([...paint.dryingWashes()].map((dry) => dry.ordinal)).toEqual([4]);
    store.applyNames(makeNames(world, { withheld: [store.byOrdinal(4)!.id] }));
    expect([...paint.dryingWashes()]).toEqual([]);
    expect(paint.nextChange()).toBe(Infinity);
  });

  it('paints a dab that comes back on air while drying once, as live', () => {
    const { store, paint, clock } = setup();
    const [dab] = dabsIn(1, 1);
    paint.apply(frameOf(store, { dabs: [dab!] }));
    clock.now += 3 * MIN;
    paint.apply(frameOf(store, { asOf: T + 3 * MIN }));
    expect([...paint.dryingDabWashes()]).toHaveLength(1);
    clock.now += 10_000;
    paint.apply(frameOf(store, { asOf: T + 6 * MIN, dabs: [dab!] }));
    expect([...paint.dryingDabWashes()]).toEqual([]);
    expect(paint.dabs.map((next) => next.hash)).toEqual([dab!.channelHash]);
  });

  it('removes washes at once under reduced motion', () => {
    const { store, paint, clock } = setup();
    paint.apply(frameOf(store, { live: { 0: 1 }, dabs: dabsIn(1, 1) }));
    clock.reduce = true;
    clock.now += 3 * MIN;
    paint.apply(frameOf(store, { asOf: T + 3 * MIN }));
    expect([...paint.dryingWashes()]).toEqual([]);
    expect([...paint.dryingDabWashes()]).toEqual([]);
    expect(paint.liveClass(store.byOrdinal(0)!)).toBe(0);
  });

  it('dries nothing on the very first frame', () => {
    const { store, paint } = setup();
    paint.apply(frameOf(store, { live: { 0: 1, 1: 2 }, dabs: dabsIn(1, 3) }));
    expect([...paint.dryingWashes()]).toEqual([]);
    expect([...paint.dryingDabWashes()]).toEqual([]);
  });
});

describe('LivePaint.nextChange', () => {
  it('is Infinity with no frame', () => {
    const { paint } = setup();
    expect(paint.nextChange()).toBe(Infinity);
  });

  it('repaints every 4 s while a wash or dab is still blooming, and stops once all have bloomed', () => {
    const { store, paint, clock } = setup();
    paint.apply(frameOf(store, { live: { 0: 1 }, starts: { 0: T - MIN } }));
    expect(paint.nextChange()).toBe(4_000);
    expect(paint.nextChange(T - MIN + BLOOM_MS)).toBe(Infinity);
    clock.now += MIN;
    paint.apply(frameOf(store, { asOf: T + MIN, live: { 0: 1 }, starts: { 0: T - 30 * MIN }, dabs: dabsIn(1, 1, T - 2 * MIN) }));
    expect(paint.nextChange()).toBe(4_000);
    clock.now += MIN;
    paint.apply(frameOf(store, { asOf: T + 2 * MIN, live: { 0: 1 }, starts: { 0: null }, dabs: dabsIn(1, 1, T - 30 * MIN) }));
    expect(paint.nextChange()).toBe(Infinity);
  });

  it('is Infinity while held or under reduced motion, even mid-bloom', () => {
    const { store, paint, clock } = setup();
    paint.apply(frameOf(store, { live: { 0: 1 }, starts: { 0: T - MIN } }));
    clock.held = T;
    expect(paint.nextChange()).toBe(Infinity);
    clock.held = null;
    clock.reduce = true;
    expect(paint.nextChange()).toBe(Infinity);
  });

  it('repaints every 120 ms while anything is drying, until it has dried', () => {
    const { store, paint, clock } = setup();
    paint.apply(frameOf(store, { live: { 0: 1 } }));
    clock.now += 3 * MIN;
    clock.held = T + 3 * MIN;
    paint.apply(frameOf(store, { asOf: T + 3 * MIN }));
    expect(paint.nextChange()).toBe(120);
    // Walking the drying washes past DRY_MS retires them.
    expect([...paint.dryingWashes(clock.now + DRY_MS)]).toEqual([]);
    expect(paint.nextChange()).toBe(Infinity);
  });
});

describe('chooseSpectacle', () => {
  const S = ATLAS_SPECTACLE;

  it('ranks crowning > dragon > Hype Train fireworks > Hype Train > festival > raid party', () => {
    expect(SPECTACLE_PRIORITY).toEqual([S.crowning, S.dragon, S.hypeTrainFireworks, S.hypeTrain, S.festival, S.raidParty]);
    const order = [S.raidParty, S.festival, S.hypeTrain, S.hypeTrainFireworks, S.dragon, S.crowning];
    const candidates = order.map((spectacle, i) => ({ ordinal: i, founded: true, spectacle }));
    for (let n = candidates.length; n > 0; n--) {
      const best = candidates.slice(0, n);
      expect(chooseSpectacle(best)).toEqual({ ordinal: n - 1, spectacle: order[n - 1] });
      expect(chooseSpectacle([...best].reverse())).toEqual({ ordinal: n - 1, spectacle: order[n - 1] });
    }
  });

  it('ignores holdings that are not founded and the none code', () => {
    expect(chooseSpectacle([
      { ordinal: 1, founded: false, spectacle: S.crowning },
      { ordinal: 2, founded: true, spectacle: S.none },
      { ordinal: 3, founded: true, spectacle: S.raidParty },
    ])).toEqual({ ordinal: 3, spectacle: S.raidParty });
  });

  it('ignores codes outside the dictionary', () => {
    expect(chooseSpectacle([{ ordinal: 1, founded: true, spectacle: 7 }, { ordinal: 2, founded: true, spectacle: 255 }])).toBeNull();
  });

  it('breaks ties by the lower ordinal, in any order', () => {
    const tied = [
      { ordinal: 40, founded: true, spectacle: S.dragon },
      { ordinal: 7, founded: true, spectacle: S.dragon },
      { ordinal: 12, founded: true, spectacle: S.dragon },
    ];
    expect(chooseSpectacle(tied)).toEqual({ ordinal: 7, spectacle: S.dragon });
    expect(chooseSpectacle([...tied].reverse())).toEqual({ ordinal: 7, spectacle: S.dragon });
  });

  it('is null when nothing qualifies', () => {
    expect(chooseSpectacle([])).toBeNull();
    expect(chooseSpectacle([{ ordinal: 0, founded: false, spectacle: S.dragon }, { ordinal: 1, founded: true, spectacle: S.none }])).toBeNull();
  });
});

describe('pencil places in an edition', () => {
  /** The square land as one night of Edition I, its chunk of region 0 holding `extra` after its own rows. */
  function editionSetup(extra: { x: number; y: number; founding: boolean } | null) {
    const world = makeEdition();
    world.coasts = squareWorld().coasts;
    publish(world);
    const store = new SettlerStore(world, () => T);
    for (const region of world.regions) {
      const chunk = makeChunk(world, region.index);
      if (region.index === 0 && extra) {
        const s = chunk.settlers;
        const at = extra.founding ? s.founded! : s.ids.length;
        const insert = <K extends 'ids' | 'tier' | 'x' | 'y' | 'average' | 'game' | 'region' | 'realm'>(key: K, value: (typeof s)[K][number]) =>
          (s[key] as (typeof s)[K][number][]).splice(at, 0, value);
        insert('ids', '923456789'); insert('tier', 4); insert('x', Math.round(extra.x * 20)); insert('y', Math.round(extra.y * 20));
        insert('average', 7); insert('game', 0); insert('region', 0); insert('realm', 1);
        if (extra.founding) s.founded = s.founded! + 1;
      }
      store.addChunk(chunk);
    }
    const paint = new LivePaint(world, store, decodeRings(world), () => T);
    return { world, store, paint };
  }
  const place = ({ store, paint }: { store: SettlerStore; paint: LivePaint }, dabs: AtlasDab[]) => {
    paint.apply(frameOf(store, { dabs }));
    while (paint.work(1_000));
    return paint.dabs.map(({ hash, x, y, placed }) => ({ hash, x, y, placed }));
  };

  it('keeps clear of founding holdings only: a holding granted later never moves a dab', () => {
    const dabs = dabsIn(1, 12);
    const base = place(editionSetup(null), dabs);
    expect(base.every(dab => dab.placed)).toBe(true);
    // The later grant already in the fixture (LittleLantern) is not in the base either.
    const { store } = editionSetup(null);
    const radii = [6, 3.4, 1.8, 1.25, 0.5];
    expect(pencilBase(store.all, 0, radii).some(h => h.x === LATER_HAMLET.x / 20 && h.y === LATER_HAMLET.y / 20)).toBe(false);
    // A hamlet granted on a later night, right on the first dab's place: every dab stays where it was.
    const target = base[0]!;
    expect(place(editionSetup({ x: target.x, y: target.y, founding: false }), dabs)).toEqual(base);
    // Had the same hamlet been founded with the edition, that place would have been taken.
    const founded = place(editionSetup({ x: target.x, y: target.y, founding: true }), dabs);
    expect(founded[0]).not.toEqual(target);
  });

  it('keeps a survey preview’s base whole: every holding of the region, withheld ones included', () => {
    const world = squareWorld();
    const { store } = setup({ world });
    store.applyNames(makeNames(world, { withheld: [CHUNK_ROWS[0]![0]!.id] }));
    const radii = [6, 3.4, 1.8, 1.25, 0.5];
    expect(pencilBase(store.all, 0, radii)).toHaveLength(store.all.filter(settler => settler.region === 0).length);
    expect(pencilBase(store.all, 0, radii).map(h => h.r).sort()).toEqual(store.all.filter(s => s.region === 0).map(s => radii[s.tierRank]!).sort());
  });
});

describe('LivePaint dab placement', () => {
  const realmDabs = () => [...dabsIn(1, 40), ...dabsIn(4, 12), ...dabsIn(5, 2)];
  const placeAll = (paint: LivePaint) => {
    let rounds = 0;
    while (paint.work(1_000) && rounds < 100) rounds++;
    expect(paint.work(1_000)).toBe(false);
  };

  function expectWellPlaced(world: PreviewWorld, store: SettlerStore, paint: LivePaint): void {
    const land = new LandIndex(decodeRings(world), circlesOf(world));
    const radii = world.tiers.holdingRadius;
    const r = [radii.capital, radii.city, radii.town, radii.village];
    const clearance = HAMLET_RADIUS + LATTICE.shore;
    for (const dab of paint.dabs.filter((d) => d.placed)) {
      expect(land.realmAt(dab.x, dab.y)).toBe(dab.realm);
      expect(land.distanceToCoast(dab.x, dab.y, clearance)).toBeGreaterThanOrEqual(clearance);
      for (const settler of store.all) {
        const min = HAMLET_RADIUS + r[settler.tierRank]! + HOLDING_GAP - 1e-9;
        expect(Math.hypot(settler.x - dab.x, settler.y - dab.y)).toBeGreaterThanOrEqual(min);
      }
    }
  }

  it('places every dab on free land of its own realm', () => {
    const { world, store, paint } = setup();
    paint.apply(frameOf(store, { dabs: realmDabs() }));
    expect(paint.dabs).toHaveLength(54);
    expect(paint.dabs.every((dab) => !dab.placed)).toBe(true);
    const version = paint.version;
    placeAll(paint);
    expect(paint.version).toBeGreaterThan(version);
    const placed = paint.dabs.filter((dab) => dab.placed);
    expect(placed.filter((dab) => dab.realm === 1)).toHaveLength(40);
    expect(placed.filter((dab) => dab.realm === 4)).toHaveLength(12);
    expect(paint.dabs.every((dab) => dab.region === world.realms[dab.realm]!.region)).toBe(true);
    expectWellPlaced(world, store, paint);
  });

  it('leaves dabs of a realm without land unplaced', () => {
    const { store, paint } = setup();
    paint.apply(frameOf(store, { dabs: realmDabs() }));
    placeAll(paint);
    const outer = paint.dabs.filter((dab) => dab.realm === 5);
    expect(outer).toHaveLength(2);
    expect(outer.every((dab) => !dab.placed)).toBe(true);
  });

  it('is deterministic across two runs', () => {
    const runs = [setup(), setup()].map(({ store, paint }) => {
      paint.apply(frameOf(store, { dabs: realmDabs() }));
      placeAll(paint);
      return paint.dabs.map((dab) => [dab.hash, dab.x, dab.y, dab.placed]);
    });
    expect(runs[0]).toEqual(runs[1]);
  });

  it('keeps a known dab’s place across frames instead of hopping back to its raw target', () => {
    const { store, paint, clock } = setup();
    const dabs = dabsIn(1, 5);
    paint.apply(frameOf(store, { dabs }));
    placeAll(paint);
    const before = paint.dabs.map((dab) => ({ ...dab }));
    clock.now += 3 * MIN;
    paint.apply(frameOf(store, { asOf: T + 3 * MIN, dabs }));
    expect(paint.dabs.map(({ hash, x, y, placed }) => ({ hash, x, y, placed })))
      .toEqual(before.map(({ hash, x, y, placed }) => ({ hash, x, y, placed })));
  });

  it('waits for a region’s complete holdings, then agrees with a browser that loaded them before its frame', () => {
    const world = squareWorld();
    const { store, paint } = setup({ world, chunks: false });
    const dabs = dabsIn(1, 40);
    paint.apply(frameOf(store, { dabs }));
    placeAll(paint);
    expect(paint.dabs.every(dab => !dab.placed)).toBe(true);
    store.addChunk(makeChunk(world, 0));
    // A region that was never placed is not queued.
    const version = paint.version;
    paint.regionLoaded(3);
    expect(paint.work(1_000)).toBe(false);
    expect(paint.version).toBe(version);
    paint.regionLoaded(0);
    expect(paint.work(1_000)).toBe(false);
    expect(paint.version).toBe(version + 1);
    expect(paint.dabs.every(dab => dab.placed)).toBe(true);
    expectWellPlaced(world, store, paint);
    const complete = setup({ world });
    complete.paint.apply(frameOf(complete.store, { dabs }));
    placeAll(complete.paint);
    expect(paint.dabs).toEqual(complete.paint.dabs);
    // A duplicate load notification cannot rebuild a frozen occupancy or move its dabs.
    const placedVersion = paint.version;
    paint.regionLoaded(0);
    expect(paint.work(1_000)).toBe(false);
    expect(paint.version).toBe(placedVersion);
  });

  it('cannot move an existing channel when colliding dabs arrive, reorder, leave or restart', () => {
    const { store, paint } = setup();
    const kept = { realmIndex: 1, channelHash: '0000000000000001', startedAt: T };
    const added = { realmIndex: 1, channelHash: '0000000000000000', startedAt: T };
    paint.apply(frameOf(store, { dabs: [kept] }));
    placeAll(paint);
    const expected = { ...paint.dabs[0]! };
    expect(expected.placed).toBe(true);
    for (const dabs of [[added, kept], [kept, added], [kept]]) {
      paint.apply(frameOf(store, { dabs }));
      placeAll(paint);
      expect(paint.dabs.find(dab => dab.hash === kept.channelHash)).toEqual(expected);
    }
    const restarted = setup();
    restarted.paint.apply(frameOf(restarted.store, { dabs: [added, kept] }));
    placeAll(restarted.paint);
    expect(restarted.paint.dabs.find(dab => dab.hash === kept.channelHash)).toEqual(expected);
    expect(restarted.paint.dabs[0]!.x).toBe(expected.x);
    expect(restarted.paint.dabs[0]!.y).toBe(expected.y);
  });

  it('finishes a crowded region over several budgets in exactly the order of one unlimited pass', () => {
    const whole = setup();
    whole.paint.apply(frameOf(whole.store, { dabs: dabsIn(1, 12) }));
    expect(whole.paint.work(1_000)).toBe(false);
    const sliced = setup();
    sliced.paint.apply(frameOf(sliced.store, { dabs: dabsIn(1, 12) }));
    // Every clock read advances a millisecond, so each 1.5 ms budget runs out after one dab inside the region.
    let t = 0;
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => (t += 1));
    let calls = 0;
    try {
      while (sliced.paint.work(1.5) && calls < 100) calls++;
    } finally {
      clock.mockRestore();
    }
    expect(calls).toBeGreaterThanOrEqual(11);
    expect(sliced.paint.dabs.map((dab) => [dab.hash, dab.placed, dab.x, dab.y])).toEqual(whole.paint.dabs.map((dab) => [dab.hash, dab.placed, dab.x, dab.y]));
    expect(sliced.paint.dabs.filter((dab) => dab.placed).length).toBeGreaterThan(0);
  });

  it('places the regions in view first', () => {
    const { store, paint } = setup();
    paint.apply(frameOf(store, { dabs: [...dabsIn(1, 3), ...dabsIn(4, 3)] }));
    // A zero budget places nothing but keeps the work queued.
    expect(paint.work(0, new Set([1]))).toBe(true);
    expect(paint.dabs.some((dab) => dab.placed)).toBe(false);
    // With the island in view, its region goes first.
    const queue = (paint as unknown as { queue: number[] }).queue;
    paint.work(0, new Set([1]));
    expect(queue[0]).toBe(1);
  });
});

describe('LiveFeed and LivePaint together', () => {
  async function liveLand() {
    const world = squareWorld();
    const worldSha256 = sha(JSON.stringify(world));
    const ids = [...world.head.ids, ...world.regions.flatMap((region) => makeChunk(world, region.index).settlers.ids)];
    const alignment = await createAtlasAlignment(
      { version: 1, id: world.id, label: PREVIEW_LABEL, status: 'preview', foundedAt: world.asOf, worldHash: worldSha256, realmCount: world.realms.length },
      ids.map((id, ordinal) => ({
        ordinal, kingdomId: id as KingdomId, holdingId: `${world.id}:${ordinal}`, realmIndex: 0, holdingTier: TIER_CODES[3], point: { x: 0, y: 0 }, settledAt: world.asOf,
      })),
    );
    const service = new FakeService();
    const { store, paint, clock } = setup({ world });
    let serial = 0;
    const publishFrame = (asOf: number, live: Record<number, number>, coverage: AtlasManifest['coverage'] = 'complete-sweep', starts: Record<number, number | null> = {}): AtlasManifest => {
      const slots: AtlasLiveSlot[] = ids.map((_, ordinal) => ({ liveClass: (live[ordinal] ?? 0) as AtlasLiveSlot['liveClass'], spectacle: 0 }));
      const liveBytes = encodeLiveV2(slots);
      const entries = Object.keys(live).map(Number).sort((a, b) => a - b).map((ordinal) => ({ ordinal, startedAt: ordinal in starts ? starts[ordinal]! : asOf - 20 * MIN }));
      const startBytes = new TextEncoder().encode(JSON.stringify({ version: 1, alignment, asOf, entries }));
      const dabBytes = encodeDabsV1([]);
      const dir = `/v1/live/${world.id}/frames/${++serial}`;
      const manifest = AtlasManifestSchema.parse({
        version: 1, alignment: alignment satisfies AtlasAlignment, evidence: { kind: 'observed', asOf }, publishedAt: asOf, realmCount: world.realms.length, coverage,
        live: { format: 'live-v2', path: `${dir}/live.bin`, sha256: sha(liveBytes), byteLength: liveBytes.byteLength },
        starts: { format: 'live-starts-v1', path: `${dir}/starts.json`, sha256: sha(startBytes), byteLength: startBytes.byteLength },
        dabs: { format: 'dabs-v1', path: `${dir}/dabs.bin`, count: 0, sha256: sha(dabBytes), byteLength: 0 },
      });
      service.serve(`${BASE}${manifest.live.path}`, liveBytes).serve(`${BASE}${manifest.starts.path}`, startBytes).serve(`${BASE}${manifest.dabs.path}`, dabBytes);
      service.serve(`${BASE}/v1/live/${world.id}`, JSON.stringify({
        version: 1, kind: 'chatdom-atlas-live-pointer', preview: world.id,
        source: { state: coverage === 'complete-sweep' ? 'complete' : 'partial', checkedAt: asOf, sweepAt: asOf, completeAt: coverage === 'complete-sweep' ? asOf : null, gapBefore: false },
        manifest,
      }));
      return manifest;
    };
    // Wired the way the Atlas wires them: a frame is painted only when it is a new one.
    const feed = new LiveFeed(service.source, world, worldSha256, (frame, status) => {
      clock.held = frame && status.freshness !== 'fresh' ? frame.asOf : null;
      if (frame && frame !== paint.frame) paint.apply(frame);
    }, { now: () => clock.now, openStream: null, setTimer: () => 0, clearTimer: () => undefined });
    return { store, paint, clock, feed, publishFrame, service, pointerUrl: `${BASE}/v1/live/${world.id}` };
  }

  it('a refused partial sweep never reaches the paint: a live holding stays live, neither dried nor bloomed afresh', async () => {
    const { store, paint, clock, feed, publishFrame } = await liveLand();
    const capital = store.byOrdinal(0)!;
    publishFrame(T, { 0: 1, 5: 4 }, 'complete-sweep', { 0: T - 40 * MIN });
    clock.now = T + MIN;
    await feed.reconcile();
    expect(paint.liveClass(capital)).toBe(1);
    expect(paint.bloom(paint.startedAt(capital))).toBe(1);
    const shown = paint.frame;
    const version = paint.version;

    // The next sweep was cut short and saw nobody.
    publishFrame(T + 3 * MIN, {}, 'partial');
    clock.now = T + 4 * MIN;
    await feed.reconcile();
    expect(feed.status().refused).toBe('partial');
    expect(paint.frame).toBe(shown);
    expect(paint.version).toBe(version);
    expect(paint.liveClass(capital)).toBe(1);
    expect(paint.liveCount).toBe(2);
    expect(paint.startedAt(capital)).toBe(T - 40 * MIN);
    expect(paint.bloom(paint.startedAt(capital))).toBe(1);
    expect([...paint.dryingWashes()]).toEqual([]);

    // A complete sweep that really shows it offline does dry it.
    publishFrame(T + 6 * MIN, { 5: 4 });
    clock.now = T + 7 * MIN;
    await feed.reconcile();
    expect(paint.liveClass(capital)).toBe(0);
    expect([...paint.dryingWashes()].map((dry) => dry.ordinal)).toEqual([0]);
  });

  it('holds the bloom at the frame’s time once the frame goes stale', async () => {
    const { store, paint, clock, feed, publishFrame, service, pointerUrl } = await liveLand();
    publishFrame(T, { 0: 1 }, 'complete-sweep', { 0: T - 2 * MIN });
    clock.now = T + MIN;
    await feed.reconcile();
    const capital = store.byOrdinal(0)!;
    const atAsOf = paint.bloom(paint.startedAt(capital), T);
    // The surveyors go quiet; a failed read re-judges freshness without a new frame.
    service.routes.delete(pointerUrl);
    clock.now = T + 20 * MIN;
    await feed.reconcile();
    expect(feed.status().freshness).toBe('stale');
    expect(clock.held).toBe(T);
    expect(paint.bloom(paint.startedAt(capital))).toBeCloseTo(atAsOf, 12);
    expect(atAsOf).toBeLessThan(1);
  });
});
