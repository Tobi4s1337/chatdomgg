import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { decodeLiveV2 } from '@chatdom/shared';
import type { SourceLiveSnapshot } from '../source/sqlite';
import { previewDir } from '../preview/store';
import { runLive } from './run';
import { liveRoot, liveTargetDir, readLiveManifest, readLiveState } from './store';
import type { LiveTarget } from './target';
import { IDS, LANDLESS, copyLand, fixtureLand, iso, liveAt, liveSnapshot, writeWithheld, type Land, type LiveChannelSpec } from './fixtures.test-support';

let base: Land;
beforeAll(async () => {
  base = await fixtureLand();
});
afterAll(() => base.cleanup());

const lands: Land[] = [];
afterEach(() => {
  while (lands.length) lands.pop()!.cleanup();
});
function land(): Land {
  const copy = copyLand(base);
  lands.push(copy);
  return copy;
}

const channelsAt = (at: number): LiveChannelSpec[] => [
  { id: IDS.capital, average: 6_000 },
  { id: IDS.village, average: 60, lang: 'de' },
  { id: IDS.small, average: 8, startedAt: iso(at - 600_000) },
  { id: LANDLESS[0], average: 12, startedAt: iso(at - 60_000) },
];
const complete = (index: number) => liveSnapshot(liveAt(index), channelsAt(liveAt(index)));

/** Runs one producer step against a fixed read, with the clock a little after that read's sweep. */
async function step(l: Land, read: SourceLiveSnapshot | (() => SourceLiveSnapshot), clockAt: number, cache = new Map<string, LiveTarget>()) {
  return runLive(l.dataDir, null, cache, { now: () => clockAt, readSource: typeof read === 'function' ? read : () => read });
}

const manifestFile = (l: Land) => join(liveTargetDir(l.dataDir, l.previewId), 'manifest.json');

