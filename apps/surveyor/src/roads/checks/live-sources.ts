import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import type { AtlasRaid } from '@chatdom/shared';
import { readCurrent, readManifest } from '../../store/revisions';
import { createRoadRuntime } from '../runtime';
import { RoadLedger } from '../ledger';

/** Manual read-only evidence: uses the configured real collector, writes an isolated private road store. */
async function main() {
  const seed = resolve(process.env.ATLAS_DATA_DIR ?? 'apps/surveyor/shots/atlas-data');
  const pointer = readCurrent(seed);
  if (!pointer) throw new Error('A verified local import is required to identify the collector.');
  const source = readManifest(seed, pointer.revision);
  if (source.sha256 !== pointer.manifestSha256) throw new Error('Seed manifest hash mismatch.');
  const base = process.env.SURVEYOR_BASE_URL ?? source.manifest.source.http.base;
  const path = process.env.SURVEYOR_DB_PATH ?? source.manifest.source.database.path;
  const pairFile = join(seed, 'revisions', pointer.revision, source.manifest.files.raidPairs.path);
  const knownPair = readFileSync(pairFile, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line) as { fromKingdomId: string; toKingdomId: string; raids: number }).find(pair => pair.raids >= 3);
  if (!knownPair) throw new Error('The real seed contains no aggregate-backed road.');
  const original = statSync(path);
  const dataDir = mkdtempSync(join(dirname(seed), 'road-sources-'));
  const live: AtlasRaid[] = [];
  const logs: string[] = [];
  const start = Date.now();
  const runtime = createRoadRuntime(dataDir, {
    feedUrl: null, surveyorBase: base, recorderPath: path,
    onLiveRaid: raid => live.push(raid),
  }, line => { logs.push(line); process.stdout.write(`${line}\n`); });
  const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
  async function until(check: () => boolean, label: string, timeout: number) {
    const at = Date.now();
    let announced = at;
    while (!check()) {
      if (Date.now() - at > timeout) throw new Error(`Live source guard timed out: ${label}.`);
      if (Date.now() - announced > 10_000) {
        process.stdout.write(`${label}: ${runtime.coverage().state}\n`);
        announced = Date.now();
      }
      await pause(100);
    }
  }
  let before: ReturnType<RoadLedger['road']> = null;
  let aggregateBefore: ReturnType<RoadLedger['road']>;
  let coverage: ReturnType<typeof runtime.coverage>;
  let journalHash: string;
  try {
    await until(() => runtime.coverage().state === 'connected', 'current recorder recovery', 180_000);
    await until(() => live.length > 0, 'fresh witnessed SSE', 90_000);
    // Give the same real source another opportunity to deliver; never synthesize a public event.
    await pause(1000);
    const raid = live[0]!;
    before = runtime.ledger.road(raid.fromKingdomId, raid.toKingdomId);
    aggregateBefore = runtime.ledger.road(knownPair.fromKingdomId, knownPair.toKingdomId);
    if (!before || !aggregateBefore || aggregateBefore.countBasis !== 'at-least') throw new Error('Real source road evidence is missing.');
    coverage = runtime.coverage();
    journalHash = hash(readFileSync(join(dataDir, 'roads/ledger.ndjson')));
  } finally { await runtime.close(); }
  const afterCloseHash = hash(readFileSync(join(dataDir, 'roads/ledger.ndjson')));
  if (afterCloseHash !== journalHash!) throw new Error('Closing changed the acknowledged road memory.');
  const reopened = new RoadLedger(dataDir);
  let after: ReturnType<RoadLedger['road']>;
  let aggregateAfter: ReturnType<RoadLedger['road']>;
  try {
    after = reopened.road(live[0]!.fromKingdomId, live[0]!.toKingdomId);
    aggregateAfter = reopened.road(knownPair.fromKingdomId, knownPair.toKingdomId);
  }
  finally { reopened.close(); }
  if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('Restart changed the real road story.');
  if (JSON.stringify(aggregateBefore) !== JSON.stringify(aggregateAfter)) throw new Error('Restart changed the real aggregate story.');
  if (hash(readFileSync(join(dataDir, 'roads/ledger.ndjson'))) !== afterCloseHash) throw new Error('Restart changed the real journal bytes.');
  const omitEvents = (road: NonNullable<typeof before>) => {
    const { events, ...facts } = road;
    return { ...facts, events: events.length };
  };
  const result = {
    kind: 'real-surveyor-sse-recorder-aggregate', sourceKind: 'read-only collector',
    seedRevision: pointer.revision, elapsedMs: Date.now() - start,
    freshSse: live, coverage: coverage!, before: omitEvents(before!), after: omitEvents(after!),
    aggregateBefore: omitEvents(aggregateBefore!), aggregateAfter: omitEvents(aggregateAfter!),
    journalSha256: afterCloseHash, restartUnchanged: true,
    sourceDatabaseInodeUnchanged: statSync(path).ino === original.ino,
    sourceWrites: false, raidShowFeedConnected: false, publicRoadRenderingVerified: false, logs,
  };
  const output = resolve('work/evidence/atlas-map/am11-live-sources.json');
  writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ output, freshSse: live.length, recovered: coverage!.recorder?.events, restartUnchanged: true })}\n`);
}

void main().catch(error => {
  process.stderr.write(`${error instanceof Error ? error.message : 'Live source guard failed.'}\n`);
  process.exitCode = 1;
});
