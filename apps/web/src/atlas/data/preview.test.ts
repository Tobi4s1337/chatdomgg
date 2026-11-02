// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BASE, clone, FakeService, ID_A, ID_B, makeChunk, makeEdition, makeNames, makeWorld, publish, sha } from './fixtures.test-support';
import {
  fetchChunk, fetchNames, fetchPointer, fetchWorld, PreviewError, READ_TIMEOUT_MS, sha256Hex, validateChunk, validateNames,
  validatePointer, validateWorld, worldUrl, type PreviewPointer, type PreviewWorld, type ServedNames,
} from './preview';

type Reason = PreviewError['reason'];

/** Run `action` and return the PreviewError it throws (failing the test if it throws anything else or nothing). */
function caught(action: () => unknown): PreviewError {
  try {
    action();
  } catch (error) {
    expect(error).toBeInstanceOf(PreviewError);
    return error as PreviewError;
  }
  throw new Error('expected a PreviewError, nothing was thrown');
}

async function rejection(promise: Promise<unknown>): Promise<PreviewError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(PreviewError);
    return error as PreviewError;
  }
  throw new Error('expected a PreviewError, the promise resolved');
}

const pointer = (): PreviewPointer => publish().pointer;

/** Apply a mutation to a fresh valid world and expect validation to refuse it at `path`. */
function refusesWorld(mutate: (world: Record<string, unknown> & PreviewWorld) => void, path: string): void {
  const world = clone(makeWorld()) as Record<string, unknown> & PreviewWorld;
  mutate(world);
  const error = caught(() => validateWorld(world));
  expect(error.reason).toBe<Reason>('invalid');
  expect(error.message.startsWith(path)).toBe(true);
}

describe('validatePointer', () => {
  it('accepts a well-formed pointer and returns it unchanged', () => {
    const value = pointer();
    expect(validatePointer(value)).toBe(value);
  });

  it.each([
    ['a non-object', null, 'pointer'],
    ['an array', [], 'pointer'],
    ['a string', '{}', 'pointer'],
  ])('refuses %s', (_, value, path) => {
    const error = caught(() => validatePointer(value));
    expect(error.reason).toBe<Reason>('invalid');
    expect(error.message.startsWith(path)).toBe(true);
  });

  const cases: [string, (p: Record<string, unknown> & { world: Record<string, unknown> }) => void, string][] = [
    ['a future version', (p) => { p.version = 2; }, 'pointer.version'],
    ['a version given as text', (p) => { p.version = '1'; }, 'pointer.version'],
    ['an ID in another format', (p) => { p.id = 'pv-2026-10-30'; }, 'pointer.id'],
    ['an ID with a trailing newline', (p) => { p.id = `${ID_A}\n`; }, 'pointer.id'],
    ['a revision that is not an observation revision', (p) => { p.revision = ID_A; }, 'pointer.revision'],
    ['a negative asOf', (p) => { p.asOf = -1; }, 'pointer.asOf'],
    ['a fractional asOf', (p) => { p.asOf = 1.5; }, 'pointer.asOf'],
    ['a missing field', (p) => { delete p.revision; }, 'pointer.revision'],
    ['an unknown field', (p) => { p.edition = 1; }, 'pointer.edition'],
    ['an unknown nested field', (p) => { p.world.etag = 'x'; }, 'pointer.world.etag'],
    ['an absolute world URL on another host', (p) => { p.world.url = 'https://evil.test/world.json'; }, 'pointer.world.url'],
    ['a world URL with a query', (p) => { p.world.url = '/map-data/world.json?x=1'; }, 'pointer.world.url'],
    ['an upper-case hash', (p) => { p.world.sha256 = 'A'.repeat(64); }, 'pointer.world.sha256'],
    ['a short hash', (p) => { p.world.sha256 = 'a'.repeat(63); }, 'pointer.world.sha256'],
    ['a zero byte length', (p) => { p.world.bytes = 0; }, 'pointer.world.bytes'],
    ['a world larger than 64 MB', (p) => { p.world.bytes = 64_000_001; }, 'pointer.world.bytes'],
  ];
  it.each(cases)('refuses %s', (_, mutate, path) => {
    const value = clone(pointer()) as unknown as Record<string, unknown> & { world: Record<string, unknown> };
    mutate(value);
    const error = caught(() => validatePointer(value));
    expect(error.reason).toBe<Reason>('invalid');
    expect(error.message.startsWith(path)).toBe(true);
  });

  // Bug: `strict` tests `key in shape`, which also sees Object.prototype, so a field named after an inherited member
  // (constructor, toString, hasOwnProperty, __proto__ …) slips past the "no such field" check.
  it('refuses unknown fields even when they share a name with an Object.prototype member', () => {
    for (const key of ['constructor', 'toString', 'hasOwnProperty', '__proto__']) {
      const value = JSON.parse(JSON.stringify(pointer()).replace('{', `{"${key}":1,`)) as unknown;
      expect(() => validatePointer(value), key).toThrow(PreviewError);
    }
  });
});

