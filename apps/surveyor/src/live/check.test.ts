import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { checkLive } from './check';
import { runLive } from './run';
import { LIVE_FILES, liveRoot, liveTargetDir, readLiveManifest } from './store';
import { IDS, LANDLESS, copyLand, fixtureLand, iso, liveAt, liveSnapshot, type Land } from './fixtures.test-support';

let base: Land;
beforeAll(async () => {
  base = await fixtureLand();
});
afterAll(() => base.cleanup());

const lands: Land[] = [];
afterEach(() => {
  while (lands.length) lands.pop()!.cleanup();
});

/** A land with one good frame published by the producer. */
async function publishedLand(): Promise<{ l: Land; dir: string; manifestPath: string; frameDir: string }> {
  const l = copyLand(base);
  lands.push(l);
  const at = liveAt(1);
  const result = await runLive(l.dataDir, null, new Map(), {
    now: () => at + 15_000,
    readSource: () => liveSnapshot(at, [{ id: IDS.capital, average: 6_000 }, { id: LANDLESS[0], average: 9, startedAt: iso(at - 60_000) }]),
  });
  expect(result.targets.map((target) => target.outcome)).toEqual(['published']);
  const dir = liveTargetDir(l.dataDir, l.previewId);
  return { l, dir, manifestPath: join(dir, 'manifest.json'), frameDir: join(dir, result.targets[0]!.frame!) };
}

describe('checkLive', () => {
  it('says plainly when no frame was published yet', async () => {
    const l = copyLand(base);
    lands.push(l);
    expect(await checkLive(l.dataDir)).toEqual({ lines: ['  live: no frame published yet (atlas:live has not run)'], problems: [] });
  });

  it('passes a good publish and describes it', async () => {
    const { l, frameDir } = await publishedLand();
    const report = await checkLive(l.dataDir);
    expect(report.problems).toEqual([]);
    const frame = frameDir.split('/').pop()!;
    expect(report.lines).toEqual([`  live ${l.previewId}: ${frame} observed ${new Date(liveAt(1)).toISOString().slice(0, 16).replace('T', ' ')} UTC · 6 holdings aligned · 1 dabs`]);
  });

  it('fails a manifest whose alignment no longer matches its land', async () => {
    const { l, manifestPath } = await publishedLand();
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { alignment: { settlerOrderHash: string } };
    manifest.alignment.settlerOrderHash = 'e'.repeat(64);
    writeFileSync(manifestPath, JSON.stringify(manifest));
    expect(readLiveManifest(l.dataDir, l.previewId)!.alignment.settlerOrderHash).toBe('e'.repeat(64));
    expect((await checkLive(l.dataDir)).problems).toEqual([`live/${l.previewId}: Atlas edition or settler order mismatch; reload the matching index.`]);
  });

  it('fails a corrupted copy of live.bin and a truncated dabs.bin', async () => {
    const { l, frameDir } = await publishedLand();
    const livePath = join(frameDir, LIVE_FILES.live);
    const original = readFileSync(livePath);
    const flipped = Buffer.from(original);
    flipped[original.length - 2] = flipped[original.length - 2]! ^ 0x04;
    writeFileSync(livePath, flipped);
    expect((await checkLive(l.dataDir)).problems).toEqual([`live/${l.previewId}: Atlas artifact hash mismatch.`]);
    writeFileSync(livePath, original);

    const dabsPath = join(frameDir, LIVE_FILES.dabs);
    writeFileSync(dabsPath, readFileSync(dabsPath).subarray(0, 12));
    expect((await checkLive(l.dataDir)).problems).toEqual([`live/${l.previewId}: Atlas artifact length mismatch.`]);
  });

  it('fails a stray target directory for a preview this service does not keep', async () => {
    const { l } = await publishedLand();
    mkdirSync(join(liveRoot(l.dataDir), 'pv-20200101T000000Z-aaaaaaaaaaaa'));
    expect((await checkLive(l.dataDir)).problems).toEqual(['live/pv-20200101T000000Z-aaaaaaaaaaaa: a frame for a preview this service no longer keeps']);
  });

  it('fails an unreadable manifest or state file, naming the file', async () => {
    const { l, manifestPath } = await publishedLand();
    writeFileSync(join(liveRoot(l.dataDir), 'state.json'), '{"version":2}');
    writeFileSync(manifestPath, '{"version":1');
    const { problems } = await checkLive(l.dataDir);
    expect(problems).toHaveLength(2);
    expect(problems[0]).toMatch(/^live\/state\.json: /);
    expect(problems[1]).toMatch(new RegExp(`^live/${l.previewId}/manifest\\.json: `));
  });

  it('fails a manifest that claims partial coverage', async () => {
    const { l, manifestPath } = await publishedLand();
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { coverage: string };
    manifest.coverage = 'partial';
    writeFileSync(manifestPath, JSON.stringify(manifest));
    const { problems } = await checkLive(l.dataDir);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(new RegExp(`^live/${l.previewId}: .*partial`, 'i'));
  });
});
