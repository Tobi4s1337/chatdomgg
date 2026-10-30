import { statSync } from 'node:fs';
import { join } from 'node:path';
import { checkDataDir } from './check';
import { dataDirFrom, importConfigFrom, serveConfigFrom } from './config';
import { asAtlasError } from './errors';
import type { SnapshotManifest } from './export/schema';
import { runImport } from './import';
import { createAtlasService } from './serve';
import { revisionDir } from './store/revisions';

const utc = (ms: number) => `${new Date(ms).toISOString().slice(0, 16).replace('T', ' ')} UTC`;
const n = (value: number) => value.toLocaleString('en-US');

function summary(manifest: SnapshotManifest): string[] {
  const { window, counts, founding, source, coverage } = manifest;
  const rejected = Object.values(counts.rejected).reduce((sum, count) => sum + count, 0);
  return [
    `  observed ${utc(window.firstObservationAt)} → ${utc(window.lastObservationAt)} (${window.hours} h, ${n(window.sweeps)} sweeps, ${window.gapCount} gaps)`,
    `  ${n(counts.channels)} channels · ${n(counts.kingdomCandidates)} kingdom candidates · ${n(counts.liveChannels)} live (${n(counts.liveCandidates)} candidates)`,
    `  ${n(counts.games)} categories · ${n(counts.raidPairs)} raid pairs · ${n(counts.raidObservations)} recorded raids (${n(counts.raidObservationsBetweenCandidates)} between candidates)`,
    `  coverage: sweep floor ${coverage.sweep.floorViewers} viewers · raid watch ${n(coverage.raidWatch.watching)} channels · content labels ${coverage.contentLabels}`,
    `  source: HTTP status ${n(source.http.statusSweeps)} sweeps · database read-only single transaction ${source.database.readMs} ms (${source.database.lagSweeps} sweeps behind HTTP)`,
    `  retention: ${n(counts.streamsExpired)} stale stream facts and ${n(counts.avatarsDropped)} stale avatars dropped · rejected rows ${rejected}`,
    `  founding: not founded · Edition 0 from ${utc(founding.edition0EligibleAt)} · Edition I from ${utc(founding.editionIEligibleAt)}`,
  ];
}

function revisionBytes(dataDir: string, manifest: SnapshotManifest): number {
  return Object.values(manifest.files).reduce((sum, file) => sum + file.bytes, 0) +
    statSync(join(revisionDir(dataDir, manifest.revision), 'import.json')).size;
}

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  if (command === 'import') {
    const config = importConfigFrom(process.env);
    const result = await runImport(config);
    if (!result.ok) {
      console.error(`atlas:import failed [${result.error.code}] ${result.error.message}`);
      for (const detail of result.error.details) console.error(`  ${detail}`);
      console.error(`  current revision unchanged: ${result.currentRevision ?? 'none yet'}`);
      return 1;
    }
    console.log(`atlas:import ${result.outcome} ${result.revision}`);
    for (const line of summary(result.manifest)) console.log(line);
    console.log(`  survey preview ${result.preview.id} ${result.preview.outcome} (draft land, not an edition)`);
    console.log(`  wrote ${(revisionBytes(config.dataDir, result.manifest) / 1_048_576).toFixed(1)} MB · pruned ${result.pruned.length ? result.pruned.join(', ') : 'none'}`);
    return 0;
  }
  if (command === 'check') {
    const flag = rest.indexOf('--revision');
    const report = checkDataDir(dataDirFrom(process.env), flag >= 0 ? rest[flag + 1] : undefined);
    if (!report.ok) {
      console.error(`atlas:check FAILED ${report.revision ?? ''}`.trim());
      for (const problem of report.problems) console.error(`  ${problem}`);
      return 1;
    }
    console.log(`atlas:check OK ${report.revision}`);
    if (report.manifest) for (const line of summary(report.manifest)) console.log(line);
    console.log('  verified: file hashes and lengths, strict records, canonical order, source dates, retention, no founded records, survey preview land');
    return 0;
  }
  if (command === 'serve') {
    const config = serveConfigFrom(process.env);
    const service = createAtlasService(config.dataDir, (line) => console.log(`atlas:serve ${line}`));
    await new Promise<void>((resolve, reject) => {
      service.server.once('error', reject);
      service.server.listen(config.port, config.host, () => resolve());
    });
    console.log(`atlas:serve http://${config.host}:${config.port}/map-data/v1/survey (${service.revision() ?? 'no revision yet'})`);
    const stop = () => void service.close().then(() => process.exit(0));
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    return await new Promise<number>(() => {});
  }
  console.error('usage: atlas.mjs import | check [--revision <id>] | serve');
  return 2;
}

main(process.argv.slice(2)).then((code) => process.exit(code), (error: unknown) => {
  const atlasError = asAtlasError(error, 'config');
  console.error(`atlas failed [${atlasError.code}] ${atlasError.message}`);
  for (const detail of atlasError.details) console.error(`  ${detail}`);
  process.exit(1);
});