describe('validateWorld', () => {
  it('accepts the fixture world and returns it unchanged', () => {
    const world = makeWorld();
    expect(validateWorld(world)).toBe(world);
  });

  it('accepts a world without isles and with an empty decor list', () => {
    const world = makeWorld();
    world.isles = null;
    world.decor = [];
    expect(() => validateWorld(world)).not.toThrow();
  });

  it('accepts a world that survives a JSON round trip (what the browser actually parses)', () => {
    expect(() => validateWorld(JSON.parse(publish().worldText) as unknown)).not.toThrow();
  });

  it('accepts reviewed families and newer rule versions, which the key then names as they are', () => {
    const world = makeWorld();
    world.taxonomy = { ...world.taxonomy, id: 'families-2', status: 'reviewed', variety: 'variety-2', realmThreshold: 'realm-threshold-3' };
    world.lattice.id = 'hex-2';
    expect(validateWorld(world).taxonomy.status).toBe('reviewed');
  });

  it('accepts a world with no families at all, whose continents hold only the Crossroads and the Wilds', () => {
    const world = makeWorld();
    world.families = [];
    world.realms = world.realms.map((realm) => (realm.kind === 'family' ? { ...realm, kind: 'wilds', family: -1, name: 'The Wilds' } : realm));
    expect(() => validateWorld(world)).not.toThrow();
  });

  it.each<[string, (w: Record<string, unknown> & PreviewWorld) => void, string]>([
    ['a different kind', (w) => { (w as { kind: string }).kind = 'chatdom-atlas-edition'; }, 'world.kind'],
    ['any label but the preview label', (w) => { (w as { label: string }).label = 'Edition 0'; }, 'world.label'],
    ['a status other than preview', (w) => { (w as { status: string }).status = 'founded'; }, 'world.status'],
    ['a founded world', (w) => { (w.founding as { status: string }).status = 'founded'; }, 'world.founding.status'],
    ['collected content labels', (w) => { (w.coverage as { contentLabels: string }).contentLabels = 'collected'; }, 'world.coverage.contentLabels'],
    ['an unknown top-level field', (w) => { w.edition = 0; }, 'world.edition'],
    ['an unknown field inside window', (w) => { (w.window as unknown as Record<string, unknown>).cursor = 1; }, 'world.window.cursor'],
    ['a coordScale of zero', (w) => { w.coordScale = 0; }, 'world.coordScale'],
    ['a fractional coordScale', (w) => { w.coordScale = 2.5; }, 'world.coordScale'],
    ['an infinite holding radius', (w) => { w.tiers.holdingRadius.city = Infinity; }, 'world.tiers.holdingRadius.city'],
    ['an empty bounds box', (w) => { w.bounds.maxX = w.bounds.minX; }, 'world.bounds'],
    ['inverted bounds', (w) => { w.bounds.maxY = w.bounds.minY - 1; }, 'world.bounds'],
    ['no regions', (w) => { w.regions = []; }, 'world.regions'],
    ['regions out of order', (w) => { w.regions.reverse(); }, 'world.regions[0].index'],
    ['an unknown region kind', (w) => { (w.regions[0] as { kind: string }).kind = 'island'; }, 'world.regions[0].kind'],
    ['a chunk path that leaves the preview folder', (w) => { w.regions[0]!.chunk.path = '../region-0.json'; }, 'world.regions[0].chunk.path'],
    ['a chunk path that is not JSON', (w) => { w.regions[0]!.chunk.path = 'region-0.js'; }, 'world.regions[0].chunk.path'],
    ['a game ID that is not numeric', (w) => { w.games[0]!.gameId = 'just-chatting'; }, 'world.games[0].gameId'],
    ['a coast with an odd number of values', (w) => { w.coasts[0]!.points.push(5); }, 'world.coasts'],
    ['a coast of an unknown region', (w) => { w.coasts[0]!.region = 3; }, 'world.coasts'],
    ['a coast with a fractional value', (w) => { w.coasts[0]!.points[2] = 0.5; }, 'world.coasts[0].points[2]'],
    ['a cluster of an unknown game', (w) => { w.clusters[0]!.game = 3; }, 'world.clusters'],
    ['a cluster of an unknown region', (w) => { w.clusters[0]!.region = 3; }, 'world.clusters'],
    ['decor that is not in triples', (w) => { w.decor.pop(); }, 'world.decor'],
    ['a head column of the wrong length', (w) => { w.head.average.pop(); }, 'world.head.average'],
    ['a town in the head (towns arrive per region)', (w) => { w.head.tier[1] = 2; }, 'world.head.tier[1]'],
    ['a head tier out of range', (w) => { w.head.tier[0] = 4; }, 'world.head.tier[0]'],
    ['a head settler of an unknown region', (w) => { w.head.region[0] = 3; }, 'world.head.region[0]'],
    ['a head settler of an unknown game', (w) => { w.head.game[0] = 3; }, 'world.head.game[0]'],
    ['a game index below −1', (w) => { w.head.game[0] = -2; }, 'world.head.game[0]'],
    ['a channel ID with a leading zero', (w) => { w.head.ids[0] = '0552120296'; }, 'world.head.ids[0]'],
    ['a channel ID that is not numeric', (w) => { w.head.ids[0] = '55212029a'; }, 'world.head.ids[0]'],
    ['raw logins inside the immutable world', (w) => { (w.head as unknown as Record<string, unknown>).logins = ['zackrawrr', 'hasanabi', 'gronkh']; }, 'world.head.logins'],
    ['raw names inside the immutable world', (w) => { (w.head as unknown as Record<string, unknown>).names = ['zackrawrr', 'HasanAbi', 'GRONKH']; }, 'world.head.names'],
    ['a world that does not say which gambling policy it was drawn under', (w) => { delete (w as Partial<PreviewWorld>).policy; }, 'world.policy'],
    ['a negative average', (w) => { w.head.average[0] = -1; }, 'world.head.average[0]'],
    ['a NaN coordinate', (w) => { w.head.x[0] = Number.NaN; }, 'world.head.x[0]'],
    // The realm geography.
    ['a world without hamlet slots counted', (w) => { delete (w.counts as Partial<PreviewWorld['counts']>).hamletSlots; }, 'world.counts.hamletSlots'],
    ['a world without its taxonomy', (w) => { delete (w as Partial<PreviewWorld>).taxonomy; }, 'world.taxonomy'],
    ['a taxonomy of unknown status', (w) => { (w.taxonomy as { status: string }).status = 'approved'; }, 'world.taxonomy.status'],
    ['a taxonomy without a hash', (w) => { w.taxonomy.sha256 = 'proposal'; }, 'world.taxonomy.sha256'],
    ['a variety rule of another form', (w) => { w.taxonomy.variety = 'diverse'; }, 'world.taxonomy.variety'],
    ['a lattice of zero hamlet radius', (w) => { w.lattice.hamletRadius = 0; }, 'world.lattice.hamletRadius'],
    ['a lattice of another kind', (w) => { w.lattice.id = 'square-1'; }, 'world.lattice.id'],
    ['a world without the Outer Isles', (w) => { delete (w as Partial<PreviewWorld>).outer; }, 'world.outer'],
    ['the Outer Isles drawn as nothing', (w) => { (w as { outer: unknown }).outer = null; }, 'world.outer'],
    ['a world without realms', (w) => { w.realms = []; }, 'world.realms'],
    ['a family id with capitals', (w) => { w.families[0]!.id = 'Shooters'; }, 'world.families[0].id'],
    ['an unknown realm kind', (w) => { (w.realms[0] as { kind: string }).kind = 'heart'; }, 'world.realms[0].kind'],
    ['realms out of order', (w) => { w.realms.reverse(); }, 'world.realms[0].index'],
    ['a realm of an unknown region', (w) => { w.realms[3]!.region = 3; }, 'world.realms[3].region'],
    ['a family realm of a family that does not exist', (w) => { w.realms[2]!.family = 2; }, 'world.realms[2].family'],
    ['a family realm without a family', (w) => { w.realms[1]!.family = -1; }, 'world.realms[1].family'],
    ['the Crossroads claiming a family', (w) => { w.realms[0]!.family = 0; }, 'world.realms[0].family'],
    ['a family realm on an isle', (w) => { w.realms[4] = { ...w.realms[4]!, kind: 'family', family: 0 }; }, 'world.realms[4].kind'],
    ['the Wilds on one of the Outer Isles', (w) => { w.realms[5]!.kind = 'wilds'; }, 'world.realms[5].kind'],
    ['an isle realm on a continent', (w) => { w.realms[3]!.kind = 'isle'; }, 'world.realms[3].kind'],
    ['a region without a language that is not one of the Outer Isles', (w) => { w.regions[1]!.language = null; }, 'world.regions[1].language'],
    ['one of the Outer Isles claiming a language', (w) => { w.regions[2]!.language = 'en'; }, 'world.regions[2].language'],
    ['an unknown region kind beside the Outer Isles', (w) => { (w.regions[2] as { kind: string }).kind = 'reserve'; }, 'world.regions[2].kind'],
    ['a cluster without a realm', (w) => { delete (w.clusters[0] as Partial<PreviewWorld['clusters'][number]>).realm; }, 'world.clusters[0].realm'],
    ['a cluster of an unknown realm', (w) => { w.clusters[0]!.realm = 6; }, 'world.clusters[0].realm'],
    ['a cluster in a realm of another region', (w) => { w.clusters[3]!.realm = 1; }, 'world.clusters[3].realm'],
    ['a head without a realm column', (w) => { delete (w.head as Partial<PreviewWorld['head']>).realm; }, 'world.head.realm'],
    ['a realm column of the wrong length', (w) => { w.head.realm.push(1); }, 'world.head.realm'],
    ['a head settler of an unknown realm', (w) => { w.head.realm[0] = 6; }, 'world.head.realm[0]'],
    ['a head settler in a realm of another region', (w) => { w.head.realm[2] = 1; }, 'world.head.realm[2]'],
  ])('refuses %s', (_, mutate, path) => refusesWorld(mutate, path));
});

