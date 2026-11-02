import { statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkDataDir } from './check';
import { dataDirFrom, founderKeyPemFrom, importConfigFrom, ingestConfigFrom, liveConfigFrom, serveConfigFrom } from './config';
import { founderKey } from './edition/authorization';
import { checkPublication, prepareFounding, rehearsalAllowed, runAuthorize, runFound, runPublish, runRehearsal, runSettle, runStage } from './edition/commands';
import { EditionNumberSchema } from './edition/schema';
import { listEditions, verifyEditionDir } from './edition/store';
import { asAtlasError } from './errors';
import type { SnapshotManifest } from './export/schema';
import { runImport } from './import';
import { checkLive } from './live/check';
import { runLive } from './live/run';
import type { LiveTarget } from './live/target';
import { rebuildPreview } from './preview/rebuild';
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

function printSettle(result: ReturnType<typeof runSettle>): void {
  if (result.outcome === 'no-edition') console.log('atlas:settle no edition is founded; the survey preview is draft land and nothing is settled');
  else if (result.outcome === 'up-to-date') console.log(`atlas:settle ${result.edition} already settled through ${result.revision}; published ${result.publication}`);
  else if (result.outcome === 'moderated') console.log(`atlas:settle ${result.edition} no newer survey than ${result.revision}; ${n(result.hidden)} newly withheld holdings now wait under hidden tombstones; ${n(result.settlers)} holdings; published ${result.publication}`);
  else {
    const s = result.summary;
    console.log(`atlas:settle ${result.edition} ← ${result.revision}: ${n(s.settled)} settled (${n(s.byRaid)} by raid, ${n(s.byClaim)} by claim, ${n(s.outer)} on the Outer Isles), ${n(s.tombstones)} tombstones, ${n(s.restores)} restored, ${n(s.deferred)} deferred; ${n(result.settlers)} holdings; published ${result.publication}`);
  }
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
  const allowRehearsal = rehearsalAllowed();
  if (key) lines.push(`  founder key sha256 ${key.fingerprint}`);
  for (const id of editions) {
    const report = verifyEditionDir(dataDir, id, key, { allowRehearsal });
    if (report.problems.length) problems.push(...report.problems.map((problem) => `${id}: ${problem}`));
    else lines.push(`  ${report.edition!.label}: ${n(report.stats.settlers)} holdings over ${report.stats.nights} nights, ${n(report.stats.tombstoned)} tombstoned, ${n(report.stats.outer)} on the Outer Isles; ${report.stats.heads} heads hold`);
  }
  // The newest edition is the map: its publication must exist, verify and rebuild byte for byte.
  const newest = editions[editions.length - 1]!;
  const published = checkPublication(dataDir, newest, key, allowRehearsal);
  if (published.length) problems.push(...published);
  else lines.push(`  ${newest} publication reproduces from the edition files and its night`);
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
    // Once an edition is founded every new survey is a night of it: settled and published at once, so the map never
    // waits on a separate job. Settling founds nothing; an edition exists only through atlas:found.
    if (listEditions(config.dataDir).length) {
      try {
        printSettle(withLock(config.dataDir, () => runSettle(config.dataDir, founderKeyPemFrom(process.env), Date.now())));
      } catch (error) {
        const failure = asAtlasError(error, 'check');
        console.error(`atlas:settle after the import failed [${failure.code}] ${failure.message}; the map keeps its last published night`);
        for (const detail of failure.details) console.error(`  ${detail}`);
        return 1;
      }
    }
    return 0;
  }
  if (command === 'preview') {
    const result = rebuildPreview(dataDirFrom(process.env));
    console.log(`atlas:preview ${result.id} ${result.outcome} (verified local revision; collector untouched; nothing founded)`);
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
    const revision = flag(rest, '--revision') ?? undefined;
    if (rest.includes('--prepare')) {
      // The request the founder signs on their own machine (tools/sign-founding.mjs); nothing is founded here.
      const by = flag(rest, '--by');
      if (!by) throw new Error('found --prepare needs --by <the founder\'s twitch login>.');
      const { request, problems } = prepareFounding(dataDir, number, Date.now(), { revision, by });
      const out = flag(rest, '--out');
      if (out) writeFileSync(out, `${JSON.stringify(request, null, 2)}\n`, { flag: 'wx' });
      console.log(JSON.stringify(request, null, 2));
      // The founder compares this with their own key before signing: a signature under any other key is refused.
      const pem = founderKeyPemFrom(process.env);
      if (pem) console.error(`atlas:found --prepare: this service verifies with the founder key sha256 ${founderKey(pem).fingerprint}`);
      else problems.push('No founder key is configured (ATLAS_FOUNDER_PUBLIC_KEY): set it before the signature, or the founding will be refused.');
      if (problems.length) {
        console.error('atlas:found --prepare: these gates do not pass yet, so a signature now would be refused:');
        for (const problem of problems) console.error(`  ${problem}`);
        return 1;
      }
      console.error(`atlas:found --prepare: every gate but the signature passes${out ? `; request written to ${out}` : ''}`);
      return 0;
    }
    const result = withLock(dataDir, () => runFound(dataDir, number, flag(rest, '--authorization'), founderKeyPemFrom(process.env), Date.now(), { revision }));
    if (!result.ok) {
      console.error(`atlas:found REFUSED ${result.edition} from ${result.revision ?? 'no revision'}: nothing was founded`);
      for (const problem of result.problems) console.error(`  ${problem}`);
      return 1;
    }
    console.log(`atlas:found ${result.edition} from ${result.revision}: ${n(result.settlers ?? 0)} holdings, world ${result.worldHash}`);
    console.log(`  content address ${result.address} · published ${result.publication}`);
    return 0;
  }
  if (command === 'settle') {
    const dataDir = dataDirFrom(process.env);
    printSettle(withLock(dataDir, () => runSettle(dataDir, founderKeyPemFrom(process.env), Date.now())));
    return 0;
  }
  if (command === 'publish') {
    const dataDir = dataDirFrom(process.env);
    const result = withLock(dataDir, () => runPublish(dataDir, founderKeyPemFrom(process.env)));
    if (!result) console.log('atlas:publish no edition is founded; the map stays the survey preview');
    else console.log(`atlas:publish ${result.id} ${result.outcome} (content address ${result.address}); nothing founded or settled`);
    return 0;
  }
  if (command === 'rehearse') {
    const dataDir = dataDirFrom(process.env);
    const number = editionArg(rest, 'I');
    const started = Date.now();
    const stage = flag(rest, '--stage');
    if (stage) {
      const result = runStage(dataDir, stage, number, started);
      const f = result.founding;
      console.log(`atlas:rehearse --stage ${result.dataDir}: a rehearsal on a bench, never an edition (served only with ATLAS_REHEARSAL=1)`);
      console.log(`  founded in rehearsal from ${f.revision}: ${n(f.settlers)} holdings (${n(f.hidden)} withheld), address ${f.address.slice(0, 16)}…, published ${f.publication}`);
      for (const gate of result.waived) console.log(`  waived for the rehearsal: ${gate}`);
      for (const night of result.nights) console.log(`  ← ${night.revision}: ${night.outcome}, ${n(night.settled)} settled (${n(night.byRaid)} by raid, ${n(night.byClaim)} by claim), ${night.moved} moved; published ${night.publication}`);
      console.log(`  bench founder key (public half only): ${result.publicKeyPath}`);
      return result.nights.some((night) => night.moved) ? 1 : 0;
    }
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
    const ingestConfig = ingestConfigFrom(process.env);
    const service = createAtlasService(config.dataDir, (line) => console.log(`atlas:serve ${line}`), { ingestToken: ingestConfig?.token ?? null });
    await new Promise<void>((resolve, reject) => {
      service.server.once('error', reject);
      service.server.listen(config.port, config.host, () => resolve());
    });
    console.log(`atlas:serve http://${config.host}:${config.port}/map-data/v1/survey (${service.revision() ?? 'no revision yet'})`);
    if (ingestConfig) {
      await new Promise<void>((resolve, reject) => {
        service.ingest.once('error', reject);
        service.ingest.listen(ingestConfig.port, ingestConfig.host, () => resolve());
      });
      console.log(`atlas:serve road ingest on http://${ingestConfig.host}:${ingestConfig.port}/v1/roads/observe (${ingestConfig.token ? 'token required' : 'no token'})`);
    }
    const stop = () => void service.close().then(() => process.exit(0));
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    return await new Promise<number>(() => {});
  }
  console.error('usage: atlas.mjs import | preview | check [--revision <id>] | serve | live [--once] | found --edition 0|I [--revision <id>] (--prepare --by <login> [--out <file>] | --authorization <file>) | settle | publish | rehearse [--edition 0|I] [--stage <bench dir>] | authorize --edition 0|I --key <pem> --by <login>');
  return 2;
}

main(process.argv.slice(2)).then((code) => process.exit(code), (error: unknown) => {
  const atlasError = asAtlasError(error, 'config');
  console.error(`atlas failed [${atlasError.code}] ${atlasError.message}`);
  for (const detail of atlasError.details) console.error(`  ${detail}`);
  process.exit(1);
});
