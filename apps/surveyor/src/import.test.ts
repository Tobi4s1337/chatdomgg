import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { checkDataDir } from './check';
import { MAX_ERROR_DETAILS } from './errors';
import { SNAPSHOT_FILE_NAMES, type ChannelObservation, type RaidObservation } from './export/schema';
import { runImport, type ImportOutcome } from './import';
import { acquireLock, layout, readCurrent, readLedger, revisionDir } from './store/revisions';
import { FixtureSource, RECENT, T0, clock, configFor, fakeSurveyor, sweepAt, tempDataDir } from './test/fixture-source';
import { allowRealImports } from './test/timeouts';

allowRealImports();

const cleanup: (() => void)[] = [];
afterEach(() => {
  while (cleanup.length) cleanup.pop()!();
});

function world() {
  const source = FixtureSource.standard();
  const dataDir = tempDataDir();
  cleanup.push(() => source.close(), () => rmSync(dataDir, { recursive: true, force: true }));
  return { source, dataDir };
}

async function importOnce(source: FixtureSource, dataDir: string, routes?: Parameters<typeof fakeSurveyor>[0], now = clock()) {
  const { fetchImpl } = fakeSurveyor(routes ?? { status: source.status(), 'raids/recent': RECENT });
  return runImport(configFor(source, dataDir), { fetchImpl, now, sleep: async () => {} });
}

function published(outcome: ImportOutcome) {
  if (!outcome.ok) throw new Error(`import failed: ${outcome.error.code} ${outcome.error.message}`);
  return outcome;
}

function records<T>(dataDir: string, revision: string, file: keyof typeof SNAPSHOT_FILE_NAMES): T[] {
  return readFileSync(join(revisionDir(dataDir, revision), SNAPSHOT_FILE_NAMES[file]), 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line) as T);
}