describe('validateChunk', () => {
  const world = makeWorld();

  it('accepts a chunk of its own preview and region', () => {
    const chunk = makeChunk(world, 1);
    expect(validateChunk(chunk, world, 1)).toBe(chunk);
  });

  it.each<[string, (c: ReturnType<typeof makeChunk>) => void, number, string]>([
    ['a chunk of another preview', (c) => { c.preview = ID_B; }, 0, 'chunk.preview'],
    ['a chunk asked for as another region', () => undefined, 1, 'chunk.region'],
    ['a capital inside a chunk', (c) => { c.settlers.tier[0] = 0; }, 0, 'chunk.settlers.tier[0]'],
    ['a city inside a chunk', (c) => { c.settlers.tier[1] = 1; }, 0, 'chunk.settlers.tier[1]'],
    ['a settler filed under another region', (c) => { c.settlers.region[1] = 1; }, 0, 'chunk.settlers.region[1]'],
    ['a settler of an unknown game', (c) => { c.settlers.game[0] = 9; }, 0, 'chunk.settlers.game[0]'],
    ['a settler in a realm of another region', (c) => { c.settlers.realm[1] = 4; }, 0, 'chunk.settlers.realm[1]'],
    ['a settler of an unknown realm', (c) => { c.settlers.realm[0] = 99; }, 0, 'chunk.settlers.realm[0]'],
    ['columns of different lengths', (c) => { c.settlers.average.push(30); }, 0, 'chunk.settlers.average'],
    ['raw names inside a chunk', (c) => { (c.settlers as unknown as Record<string, unknown>).names = ['mira004', 'pumpkinpotion']; }, 0, 'chunk.settlers.names'],
    ['an unknown field', (c) => { (c as unknown as Record<string, unknown>).cursor = 'x'; }, 0, 'chunk.cursor'],
  ])('refuses %s', (_, mutate, region, path) => {
    const chunk = clone(makeChunk(world, 0));
    mutate(chunk);
    const error = caught(() => validateChunk(chunk, world, region));
    expect(error.reason).toBe<Reason>('invalid');
    expect(error.message.startsWith(path)).toBe(true);
  });
});

