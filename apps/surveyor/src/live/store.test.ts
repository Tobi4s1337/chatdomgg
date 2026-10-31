import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildFrame, judgeSweep, type BuiltFrame } from './frame';
import {
  KEEP_FRAMES, LIVE_FILES, framePath, liveRoot, liveTargetDir, publishFrame, pruneFrames, pruneLiveTargets, readLiveManifest, readLiveState,
  verifyFrame, writeLiveState, type LiveSourceState,
} from './store';
import { IDS, LANDLESS, copyLand, fixtureLand, iso, liveAt, liveSnapshot, type Land, type LiveChannelSpec } from './fixtures.test-support';

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

/** A frame of sweep `index`; `variant` changes one audience so two frames of the same sweep differ. */
async function frameAt(index: number, variant = 0): Promise<BuiltFrame> {
  const at = liveAt(index);
  const channels: LiveChannelSpec[] = [
    { id: IDS.capital, average: 6_000 + variant * 10_000 },
    { id: IDS.modest, average: variant ? 30 : 120 },
    { id: IDS.small, average: 8, startedAt: iso(at - 600_000) },
    { id: LANDLESS[0], average: 12, startedAt: iso(at - 60_000) },
  ];
  const sweep = judgeSweep(liveSnapshot(at, channels), at + 5_000);
  if (!sweep.ok) throw new Error(sweep.reason);
  return buildFrame(base.target, sweep, new Set(), at + 5_000);
}

const manifestFile = (l: Land) => join(liveTargetDir(l.dataDir, l.previewId), 'manifest.json');
const frameDirs = (l: Land) => readdirSync(liveTargetDir(l.dataDir, l.previewId)).filter((name) => name.startsWith('lf-')).sort();

describe('publishFrame', () => {
  it('writes the frame files, verifies them and then names them in the manifest', async () => {
    const l = land();
    const frame = await frameAt(1);
    expect(readLiveManifest(l.dataDir, l.previewId)).toBeNull();
    const result = await publishFrame(l.dataDir, l.previewId, frame, base.target.alignment);
    expect(result.outcome).toBe('published');
    expect(result.manifest.live.path).toBe(`/v1/live/${l.previewId}/${frame.frameId}/live.bin`);
    expect(result.manifest.starts.path).toBe(framePath(l.previewId, frame.frameId, 'starts'));
    expect(readLiveManifest(l.dataDir, l.previewId)).toEqual(result.manifest);

    const dir = join(liveTargetDir(l.dataDir, l.previewId), frame.frameId);
    expect(readdirSync(dir).sort()).toEqual(Object.values(LIVE_FILES).sort());
    expect(Buffer.from(readFileSync(join(dir, LIVE_FILES.live))).equals(Buffer.from(frame.live))).toBe(true);
    expect(Buffer.from(readFileSync(join(dir, LIVE_FILES.dabs))).equals(Buffer.from(frame.dabs))).toBe(true);
    // Nothing half-written is left beside the manifest: no staging folder, no temporary manifest.
    expect(readdirSync(liveTargetDir(l.dataDir, l.previewId)).sort()).toEqual([frame.frameId, 'manifest.json']);
    await expect(verifyFrame(l.dataDir, l.previewId, result.manifest, base.target.alignment)).resolves.toBeUndefined();
  });

  it('refuses the same observation (existing) and an older or equally old one (older), leaving the manifest byte-identical', async () => {
    const l = land();
    const first = await frameAt(2);
    await publishFrame(l.dataDir, l.previewId, first, base.target.alignment);
    const before = readFileSync(manifestFile(l));
    const inode = statSync(manifestFile(l)).ino;

    const again = await publishFrame(l.dataDir, l.previewId, first, base.target.alignment);
    expect(again.outcome).toBe('existing');
    const sameTime = await frameAt(2, 1);
    expect(sameTime.frameId).not.toBe(first.frameId);
    expect((await publishFrame(l.dataDir, l.previewId, sameTime, base.target.alignment)).outcome).toBe('older');
    const older = await publishFrame(l.dataDir, l.previewId, await frameAt(1), base.target.alignment);
    expect(older.outcome).toBe('older');
    expect(older.manifest.evidence.asOf).toBe(liveAt(2));

    expect(readFileSync(manifestFile(l)).equals(before)).toBe(true);
    expect(statSync(manifestFile(l)).ino).toBe(inode);
    // A refused frame writes no files either.
    expect(frameDirs(l)).toEqual([first.frameId]);
  });

  it('replaces the manifest with a newer frame and keeps the previous frame readable', async () => {
    const l = land();
    const first = await frameAt(1);
    const second = await frameAt(2);
    await publishFrame(l.dataDir, l.previewId, first, base.target.alignment);
    const old = readLiveManifest(l.dataDir, l.previewId)!;
    const published = await publishFrame(l.dataDir, l.previewId, second, base.target.alignment);
    expect(published.outcome).toBe('published');
    expect(readLiveManifest(l.dataDir, l.previewId)!.evidence.asOf).toBe(liveAt(2));
    // A reader holding the previous manifest still finds its bytes.
    await expect(verifyFrame(l.dataDir, l.previewId, old, base.target.alignment)).resolves.toBeUndefined();
  });

  it('never names a frame whose files on disk do not verify', async () => {
    const l = land();
    await publishFrame(l.dataDir, l.previewId, await frameAt(1), base.target.alignment);
    const before = readFileSync(manifestFile(l));
    const next = await frameAt(2);
    // A damaged folder already sits where the next frame would go (left by a crash, say).
    const dir = join(liveTargetDir(l.dataDir, l.previewId), next.frameId);
    mkdirSync(dir);
    writeFileSync(join(dir, LIVE_FILES.live), Buffer.alloc(next.live.byteLength, 9));
    writeFileSync(join(dir, LIVE_FILES.starts), next.starts);
    writeFileSync(join(dir, LIVE_FILES.dabs), next.dabs);
    await expect(publishFrame(l.dataDir, l.previewId, next, base.target.alignment)).rejects.toThrow(/hash mismatch/);
    expect(readFileSync(manifestFile(l)).equals(before)).toBe(true);
  });
});

