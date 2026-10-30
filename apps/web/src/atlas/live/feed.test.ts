import { describe, expect, it, vi } from 'vitest';
import {
  ATLAS_LIVE_STALE_AFTER_MS, ATLAS_SPECTACLE, AtlasManifestSchema, createAtlasAlignment, encodeDabsV1, encodeLiveV2,
  type AtlasAlignment, type AtlasDab, type AtlasEdition, type AtlasLiveSlot, type AtlasManifest, type AtlasSettler, type KingdomId,
} from '@chatdom/shared';
import { BASE, CHUNK_ROWS, FakeService, makeChunk, makeWorld, publish, sha } from '../data/fixtures.test-support';
import { SettlerStore } from '../data/model';
import { PREVIEW_LABEL, TIER_CODES, type PreviewWorld } from '../data/preview';
import {
  LiveFeed, parsePointer, RECONCILE_MS, regionOffsets, settlerCount, type EventSourceLike, type LiveFrame, type LiveSource,
  type LiveStatus,
} from './feed';

/**
 * A live frame for the fixture land, written the way apps/surveyor/src/live/frame.ts writes one: live-v2 bytes from
 * the shared encoder, a live-starts-v1 JSON sidecar with one entry per live ordinal, dabs-v1 in canonical order, and a
 * manifest validated by the shared schema.
 */
interface FrameSpec {
  asOf: number;
  /** liveClass per ordinal; everything else is offline. */
  live?: Record<number, number>;
  spectacle?: Record<number, number>;
  /** Real stream starts per live ordinal; a live ordinal without one started a minute before the cut. */
  starts?: Record<number, number | null>;
  dabs?: AtlasDab[];
  alignment?: Partial<AtlasAlignment>;
  coverage?: AtlasManifest['coverage'];
  realmCount?: number;
}

interface Built {
  manifest: AtlasManifest;
  live: Uint8Array;
  starts: Uint8Array;
  dabs: Uint8Array;
}

/** The fixture world's settler order: `world.head`, then each region's chunk in region order. */
const orderOf = (world: PreviewWorld) => [...world.head.ids, ...world.regions.flatMap((region) => makeChunk(world, region.index).settlers.ids)];

async function alignmentOf(world: PreviewWorld, worldSha256: string, ids = orderOf(world)): Promise<AtlasAlignment> {
  const edition: AtlasEdition = {
    version: 1, id: world.id, label: PREVIEW_LABEL, status: 'preview', foundedAt: world.asOf, worldHash: worldSha256, realmCount: world.realms.length,
  };
  const realms = [...world.head.realm, ...world.regions.flatMap((region) => makeChunk(world, region.index).settlers.realm)];
  const tiers = [...world.head.tier, ...world.regions.flatMap((region) => makeChunk(world, region.index).settlers.tier)];
  const settlers: AtlasSettler[] = ids.map((id, ordinal) => ({
    ordinal, kingdomId: id as KingdomId, holdingId: `${world.id}:${ordinal}`, realmIndex: realms[ordinal] ?? 0,
    holdingTier: TIER_CODES[tiers[ordinal] ?? 3]!, point: { x: 0, y: 0 }, settledAt: world.asOf,
  }));
  return createAtlasAlignment(edition, settlers);
}

class Land {
  readonly service = new FakeService();
  readonly changes: { frame: LiveFrame | null; status: LiveStatus }[] = [];
  readonly timers: { run: () => void; ms: number; handle: number }[] = [];
  readonly cleared: unknown[] = [];
  clock: number;
  private serial = 0;

  constructor(readonly world: PreviewWorld, readonly worldSha256: string, readonly alignment: AtlasAlignment) {
    this.clock = world.asOf + 600_000;
  }

  static async create(): Promise<Land> {
    const world = makeWorld();
    const { worldText } = publish(world);
    const worldSha256 = sha(worldText);
    return new Land(world, worldSha256, await alignmentOf(world, worldSha256));
  }