describe('an edition publication', () => {
  type Mutable = Record<string, unknown> & PreviewWorld;
  function refusesEdition(mutate: (world: Mutable) => void, path: string, rehearsal = false): void {
    const world = clone(makeEdition({ rehearsal })) as Mutable;
    mutate(world);
    const error = caught(() => validateWorld(world));
    expect(error.reason).toBe<Reason>('invalid');
    expect(error.message.startsWith(path), error.message).toBe(true);
  }

  it('accepts an edition night, a rehearsal and Edition 0, unchanged and after a JSON round trip', () => {
    for (const world of [makeEdition(), makeEdition({ rehearsal: true }), makeEdition({ label: 'Edition 0' })]) {
      expect(validateWorld(world)).toBe(world);
      expect(() => validateWorld(JSON.parse(publish(world).worldText) as unknown)).not.toThrow();
    }
  });

  it('accepts an edition without a hamlet count or founding counts, and holdings whose average left their tier', () => {
    const world = makeEdition();
    delete world.counts.hamlet;
    delete world.head.founded;
    // A city whose audience fell to 300 is still a city: an edition draws the tier its land was granted at.
    world.head.average[1] = 300;
    expect(() => validateWorld(world)).not.toThrow();
  });

  it.each<[string, (w: Mutable) => void, string]>([
    ['the preview label', (w) => { (w as { label: string }).label = 'Survey preview · land awaiting founding'; }, 'world.label'],
    ['an unknown label', (w) => { (w as { label: string }).label = 'Edition II'; }, 'world.label'],
    ['a label other than its founding’s', (w) => { (w as { label: string }).label = 'Edition 0'; }, 'world.label'],
    ['an edition ID of another edition', (w) => { (w.founding as { edition: string }).edition = 'ed-0'; }, 'world.founding.label'],
    ['an unknown edition ID', (w) => { (w.founding as { edition: string }).edition = 'ed-2'; }, 'world.founding.edition'],
    ['a founding that is not founded', (w) => { (w as { founding: unknown }).founding = { status: 'not-founded', edition0EligibleAt: 1, editionIEligibleAt: 2 }; }, 'world.founding'],
    ['a founding with an unknown key', (w) => { (w.founding as unknown as Record<string, unknown>).signature = 'x'; }, 'world.founding.signature'],
    ['a founding without its ledger', (w) => { delete (w.founding as unknown as Partial<Record<string, unknown>>).ledger; }, 'world.founding.ledger'],
    ['a founding without its night', (w) => { delete (w.founding as unknown as Partial<Record<string, unknown>>).night; }, 'world.founding.night'],
    ['a founding with an unknown key in its ledger', (w) => { (w.founding as unknown as { ledger: Record<string, unknown> }).ledger.tail = 'x'; }, 'world.founding.ledger.tail'],
    ['a founding with an unknown key in its night', (w) => { (w.founding as unknown as { night: Record<string, unknown> }).night.sweeps = 3; }, 'world.founding.night.sweeps'],
    ['a night of another form', (w) => { (w.founding as { night: { revision: string } }).night.revision = ID_A; }, 'world.founding.night.revision'],
    ['a rehearsal flag given as text', (w) => { (w.founding as unknown as Record<string, unknown>).rehearsal = 'false'; }, 'world.founding.rehearsal'],
    ['a world hash that is not one', (w) => { (w.founding as { worldHash: string }).worldHash = 'ed-1'; }, 'world.founding.worldHash'],
    ['a fractional ledger count', (w) => { (w.founding as { ledger: { lines: number } }).ledger.lines = 1.5; }, 'world.founding.ledger.lines'],
    ['a hamlet in the head (hamlets arrive per region)', (w) => { w.head.tier[2] = 4; }, 'world.head.tier[2]'],
    ['more founding holdings in the head than it holds', (w) => { w.head.founded = w.head.ids.length + 1; }, 'world.head.founded'],
    ['a negative founding count', (w) => { w.head.founded = -1; }, 'world.head.founded'],
    ['a fractional hamlet count', (w) => { w.counts.hamlet = 2.5; }, 'world.counts.hamlet'],
  ])('refuses an edition with %s', (_, mutate, path) => refusesEdition(mutate, path));

  it.each<[string, (w: Mutable) => void, string]>([
    ['a founded founding', (w) => { (w as { founding: unknown }).founding = clone(makeEdition().founding); }, 'world.founding'],
    ['a hamlet count', (w) => { w.counts.hamlet = 0; }, 'world.counts.hamlet'],
    ['a founding-holding count', (w) => { w.head.founded = 3; }, 'world.head.founded'],
    ['an edition label', (w) => { (w as { label: string }).label = 'Edition I'; }, 'world.label'],
  ])('refuses a survey preview with %s', (_, mutate, path) => refusesWorld(mutate, path));

  it('takes hamlets and founding counts in an edition’s chunks, and nothing past the file’s length', () => {
    const world = makeEdition();
    const chunk = makeChunk(world, 0);
    expect(chunk.settlers.tier).toContain(4);
    expect(validateChunk(chunk, world, 0)).toBe(chunk);
    const over = clone(chunk);
    over.settlers.founded = over.settlers.ids.length + 1;
    expect(caught(() => validateChunk(over, world, 0)).message.startsWith('chunk.settlers.founded')).toBe(true);
    const all = clone(chunk);
    all.settlers.founded = all.settlers.ids.length;
    expect(() => validateChunk(all, world, 0)).not.toThrow();
  });

  it('refuses a hamlet or a founding count in a survey preview’s chunk', () => {
    const world = makeWorld();
    const hamlet = clone(makeChunk(world, 0));
    hamlet.settlers.tier[1] = 4;
    expect(caught(() => validateChunk(hamlet, world, 0)).message.startsWith('chunk.settlers.tier[1]')).toBe(true);
    const founded = clone(makeChunk(world, 0));
    founded.settlers.founded = 1;
    expect(caught(() => validateChunk(founded, world, 0)).message.startsWith('chunk.settlers.founded')).toBe(true);
  });

  it('reads the edition named on the pointer, and refuses one of the wrong shape', () => {
    const pointer = publish(makeEdition()).pointer;
    expect(validatePointer(pointer).edition).toEqual({ id: 'ed-1', label: 'Edition I', foundedAt: makeEdition().founding.foundedAt, worldHash: 'a1'.repeat(32), address: 'b2'.repeat(32) });
    const cases: [string, (e: Record<string, unknown>) => void, string][] = [
      ['a label of another edition', (e) => { e.label = 'Edition 0'; }, 'pointer.edition.label'],
      ['an unknown edition', (e) => { e.id = 'ed-2'; }, 'pointer.edition.id'],
      ['an unknown key', (e) => { e.rehearsal = true; }, 'pointer.edition.rehearsal'],
      ['a missing address', (e) => { delete e.address; }, 'pointer.edition.address'],
      ['a short world hash', (e) => { e.worldHash = 'a'.repeat(63); }, 'pointer.edition.worldHash'],
    ];
    for (const [what, mutate, path] of cases) {
      const value = clone(pointer) as unknown as { edition: Record<string, unknown> };
      mutate(value.edition);
      expect(caught(() => validatePointer(value)).message.startsWith(path), what).toBe(true);
    }
    expect(caught(() => validatePointer({ ...clone(pointer), edition: null })).message.startsWith('pointer.edition')).toBe(true);
  });

  it('fetches an edition night through the same routes as a survey preview', async () => {
    const published = publish(makeEdition());
    const service = new FakeService().publish(published);
    const pointer = await fetchPointer(service.source);
    const world = await fetchWorld(service.source, pointer);
    expect(world.status).toBe('edition');
    expect((await fetchChunk(service.source, world, 1)).settlers.founded).toBe(3);
    expect(service.urls()).toEqual([`${BASE}/v1/preview`, worldUrl(service.source, world.id), `${BASE}/v1/preview/${world.id}/region-1.json`]);
  });
});

