// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { columns, decorCode, FOUNDING_HAMLET, LATER_HAMLET, makeChunk, makeEdition, makeNames, makeWorld } from './fixtures.test-support';
import { decodeDecor, decodeRings, geographyOf, SettlerStore, tierOf, type Settler } from './model';
import { DECOR_KINDS, TIER_CODES, type PreviewWorld } from './preview';

describe('decodeRings', () => {
  it('accumulates deltas from an absolute first point and divides by coordScale', () => {
    const [square, triangle] = decodeRings(makeWorld());
    expect(Array.from(square!.points)).toEqual([-50, -30, 50, -30, 50, 30, -50, 30]);
    expect(square).toMatchObject({ region: 0, minX: -50, minY: -30, maxX: 50, maxY: 30 });
    expect(Array.from(triangle!.points)).toEqual([70, 10, 90, 10, 80, 30]);
    expect(triangle).toMatchObject({ region: 1, minX: 70, minY: 10, maxX: 90, maxY: 30 });
  });

  it('starts every ring from zero (no carry-over between rings)', () => {
    const world = makeWorld();
    world.coasts = [{ region: 0, points: [100, 100, 20, 0, 0, 20] }, { region: 0, points: [100, 100, 20, 0, 0, 20] }];
    const [a, b] = decodeRings(world);
    expect(Array.from(b!.points)).toEqual(Array.from(a!.points));
  });

  it('round-trips a long, wandering coast without drift', () => {
    const world = makeWorld();
    const absolute: number[] = [];
    for (let i = 0; i < 2000; i++) absolute.push(Math.round(Math.cos(i / 50) * 9000 + i), Math.round(Math.sin(i / 70) * 7000 - i));
    const deltas = absolute.map((value, i) => (i < 2 ? value : value - absolute[i - 2]!));
    world.coasts = [{ region: 0, points: deltas }];
    world.coordScale = 7;
    const [ring] = decodeRings(world);
    absolute.forEach((value, i) => expect(ring!.points[i]).toBe(value / 7));
    const xs = absolute.filter((_, i) => i % 2 === 0).map((v) => v / 7);
    const ys = absolute.filter((_, i) => i % 2 === 1).map((v) => v / 7);
    expect(ring).toMatchObject({ minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) });
  });
});

describe('decodeDecor', () => {
  it('unpacks kind, bands and variant from code = kind<<12 | bands<<7 | variant', () => {
    expect(decodeDecor(makeWorld())).toEqual([
      { kind: 'mountain', bands: 2, variant: 5, x: 5, y: -10 },
      { kind: 'ship', bands: 0, variant: 127, x: -95, y: 45 },
      { kind: 'forest', bands: 31, variant: 0, x: 82.5, y: 20.5 },
    ]);
  });

  it('keeps the three fields independent across their whole ranges', () => {
    const world = makeWorld();
    world.decor = [];
    const expected: { kind: string; bands: number; variant: number }[] = [];
    DECOR_KINDS.forEach((kind, k) => {
      for (const bands of [0, 1, 16, 30, 31]) {
        for (const variant of [0, 1, 64, 126, 127]) {
          world.decor.push(decorCode(k, bands, variant), k * 20, -bands * 20);
          expected.push({ kind, bands, variant });
        }
      }
    });
    const marks = decodeDecor(world);
    expect(marks.map(({ kind, bands, variant }) => ({ kind, bands, variant }))).toEqual(expected);
    expect(marks.every((mark, i) => mark.x === DECOR_KINDS.indexOf(mark.kind) && mark.y === -expected[i]!.bands)).toBe(true);
  });

  it('skips marks of a kind this client does not know', () => {
    const world = makeWorld();
    world.decor = [decorCode(6, 1, 1), 0, 0, decorCode(1, 3, 9), 40, 60, decorCode(15, 31, 127), 0, 0];
    expect(decodeDecor(world)).toEqual([{ kind: 'hill', bands: 3, variant: 9, x: 2, y: 3 }]);
  });
});

