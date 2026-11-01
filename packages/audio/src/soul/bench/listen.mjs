import { chromium } from '@playwright/test';
import { Buffer } from 'node:buffer';
import { createServer } from 'vite';
import { acquireCaptureLock } from '../../../../testing/capture-lock.mjs';
import { CAPTURE_PORTS } from '../../../../testing/capture-ports.mjs';
import { mkdir, writeFile } from 'node:fs/promises';

// One lock owns one server and one browser for one short render.
async function render(fn, argument) {
  const release = await acquireCaptureLock();
  let server, browser;
  try {
    for (const port of [...CAPTURE_PORTS, 0]) {
      try {
        server = await createServer({ configFile: false, root: process.cwd(), logLevel: 'error', optimizeDeps: { noDiscovery: true }, server: { host: '127.0.0.1', port, strictPort: true, hmr: false, watch: { ignored: ['**'] } } });
        await server.listen();
        break;
      } catch (error) {
        await server?.close(); server = undefined;
        if (!/already in use|EADDRINUSE/.test(String(error))) throw error;
      }
    }
    if (!server) throw new Error('No capture port available');
    const address = server.httpServer.address();
    browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${address.port}/packages/audio/src/soul/bench/`);
    await page.waitForFunction(() => 'renderSoulCase' in window);
    return await page.evaluate(fn, argument);
  } finally {
    try { await browser?.close(); } finally { try { await server?.close(); } finally { await release(); } }
  }
}
  await mkdir('/tmp/chatdom-soul-audio', { recursive: true });
  const rows = [];
  for (const biome of ['coastal', 'woodland', 'meadow', 'highland']) for (const hour of [6, 12, 18, 23]) for (const profile of hour === 18 ? ['walk', 'stream'] : ['walk']) {
    const result = await render(([b, h, p]) => window.renderSoulCase(b, h, p), [biome, hour, profile]);
    const name = `${biome}-${hour}-${profile}`;
    await writeFile(`/tmp/chatdom-soul-audio/${name}.wav`, Buffer.from(result.wav, 'base64'));
    rows.push({ name, peak: result.peak, rms: result.rms, middleRms: result.middleRms, ...result.inspection });
    console.log(`${name}: peak ${result.peak.toFixed(6)}, rms ${result.rms.toFixed(6)}`);
  }
  const hamlet = await render(() => window.renderSoulCase('meadow', 6, 'walk', 8, 0));
  await writeFile('/tmp/chatdom-soul-audio/meadow-6-hamlet.wav', Buffer.from(hamlet.wav, 'base64'));
  rows.push({ name: 'meadow-6-hamlet', peak: hamlet.peak, rms: hamlet.rms, ...hamlet.inspection });
  if (!(hamlet.rms > 0 && !hamlet.inspection.played.strings && !hamlet.inspection.played.woodwind && !hamlet.inspection.played.choir)) throw new Error(`Hamlet presence layers: ${JSON.stringify(hamlet.inspection)}`);
  const duck = await render(() => window.renderSoulCase('meadow', 18, 'walk', 8, 12, true));
  const reference = rows.find(row => row.name === 'meadow-18-walk');
  if (!reference || !(duck.middleRms < reference.middleRms * .3)) throw new Error(`Duck did not yield: ${JSON.stringify({ duck: duck.middleRms, reference: reference?.middleRms })}`);
  await writeFile('/tmp/chatdom-soul-audio/duck.json', JSON.stringify({ duck: duck.middleRms, normal: reference.middleRms }, null, 2));
  const lifecycle = await render(() => window.renderSoulLifecycle());
  if (!(lifecycle.before > 0 && lifecycle.muted < lifecycle.before * .01 && lifecycle.resumed > 0 && lifecycle.afterSeek > 0 && lifecycle.inspection.peakSources <= 28)) throw new Error(`Mute/resume/seek failure: ${JSON.stringify(lifecycle)}`);
  await writeFile('/tmp/chatdom-soul-audio/lifecycle.json', JSON.stringify(lifecycle, null, 2));
  const stall = await render(() => window.renderSoulStall());
  if (!(stall.before > 0 && stall.after < stall.before * .01)) throw new Error(`Watchdog did not silence stalled frames: ${JSON.stringify(stall)}`);
  for (const row of rows) if (!(row.peak > 0 && row.peak < .95 && row.peakVoices <= 12 && row.peakSources <= 28)) throw new Error(`Invalid signal or budget: ${JSON.stringify(row)}`);
  for (const row of rows.filter(row => row.name.endsWith('-stream'))) {
    const walk = rows.find(other => other.name === row.name.replace('-stream', '-walk'));
    if (!walk || !(row.rms < walk.rms)) throw new Error(`Stream profile is not quieter: ${row.name}`);
  }
  await writeFile('/tmp/chatdom-soul-audio/stall.json', JSON.stringify(stall, null, 2));
  await writeFile('/tmp/chatdom-soul-audio/measurements.json', JSON.stringify(rows, null, 2));
  console.log('All soul audio measurements and lifecycle checks passed.');