  feed(stream: ((url: string) => EventSourceLike) | null = null): LiveFeed {
    return new LiveFeed(this.service.source, this.world, this.worldSha256, (frame, status) => this.changes.push({ frame, status }), {
      now: () => this.clock,
      openStream: stream,
      setTimer: (run, ms) => {
        const handle = this.timers.length + 1;
        this.timers.push({ run, ms, handle });
        return handle;
      },
      clearTimer: (handle) => this.cleared.push(handle),
    });
  }

  get pointerUrl(): string {
    return `${BASE}/v1/live/${this.world.id}`;
  }

  /** Builds a frame and serves its three assets at their own immutable paths. */
  async frame(spec: FrameSpec): Promise<Built> {
    const alignment = { ...this.alignment, ...spec.alignment };
    const count = alignment.settlerCount;
    const slots: AtlasLiveSlot[] = Array.from({ length: count }, (_, ordinal) => ({
      liveClass: (spec.live?.[ordinal] ?? 0) as AtlasLiveSlot['liveClass'],
      spectacle: spec.spectacle?.[ordinal] ?? ATLAS_SPECTACLE.none,
    }));
    const live = encodeLiveV2(slots);
    const entries = slots.flatMap((slot, ordinal) =>
      slot.liveClass ? [{ ordinal, startedAt: spec.starts && ordinal in spec.starts ? spec.starts[ordinal]! : spec.asOf - 60_000 }] : []);
    const starts = new TextEncoder().encode(JSON.stringify({ version: 1, alignment, asOf: spec.asOf, entries }));
    const dabs = encodeDabsV1(spec.dabs ?? []);
    const dir = `/v1/live/${this.world.id}/frames/f${++this.serial}`;
    const manifest = AtlasManifestSchema.parse({
      version: 1,
      alignment,
      evidence: { kind: 'observed', asOf: spec.asOf },
      publishedAt: spec.asOf + 4_000,
      realmCount: spec.realmCount ?? this.world.realms.length,
      coverage: spec.coverage ?? 'complete-sweep',
      live: { format: 'live-v2', path: `${dir}/live.bin`, sha256: sha(live), byteLength: live.byteLength },
      starts: { format: 'live-starts-v1', path: `${dir}/starts.json`, sha256: sha(starts), byteLength: starts.byteLength },
      dabs: { format: 'dabs-v1', path: `${dir}/dabs.bin`, count: spec.dabs?.length ?? 0, sha256: sha(dabs), byteLength: dabs.byteLength },
    });
    this.service.serve(`${BASE}${manifest.live.path}`, live);
    this.service.serve(`${BASE}${manifest.starts.path}`, starts);
    this.service.serve(`${BASE}${manifest.dabs.path}`, dabs);
    return { manifest, live, starts, dabs };
  }

  pointer(manifest: AtlasManifest | null, source: Partial<LiveSource> = {}, preview = this.world.id): unknown {
    const at = manifest?.evidence.asOf ?? this.world.asOf;
    return {
      version: 1, kind: 'chatdom-atlas-live-pointer', preview,
      source: { state: 'complete', checkedAt: at, sweepAt: at, completeAt: at, gapBefore: false, ...source },
      manifest,
    };
  }

  servePointer(manifest: AtlasManifest | null, source: Partial<LiveSource> = {}): void {
    this.service.serve(this.pointerUrl, JSON.stringify(this.pointer(manifest, source)));
  }
}

/** Waits until every offer made so far has been applied (offers are chained; a later one may extend the chain). */
async function settled(feed: LiveFeed): Promise<void> {
  const chain = () => (feed as unknown as { applying: Promise<void> }).applying;
  let current: Promise<void>;
  do {
    current = chain();
    await current;
  } while (current !== chain());
}

const T = 1_793_325_387_307; // the fixture survey's cut
const dab = (realmIndex: number, channelHash: string, startedAt: number): AtlasDab => ({ realmIndex, channelHash, startedAt });

