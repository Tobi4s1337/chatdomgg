import { statSync } from 'node:fs';
import { join } from 'node:path';
import { checkDataDir } from './check';
import { dataDirFrom, founderKeyPemFrom, importConfigFrom, liveConfigFrom, serveConfigFrom } from './config';
import { founderKey } from './edition/authorization';
import { runAuthorize, runFound, runRehearsal, runSettle } from './edition/commands';
import { EditionNumberSchema } from './edition/schema';
import { listEditions, verifyEditionDir } from './edition/store';
import { asAtlasError } from './errors';
import type { SnapshotManifest } from './export/schema';
import { runImport } from './import';
import { checkLive } from './live/check';
import { runLive } from './live/run';
import type { LiveTarget } from './live/target';
import { createAtlasService } from './serve';
import { acquireLock, revisionDir } from './store/revisions';

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

function flag(args: readonly string[], name: string): string | null {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] ?? null : null;
}

function editionArg(args: readonly string[], fallback?: '0' | 'I'): '0' | 'I' {
  const parsed = EditionNumberSchema.safeParse(flag(args, '--edition') ?? fallback);
  if (!parsed.success) throw new Error('--edition must be 0 or I.');
  return parsed.data;
}

function withLock<T>(dataDir: string, run: () => T): T {
  const release = acquireLock(dataDir);
  try {
    return run();
  } finally {
    release();
  }
}

