import { describe, expect, it } from 'vitest';
import { FakeService, ID_A, ID_B, makeWorld, MemoryStorage, publish, REV_B, type Published } from './fixtures.test-support';
import { adoptPreview, loadPreview, PIN_KEY } from './load';
import { PreviewError, type PreviewPointer } from './preview';

const HOUR = 3_600_000;
const older = (): Published => publish(makeWorld(ID_A));
const newer = (asOf = makeWorld().asOf + 4 * HOUR): Published => publish(makeWorld(ID_B, REV_B, asOf));
const pinOf = (storage: MemoryStorage): PreviewPointer | null => {
  const raw = storage.getItem(PIN_KEY);
  return raw === null ? null : (JSON.parse(raw) as PreviewPointer);
};

describe('loadPreview', () => {
  it('draws the current preview on first load and pins it for the session', async () => {
    const a = older();
    const service = new FakeService().publish(a);
    const storage = new MemoryStorage();
    const loaded = await loadPreview(service.source, storage);
    expect(loaded.pointer).toEqual(a.pointer);
    expect(loaded.world.id).toBe(ID_A);
    expect(loaded.newer).toBeNull();
    expect(pinOf(storage)).toEqual(a.pointer);
    expect(service.urls()).toEqual([service.pointerUrl(), service.worldUrl(ID_A)]);
  });

  it('keeps drawing the pinned preview when a newer survey appears, and reports the newer one', async () => {
    const a = older();
    const b = newer();
    const service = new FakeService().publish(a);
    const storage = new MemoryStorage();
    await loadPreview(service.source, storage);

    service.publish(b); // B is now current; A is still served.
    service.calls.length = 0;
    const loaded = await loadPreview(service.source, storage);
    expect(loaded.pointer).toEqual(a.pointer);
    expect(loaded.world.id).toBe(ID_A);
    expect(loaded.newer).toEqual(b.pointer);
    expect(pinOf(storage)).toEqual(a.pointer);
    // The newer world is not downloaded until the visitor adopts it.
    expect(service.urls()).toEqual([service.pointerUrl(), service.worldUrl(ID_A)]);
  });

  it('switches to the newer survey once it is adopted', async () => {
    const a = older();
    const b = newer();
    const service = new FakeService().publish(a);
    const storage = new MemoryStorage();
    await loadPreview(service.source, storage);
    service.publish(b);
    const offered = await loadPreview(service.source, storage);
    adoptPreview(storage, offered.newer!);
    const loaded = await loadPreview(service.source, storage);
    expect(loaded.pointer).toEqual(b.pointer);
    expect(loaded.world.id).toBe(ID_B);
    expect(loaded.newer).toBeNull();
    expect(pinOf(storage)).toEqual(b.pointer);
  });

  it('falls back to the current preview when the pinned one has been pruned (404)', async () => {
    const a = older();
    const b = newer();
    const storage = new MemoryStorage();
    adoptPreview(storage, a.pointer);
    const service = new FakeService().publish(b); // A's world is no longer served.
    const loaded = await loadPreview(service.source, storage);
    expect(loaded.pointer).toEqual(b.pointer);
    expect(loaded.world.id).toBe(ID_B);
    expect(loaded.newer).toBeNull();
    expect(pinOf(storage)).toEqual(b.pointer);
    expect(service.urls()).toEqual([service.pointerUrl(), service.worldUrl(ID_A), service.worldUrl(ID_B)]);
  });

  it('falls back to the current preview when the pinned world fails its hash', async () => {
    const a = older();
    const b = newer();
    const storage = new MemoryStorage();
    adoptPreview(storage, a.pointer);
    const service = new FakeService().publish(b).serve(new FakeService().worldUrl(ID_A), `${a.worldText}\n`);
    const loaded = await loadPreview(service.source, storage);
    expect(loaded.world.id).toBe(ID_B);
    expect(loaded.newer).toBeNull();
    expect(pinOf(storage)).toEqual(b.pointer);
  });

  it.each([
    ['not JSON', '{oops'],
    ['JSON of the wrong shape', '{"version":1,"id":"pv-1"}'],
    ['a JSON string', '"pv-20261030T015627Z-97344f8ef397"'],
  ])('removes a corrupt pin (%s) and pins the current preview', async (_, raw) => {
    const a = older();
    const service = new FakeService().publish(a);
    const storage = new MemoryStorage();
    storage.map.set(PIN_KEY, raw);
    const loaded = await loadPreview(service.source, storage);
    expect(storage.removed).toEqual([PIN_KEY]);
    expect(loaded.pointer).toEqual(a.pointer);
    expect(loaded.newer).toBeNull();
    expect(pinOf(storage)).toEqual(a.pointer);
  });

  it('draws the current preview when the pin is not older than it (a rolled-back service)', async () => {
    const a = older();
    const b = newer();
    const storage = new MemoryStorage();
    adoptPreview(storage, b.pointer);
    const service = new FakeService().publish(b, false).publish(a); // A is current again; B is still served.
    const loaded = await loadPreview(service.source, storage);
    expect(loaded.pointer).toEqual(a.pointer);
    expect(loaded.newer).toBeNull();
    expect(pinOf(storage)).toEqual(a.pointer);
    expect(service.urls()).not.toContain(service.worldUrl(ID_B));
  });

  it('works without storage at all', async () => {
    const a = older();
    const service = new FakeService().publish(a);
    const loaded = await loadPreview(service.source, null);
    expect(loaded.pointer).toEqual(a.pointer);
    expect(loaded.newer).toBeNull();
  });

  it('still loads when storage refuses writes (private mode, full quota)', async () => {
    const a = older();
    const service = new FakeService().publish(a);
    const storage = new MemoryStorage();
    storage.refuseWrites = true;
    const loaded = await loadPreview(service.source, storage);
    expect(loaded.pointer).toEqual(a.pointer);
    expect(pinOf(storage)).toBeNull();
    expect(() => adoptPreview(storage, a.pointer)).not.toThrow();
  });

  it('does not draw a stale pin when the service has no preview: the empty state wins', async () => {
    const storage = new MemoryStorage();
    adoptPreview(storage, older().pointer);
    const service = new FakeService().serve(new FakeService().pointerUrl(), '{"error":"no-preview"}', 503);
    const error = await loadPreview(service.source, storage).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PreviewError);
    expect((error as PreviewError).reason).toBe('empty');
  });

  it('does not overwrite the pin when the current world itself fails', async () => {
    const a = older();
    const b = newer();
    const storage = new MemoryStorage();
    adoptPreview(storage, a.pointer);
    // Only B's pointer is served; neither world is reachable.
    const service = new FakeService().serve(new FakeService().pointerUrl(), JSON.stringify(b.pointer));
    const error = await loadPreview(service.source, storage).catch((e: unknown) => e);
    expect((error as PreviewError).reason).toBe('unavailable');
    expect(pinOf(storage)).toEqual(a.pointer);
  });

  it('propagates an abort while fetching the pinned world instead of falling back', async () => {
    const a = older();
    const b = newer();
    const storage = new MemoryStorage();
    adoptPreview(storage, a.pointer);
    const service = new FakeService().publish(b);
    service.routes.set(service.worldUrl(ID_A), () => { throw new DOMException('The operation was aborted.', 'AbortError'); });
    const error = await loadPreview(service.source, storage).catch((e: unknown) => e);
    expect((error as Error).name).toBe('AbortError');
    expect(service.urls()).not.toContain(service.worldUrl(ID_B));
    expect(pinOf(storage)).toEqual(a.pointer);
  });
});

describe('adoptPreview', () => {
  it('stores the pointer under the session key as JSON that loadPreview accepts', async () => {
    const b = newer();
    const storage = new MemoryStorage();
    adoptPreview(storage, b.pointer);
    expect(storage.getItem(PIN_KEY)).toBe(JSON.stringify(b.pointer));
    const service = new FakeService().publish(b);
    expect((await loadPreview(service.source, storage)).pointer).toEqual(b.pointer);
    expect(storage.removed).toEqual([]);
  });
});