describe('settler order', () => {
  it('counts the head, then every region chunk, as the SettlerStore numbers them', async () => {
    const land = await Land.create();
    const { world } = land;
    expect(settlerCount(world)).toBe(7);
    expect(regionOffsets(world)).toEqual([3, 5, 7]);
    const store = new SettlerStore(world, () => T);
    for (const region of world.regions) store.addChunk(makeChunk(world, region.index));
    expect(store.total).toBe(settlerCount(world));
    const ids = orderOf(world);
    for (let ordinal = 0; ordinal < ids.length; ordinal++) expect(store.byOrdinal(ordinal)?.id).toBe(ids[ordinal]);
    regionOffsets(world).forEach((offset, region) => {
      const rows = CHUNK_ROWS[region] ?? [];
      rows.forEach((row, i) => {
        expect(store.byOrdinal(offset + i)?.id).toBe(row.id);
        expect(store.byOrdinal(offset + i)?.region).toBe(region);
      });
    });
  });

  it('agrees with the alignment createAtlasAlignment hashes over that order', async () => {
    const land = await Land.create();
    expect(land.alignment.settlerCount).toBe(settlerCount(land.world));
    expect(land.alignment.editionId).toBe(land.world.id);
    expect(land.alignment.worldHash).toBe(land.worldSha256);
    // Any other order hashes differently, so a reordered producer would be caught after the first frame.
    const swapped = orderOf(land.world);
    [swapped[0], swapped[3]] = [swapped[3]!, swapped[0]!];
    expect((await alignmentOf(land.world, land.worldSha256, swapped)).settlerOrderHash).not.toBe(land.alignment.settlerOrderHash);
    // The feed demands exactly this alignment for the land.
    const feed = land.feed();
    const { manifest } = await land.frame({ asOf: T });
    expect(feed.expected(manifest)).toEqual(land.alignment);
  });

  it('counts chunk records even when a region is not loaded yet', () => {
    const world = makeWorld();
    world.regions[0]!.chunk.records = 10;
    world.regions[1]!.chunk.records = 0;
    world.regions[2]!.chunk.records = 4;
    expect(settlerCount(world)).toBe(3 + 10 + 0 + 4);
    expect(regionOffsets(world)).toEqual([3, 13, 13]);
  });
});

describe('parsePointer', () => {
  it('reads a pointer for this preview, with or without a manifest', async () => {
    const land = await Land.create();
    const { manifest } = await land.frame({ asOf: T });
    const parsed = parsePointer(land.pointer(manifest), land.world.id);
    expect(parsed.manifest).toEqual(manifest);
    expect(parsed.source).toEqual({ state: 'complete', checkedAt: T, sweepAt: T, completeAt: T, gapBefore: false });
    const empty = parsePointer(land.pointer(null, { state: 'empty', sweepAt: null, completeAt: null }), land.world.id);
    expect(empty.manifest).toBeNull();
    expect(empty.source.state).toBe('empty');
  });

  it('rejects a pointer for another preview, another kind or version', async () => {
    const land = await Land.create();
    const good = land.pointer(null) as Record<string, unknown>;
    expect(() => parsePointer(land.pointer(null, {}, 'pv-20261030T055627Z-0123456789ab'), land.world.id)).toThrow();
    expect(() => parsePointer({ ...good, kind: 'chatdom-atlas-survey-preview' }, land.world.id)).toThrow();
    expect(() => parsePointer({ ...good, version: 2 }, land.world.id)).toThrow();
    for (const value of [null, 'pointer', [], 42]) expect(() => parsePointer(value, land.world.id)).toThrow();
  });

  it('rejects malformed source state', async () => {
    const land = await Land.create();
    const bad: Record<string, unknown>[] = [
      { state: 'sweeping' },
      { state: undefined },
      { checkedAt: -1 },
      { sweepAt: 1.5 },
      { completeAt: '2026-10-30T00:00:00Z' },
      { gapBefore: 'no' },
      { gapBefore: undefined },
    ];
    for (const patch of bad) {
      const pointer = land.pointer(null) as { source: Record<string, unknown> };
      pointer.source = { ...pointer.source, ...patch };
      expect(() => parsePointer(pointer, land.world.id), JSON.stringify(patch)).toThrow();
    }
    const missing = land.pointer(null) as Record<string, unknown>;
    delete missing.source;
    expect(() => parsePointer(missing, land.world.id)).toThrow();
  });

  it('rejects a manifest the shared schema refuses', async () => {
    const land = await Land.create();
    const { manifest } = await land.frame({ asOf: T });
    expect(() => parsePointer(land.pointer({ ...manifest, publishedAt: T - 1 }), land.world.id)).toThrow();
    expect(() => parsePointer(land.pointer({ ...manifest, live: { ...manifest.live, byteLength: 12 } }), land.world.id)).toThrow();
  });
});