/** Every founded edition, verified; editions are reported but never created by check. */
function checkEditions(dataDir: string): { lines: string[]; problems: string[] } {
  const lines: string[] = [];
  const problems: string[] = [];
  const editions = listEditions(dataDir);
  if (editions.length === 0) return { lines: ['  editions: none founded (the survey preview is draft land)'], problems };
  const pem = founderKeyPemFrom(process.env);
  const key = pem ? founderKey(pem) : null;
  for (const id of editions) {
    const report = verifyEditionDir(dataDir, id, key);
    if (report.problems.length) problems.push(...report.problems.map((problem) => `${id}: ${problem}`));
    else lines.push(`  ${report.edition!.label}: ${n(report.stats.settlers)} holdings over ${report.stats.nights} nights, ${n(report.stats.tombstoned)} tombstoned, ${n(report.stats.outer)} on the Outer Isles; ${report.stats.heads} heads hold`);
  }
  return { lines, problems };
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
    const dataDir = dataDirFrom(process.env);
    const report = checkDataDir(dataDir, flag(rest, '--revision') ?? undefined);
    const editions = checkEditions(dataDir);
    const live = await checkLive(dataDir);
    const problems = [...report.problems, ...editions.problems, ...live.problems];
    if (problems.length) {
      console.error(`atlas:check FAILED ${report.revision ?? ''}`.trim());
      for (const problem of problems) console.error(`  ${problem}`);
      return 1;
    }
    console.log(`atlas:check OK ${report.revision}`);
    if (report.manifest) for (const line of summary(report.manifest)) console.log(line);
    for (const line of editions.lines) console.log(line);
    for (const line of live.lines) console.log(line);
    console.log('  verified: file hashes and lengths, strict records, canonical order, source dates, retention, no founded records, survey preview land and its reproduction from the revision, edition ledgers, live frames against their land');
    return 0;
  }
  if (command === 'found') {
    const dataDir = dataDirFrom(process.env);
    const number = editionArg(rest);
    const result = withLock(dataDir, () => runFound(dataDir, number, flag(rest, '--authorization'), founderKeyPemFrom(process.env), Date.now()));
    if (!result.ok) {
      console.error(`atlas:found REFUSED ${result.edition} from ${result.revision ?? 'no revision'}: nothing was founded`);
      for (const problem of result.problems) console.error(`  ${problem}`);
      return 1;
    }
    console.log(`atlas:found ${result.edition} from ${result.revision}: ${n(result.settlers ?? 0)} holdings, world ${result.worldHash}`);
    return 0;
  }
  if (command === 'settle') {
    const dataDir = dataDirFrom(process.env);
    const result = withLock(dataDir, () => runSettle(dataDir, founderKeyPemFrom(process.env), Date.now()));
    if (result.outcome === 'no-edition') console.log('atlas:settle no edition is founded; the survey preview is draft land and nothing is settled');
    else if (result.outcome === 'up-to-date') console.log(`atlas:settle ${result.edition} already settled through ${result.revision}`);
    else if (result.outcome === 'moderated') console.log(`atlas:settle ${result.edition} no newer survey than ${result.revision}; ${n(result.hidden)} newly withheld holdings now wait under hidden tombstones; ${n(result.settlers)} holdings`);
    else {
      const s = result.summary;
      console.log(`atlas:settle ${result.edition} ← ${result.revision}: ${n(s.settled)} settled (${n(s.byRaid)} by raid, ${n(s.outer)} on the Outer Isles), ${n(s.tombstones)} tombstones, ${n(s.restores)} restored, ${n(s.deferred)} deferred; ${n(result.settlers)} holdings`);
    }
    return 0;
  }
  if (command === 'rehearse') {
    const dataDir = dataDirFrom(process.env);
    const number = editionArg(rest, 'I');
    const started = Date.now();
    const result = runRehearsal(dataDir, number, started);
    const f = result.founding;
    console.log(`atlas:rehearse ${number === '0' ? 'Edition 0' : 'Edition I'} rules in memory: nothing is founded or written`);
    console.log(`  drawn from ${f.revision}: ${n(f.settlers)} holdings (${n(f.hidden)} withheld, tombstoned at founding) in ${n(f.realms)} realms, ${n(f.hamletSlots)} free hamlet slots, world ${f.worldHash.slice(0, 16)}…`);
    let failed = false;
    for (const night of result.nights) {
      const s = night.summary!;
      console.log(`  ← ${night.revision}: ${n(s.settled)} settled (${n(s.byRaid)} by raid, ${n(s.outer)} outer), ${n(s.tombstones)} tombstones, ${n(s.restores)} restored, ${n(s.deferred)} deferred, ${n(s.unseenRaidTargets)} unseen raid targets; ${n(night.settlers)} holdings, ${night.moved} moved`);
      for (const problem of night.problems) console.log(`    PROBLEM ${problem}`);
      if (night.moved || night.problems.length) failed = true;
    }
    console.log(`  ${failed ? 'FAILED' : 'held'}: world hash, owners, holdings, earlier addresses and land invariants after every night (${((Date.now() - started) / 1000).toFixed(1)} s)`);
    return failed ? 1 : 0;
  }
  if (command === 'authorize') {
    const dataDir = dataDirFrom(process.env);
    const key = flag(rest, '--key');
    const by = flag(rest, '--by');
    if (!key || !by) throw new Error('authorize needs --key <founder private key PEM> and --by <twitch login>.');
    console.log(JSON.stringify(runAuthorize(dataDir, editionArg(rest), key, by, Date.now()), null, 2));
    return 0;
  }
  if (command === 'live') {
    const config = liveConfigFrom(process.env);
    const cache = new Map<string, LiveTarget>();
    let last = '';
    const step = async () => {
      const result = await runLive(config.dataDir, config.surveyorDbPath, cache);
      const s = result.state;
      const parts = result.targets.map((t) => t.outcome === 'failed'
        ? `${t.previewId} FAILED ${t.error}`
        : `${t.previewId} ${t.outcome} ${t.frame} · ${n(t.counts!.live)} live (${t.counts!.byClass.map(n).join('/')}) · ${n(t.counts!.dabs)} dabs · gated ${n(t.counts!.gated.gambling)} gambling ${n(t.counts!.gated.withheld)} withheld`);
      const line = `atlas:live ${s.state}${s.sweepAt ? ` sweep ${utc(s.sweepAt)}` : ''}${s.reason ? ` — ${s.reason}` : ''}${s.gapBefore ? ' (after a gap)' : ''}`;
      const summaryLine = [line, ...parts.map((part) => `  ${part}`)].join('\n');
      // A steady state is reported once, not every 30 s.
      const key = `${s.state}:${s.sweepAt}:${result.targets.map((t) => `${t.frame}:${t.outcome}`).join(',')}`;
      if (key !== last) console.log(summaryLine);
      last = key;
      return result;
    };
    if (rest.includes('--once')) {
      const result = await step();
      return result.state.state === 'complete' && result.targets.every((t) => t.outcome !== 'failed') ? 0 : 1;
    }
    let stopped = false;
    const stop = () => {
      stopped = true;
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    while (!stopped) {
      try {
        await step();
      } catch (error) {
        console.error(`atlas:live step failed: ${asAtlasError(error, 'store').message}`);
      }
      const until = Date.now() + config.intervalMs;
      while (!stopped && Date.now() < until) await new Promise((resolve) => setTimeout(resolve, 250));
    }
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
  console.error('usage: atlas.mjs import | check [--revision <id>] | serve | live [--once] | found --edition 0|I --authorization <file> | settle | rehearse [--edition 0|I] | authorize --edition 0|I --key <pem> --by <login>');
  return 2;
}

main(process.argv.slice(2)).then((code) => process.exit(code), (error: unknown) => {
  const atlasError = asAtlasError(error, 'config');
  console.error(`atlas failed [${atlasError.code}] ${atlasError.message}`);
  for (const detail of atlasError.details) console.error(`  ${detail}`);
  process.exit(1);
});