describe('atlas:import', () => {
  it('exports the actual channels, categories and raids with their source dates and coverage', async () => {
    const { source, dataDir } = world();
    const result = published(await importOnce(source, dataDir));
    expect(result.outcome).toBe('published');
    const { manifest } = result;
    expect(manifest.asOf).toBe(sweepAt(4));
    expect(manifest.window).toMatchObject({ firstObservationAt: T0, lastObservationAt: sweepAt(4), sweeps: 5, gapCount: 0 });
    expect(manifest.founding).toEqual({ status: 'not-founded', edition0EligibleAt: T0 + 48 * 3_600_000, editionIEligibleAt: T0 + 7 * 86_400_000, observedMs: 4 * 180_000 });
    expect(manifest.coverage.contentLabels).toBe('not-collected');
    expect(manifest.coverage.raidWatch).toMatchObject({ watching: 2, enabled: true, liveCandidates: 2 });
    expect(manifest.source.database).toMatchObject({ readOnly: true, transaction: 'single-read', sweeps: 5, lagSweeps: 0 });
    expect(manifest.source.http.recentPairsMatched).toBe(1);
    expect(manifest.counts).toMatchObject({ channels: 4, kingdomCandidates: 3, liveChannels: 3, liveCandidates: 2, raidPairs: 1, raidObservations: 3 });

    const channels = records<ChannelObservation>(dataDir, result.revision, 'channels');
    expect(channels.map((channel) => channel.kingdomId)).toEqual(['900000000000000001', '900000000000000002', '900000000000000003', '900000000000000004']);
    const town = channels[1]!;
    expect(town).toMatchObject({ displayName: 'フィクスチャ町', language: 'ja', averageViewers: 60, kingdomCandidate: true, live: false, contentClassification: 'unknown' });
    expect(town.categories).toEqual([{ gameId: '21779', minutes: 9 }]);
    expect(channels[3]).toMatchObject({ kingdomCandidate: false, averageViewers: 8, avatarUrl: null });
    const raids = records<RaidObservation>(dataDir, result.revision, 'raidObservations');
    expect(raids[0]!.raid).toMatchObject({ source: 'surveyor-recorder', occurredAt: null, evidence: { kind: 'observed' } });
    expect(raids.map((observation) => observation.betweenCandidates)).toEqual([true, true, false]);

    expect(checkDataDir(dataDir)).toMatchObject({ ok: true, revision: result.revision });
    expect(readLedger(dataDir)).toEqual([expect.objectContaining({ outcome: 'published', revision: result.revision, asOf: sweepAt(4) })]);
  });

  it('is reproducible: the same source gives the same revision and does not rewrite it', async () => {
    const { source, dataDir } = world();
    const first = published(await importOnce(source, dataDir));
    const second = published(await importOnce(source, dataDir, undefined, clock(sweepAt(40))));
    expect(second).toMatchObject({ outcome: 'unchanged', revision: first.revision });
    expect(second.manifest.contentHash).toBe(first.manifest.contentHash);
    expect(readdirSync(layout(dataDir).revisions)).toEqual([first.revision]);
    expect(readLedger(dataDir).map((entry) => entry.outcome)).toEqual(['published', 'unchanged']);
  });

  it('keeps the last good revision when the Surveyor fails, answers garbage, or describes another collector', async () => {
    const { source, dataDir } = world();
    const good = published(await importOnce(source, dataDir));
    const pointer = readFileSync(layout(dataDir).current, 'utf8');
    source.addSweeps(1);

    const failures = [
      await importOnce(source, dataDir, { status: async () => new Response('down', { status: 502 }) }),
      await importOnce(source, dataDir, { status: { since: 'yesterday' }, 'raids/recent': RECENT }),
      await importOnce(source, dataDir, { status: source.status({ since: T0 - 1 }), 'raids/recent': RECENT }),
      await runImport(configFor(null, dataDir), { fetchImpl: fakeSurveyor({ status: source.status(), 'raids/recent': RECENT }).fetchImpl, now: clock() }),
    ];
    expect(failures.map((outcome) => (outcome.ok ? 'ok' : outcome.error.code))).toEqual(['source-http', 'source-schema', 'source-incoherent', 'inventory-missing']);
    for (const outcome of failures) if (!outcome.ok) expect(outcome.currentRevision).toBe(good.revision);
    expect(readFileSync(layout(dataDir).current, 'utf8')).toBe(pointer);
    expect(checkDataDir(dataDir)).toMatchObject({ ok: true, revision: good.revision });
    const ledger = readLedger(dataDir);
    expect(ledger.map((entry) => entry.outcome)).toEqual(['published', 'failed', 'failed', 'failed', 'failed']);
    expect(ledger[4]!.message).toMatch(/SURVEYOR_DB_PATH/);
  });

  it('never manufactures channels when the inventory is empty', async () => {
    const source = new FixtureSource();
    const dataDir = tempDataDir();
    cleanup.push(() => source.close(), () => rmSync(dataDir, { recursive: true, force: true }));
    const noSweeps = await importOnce(source, dataDir, { status: source.status({ since: T0 }), 'raids/recent': [] });
    expect(noSweeps).toMatchObject({ ok: false, error: { code: 'inventory-empty' }, currentRevision: null });
    source.addSweeps(3);
    const noChannels = await importOnce(source, dataDir, { status: source.status({ channels: 34_000, liveNow: 34_000 }), 'raids/recent': [] });
    expect(noChannels).toMatchObject({ ok: false, error: { code: 'inventory-empty' } });
    expect(existsSync(layout(dataDir).revisions) ? readdirSync(layout(dataDir).revisions) : []).toEqual([]);
    expect(existsSync(layout(dataDir).current)).toBe(false);
  });

  it('swaps atomically: a crash after writing but before the pointer swap leaves the previous revision current', async () => {
    const { source, dataDir } = world();
    const good = published(await importOnce(source, dataDir));
    source.addSweeps(1);
    source.db.prepare('UPDATE channels SET last_live = ?, live_min = live_min + 3 WHERE live = 1').run(sweepAt(5));
    const { fetchImpl } = fakeSurveyor({ status: source.status(), 'raids/recent': RECENT });
    const crashed = await runImport(configFor(source, dataDir), {
      fetchImpl, now: clock(sweepAt(20)), beforePublish: () => { throw new Error('power cut'); },
    });
    expect(crashed).toMatchObject({ ok: false, currentRevision: good.revision });
    expect(readCurrent(dataDir)?.revision).toBe(good.revision);
    expect(readdirSync(layout(dataDir).revisions)).toEqual([good.revision]);
    // The next import clears the abandoned staging folder and publishes the newer snapshot.
    const next = published(await importOnce(source, dataDir, undefined, clock(sweepAt(30))));
    expect(next.revision).not.toBe(good.revision);
    expect(next.manifest.asOf).toBe(sweepAt(5));
    expect(existsSync(layout(dataDir).staging)).toBe(false);
    expect(checkDataDir(dataDir)).toMatchObject({ ok: true, revision: next.revision });
    // Both revisions remain readable and verifiable until retention prunes the older one.
    expect(checkDataDir(dataDir, good.revision).ok).toBe(true);
  });

  it('keeps only the configured number of revisions and never prunes the current one', async () => {
    const { source, dataDir } = world();
    const revisions: string[] = [];
    for (let i = 0; i < 4; i++) {
      source.addSweeps(1);
      source.db.prepare('UPDATE channels SET last_live = ? WHERE live = 1').run(sweepAt(source.sweeps - 1));
      const outcome = await runImport(configFor(source, dataDir, { keepRevisions: 2 }), {
        fetchImpl: fakeSurveyor({ status: source.status(), 'raids/recent': RECENT }).fetchImpl, now: clock(sweepAt(100 + i * 10)),
      });
      revisions.push(published(outcome).revision);
    }
    expect(readdirSync(layout(dataDir).revisions).sort()).toEqual(revisions.slice(2).sort());
    expect(readCurrent(dataDir)?.revision).toBe(revisions[3]);
  });

  it('applies raw-content retention: stream facts a day after last live, stale or foreign avatars', async () => {
    const { source, dataDir } = world();
    source.addSweeps(500);
    source.db.prepare('UPDATE channels SET last_live = ?, live = 1 WHERE id = ?').run(sweepAt(504), '900000000000000001');
    source.db.prepare('UPDATE channels SET live = 0 WHERE id IN (?, ?)').run('900000000000000003', '900000000000000004');
    source.addChannel({ id: '900000000000000005', login: 'fixture_offsite', name: 'Offsite', firstSweep: 503, lastSweep: 504, live: false, liveMin: 6, viewerMin: 600, avatar: 'https://example.com/a.png' });
    source.db.prepare('UPDATE channels SET live = 1 WHERE id = ?').run('900000000000000005');
    const result = published(await importOnce(source, dataDir, undefined, clock(sweepAt(600))));
    const channels = records<ChannelObservation>(dataDir, result.revision, 'channels');
    const byId = new Map<string, ChannelObservation>(channels.map((channel) => [channel.kingdomId, channel]));
    expect(byId.get('900000000000000001')?.stream?.title).toBe('A fixture stream');
    expect(byId.get('900000000000000002')?.stream).toBeNull();
    expect(byId.get('900000000000000002')?.avatarUrl).toBeNull();
    expect(byId.get('900000000000000002')?.avatarFactsAt).toBeNull();
    expect(byId.get('900000000000000005')?.avatarUrl).toBeNull();
    expect(byId.get('900000000000000005')?.avatarFactsAt).toBeNull();
    expect(result.manifest.counts.streamsExpired).toBe(3);
    expect(result.manifest.counts.avatarsDropped).toBeGreaterThanOrEqual(3);
    expect(checkDataDir(dataDir).ok).toBe(true);
  });

  it('skips a few invalid rows with a bounded count, but fails a broken source with bounded detail', async () => {
    const { source, dataDir } = world();
    source.addChannel({ id: '900000000000000006', login: 'Not A Login!', name: 'x', firstSweep: 1, lastSweep: 2, live: false, liveMin: 3, viewerMin: 90 });
    const tolerated = published(await importOnce(source, dataDir));
    expect(tolerated.manifest.counts.rejected).toEqual({ 'channel.login': 1 });
    expect(tolerated.manifest.counts.rejectedSamples).toEqual(['channel.login: 900000000000000006']);

    for (let i = 0; i < 40; i++) {
      source.addChannel({ id: `91000000000000${String(i).padStart(4, '0')}`, login: `bad login ${i}`, name: 'x'.repeat(500), firstSweep: 1, lastSweep: 2, live: false, liveMin: 3, viewerMin: 90 });
    }
    const broken = await importOnce(source, dataDir, undefined, clock(sweepAt(50)));
    expect(broken).toMatchObject({ ok: false, error: { code: 'inventory-invalid' }, currentRevision: tolerated.revision });
    if (!broken.ok) {
      expect(broken.error.details.length).toBeLessThanOrEqual(MAX_ERROR_DETAILS);
      expect(broken.error.message).toMatch(/^41 of \d+ source rows failed validation/);
    }
  });

  it('refuses a second concurrent import rather than mixing snapshots', async () => {
    const { source, dataDir } = world();
    const release = acquireLock(dataDir);
    writeFileSync(layout(dataDir).lock, JSON.stringify({ pid: process.ppid }));
    const blocked = await importOnce(source, dataDir);
    expect(blocked).toMatchObject({ ok: false, error: { code: 'store' } });
    release();
    published(await importOnce(source, dataDir));
  });
});