describe('verifyFrame', () => {
  it('detects a flipped byte in live.bin and a truncated dabs.bin', async () => {
    const l = land();
    const frame = await frameAt(1);
    const { manifest } = await publishFrame(l.dataDir, l.previewId, frame, base.target.alignment);
    expect(manifest.dabs.count).toBe(2);
    const dir = join(liveTargetDir(l.dataDir, l.previewId), frame.frameId);

    const live = readFileSync(join(dir, LIVE_FILES.live));
    const flipped = Buffer.from(live);
    flipped[0] = flipped[0]! ^ 0x01;
    writeFileSync(join(dir, LIVE_FILES.live), flipped);
    await expect(verifyFrame(l.dataDir, l.previewId, manifest, base.target.alignment)).rejects.toThrow('Atlas artifact hash mismatch.');
    writeFileSync(join(dir, LIVE_FILES.live), live);

    const dabs = readFileSync(join(dir, LIVE_FILES.dabs));
    writeFileSync(join(dir, LIVE_FILES.dabs), dabs.subarray(0, dabs.length - 1));
    await expect(verifyFrame(l.dataDir, l.previewId, manifest, base.target.alignment)).rejects.toThrow('Atlas artifact length mismatch.');
    writeFileSync(join(dir, LIVE_FILES.dabs), dabs);
    await expect(verifyFrame(l.dataDir, l.previewId, manifest, base.target.alignment)).resolves.toBeUndefined();
  });

  it('refuses a manifest of another land or one pointing outside its own frames', async () => {
    const l = land();
    const { manifest } = await publishFrame(l.dataDir, l.previewId, await frameAt(1), base.target.alignment);
    const otherLand = { ...base.target.alignment, settlerOrderHash: 'f'.repeat(64) };
    await expect(verifyFrame(l.dataDir, l.previewId, manifest, otherLand)).rejects.toThrow(/settler order mismatch/);
    const foreign = { ...manifest, dabs: { ...manifest.dabs, path: '/v1/live/pv-20200101T000000Z-aaaaaaaaaaaa/lf-20200101T000000Z-aaaaaaaaaaaa/dabs.bin' } };
    await expect(verifyFrame(l.dataDir, l.previewId, foreign, base.target.alignment)).rejects.toThrow(/Unexpected live asset path/);
  });
});

