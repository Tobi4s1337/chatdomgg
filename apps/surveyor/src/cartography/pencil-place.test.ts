import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { makeWorld } from '../../../web/src/atlas/data/fixtures.test-support';
import { realmResolver } from '../live/target';
import { PreviewWorldSchema } from '../preview/schema';
import { PencilPlaces, pencilTarget, type PencilHolding, type PencilWorld } from './pencil-place';
import { landIndexOfWorld, LATTICE, nearestFreeSlot, Occupancy } from './slots';
import { currentTaxonomy } from './taxonomy';

const hashOf = (id: string) => createHash('sha256').update(id).digest('hex').slice(0, 16);
const worldOf = (): PencilWorld => ({
  coordScale: 20,
  lattice: { id: 'hex-1', hamletRadius: 0.5, shore: 0.9, gap: 0.6 },
  // One region split into two realms and a lake in the western realm.
  coasts: [
    { region: 0, points: [-600, -400, 1200, 0, 0, 800, -1200, 0] },
    { region: 0, points: [-360, -80, 160, 0, 0, 160, -160, 0] },
  ],
  realms: [
    { index: 0, region: 0, x: -300, y: 0, r: 260 },
    { index: 1, region: 0, x: 300, y: 0, r: 260 },
  ],
});
const holdings: PencilHolding[] = [{ x: -15, y: 10, r: 3.4 }, { x: -5, y: -8, r: 1.25 }];

