import { chromium } from '@playwright/test';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { build, preview } from 'vite';
import { acquireCaptureLock } from '../../../../testing/capture-lock.mjs';
import { CAPTURE_PORTS } from '../../../../testing/capture-ports.mjs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { setTimeout, clearTimeout } from 'node:timers';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const bench = dirname(fileURLToPath(import.meta.url));
const output = '/tmp/chatdom-soul-audio';
const biomes = ['coastal', 'woodland', 'meadow', 'highland'];
const clips = biomes.flatMap(biome => [6, 12, 18, 23].flatMap(hour => [`${biome}-${hour}-walk`, ...(hour === 18 ? [`${biome}-${hour}-stream`] : [])]));
clips.push('meadow-6-hamlet');
const checks = ['lifecycle', 'stall', 'duck'];
const name = process.argv[2] ?? 'coastal-6-walk';
const log = message => console.log(`[${new Date().toISOString()}] [soul audio] ${message}`);
const read = async key => JSON.parse(await readFile(join(output, `${key}.json`), 'utf8'));
const write = async (key, data) => writeFile(join(output, `${key}.json`), JSON.stringify(data, null, 2));

async function finalize() {
  const rows = await Promise.all(clips.map(read));
  const lifecycle = await read('lifecycle'), stall = await read('stall'), duck = await read('duck');
  const fingerprints = [...rows, lifecycle, stall, duck].map(result => result.buildFingerprint);
  if (!fingerprints[0] || fingerprints.some(value => value !== fingerprints[0])) throw new Error('Audio evidence must come from one unchanged bench build; rerender stale or missing cases.');
  for (const row of rows) if (!(row.peak > 0 && row.peak < .95 && row.peakVoices <= 12 && row.peakSources <= 28)) throw new Error(`Invalid signal or budget: ${JSON.stringify(row)}`);
  for (const row of rows.filter(row => row.name.endsWith('-stream'))) {
    const walk = rows.find(other => other.name === row.name.replace('-stream', '-walk'));
    if (!walk || !(row.rms < walk.rms)) throw new Error(`Stream profile is not quieter: ${row.name}`);
  }
  const hamlet = rows.find(row => row.name === 'meadow-6-hamlet');
  if (!hamlet || !(hamlet.rms > 0 && !hamlet.played.strings && !hamlet.played.woodwind && !hamlet.played.choir)) throw new Error('Hamlet presence layers failed');
  if (!(lifecycle.before > 0 && lifecycle.muted < lifecycle.before * .01 && lifecycle.resumed > 0 && lifecycle.afterSeek > 0 && lifecycle.inspection.peakSources <= 28)) throw new Error(`Mute/resume/seek failure: ${JSON.stringify(lifecycle)}`);
  if (!(stall.before > 0 && stall.after < stall.before * .01)) throw new Error(`Watchdog failure: ${JSON.stringify(stall)}`);
  const reference = rows.find(row => row.name === 'meadow-18-walk');
  if (!reference || !(duck.middleRms < reference.middleRms * .3)) throw new Error(`Duck failure: ${JSON.stringify({ duck: duck.middleRms, normal: reference?.middleRms })}`);
  await write('measurements', rows);
  log('finalized 21 clips, profile comparisons, hamlet, lifecycle, stall and duck');
}

await mkdir(output, { recursive: true });
if (name === '--finalize') {
  await finalize();
} else if (!clips.includes(name) && !checks.includes(name) && name !== '--build-only') {
  throw new Error(`Unknown case ${name}. Use a biome-hour-profile, meadow-6-hamlet, lifecycle, stall, duck, --build-only or --finalize.`);
} else {
  const outDir = await mkdtemp(join(tmpdir(), 'chatdom-soul-bench-'));
  try {
    // Compile before locking, so a monorepo build never holds up other capture workers.
    log('building standalone bench');
    await build({ root: bench, configFile: false, logLevel: 'error', base: './', build: { outDir, emptyOutDir: true, target: 'es2022' } });
    const buildFingerprint = createHash('sha256').update(await readFile(join(outDir, 'index.html'))).digest('hex');
    log('build complete');
    if (name !== '--build-only') {
      // A capture may wait behind other lanes; keep its FIFO place without
      // starting a browser or server until the lease is actually granted.
      const signal = globalThis.AbortSignal.timeout(10 * 60 * 1000);
      let release;
      try { release = await acquireCaptureLock({ signal }); }
      catch (error) {
        if (!signal.aborted) throw error;
        log('queue timeout; no browser launched');
        process.exitCode = 75;
      }
      if (release) {
        log(`lock acquired for ${name}`);
        let server, browser;
        try {
          for (const port of [...CAPTURE_PORTS, 0]) {
            try {
              server = await preview({ root: bench, configFile: false, logLevel: 'error', build: { outDir }, preview: { host: '127.0.0.1', port, strictPort: true } });
              break;
            } catch (error) {
              if (!/already in use|EADDRINUSE/.test(String(error))) throw error;
            }
          }
          if (!server) throw new Error('No capture port available');
          const address = server.httpServer.address();
          log(`server started on ${address.port}`);
          browser = await chromium.launch({ headless: true, timeout: 15000, args: ['--no-sandbox'] });
          log('browser launched');
          const page = await browser.newPage();
          page.setDefaultTimeout(15000);
          await page.goto(`http://127.0.0.1:${address.port}/`, { timeout: 15000 });
          await page.waitForFunction(() => 'renderSoulCase' in window, null, { timeout: 15000 });
          let timeout;
          const result = await Promise.race([
            page.evaluate(async caseName => {
              if (caseName === 'lifecycle') return window.renderSoulLifecycle();
              if (caseName === 'stall') return window.renderSoulStall();
              if (caseName === 'duck') return window.renderSoulCase('meadow', 18, 'walk', 8, 12, true);
              const [biome, hour, profile] = caseName.split('-');
              return window.renderSoulCase(biome, Number(hour), profile === 'hamlet' ? 'walk' : profile, 8, profile === 'hamlet' ? 0 : 12);
            }, name),
            new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Render timed out after 20 seconds')), 20000); }),
          ]).finally(() => clearTimeout(timeout));
          log('render done');
          if (result.wav) {
            if (name !== 'duck') await writeFile(join(output, `${name}.wav`), Buffer.from(result.wav, 'base64'));
            const { inspection, ...metrics } = result;
            delete metrics.wav;
          await write(name, { name, buildFingerprint, ...metrics, ...inspection });
        } else await write(name, { ...result, buildFingerprint });
          log(`wrote ${name}`);
        } finally {
          try { await browser?.close(); } finally {
            try { if (server) await new Promise((resolve, reject) => server.httpServer.close(error => error ? reject(error) : resolve())); }
            finally { await release(); log('released lock'); }
          }
        }
      }
    }
  } finally { await rm(outDir, { recursive: true, force: true }); }
}