describe('sha256Hex', () => {
  it('matches the standard vectors', async () => {
    expect(await sha256Hex(new ArrayBuffer(0))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(await sha256Hex(new TextEncoder().encode('abc').buffer)).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('fetchPointer', () => {
  it('reads the pointer from {base}/v1/preview without credentials', async () => {
    const published = publish();
    const service = new FakeService().publish(published);
    expect(await fetchPointer(service.source)).toEqual(published.pointer);
    expect(service.urls()).toEqual([`${BASE}/v1/preview`]);
    expect(service.calls[0]!.init?.credentials).toBe('omit');
  });

  it.each([
    ['503 no-preview', 503, '{"error":"no-preview"}', 'empty'],
    ['503 no-revision', 503, '{"error":"no-revision"}', 'empty'],
    ['503 for another reason', 503, '{"error":"overloaded"}', 'unavailable'],
    ['503 with an empty body', 503, '', 'unavailable'],
    ['503 that merely mentions no-preview unquoted', 503, 'no-preview', 'unavailable'],
    ['500', 500, '{"error":"no-preview"}', 'unavailable'],
    ['404', 404, '{"error":"not-found"}', 'unavailable'],
    ['200 with HTML', 200, '<!doctype html><title>Bad gateway</title>', 'invalid'],
    ['200 with a pointer of the wrong shape', 200, '{"version":1}', 'invalid'],
  ] as const)('maps %s to %s', async (_, status, body, reason) => {
    const service = new FakeService().serve(`${BASE}/v1/preview`, body, status);
    expect((await rejection(fetchPointer(service.source))).reason).toBe<Reason>(reason);
  });

  it('reports a network failure as unavailable', async () => {
    const source = { base: BASE, fetch: (async () => { throw new TypeError('fetch failed'); }) as typeof fetch };
    expect((await rejection(fetchPointer(source))).reason).toBe<Reason>('unavailable');
  });

  it('lets an abort through untouched, and the abort reaches the request', async () => {
    const controller = new AbortController();
    let seen: AbortSignal | null | undefined;
    const source = {
      base: BASE,
      fetch: ((_url: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_, reject) => {
        seen = init?.signal;
        init?.signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')));
      })) as typeof fetch,
    };
    const pending = fetchPointer(source, controller.signal).catch((e: unknown) => e);
    controller.abort();
    const error = await pending;
    expect(error).not.toBeInstanceOf(PreviewError);
    expect((error as Error).name).toBe('AbortError');
    expect(seen?.aborted).toBe(true);
  });

  it('does not even ask when the caller has already given up', async () => {
    const service = new FakeService().publish(publish());
    const controller = new AbortController();
    controller.abort();
    expect(((await fetchPointer(service.source, controller.signal).catch((e: unknown) => e)) as Error).name).toBe('AbortError');
    expect(service.calls).toHaveLength(0);
  });
});

/** A fetch that answers nothing (or headers but never a body) until its request is aborted. */
function stalled(stage: 'headers' | 'body'): { source: { base: string; fetch: typeof fetch }; signals: AbortSignal[] } {
  const signals: AbortSignal[] = [];
  const fetchImpl = ((_url: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((resolve, reject) => {
    const signal = init!.signal!;
    signals.push(signal);
    const aborted = () => new DOMException('The operation was aborted.', 'AbortError');
    if (stage === 'headers') {
      signal.addEventListener('abort', () => reject(aborted()));
      return;
    }
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"version":'));
        signal.addEventListener('abort', () => controller.error(aborted()));
      },
    });
    resolve(new Response(body, { status: 200 }));
  })) as typeof fetch;
  return { source: { base: BASE, fetch: fetchImpl }, signals };
}

describe('read timeouts', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it.each(['headers', 'body'] as const)('turns a service that stalls before its %s end into an unavailable read, not an endless load', async (stage) => {
    vi.useFakeTimers();
    const { source, signals } = stalled(stage);
    const pending = fetchPointer(source).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(READ_TIMEOUT_MS.pointer - 1);
    expect(signals[0]!.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const error = await pending;
    expect(error).toBeInstanceOf(PreviewError);
    expect((error as PreviewError).reason).toBe<Reason>('unavailable');
    expect((error as PreviewError).message).toMatch(/did not answer within 10 s/);
    expect(signals[0]!.aborted).toBe(true);
  });

  it('gives the world, its regions and the names their own longer limits', async () => {
    vi.useFakeTimers();
    const published = publish();
    const world = stalled('body');
    const pendingWorld = fetchWorld(world.source, published.pointer).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(READ_TIMEOUT_MS.pointer);
    expect(world.signals[0]!.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(READ_TIMEOUT_MS.world - READ_TIMEOUT_MS.pointer);
    expect(((await pendingWorld) as PreviewError).reason).toBe<Reason>('unavailable');

    const chunk = stalled('headers');
    const pendingChunk = fetchChunk(chunk.source, published.world, 0).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(READ_TIMEOUT_MS.chunk);
    expect(((await pendingChunk) as PreviewError).reason).toBe<Reason>('unavailable');

    const names = stalled('headers');
    const pendingNames = fetchNames(names.source, published.world).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(READ_TIMEOUT_MS.names);
    expect(((await pendingNames) as PreviewError).reason).toBe<Reason>('unavailable');
  });

  it('clears its timer once the read is done', async () => {
    vi.useFakeTimers();
    const service = new FakeService().publish(publish());
    await fetchPointer(service.source);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('fetchWorld', () => {
  it('fetches the world by preview ID and validates it', async () => {
    const published = publish();
    const service = new FakeService().publish(published);
    const world = await fetchWorld(service.source, published.pointer);
    expect(world).toEqual(published.world);
    expect(service.urls()).toEqual([worldUrl(service.source, ID_A)]);
    expect(worldUrl(service.source, ID_A)).toBe(`${BASE}/v1/preview/${ID_A}/world.json`);
    expect(service.calls[0]!.init?.credentials).toBe('omit');
  });

  it('refuses a file one byte longer than pinned, even though it parses to the same world', async () => {
    const published = publish();
    const service = new FakeService().serve(`${BASE}/v1/preview/${ID_A}/world.json`, `${published.worldText} `);
    expect((await rejection(fetchWorld(service.source, published.pointer))).reason).toBe<Reason>('mismatch');
  });

  it('refuses a file of the pinned length whose content changed', async () => {
    const published = publish();
    const tampered = published.worldText.replace('"Deutsch"', '"Deutsck"');
    expect(tampered.length).toBe(published.worldText.length);
    const service = new FakeService().serve(`${BASE}/v1/preview/${ID_A}/world.json`, tampered);
    expect((await rejection(fetchWorld(service.source, published.pointer))).reason).toBe<Reason>('mismatch');
  });

  it('measures the pinned length in bytes, not characters', async () => {
    const world = makeWorld();
    world.regions[1]!.name = 'Ελληνικά';
    const published = publish(world);
    expect(published.pointer.world.bytes).toBeGreaterThan(published.worldText.length);
    const service = new FakeService().publish(published);
    expect((await fetchWorld(service.source, published.pointer)).regions[1]!.name).toBe('Ελληνικά');
  });

  it('reports a pinned file that is not JSON as invalid, not as a mismatch', async () => {
    const body = 'not json at all';
    const service = new FakeService().serve(`${BASE}/v1/preview/${ID_A}/world.json`, body);
    const pinned = { id: ID_A, world: { url: '/x.json', sha256: sha(body), bytes: body.length } };
    expect((await rejection(fetchWorld(service.source, pinned))).reason).toBe<Reason>('invalid');
  });

  it('refuses malformed UTF-8 even when its hash was pinned', async () => {
    const bytes = new Uint8Array([0x7b, 0x22, 0xff, 0xfe, 0x22, 0x7d]); // {"\xff\xfe"}
    const service = new FakeService().serve(`${BASE}/v1/preview/${ID_A}/world.json`, bytes);
    const pinned = { id: ID_A, world: { url: '/x.json', sha256: sha(bytes), bytes: bytes.length } };
    expect((await rejection(fetchWorld(service.source, pinned))).reason).toBe<Reason>('invalid');
  });

  it('reports a pinned world of the wrong shape as invalid', async () => {
    const world = makeWorld();
    (world as { status: string }).status = 'founded';
    const published = publish(world);
    const service = new FakeService().publish(published);
    expect((await rejection(fetchWorld(service.source, published.pointer))).reason).toBe<Reason>('invalid');
  });

  it('refuses a world that belongs to another preview', async () => {
    const published = publish(makeWorld(ID_B));
    const service = new FakeService().serve(`${BASE}/v1/preview/${ID_A}/world.json`, published.worldText);
    const pointerA = { ...published.pointer, id: ID_A };
    expect((await rejection(fetchWorld(service.source, pointerA))).reason).toBe<Reason>('mismatch');
  });

  it('reports a pruned world (404) as unavailable', async () => {
    const service = new FakeService();
    expect((await rejection(fetchWorld(service.source, publish().pointer))).reason).toBe<Reason>('unavailable');
  });
});

describe('fetchChunk', () => {
  it('fetches a region chunk from the preview folder and validates it', async () => {
    const published = publish();
    const service = new FakeService().publish(published);
    const chunk = await fetchChunk(service.source, published.world, 1);
    expect(chunk.region).toBe(1);
    expect(chunk.settlers.ids).toEqual(['108586685', '558501883']);
    expect(service.urls()).toEqual([`${BASE}/v1/preview/${ID_A}/region-1.json`]);
  });

  it('refuses an unknown region without asking the service', async () => {
    const published = publish();
    const service = new FakeService().publish(published);
    expect((await rejection(fetchChunk(service.source, published.world, 3))).reason).toBe<Reason>('invalid');
    expect((await rejection(fetchChunk(service.source, published.world, -1))).reason).toBe<Reason>('invalid');
    expect(service.calls).toHaveLength(0);
  });

  it('refuses a chunk that does not match its pinned hash', async () => {
    const published = publish();
    const service = new FakeService().publish(published);
    service.serve(`${BASE}/v1/preview/${ID_A}/region-0.json`, published.chunkTexts[1]!);
    expect((await rejection(fetchChunk(service.source, published.world, 0))).reason).toBe<Reason>('mismatch');
  });

  it('refuses a correctly pinned chunk that holds another region', async () => {
    const published = publish();
    // Pin region 0's reference to region 1's file: the bytes match, the content does not belong.
    published.world.regions[0]!.chunk = { ...published.world.regions[1]!.chunk, path: 'region-0.json' };
    const service = new FakeService().serve(`${BASE}/v1/preview/${ID_A}/region-0.json`, published.chunkTexts[1]!);
    const error = await rejection(fetchChunk(service.source, published.world, 0));
    expect(error.reason).toBe<Reason>('invalid');
    expect(error.message.startsWith('chunk.region')).toBe(true);
  });
});

describe('names projection', () => {
  const world = makeWorld();

  it('reads the names of its own preview, uncached by hash, and validates them', async () => {
    const published = publish();
    const service = new FakeService().publish(published);
    const names = await fetchNames(service.source, published.world);
    expect(names).toEqual(makeNames(published.world));
    expect(service.urls()).toEqual([`${BASE}/v1/preview/${ID_A}/names`]);
    expect(service.calls[0]!.init?.credentials).toBe('omit');
  });

  it.each<[string, (n: ServedNames) => void, string]>([
    ['names of another preview', (n) => { n.preview = ID_B; }, 'names.preview'],
    ['columns of different lengths', (n) => { n.freshUntil.pop(); }, 'names.freshUntil'],
    ['an upper-case login', (n) => { n.logins[0] = 'Zackrawrr'; }, 'names.logins[0]'],
    ['a login carrying markup', (n) => { n.logins[0] = '<img src=x>'; }, 'names.logins[0]'],
    ['a login longer than Twitch allows', (n) => { n.logins[0] = 'a'.repeat(26); }, 'names.logins[0]'],
    ['an empty display name', (n) => { n.names[0] = ''; }, 'names.names[0]'],
    ['a withheld entry that is not a channel ID', (n) => { n.withheld.push('../x'); }, 'names.withheld[0]'],
    ['a reason riding along', (n) => { (n as unknown as Record<string, unknown>).reasons = ['banned']; }, 'names.reasons'],
  ])('refuses %s', (_, mutate, path) => {
    const names = clone(makeNames(world));
    mutate(names);
    const error = caught(() => validateNames(names, world.id));
    expect(error.reason).toBe<Reason>('invalid');
    expect(error.message.startsWith(path)).toBe(true);
  });

  it('reports names refused by the service (503) as unavailable and broken JSON as invalid', async () => {
    const refused = new FakeService().serve(`${BASE}/v1/preview/${ID_A}/names`, '{"error":"names-unavailable"}', 503);
    expect((await rejection(fetchNames(refused.source, world))).reason).toBe<Reason>('unavailable');
    const broken = new FakeService().serve(`${BASE}/v1/preview/${ID_A}/names`, '{"version":1,');
    expect((await rejection(fetchNames(broken.source, world))).reason).toBe<Reason>('invalid');
  });
});