describe('geographyOf', () => {
  it('converts every geometric field to world units and names clusters by their game', () => {
    const geo = geographyOf(makeWorld());
    expect(geo.bounds).toEqual({ minX: -100, minY: -60, maxX: 120, maxY: 50 });
    expect(geo.regions[1]).toEqual({ index: 1, name: 'German', englishName: 'German', kind: 'isle', x: 80, y: 20, r: 15, members: 2 });
    expect(geo.regions[2]).toMatchObject({ name: 'The Outer Isles', kind: 'outer', members: 0 });
    expect(geo.clusters).toEqual([
      { region: 0, realm: 1, name: 'Just Chatting', x: 0, y: 0, r: 20, members: 3 },
      { region: 0, realm: 0, name: null, x: -30, y: 10, r: 10, members: 2 }, // a mixed patch of the Crossroads
      { region: 0, realm: 2, name: 'League of Legends', x: -35, y: -20, r: 9, members: 1 },
      { region: 1, realm: 4, name: null, x: 80, y: 20, r: 6, members: 2 }, // a game whose name is unknown
      { region: 2, realm: 5, name: null, x: 100, y: -40, r: 7.5, members: 0 }, // empty waiting land
    ]);
    expect(geo.isles).toEqual({ name: 'The Isles of Many Tongues', x: 80, y: 20, r: 25 });
    expect(geo.outer).toEqual({ name: 'The Outer Isles', x: 100, y: -40, r: 10 });
  });

  it('keeps each realm with its region, kind, family, name and circle in world units', () => {
    const geo = geographyOf(makeWorld());
    expect(geo.realms.map((realm) => `${realm.region}:${realm.kind}:${realm.name}`)).toEqual([
      '0:crossroads:The Crossroads', '0:family:Just Chatting & IRL', '0:family:Arenas & MOBAs', '0:wilds:The Wilds', '1:isle:German', '2:outer:The Outer Isles',
    ]);
    expect(geo.realms[2]).toEqual({ index: 2, region: 0, kind: 'family', family: 1, name: 'Arenas & MOBAs', x: -35, y: -20, r: 10, members: 1 });
  });

  it('keeps isles null when the preview has none', () => {
    const world = makeWorld();
    world.isles = null;
    expect(geographyOf(world).isles).toBeNull();
  });
});

const DAY = 86_400_000;

/** A store on a fixed clock, with the fixture's names applied as the service would serve them. */
function namedStore(world: PreviewWorld, clock = { now: world.asOf + 3_600_000 }, opts: Parameters<typeof makeNames>[1] = {}): SettlerStore {
  const store = new SettlerStore(world, () => clock.now);
  store.applyNames(makeNames(world, opts));
  return store;
}