describe('shared pencil places', () => {
  it('repeats across restarts and arbitrary other lookups without reserving a temporary slot', () => {
    const world = worldOf();
    const first = new PencilPlaces(world).forRegion(0, holdings);
    const hash = hashOf('41245072');
    const expected = first.place(hash, 0);
    expect(expected).not.toBeNull();
    for (let id = 1; id <= 200; id++) first.place(hashOf(String(id)), id % 2);
    expect(first.place(hash, 0)).toEqual(expected);
    expect(new PencilPlaces(structuredClone(world)).forRegion(0, [...holdings].reverse()).place(hash, 0)).toEqual(expected);
  });

  it('uses the existing actual hex lattice and nearest-slot rule, including row/column tie order', () => {
    const world = worldOf();
    const places = new PencilPlaces(world).forRegion(0, holdings);
    const land = landIndexOfWorld(world);
    const occupancy = new Occupancy(world.lattice.gap);
    for (const holding of holdings) occupancy.add(holding.x, holding.y, holding.r);
    for (const realm of land.realms) for (let id = 1; id <= 30; id++) {
      const hash = hashOf(String(id));
      const old = nearestFreeSlot(land, occupancy, realm, pencilTarget(hash, realm), world.lattice.hamletRadius)!;
      expect(places.place(hash, realm.index)).toEqual({ x: old.x, y: old.y });
    }
  });

  it('stays on the correct coast and realm, outside lakes, with shore clearance and every holding gap', () => {
    const world = worldOf();
    const land = landIndexOfWorld(world);
    const places = new PencilPlaces(world).forRegion(0, holdings);
    const clearance = world.lattice.hamletRadius + world.lattice.shore;
    for (let id = 1; id <= 200; id++) {
      const realm = id % 2;
      const point = places.place(hashOf(String(id)), realm)!;
      expect(point).not.toBeNull();
      expect(land.realmAt(point.x, point.y)).toBe(realm);
      expect(land.distanceToCoast(point.x, point.y, clearance)).toBe(clearance);
      for (const holding of holdings) expect(Math.hypot(point.x - holding.x, point.y - holding.y))
        .toBeGreaterThanOrEqual(holding.r + world.lattice.hamletRadius + world.lattice.gap - 1e-9);
      const j = Math.round(point.y * LATTICE.scale / LATTICE.rowY);
      expect(point.y).toBe(j * LATTICE.rowY / LATTICE.scale);
      const i = Math.round((point.x * LATTICE.scale - (j & 1) * LATTICE.pitchX / 2) / LATTICE.pitchX);
      expect(point.x).toBe((i * LATTICE.pitchX + (j & 1) * LATTICE.pitchX / 2) / LATTICE.scale);
    }
  });

  it('snapshots permanent holdings and allows different hashes to share a provisional point', () => {
    const world = worldOf();
    const mutable = structuredClone(holdings);
    const places = new PencilPlaces(world).forRegion(0, mutable);
    // These different 64-bit hashes aim much closer together than one lattice pitch.
    const a = places.place('0000000000000000', 0);
    const b = places.place('0000000000000001', 0);
    expect(a).not.toBeNull();
    expect(a).toEqual(b);
    mutable[0]!.x = a!.x;
    mutable[0]!.y = a!.y;
    mutable[0]!.r = 1_000;
    expect(places.place('0000000000000000', 0)).toEqual(a);
    // A permanent claim is different: rebuilding from that holding excludes its ground.
    expect(new PencilPlaces(world).forRegion(0, [{ ...a!, r: 0.5 }]).place('0000000000000000', 0)).not.toEqual(a);
  });

  it('finds real land even when the drawn coast extends beyond the realm circle’s old search radius', () => {
    const world = worldOf();
    world.realms = [{ index: 0, region: 0, x: 0, y: 0, r: 20 }];
    world.coasts = [{ region: 0, points: [2000, -100, 200, 0, 0, 200, -200, 0] }];
    const point = new PencilPlaces(world).forRegion(0, []).place('0000000000000000', 0)!;
    expect(point).not.toBeNull();
    expect(landIndexOfWorld(world).realmAt(point.x, point.y)).toBe(0);
    expect(point.x).toBeGreaterThan(100);
  });

  it('returns no invented coordinate for missing realms, sea-only realms, occupied land or malformed hashes', () => {
    const world = worldOf();
    const core = new PencilPlaces(world);
    expect(core.forRegion(0, []).place(hashOf('1'), 99)).toBeNull();
    expect(core.forRegion(1, []).place(hashOf('1'), 0)).toBeNull();
    expect(core.forRegion(0, []).place('not-a-channel-hash', 0)).toBeNull();
    const full = core.forRegion(0, [{ x: 0, y: 0, r: 60 }]);
    expect(full.place(hashOf('1'), 0)).toBeNull();
    expect(full.place(hashOf('2'), 0)).toBeNull();
    world.coasts = [];
    expect(new PencilPlaces(world).forRegion(0, []).place(hashOf('1'), 0)).toBeNull();
  });

  it('uses the current language/game resolver, including deterministic unknown-language Outer Isles fallback', () => {
    const world = PreviewWorldSchema.parse(makeWorld());
    world.taxonomy.sha256 = currentTaxonomy().ref.sha256;
    world.coasts.push({ region: 2, points: [1800, -1000, 400, 0, 0, 400, -400, 0] });
    world.regions.push({ ...world.regions[2]!, index: 3, x: 2600 });
    world.realms.push({ ...world.realms[5]!, index: 6, region: 3, x: 2600 });
    world.coasts.push({ region: 3, points: [2400, -1000, 400, 0, 0, 400, -400, 0] });
    const resolve = realmResolver(world);
    const known = { id: '41245072', language: 'en', categories: [{ gameId: '509658', minutes: 240 }] };
    expect(resolve(known)).toBe(1);
    expect(resolve({ ...known, categories: [] })).toBe(3);
    expect(resolve({ ...known, language: 'de' })).toBe(4);
    const unknown = { ...known, language: 'unknown' };
    expect(new Set(Array.from({ length: 20 }, (_, id) => resolve({ ...unknown, id: String(id + 1) })))).toEqual(new Set([5, 6]));
    const realmIndex = resolve(unknown);
    expect(world.realms[realmIndex]!.kind).toBe('outer');
    const region = world.realms[realmIndex]!.region;
    const point = new PencilPlaces(world).forRegion(region, []).place(hashOf(unknown.id), realmIndex)!;
    expect(point).not.toBeNull();
    expect(landIndexOfWorld(world).realmAt(point.x, point.y)).toBe(realmIndex);
    const restarted = structuredClone(world);
    expect(realmResolver(restarted)(unknown)).toBe(realmIndex);
    expect(new PencilPlaces(restarted).forRegion(region, []).place(hashOf(unknown.id), realmIndex)).toEqual(point);
  });
});