describe('atlas:check', () => {
  it('rejects a corrupted copy, a tampered pointer and an injected file', async () => {
    const { source, dataDir } = world();
    const { revision } = published(await importOnce(source, dataDir));
    const dir = revisionDir(dataDir, revision);
    const channels = join(dir, SNAPSHOT_FILE_NAMES.channels);
    const original = readFileSync(channels);

    const flipped = Buffer.from(original);
    flipped[20] = flipped[20]! ^ 0x01;
    writeFileSync(channels, flipped);
    expect(checkDataDir(dataDir)).toMatchObject({ ok: false, problems: [expect.stringMatching(/channels: SHA-256 does not match/)] });

    writeFileSync(channels, original.subarray(0, original.length - 5));
    expect(checkDataDir(dataDir).problems.join('\n')).toMatch(/channels: \d+ bytes, manifest says/);
    writeFileSync(channels, original);
    expect(checkDataDir(dataDir).ok).toBe(true);

    writeFileSync(join(dir, 'debug-dump.json'), '{}');
    expect(checkDataDir(dataDir).problems).toContain('Unexpected file debug-dump.json in the revision.');
    rmSync(join(dir, 'debug-dump.json'));

    const pointerPath = layout(dataDir).current;
    const pointer = JSON.parse(readFileSync(pointerPath, 'utf8')) as Record<string, unknown>;
    writeFileSync(pointerPath, JSON.stringify({ ...pointer, manifestSha256: 'f'.repeat(64) }));
    expect(checkDataDir(dataDir).problems).toContain('current.json does not match the revision manifest hash.');
  });

  it('rejects a manifest that claims a founded record or a person field', async () => {
    const { source, dataDir } = world();
    const { revision } = published(await importOnce(source, dataDir));
    const manifestPath = join(revisionDir(dataDir, revision), 'import.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { founding: Record<string, unknown> };
    writeFileSync(manifestPath, JSON.stringify({ ...manifest, founding: { ...manifest.founding, status: 'founded' } }));
    expect(checkDataDir(dataDir, revision).ok).toBe(false);

    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    const channels = join(revisionDir(dataDir, revision), SNAPSHOT_FILE_NAMES.channels);
    const lines = readFileSync(channels, 'utf8').split('\n');
    lines[0] = JSON.stringify({ ...JSON.parse(lines[0]!), viewerIds: ['12345'] });
    writeFileSync(channels, lines.join('\n'));
    expect(checkDataDir(dataDir, revision).ok).toBe(false);
  });
});