describe('SettlerStore', () => {
  it('holds the capitals and cities of the head from the start, named once the names projection arrives', () => {
    const world = makeWorld();
    const bare = new SettlerStore(world, () => world.asOf);
    expect(bare.all.map((s) => s.id)).toEqual(['552120296', '207813352', '36926489']);
    expect(bare.all.every((s) => s.name === null && s.login === null && !s.withheld)).toBe(true);
    expect(bare.named).toBe(false);
    expect(bare.version).toBe(1);

    const store = namedStore(world);
    expect(store.named).toBe(true);
    expect(store.version).toBe(2);
    expect(store.all.map((s) => s.login)).toEqual(['zackrawrr', 'hasanabi', 'gronkh']);
    const zack = store.byLogin.get('zackrawrr')!;
    expect(zack).toEqual<Settler>({
      index: 0, id: '552120296', login: 'zackrawrr', name: 'zackrawrr', freshUntil: world.asOf + DAY, withheld: false,
      tier: 'capital', tierRank: 0, foundingHolding: true, x: 6, y: -6, average: 33_015, game: 'Just Chatting', region: 0, realm: 1, realmName: 'Just Chatting & IRL', ordinal: 0,
    });
    // An isle is one realm, named for its language.
    expect(store.byId.get('36926489')).toMatchObject({ name: 'GRONKH', tier: 'city', game: null, region: 1, realm: 4, realmName: 'German' });
    expect(store.hasRegion(0)).toBe(false);
  });

  it('adds a region chunk once, however often it arrives', () => {
    const world = makeWorld();
    const store = namedStore(world);
    store.addChunk(makeChunk(world, 0));
    expect(store.hasRegion(0)).toBe(true);
    expect(store.all).toHaveLength(5);
    expect(store.version).toBe(3);
    store.addChunk(makeChunk(world, 0));
    expect(store.all).toHaveLength(5);
    expect(store.version).toBe(3);
    expect(store.all.map((s) => s.index)).toEqual([0, 1, 2, 3, 4]);
    expect(store.byLogin.get('pumpkinpotion')).toMatchObject({ tier: 'village', tierRank: 3, game: 'League of Legends', x: -35.1, y: -18.05, realm: 2, realmName: 'Arenas & MOBAs' });
    expect(store.byLogin.get('mira004')).toMatchObject({ realm: 3, realmName: 'The Wilds' });
  });

  it('never holds the same channel twice', () => {
    const world = makeWorld();
    const store = namedStore(world);
    const chunk = makeChunk(world, 0);
    chunk.settlers.ids[0] = '552120296'; // a capital that also appears in its region chunk
    store.addChunk(chunk);
    expect(store.all.filter((s) => s.id === '552120296')).toHaveLength(1);
    expect(store.byId.get('552120296')!.tier).toBe('capital');
    expect(store.all).toHaveLength(4);
  });

  it('answers box queries inclusively and filters by tier', () => {
    const world = makeWorld();
    const store = namedStore(world);
    store.addChunk(makeChunk(world, 0));
    store.addChunk(makeChunk(world, 1));
    const logins = (list: Settler[]) => list.map((s) => s.login).sort();
    const everything = store.query(-100, -60, 120, 50, 3);
    expect(everything).toHaveLength(7);
    expect(logins(store.query(-100, -60, 120, 50, 0))).toEqual(['zackrawrr']);
    expect(logins(store.query(-100, -60, 120, 50, 1))).toEqual(['gronkh', 'hasanabi', 'zackrawrr']);
    expect(logins(store.query(-100, -60, 120, 50, 2))).toEqual(['gronkh', 'hasanabi', 'mira004', 'tenzinniznet', 'zackrawrr']);
    // Exactly on a holding's position counts as inside.
    expect(logins(store.query(6, -6, 6, -6, 3))).toEqual(['zackrawrr']);
    expect(store.query(6.0001, -6, 10, -6, 3)).toHaveLength(0);
    // Only the isle.
    expect(logins(store.query(70, 10, 90, 30, 3))).toEqual(['gronkh', 'koalapuffslive', 'tenzinniznet']);
  });

  it('returns nothing for a box outside the world and reuses the output array', () => {
    const world = makeWorld();
    const store = new SettlerStore(world, () => world.asOf);
    const out: Settler[] = [];
    expect(store.query(-100, -60, 120, 50, 3, out)).toBe(out);
    expect(out).toHaveLength(3);
    store.query(500, 500, 600, 600, 3, out);
    expect(out).toHaveLength(0);
    store.query(-900, -900, -500, -500, 3, out);
    expect(out).toHaveLength(0);
  });

  it('agrees with a brute-force scan for many holdings and boxes, including at the edges of the world', () => {
    const world: PreviewWorld = makeWorld();
    let seed = 12345;
    const random = () => ((seed = (Math.imul(seed, 1_103_515_245) + 12_345) >>> 0) / 2 ** 32);
    const rows = [];
    for (let i = 0; i < 3000; i++) {
      const edge = i % 50;
      // Most holdings are random; a few sit exactly on the bounds and on grid-cell boundaries.
      const x = edge === 0 ? world.bounds.minX : edge === 1 ? world.bounds.maxX : edge === 2 ? 480 * 2 - 2000 : Math.round(world.bounds.minX + random() * (world.bounds.maxX - world.bounds.minX));
      const y = edge === 3 ? world.bounds.minY : edge === 4 ? world.bounds.maxY : Math.round(world.bounds.minY + random() * (world.bounds.maxY - world.bounds.minY));
      rows.push({ id: String(1_000_000 + i), login: `c${i}`, name: `C${i}`, tier: 2 + (i % 2), x, y, average: 25 + i, game: -1, region: 0, realm: i % 4 });
    }
    const store = new SettlerStore(world, () => world.asOf, 7);
    store.addChunk({ version: 1, kind: 'chatdom-atlas-survey-preview-region', preview: world.id, region: 0, settlers: columns(rows) });
    expect(store.all).toHaveLength(3003);
    for (let q = 0; q < 300; q++) {
      const ax = -130 + random() * 280;
      const ay = -90 + random() * 170;
      const bx = ax + random() * (q % 10 === 0 ? 400 : 60);
      const by = ay + random() * (q % 10 === 0 ? 300 : 60);
      const maxTier = q % 4;
      const expected = store.all.filter((s) => s.tierRank <= maxTier && s.x >= ax && s.x <= bx && s.y >= ay && s.y <= by).map((s) => s.index).sort((a, b) => a - b);
      const actual = store.query(ax, ay, bx, by, maxTier).map((s) => s.index).sort((a, b) => a - b);
      expect(actual).toEqual(expected);
    }
    // The whole world, exactly.
    expect(store.query(-100, -60, 120, 50, 3)).toHaveLength(3003);
  });

  it('names chunk holdings that arrive after the names, and replaces names wholesale on the next projection', () => {
    const world = makeWorld();
    const store = namedStore(world);
    store.addChunk(makeChunk(world, 1));
    expect(store.byId.get('108586685')).toMatchObject({ login: 'tenzinniznet', name: 'TenzinNiznet' });
    // A later projection that no longer names a holding takes its name away; a renamed channel follows.
    const next = makeNames(world, { omit: ['207813352'] });
    next.names[next.ids.indexOf('108586685')] = 'Tenzin';
    store.applyNames(next);
    expect(store.byId.get('207813352')).toMatchObject({ login: null, name: null, withheld: false });
    expect(store.byLogin.has('hasanabi')).toBe(false);
    expect(store.byId.get('108586685')!.name).toBe('Tenzin');
  });

  it('draws a withheld holding as bare land: no name, absent from queries and logins', () => {
    const world = makeWorld();
    const store = namedStore(world, undefined, { withheld: ['207813352'] });
    const hasan = store.byId.get('207813352')!;
    expect(hasan).toMatchObject({ withheld: true, login: null, name: null });
    expect(store.query(-100, -60, 120, 50, 3).map((s) => s.id)).not.toContain('207813352');
    expect(store.byLogin.has('hasanabi')).toBe(false);
    // Lifted: back on the map with its name.
    store.applyNames(makeNames(world));
    expect(store.query(-100, -60, 120, 50, 3).map((s) => s.id)).toContain('207813352');
    expect(store.byId.get('207813352')!.name).toBe('HasanAbi');
  });

  it('drops each name when it goes stale, on its own clock, and reports when the next one will', () => {
    const world = makeWorld();
    const clock = { now: world.asOf + 3_600_000 };
    const store = namedStore(world, clock, { freshUntil: { '36926489': world.asOf + 2 * 3_600_000 } });
    expect(store.expireNames()).toBe(world.asOf + 2 * 3_600_000);
    const version = store.version;
    clock.now = world.asOf + 2 * 3_600_000;
    expect(store.expireNames()).toBe(world.asOf + DAY);
    expect(store.version).toBe(version + 1);
    expect(store.byId.get('36926489')).toMatchObject({ login: null, name: null, withheld: false });
    expect(store.byLogin.has('gronkh')).toBe(false);
    expect(store.query(60, 0, 100, 40, 3).map((s) => s.id)).toContain('36926489');
    // A projection that is already stale when it arrives names nothing.
    clock.now = world.asOf + DAY + 1;
    store.applyNames(makeNames(world));
    expect(store.all.every((s) => s.name === null)).toBe(true);
    expect(store.expireNames()).toBe(Number.POSITIVE_INFINITY);
  });

  it('takes the names head first, then the whole, and never lets a late head undo the whole', () => {
    const world = makeWorld();
    const store = new SettlerStore(world, () => world.asOf + 3_600_000);
    store.addChunk(makeChunk(world, 1));
    const whole = makeNames(world, { withheld: ['108586685'] });
    const head = new Set(world.head.ids);
    const keep = whole.ids.map((id, i) => (head.has(id) ? i : -1)).filter((i) => i >= 0);
    const part = { ...whole, ids: keep.map((i) => whole.ids[i]!), logins: keep.map((i) => whole.logins[i]!), names: keep.map((i) => whole.names[i]!), freshUntil: keep.map((i) => whole.freshUntil[i]!) };
    expect(part.ids.length).toBeLessThan(whole.ids.length);
    expect(store.headSize).toBe(world.head.ids.length);
    store.applyNames(part, false);
    expect(store).toMatchObject({ named: true, namedWhole: false });
    // The head names its own; a withheld chunk holding is bare from the first frame, the others wait for the whole.
    expect(store.byId.get(part.ids[0]!)!.name).not.toBeNull();
    expect(store.byId.get('108586685')).toMatchObject({ withheld: true, name: null });
    const later = store.all.find((s) => !head.has(s.id) && !s.withheld)!.id;
    expect(store.byId.get(later)!.name).toBeNull();
    store.applyNames(whole);
    expect(store.namedWhole).toBe(true);
    expect(store.byId.get(later)!.name).not.toBeNull();
    store.applyNames(part, false);
    expect(store.byId.get(later)!.name).not.toBeNull();
  });

  it('ignores a names projection for another preview', () => {
    const world = makeWorld();
    const store = new SettlerStore(world, () => world.asOf);
    store.applyNames({ ...makeNames(world), preview: 'pv-20261030T055627Z-0123456789ab' });
    expect(store.named).toBe(false);
    expect(store.all.every((s) => s.name === null)).toBe(true);
  });

  it('keeps fixed lettering on chunk arrival but invalidates names, withholding and expiry including lower tiers', () => {
    const world = makeWorld();
    const clock = { now: world.asOf + 3_600_000 };
    const store = namedStore(world, clock);
    const labels = store.labelsVersion;
    const version = store.version;
    store.addChunk(makeChunk(world, 0));
    store.addChunk(makeChunk(world, 1));
    expect(store.version).toBeGreaterThan(version);
    expect(store.labelsVersion).toBe(labels);
    const selected = store.byId.get('108586685')!;
    expect(selected.name).toBe('TenzinNiznet');
    store.applyNames(makeNames(world, { omit: ['108586685'], withheld: ['207813352'] }));
    expect(store.labelsVersion).toBe(labels + 1);
    expect(selected.name).toBeNull();
    expect(store.byId.get('207813352')!.withheld).toBe(true);
    store.applyNames(makeNames(world));
    expect(store.labelsVersion).toBe(labels + 2);
    expect(selected.name).toBe('TenzinNiznet');
    expect(store.byId.get('207813352')!.withheld).toBe(false);
    clock.now = world.asOf + DAY;
    store.expireNames();
    expect(store.labelsVersion).toBe(labels + 3);
    expect(selected.name).toBeNull();
    expect(store.all.every(settler => settler.name === null)).toBe(true);
    store.expireNames();
    expect(store.labelsVersion).toBe(labels + 3);
  });
});

