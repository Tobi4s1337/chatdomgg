import { afterEach, describe, expect, it, vi } from 'vitest';
import { BASE, clone, FakeService, ID_A, ID_B, makeChunk, makeNames, makeWorld, publish, sha } from './fixtures.test-support';
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
    ['a coast of an unknown region', (w) => { w.coasts[0]!.region = 2; }, 'world.coasts'],
    ['a coast with a fractional value', (w) => { w.coasts[0]!.points[2] = 0.5; }, 'world.coasts[0].points[2]'],
    ['a cluster of an unknown game', (w) => { w.clusters[0]!.game = 3; }, 'world.clusters'],
    ['a cluster of an unknown region', (w) => { w.clusters[0]!.region = 2; }, 'world.clusters'],
    ['decor that is not in triples', (w) => { w.decor.pop(); }, 'world.decor'],
    ['a head column of the wrong length', (w) => { w.head.average.pop(); }, 'world.head.average'],
    ['a town in the head (towns arrive per region)', (w) => { w.head.tier[1] = 2; }, 'world.head.tier[1]'],
    ['a head tier out of range', (w) => { w.head.tier[0] = 4; }, 'world.head.tier[0]'],
    ['a head settler of an unknown region', (w) => { w.head.region[0] = 2; }, 'world.head.region[0]'],
    ['a head settler of an unknown game', (w) => { w.head.game[0] = 3; }, 'world.head.game[0]'],
    ['a game index below −1', (w) => { w.head.game[0] = -2; }, 'world.head.game[0]'],
    ['a channel ID with a leading zero', (w) => { w.head.ids[0] = '0552120296'; }, 'world.head.ids[0]'],
    ['a channel ID that is not numeric', (w) => { w.head.ids[0] = '55212029a'; }, 'world.head.ids[0]'],
    ['raw logins inside the immutable world', (w) => { (w.head as unknown as Record<string, unknown>).logins = ['zackrawrr', 'hasanabi', 'gronkh']; }, 'world.head.logins'],
    ['raw names inside the immutable world', (w) => { (w.head as unknown as Record<string, unknown>).names = ['zackrawrr', 'HasanAbi', 'GRONKH']; }, 'world.head.names'],
    ['a world that does not say which gambling policy it was drawn under', (w) => { delete (w as Partial<PreviewWorld>).policy; }, 'world.policy'],
    ['a negative average', (w) => { w.head.average[0] = -1; }, 'world.head.average[0]'],
    ['a NaN coordinate', (w) => { w.head.x[0] = Number.NaN; }, 'world.head.x[0]'],
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
    expect((await rejection(fetchChunk(service.source, published.world, 2))).reason).toBe<Reason>('invalid');
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