describe('runLive', () => {
  it('publishes a complete sweep for every kept preview and records it as complete', async () => {
    const l = land();
    const result = await step(l, complete(1), liveAt(1) + 15_000);
    expect(result.targets).toEqual([expect.objectContaining({ previewId: l.previewId, outcome: 'published', error: null })]);
    expect(result.targets[0]!.counts).toMatchObject({ live: 2, dabs: 2 });
    const manifest = readLiveManifest(l.dataDir, l.previewId)!;
    expect(manifest.evidence).toEqual({ kind: 'observed', asOf: liveAt(1) });
    expect(manifest.live.path).toContain(result.targets[0]!.frame!);
    expect(readLiveState(l.dataDir)).toEqual({
      version: 1, checkedAt: liveAt(1) + 15_000, state: 'complete', sweepAt: liveAt(1), completeAt: liveAt(1), gapBefore: false, reason: null, rule: 'sweep-complete-1',
    });
    const live = await decodeLiveV2(new Uint8Array(readFileSync(join(liveTargetDir(l.dataDir, l.previewId), result.targets[0]!.frame!, 'live.bin'))), manifest, base.target.alignment);
    expect(live[base.target.ordinalOf.get(IDS.capital)! * 2]).toBe(1);
    expect(live[base.target.ordinalOf.get(IDS.village)! * 2]).toBe(3);
  });

  const refused: [string, () => SourceLiveSnapshot, string][] = [
    ['partial', () => liveSnapshot(liveAt(2), channelsAt(liveAt(2)), { streams: 20 }), 'partial'],
    ['collapsed', () => liveSnapshot(liveAt(2), channelsAt(liveAt(2)), { streams: 400, history: Array.from({ length: 10 }, () => 1_000) }), 'partial'],
    ['incoherent', () => liveSnapshot(liveAt(2), [...channelsAt(liveAt(2)), { id: IDS.quiet, lastLive: liveAt(1) }]), 'incoherent'],
    ['future', () => liveSnapshot(liveAt(2) + 10 * 60_000, channelsAt(liveAt(2))), 'future'],
  ];
  it.each(refused)('keeps the last frame with its original observation time after a %s sweep', async (_name, read, state) => {
    const l = land();
    await step(l, complete(1), liveAt(1) + 15_000);
    const before = readFileSync(manifestFile(l));
    const snapshot = read();
    const result = await step(l, snapshot, liveAt(2) + 15_000);
    expect(result.targets).toEqual([]);
    expect(readFileSync(manifestFile(l)).equals(before)).toBe(true);
    expect(readLiveManifest(l.dataDir, l.previewId)!.evidence.asOf).toBe(liveAt(1));
    expect(readLiveState(l.dataDir)).toMatchObject({
      state, checkedAt: liveAt(2) + 15_000, sweepAt: snapshot.sweeps[0]!.at, completeAt: liveAt(1), gapBefore: false, reason: expect.any(String),
    });
  });

  it('records an empty source and publishes nothing', async () => {
    const l = land();
    const result = await step(l, { openedAt: 1, readMs: 0, sweeps: [], channels: [], categories: [] }, liveAt(1));
    expect(result.state).toMatchObject({ state: 'empty', sweepAt: null, completeAt: null });
    expect(existsSync(liveTargetDir(l.dataDir, l.previewId))).toBe(false);
  });

  it('publishes nothing new while the withheld list is unreadable (fail closed), without reading the source', async () => {
    const l = land();
    writeWithheld(l.dataDir, '{"version":1,');
    const read = vi.fn(() => complete(1));
    const first = await step(l, read, liveAt(1) + 15_000);
    expect(read).not.toHaveBeenCalled();
    expect(first.state).toMatchObject({ state: 'moderation-unreadable', sweepAt: null, completeAt: null, reason: expect.stringMatching(/^The withheld list could not be read: /) });
    expect(existsSync(liveTargetDir(l.dataDir, l.previewId))).toBe(false);

    // With a frame already out, the frame stays exactly as it was.
    writeWithheld(l.dataDir, []);
    await step(l, complete(1), liveAt(1) + 15_000);
    const before = readFileSync(manifestFile(l));
    writeWithheld(l.dataDir, '{"version":1,"updatedAt":1,"kingdomIds":["not-an-id"]}');
    const second = await step(l, complete(2), liveAt(2) + 15_000);
    expect(second.state).toMatchObject({ state: 'moderation-unreadable', sweepAt: liveAt(1), completeAt: liveAt(1) });
    expect(readFileSync(manifestFile(l)).equals(before)).toBe(true);
  });

  it('records an unreadable source as unavailable and keeps the manifest', async () => {
    const l = land();
    await step(l, complete(1), liveAt(1) + 15_000);
    const before = readFileSync(manifestFile(l));
    const result = await step(l, () => {
      throw new Error('database is locked');
    }, liveAt(2) + 15_000);
    expect(result.state).toMatchObject({ state: 'unavailable', sweepAt: liveAt(1), completeAt: liveAt(1), reason: expect.stringContaining('database is locked') });
    expect(readFileSync(manifestFile(l)).equals(before)).toBe(true);

    // Without a test seam and without a database path, the real reader says so.
    const missing = await runLive(l.dataDir, null, new Map(), { now: () => liveAt(3) });
    expect(missing.state).toMatchObject({ state: 'unavailable', reason: expect.stringContaining('SURVEYOR_DB_PATH') });
    expect(readFileSync(manifestFile(l)).equals(before)).toBe(true);
  });

  it('refuses a sweep older than one already published: nothing rolls back', async () => {
    const l = land();
    await step(l, complete(3), liveAt(3) + 15_000);
    const before = readFileSync(manifestFile(l));
    const result = await step(l, complete(2), liveAt(3) + 45_000);
    expect(result.targets).toEqual([]);
    expect(result.state).toMatchObject({ state: 'incoherent', sweepAt: liveAt(2), completeAt: liveAt(3), reason: expect.stringContaining('older than a frame already published') });
    expect(readFileSync(manifestFile(l)).equals(before)).toBe(true);
  });

  it('reads the same sweep again without a new frame', async () => {
    const l = land();
    await step(l, complete(1), liveAt(1) + 15_000);
    const before = readFileSync(manifestFile(l));
    const again = await step(l, complete(1), liveAt(1) + 45_000);
    expect(again.targets.map((target) => target.outcome)).toEqual(['existing']);
    expect(again.state).toMatchObject({ state: 'complete', completeAt: liveAt(1) });
    expect(readFileSync(manifestFile(l)).equals(before)).toBe(true);
  });

  it('tolerates a corrupt state file: it is rewritten, and the manifest still refuses an older frame', async () => {
    const l = land();
    await step(l, complete(2), liveAt(2) + 15_000);
    const before = readFileSync(manifestFile(l));
    writeFileSync(join(liveRoot(l.dataDir), 'state.json'), '{"version":1,"state":');
    const older = await step(l, complete(1), liveAt(2) + 45_000);
    expect(older.targets.map((target) => target.outcome)).toEqual(['older']);
    expect(readFileSync(manifestFile(l)).equals(before)).toBe(true);
    expect(() => readLiveState(l.dataDir)).not.toThrow();

    writeFileSync(join(liveRoot(l.dataDir), 'state.json'), 'not json');
    const next = await step(l, complete(3), liveAt(3) + 15_000);
    expect(next.targets.map((target) => target.outcome)).toEqual(['published']);
    expect(readLiveState(l.dataDir)).toMatchObject({ state: 'complete', sweepAt: liveAt(3), completeAt: liveAt(3) });
  });

  it('marks a frame that follows missed sweeps', async () => {
    const l = land();
    const snapshot = complete(5);
    snapshot.sweeps = [snapshot.sweeps[0]!, ...snapshot.sweeps.slice(3)];
    const result = await step(l, snapshot, liveAt(5) + 15_000);
    expect(result.state).toMatchObject({ state: 'complete', gapBefore: true });
  });

  it('drops a removed preview from the cache and its live folder with it', async () => {
    const l = land();
    const cache = new Map<string, LiveTarget>();
    await step(l, complete(1), liveAt(1) + 15_000, cache);
    expect([...cache.keys()]).toEqual([l.previewId]);
    rmSync(previewDir(l.dataDir, l.previewId), { recursive: true });
    const result = await step(l, complete(2), liveAt(2) + 15_000, cache);
    expect(result.pruned).toEqual([l.previewId]);
    expect(cache.size).toBe(0);
    expect(existsSync(liveTargetDir(l.dataDir, l.previewId))).toBe(false);
    // With no land to take it, the sweep is seen but nothing is complete beyond what was.
    expect(result.state).toMatchObject({ state: 'complete', completeAt: liveAt(1), reason: 'No preview could take the frame.' });
  });

  it('takes a new withholding off the live paint at the next run, even before the next sweep', async () => {
    const l = land();
    await step(l, complete(1), liveAt(1) + 15_000);
    writeWithheld(l.dataDir, [IDS.capital]);
    // The producer runs every 30 s; the source sweeps every three minutes. This is the same sweep, read again.
    await step(l, complete(1), liveAt(1) + 45_000);
    const manifest = readLiveManifest(l.dataDir, l.previewId)!;
    expect(manifest.evidence.asOf).toBe(liveAt(1));
    expect(manifest.publishedAt).toBe(liveAt(1) + 45_000);
    const frame = manifest.live.path.split('/')[4]!;
    const live = await decodeLiveV2(new Uint8Array(readFileSync(join(liveTargetDir(l.dataDir, l.previewId), frame, 'live.bin'))), manifest, base.target.alignment);
    expect(live[base.target.ordinalOf.get(IDS.capital)! * 2]).toBe(0);
    expect(live[base.target.ordinalOf.get(IDS.village)! * 2]).toBe(3);
  });

  it('takes a new withholding off the published frame while the sweeps stay partial, keeping their observation time', async () => {
    const l = land();
    await step(l, complete(1), liveAt(1) + 15_000);
    writeWithheld(l.dataDir, [IDS.capital]);
    const result = await step(l, liveSnapshot(liveAt(2), channelsAt(liveAt(2)), { streams: 20 }), liveAt(2) + 15_000);
    expect(result.state.state).toBe('partial');
    expect(result.targets).toEqual([expect.objectContaining({ outcome: 'published', error: null })]);
    const manifest = readLiveManifest(l.dataDir, l.previewId)!;
    expect(manifest.evidence.asOf).toBe(liveAt(1));
    const frame = manifest.live.path.split('/')[4]!;
    const live = await decodeLiveV2(new Uint8Array(readFileSync(join(liveTargetDir(l.dataDir, l.previewId), frame, 'live.bin'))), manifest, base.target.alignment);
    expect(live[base.target.ordinalOf.get(IDS.capital)! * 2]).toBe(0);
    expect(live[base.target.ordinalOf.get(IDS.village)! * 2]).toBe(3);
    // Nothing else is withheld on the next run, so the frame is left as it is.
    const again = await step(l, liveSnapshot(liveAt(2), channelsAt(liveAt(2)), { streams: 20 }), liveAt(2) + 45_000);
    expect(again.targets).toEqual([]);
  });
});