describe('founding holdings', () => {
  it('counts every holding of a survey preview as founding', () => {
    const world = makeWorld();
    const store = new SettlerStore(world, () => world.asOf);
    for (const region of world.regions) store.addChunk(makeChunk(world, region.index));
    expect(store.all.every(settler => settler.foundingHolding)).toBe(true);
  });

  it('marks the first `founded` entries of each edition file as founding, the later grants not', () => {
    const world = makeEdition();
    const store = new SettlerStore(world, () => world.asOf);
    for (const region of world.regions) store.addChunk(makeChunk(world, region.index));
    const later = store.all.filter(settler => !settler.foundingHolding).map(settler => settler.id);
    expect(later).toEqual([LATER_HAMLET.id]);
    expect(store.byId.get(FOUNDING_HAMLET.id)).toMatchObject({ tier: 'hamlet', tierRank: 4, foundingHolding: true });
    // Ordinals still follow file order, later grants included.
    expect(store.byId.get(LATER_HAMLET.id)!.ordinal).toBe(world.head.ids.length + 2);
  });

  it('counts none of an edition file as founding when it says none were', () => {
    const world = makeEdition();
    world.head.founded = 0;
    const store = new SettlerStore(world, () => world.asOf);
    expect(store.all.some(settler => settler.foundingHolding)).toBe(false);
  });
});

describe('tierOf', () => {
  it('names the five tiers by rank, the hamlet last', () => {
    expect([0, 1, 2, 3, 4].map(tierOf)).toEqual([...TIER_CODES]);
    expect(tierOf(4)).toBe('hamlet');
  });
});