describe('pruneFrames', () => {
  it(`keeps the current frame and the ${KEEP_FRAMES - 1} before it, and clears stray staging folders`, async () => {
    const l = land();
    const ids: string[] = [];
    for (let i = 1; i <= KEEP_FRAMES + 3; i++) {
      const frame = await frameAt(i);
      ids.push(frame.frameId);
      await publishFrame(l.dataDir, l.previewId, frame, base.target.alignment);
      expect(frameDirs(l).length).toBe(Math.min(i, KEEP_FRAMES));
    }
    expect(frameDirs(l)).toEqual(ids.slice(-KEEP_FRAMES).sort());

    const staging = join(liveTargetDir(l.dataDir, l.previewId), `.staging-${ids[0]}-1`);
    mkdirSync(staging);
    const removed = pruneFrames(l.dataDir, l.previewId, readLiveManifest(l.dataDir, l.previewId)!);
    expect(removed).toEqual([]);
    expect(existsSync(staging)).toBe(false);
    expect(frameDirs(l)).toEqual(ids.slice(-KEEP_FRAMES).sort());
  });

  it('keeps the frame a reader may still hold when the same sweep is re-gated, whichever hash sorts first', async () => {
    const l = land();
    const first = await frameAt(1);
    await publishFrame(l.dataDir, l.previewId, first, base.target.alignment);
    // The same sweep published again later with other content, as a re-gate does.
    // Choose one whose hash sorts before the first: a prune by full name would then drop the first.
    const at = liveAt(1);
    let again: BuiltFrame | null = null;
    for (let minutes = 1; !again || again.frameId > first.frameId; minutes++) {
      const sweep = judgeSweep(liveSnapshot(at, [{ id: IDS.capital, average: 6_000, startedAt: iso(at - minutes * 60_000) }]), at + 5_000);
      if (!sweep.ok) throw new Error(sweep.reason);
      again = await buildFrame(base.target, sweep, new Set(), at + 60_000);
    }
    expect(again.frameId.slice(0, 19)).toBe(first.frameId.slice(0, 19));
    expect((await publishFrame(l.dataDir, l.previewId, again, base.target.alignment)).outcome).toBe('published');
    expect(frameDirs(l)).toEqual([first.frameId, again.frameId].sort());
  });
});

describe('live state and targets', () => {
  it('round-trips the producer state and refuses one that does not parse', () => {
    const l = land();
    expect(readLiveState(l.dataDir)).toBeNull();
    const state: LiveSourceState = {
      version: 1, checkedAt: liveAt(3), state: 'partial', sweepAt: liveAt(3), completeAt: liveAt(2), gapBefore: false, reason: 'cut short', rule: 'sweep-complete-1',
    };
    writeLiveState(l.dataDir, state);
    expect(readLiveState(l.dataDir)).toEqual(state);
    expect(readdirSync(liveRoot(l.dataDir))).toEqual(['state.json']);
    expect(() => writeLiveState(l.dataDir, { ...state, state: 'fine' as never })).toThrow();
    expect(readLiveState(l.dataDir)).toEqual(state);
  });

  it('removes the live folders of previews that are gone, and only those', async () => {
    const l = land();
    await publishFrame(l.dataDir, l.previewId, await frameAt(1), base.target.alignment);
    const stray = join(liveRoot(l.dataDir), 'pv-20200101T000000Z-aaaaaaaaaaaa');
    mkdirSync(stray);
    writeLiveState(l.dataDir, { version: 1, checkedAt: liveAt(1), state: 'complete', sweepAt: liveAt(1), completeAt: liveAt(1), gapBefore: false, reason: null, rule: 'sweep-complete-1' });
    expect(pruneLiveTargets(l.dataDir, new Set([l.previewId]))).toEqual(['pv-20200101T000000Z-aaaaaaaaaaaa']);
    expect(readdirSync(liveRoot(l.dataDir)).sort()).toEqual([l.previewId, 'state.json']);
  });
});