describe('LiveFeed', () => {
  it('applies a valid complete frame: slots, starts and dabs decoded, observed time kept', async () => {
    const land = await Land.create();
    const dabs = [dab(1, 'ffff000000000001', T - 300_000), dab(1, '0000aaaa00000002', T - 600_000), dab(4, '1234567890abcdef', T - 30_000)];
    const { manifest } = await land.frame({
      asOf: T, live: { 0: 1, 2: 2, 6: 4 }, spectacle: { 0: ATLAS_SPECTACLE.crowning }, starts: { 0: T - 900_000, 2: null, 6: T - 120_000 }, dabs,
    });
    land.servePointer(manifest);
    land.clock = T + 30_000;
    const feed = land.feed();
    await feed.reconcile();
    const frame = feed.current()!;
    expect(frame).not.toBeNull();
    expect(Array.from(frame.slots)).toEqual([1, 6, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 4, 0]);
    expect([...frame.starts.entries()]).toEqual([[0, T - 900_000], [2, null], [6, T - 120_000]]);
    // Decoded in canonical order: realm, then hash.
    expect(frame.dabs).toEqual([dabs[1], dabs[0], dabs[2]]);
    // The observation time is the sweep's, never the time it was fetched or published.
    expect(frame.asOf).toBe(T);
    expect(frame.publishedAt).toBe(T + 4_000);
    expect(frame.path).toBe(manifest.live.path);
    expect(feed.status()).toMatchObject({ freshness: 'fresh', frameAsOf: T, refused: null });
    expect(land.changes.at(-1)!.frame).toBe(frame);
    // Every read goes out without credentials.
    expect(land.service.calls.every((call) => call.init?.credentials === 'omit')).toBe(true);
  });

  it('refuses a partial sweep and keeps the previous frame and its time', async () => {
    const land = await Land.create();
    const a = await land.frame({ asOf: T, live: { 0: 1, 1: 2 } });
    const feed = land.feed();
    feed.offer(land.pointer(a.manifest));
    await settled(feed);
    const before = feed.current()!;
    // A newer sweep that was cut short, which would show both holdings offline.
    const partial = await land.frame({ asOf: T + 180_000, coverage: 'partial' });
    feed.offer(land.pointer(partial.manifest, { state: 'partial' }));
    await settled(feed);
    expect(feed.current()).toBe(before);
    expect(Array.from(before.slots.subarray(0, 4))).toEqual([1, 0, 2, 0]);
    expect(feed.status()).toMatchObject({ refused: 'partial', frameAsOf: T, source: { state: 'partial' } });
    // The assets of a partial sweep are never even fetched.
    expect(land.service.urls().some((url) => url.includes(partial.manifest.live.path))).toBe(false);
  });

  it('refuses a partial sweep as the very first offer and shows no frame', async () => {
    const land = await Land.create();
    const partial = await land.frame({ asOf: T, coverage: 'partial' });
    const feed = land.feed();
    feed.offer(land.pointer(partial.manifest, { state: 'partial' }));
    await settled(feed);
    expect(feed.current()).toBeNull();
    expect(feed.status()).toMatchObject({ freshness: 'none', frameAsOf: null, refused: 'partial' });
  });

  describe('alignment', () => {
    const cases: [string, (land: Land) => Promise<Partial<AtlasAlignment>>][] = [
      ['another world hash', async () => ({ worldHash: 'a'.repeat(64) })],
      ['another edition', async () => ({ editionId: 'pv-20261030T055627Z-0123456789ab' })],
      ['another settler count', async () => ({ settlerCount: 8 })],
      ['a shorter settler count', async () => ({ settlerCount: 6 })],
    ];
    for (const [name, patch] of cases) {
      it(`refuses a frame of ${name} and keeps the old frame`, async () => {
        const land = await Land.create();
        const a = await land.frame({ asOf: T, live: { 3: 3 } });
        const feed = land.feed();
        feed.offer(land.pointer(a.manifest));
        await settled(feed);
        const before = feed.current()!;
        const b = await land.frame({ asOf: T + 180_000, alignment: await patch(land) });
        feed.offer(land.pointer(b.manifest));
        await settled(feed);
        expect(feed.current()).toBe(before);
        expect(feed.status()).toMatchObject({ refused: 'alignment', frameAsOf: T });
      });
    }

    it('refuses a different settler order once a first order has been accepted', async () => {
      const land = await Land.create();
      const feed = land.feed();
      const a = await land.frame({ asOf: T, live: { 3: 3 } });
      feed.offer(land.pointer(a.manifest));
      await settled(feed);
      const swapped = orderOf(land.world);
      [swapped[0], swapped[3]] = [swapped[3]!, swapped[0]!];
      const other = await alignmentOf(land.world, land.worldSha256, swapped);
      const b = await land.frame({ asOf: T + 180_000, live: { 0: 3 }, alignment: { settlerOrderHash: other.settlerOrderHash } });
      feed.offer(land.pointer(b.manifest));
      await settled(feed);
      expect(feed.current()!.asOf).toBe(T);
      expect(feed.current()!.slots[6]).toBe(3);
      expect(feed.status().refused).toBe('alignment');
      // The original order is still accepted afterwards.
      const c = await land.frame({ asOf: T + 360_000, live: { 1: 2 } });
      feed.offer(land.pointer(c.manifest));
      await settled(feed);
      expect(feed.current()!.asOf).toBe(T + 360_000);
      expect(feed.status().refused).toBeNull();
    });

    it('refuses before any frame when the edition is wrong, and shows nothing', async () => {
      const land = await Land.create();
      const feed = land.feed();
      const b = await land.frame({ asOf: T, live: { 0: 1 }, alignment: { worldHash: 'b'.repeat(64) } });
      feed.offer(land.pointer(b.manifest));
      await settled(feed);
      expect(feed.current()).toBeNull();
      expect(feed.status()).toMatchObject({ refused: 'alignment', freshness: 'none' });
    });
  });

  describe('corrupt assets', () => {
    const corruptions: [string, (built: Built, land: Land) => void][] = [
      ['a live.bin whose hash does not match', (built, land) => {
        const bytes = Uint8Array.from(built.live);
        bytes[0] = 0; // the same length, everyone offline
        land.service.serve(`${BASE}${built.manifest.live.path}`, bytes);
      }],
      ['a truncated live.bin', (built, land) => land.service.serve(`${BASE}${built.manifest.live.path}`, built.live.subarray(0, 6))],
      ['an empty live.bin', (built, land) => land.service.serve(`${BASE}${built.manifest.live.path}`, new Uint8Array(0))],
      ['a starts sidecar that does not match', (built, land) => land.service.serve(`${BASE}${built.manifest.starts.path}`, built.starts.subarray(1))],
      ['dabs that do not match', (built, land) => {
        const bytes = Uint8Array.from(built.dabs);
        bytes[5] = (bytes[5]! + 1) % 256;
        land.service.serve(`${BASE}${built.manifest.dabs.path}`, bytes);
      }],
      ['a missing asset', (built, land) => land.service.serve(`${BASE}${built.manifest.live.path}`, 'gone', 404)],
    ];
    for (const [name, corrupt] of corruptions) {
      it(`refuses ${name} as corrupt and never paints everyone offline`, async () => {
        const land = await Land.create();
        const feed = land.feed();
        const a = await land.frame({ asOf: T, live: { 0: 1, 4: 3 } });
        feed.offer(land.pointer(a.manifest));
        await settled(feed);
        const before = feed.current()!;
        const b = await land.frame({ asOf: T + 180_000, live: { 0: 1, 4: 3, 5: 4 }, dabs: [dab(2, 'abcdefabcdef0123', T)] });
        corrupt(b, land);
        feed.offer(land.pointer(b.manifest));
        await settled(feed);
        expect(feed.current()).toBe(before);
        expect(before.slots[0]).toBe(1);
        expect(before.slots[8]).toBe(3);
        expect(feed.status()).toMatchObject({ refused: 'corrupt', frameAsOf: T });
      });
    }

    it('refuses a pointer that is not JSON or not this land’s as corrupt', async () => {
      const land = await Land.create();
      land.service.serve(land.pointerUrl, '{"version":1,');
      const feed = land.feed();
      await feed.reconcile();
      land.service.serve(land.pointerUrl, JSON.stringify(land.pointer(null, {}, 'pv-20261030T055627Z-0123456789ab')));
      await feed.reconcile();
      expect(feed.status()).toMatchObject({ refused: 'corrupt', source: null });
    });
  });

  it('never rolls back to an older or equal manifest', async () => {
    const land = await Land.create();
    const feed = land.feed();
    const newer = await land.frame({ asOf: T + 180_000, live: { 1: 2 } });
    feed.offer(land.pointer(newer.manifest));
    await settled(feed);
    const shown = feed.current()!;
    const older = await land.frame({ asOf: T, live: { 0: 1 } });
    const same = await land.frame({ asOf: T + 180_000, live: { 0: 1, 1: 2 } });
    feed.offer(land.pointer(older.manifest));
    feed.offer(land.pointer(same.manifest));
    await settled(feed);
    expect(feed.current()).toBe(shown);
    expect(feed.status()).toMatchObject({ frameAsOf: T + 180_000, refused: null });
    // Neither was worth fetching.
    expect(land.service.urls().some((url) => url.includes(older.manifest.live.path) || url.includes(same.manifest.live.path))).toBe(false);
  });

  describe('a failed pointer read', () => {
    it('keeps the frame and its time when the pointer read is refused or rejected', async () => {
      const land = await Land.create();
      const a = await land.frame({ asOf: T, live: { 0: 1 } });
      land.servePointer(a.manifest);
      const feed = land.feed();
      await feed.reconcile();
      const shown = feed.current()!;
      land.service.serve(land.pointerUrl, 'upstream down', 500);
      land.clock = T + 60_000;
      await feed.reconcile();
      expect(feed.current()).toBe(shown);
      expect(feed.status()).toMatchObject({ frameAsOf: T, refused: null, freshness: 'fresh' });
      land.service.routes.set(land.pointerUrl, () => Promise.reject(new TypeError('network down')));
      await feed.reconcile();
      expect(feed.current()).toBe(shown);
      expect(feed.status()).toMatchObject({ frameAsOf: T, refused: null, transport: 'polling' });
    });

    it('says unreachable when there is no frame yet', async () => {
      const land = await Land.create();
      land.service.routes.set(land.pointerUrl, () => Promise.reject(new TypeError('network down')));
      const feed = land.feed();
      await feed.reconcile();
      expect(feed.current()).toBeNull();
      expect(feed.status()).toMatchObject({ refused: 'unreachable', freshness: 'none', frameAsOf: null });
      expect(land.changes.at(-1)!.status.refused).toBe('unreachable');
      land.service.serve(land.pointerUrl, '', 503);
      await feed.reconcile();
      expect(feed.status().refused).toBe('unreachable');
    });
  });

  it('clears unreachable once the pointer reads again, even before a first frame', async () => {
    const land = await Land.create();
    land.service.routes.set(land.pointerUrl, () => Promise.reject(new TypeError('network down')));
    const feed = land.feed();
    await feed.reconcile();
    expect(feed.status().refused).toBe('unreachable');
    land.servePointer(null, { state: 'partial', completeAt: null });
    await feed.reconcile();
    expect(feed.status().source?.state).toBe('partial');
    expect(feed.status().refused).toBeNull();
  });

  it('refuses a frame whose realm count is not this land’s', async () => {
    const land = await Land.create();
    const feed = land.feed();
    const a = await land.frame({ asOf: T, live: { 0: 1 } });
    feed.offer(land.pointer(a.manifest));
    await settled(feed);
    const extra = land.world.realms.length;
    const b = await land.frame({ asOf: T + 180_000, live: { 0: 1 }, realmCount: extra + 1, dabs: [dab(extra, 'aaaaaaaaaaaaaaaa', T)] });
    feed.offer(land.pointer(b.manifest));
    await settled(feed);
    expect(feed.current()!.asOf).toBe(T);
    expect(feed.status().refused).not.toBeNull();
  });

  describe('freshness', () => {
    it('turns stale with injected time alone, past 270 s after the observation', async () => {
      const land = await Land.create();
      const a = await land.frame({ asOf: T, live: { 0: 1 } });
      land.clock = T + 10_000;
      const feed = land.feed();
      expect(feed.status().freshness).toBe('none');
      feed.offer(land.pointer(a.manifest));
      await settled(feed);
      expect(feed.status().freshness).toBe('fresh');
      land.clock = T + ATLAS_LIVE_STALE_AFTER_MS;
      expect(feed.status().freshness).toBe('fresh');
      land.clock = T + ATLAS_LIVE_STALE_AFTER_MS + 1;
      expect(feed.status()).toMatchObject({ freshness: 'stale', frameAsOf: T });
      land.clock = T + 3_600_000;
      expect(feed.status().freshness).toBe('stale');
    });

    it('reports clock skew when the device clock is behind the observation', async () => {
      const land = await Land.create();
      const a = await land.frame({ asOf: T, live: { 0: 1 } });
      land.clock = T - 5_000;
      const feed = land.feed();
      feed.offer(land.pointer(a.manifest));
      await settled(feed);
      expect(feed.current()!.asOf).toBe(T);
      expect(feed.status().freshness).toBe('clock-skew');
      land.clock = T;
      expect(feed.status().freshness).toBe('fresh');
    });
  });

  describe('ordering', () => {
    it('applies offers in order: the later observation wins even when the earlier one resolves later', async () => {
      const land = await Land.create();
      const feed = land.feed();
      const early = await land.frame({ asOf: T, live: { 0: 1 } });
      const late = await land.frame({ asOf: T + 180_000, live: { 1: 2 } });
      // Hold the early frame's live.bin until after the later offer has been made.
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      land.service.routes.set(`${BASE}${early.manifest.live.path}`, async () => {
        await gate;
        return new Response(Uint8Array.from(early.live));
      });
      feed.offer(land.pointer(early.manifest));
      feed.offer(land.pointer(late.manifest));
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(feed.current()).toBeNull();
      release();
      await settled(feed);
      expect(feed.current()!.asOf).toBe(T + 180_000);
      expect(feed.current()!.slots[2]).toBe(2);
      const shown = land.changes.filter((change) => change.frame).map((change) => change.frame!.asOf);
      expect(shown).toEqual([T, T + 180_000]);
    });

    it('drops an earlier observation offered after a later one', async () => {
      const land = await Land.create();
      const feed = land.feed();
      const early = await land.frame({ asOf: T, live: { 0: 1 } });
      const late = await land.frame({ asOf: T + 180_000, live: { 1: 2 } });
      feed.offer(land.pointer(late.manifest));
      feed.offer(land.pointer(early.manifest));
      await settled(feed);
      expect(feed.current()!.asOf).toBe(T + 180_000);
      expect(land.changes.filter((change) => change.frame).every((change) => change.frame!.asOf === T + 180_000)).toBe(true);
    });
  });

  describe('transport', () => {
    class FakeStream implements EventSourceLike {
      readonly listeners = new Map<string, (event: MessageEvent<string>) => void>();
      onerror: ((event: Event) => void) | null = null;
      onopen: ((event: Event) => void) | null = null;
      closed = false;
      constructor(readonly url: string) {}
      addEventListener(type: string, listener: (event: MessageEvent<string>) => void): void {
        this.listeners.set(type, listener);
      }
      close(): void {
        this.closed = true;
      }
      send(data: string): void {
        this.listeners.get('live')!({ data } as MessageEvent<string>);
      }
    }

    it('subscribes once, applies streamed pointers, reconciles on a timer and closes on dispose', async () => {
      const land = await Land.create();
      const a = await land.frame({ asOf: T, live: { 0: 1 } });
      land.servePointer(a.manifest);
      const streams: FakeStream[] = [];
      const feed = land.feed((url) => {
        const stream = new FakeStream(url);
        streams.push(stream);
        return stream;
      });
      feed.start();
      await vi.waitFor(() => expect(feed.current()).not.toBeNull());
      expect(streams).toHaveLength(1);
      expect(streams[0]!.url).toBe(`${BASE}/v1/live/${land.world.id}/events`);
      expect(feed.current()!.asOf).toBe(T);
      expect(land.timers).toHaveLength(1);
      expect(land.timers[0]!.ms).toBe(RECONCILE_MS);

      streams[0]!.onopen!(new Event('open'));
      expect(feed.status().transport).toBe('streaming');
      const b = await land.frame({ asOf: T + 180_000, live: { 1: 2 } });
      streams[0]!.send(JSON.stringify(land.pointer(b.manifest)));
      await settled(feed);
      expect(feed.current()!.asOf).toBe(T + 180_000);

      streams[0]!.send('not json');
      expect(feed.status()).toMatchObject({ refused: 'corrupt', frameAsOf: T + 180_000 });
      streams[0]!.onerror!(new Event('error'));
      expect(feed.status().transport).toBe('polling');

      // The reconcile timer re-reads the pointer and schedules the next one.
      const c = await land.frame({ asOf: T + 360_000, live: { 2: 2 } });
      land.servePointer(c.manifest);
      land.timers[0]!.run();
      await vi.waitFor(() => expect(land.timers).toHaveLength(2));
      expect(feed.current()!.asOf).toBe(T + 360_000);

      feed.dispose();
      expect(streams[0]!.closed).toBe(true);
      expect(land.cleared).toEqual([land.timers[1]!.handle]);
      expect(feed.status().transport).toBe('closed');
      const count = land.changes.length;
      streams[0]!.send(JSON.stringify(land.pointer(c.manifest)));
      await settled(feed);
      expect(land.changes).toHaveLength(count);
    });

    it('leaves no reconcile timer behind when disposed during a read', async () => {
      const land = await Land.create();
      const a = await land.frame({ asOf: T, live: { 0: 1 } });
      land.servePointer(a.manifest);
      const feed = land.feed(null);
      feed.start();
      await vi.waitFor(() => expect(feed.current()).not.toBeNull());
      expect(land.timers).toHaveLength(1);
      land.timers[0]!.run();
      feed.dispose();
      await settled(feed);
      await new Promise((done) => setTimeout(done, 20));
      expect(land.timers).toHaveLength(1);
      expect(land.cleared).toEqual([land.timers[0]!.handle]);
    });

    it('polls when no stream can be opened', async () => {
      const land = await Land.create();
      land.servePointer(null, { state: 'empty', sweepAt: null, completeAt: null });
      const feed = land.feed(null);
      feed.start();
      expect(feed.status().transport).toBe('polling');
      await vi.waitFor(() => expect(land.changes.length).toBeGreaterThan(0));
      expect(feed.status()).toMatchObject({ freshness: 'none', source: { state: 'empty' }, refused: null });
      feed.dispose();
    });
  });
});
