// Renders the panel's SIMULATED fixture pictures from our own kingdom renderer.
// The pictures are stills of the simulated Willowmere night, not paintings: the
// renderer draws them in headless Chrome, and this script records exactly how.
//
//   pnpm --filter @chatdom/web build
//   node apps/panel/scripts/capture-fixture.mjs [--base-url http://127.0.0.1:5190]
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { acquireCaptureLock } from '../../../packages/testing/capture-lock.mjs';
import { startCapturePreview, closeCapturePreview } from '../../../packages/testing/preview.mjs';

const args = process.argv.slice(2);
const option = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const root = resolve(import.meta.dirname, '..');
const assets = join(root, 'src/assets/fixture');

// One render per picture the panel shows. Sizes are twice the panel's drawn size,
// so the still stays crisp on a 2x phone and is downscaled on a 1x desktop.
const SHOTS = [
  { id: 'kingdom', camera: 'hero', hour: 20.7, width: 640, height: 400, alt: 'Willowmere at dusk: warm windows in the streets below the castle' },
  // Phones held upright: the renderer frames a portrait canvas with its own hero camera.
  { id: 'portrait', camera: 'hero', hour: 20.7, width: 600, height: 760, alt: 'Willowmere at dusk, the castle above the lit streets' },
  { id: 'window', camera: 'window', hour: 20.4, width: 560, height: 360, alt: 'Close to one home in Willowmere, its window lit at dusk' },
];
const SEED = 'willowmere', TIER = 'town', TIME = 30;

let server, browser, release;
const scratch = await mkdtemp(join(tmpdir(), 'chatdom-panel-fixture-'));
try {
  release = await acquireCaptureLock();
  let base = option('--base-url');
  if (!base) ({ server, base } = await startCapturePreview());
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
  const pictures = {};
  for (const shot of SHOTS) {
    const page = await browser.newPage({ viewport: { width: shot.width, height: shot.height }, deviceScaleFactor: 1 });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const path = `/?source=simulated&seed=${SEED}&tier=${TIER}&hour=${shot.hour}&time=${TIME}&camera=${shot.camera}`;
    console.log(`Rendering ${shot.id} from ${path}`);
    await page.goto(base + path);
    await page.waitForFunction(() => (window.__chatdomReady === true && window.__chatdomKingdom?.stats.ready && window.__chatdomKingdom.stats.fieldSettled) || !!document.querySelector('.kingdom-gate button'), null, { timeout: 300_000 });
    if (await page.locator('.kingdom-gate button').count()) throw new Error(`${shot.id}: kingdom error gate${errors.length ? `\n${errors.join('\n')}` : ''}`);
    if (!(await page.locator('.source-ribbon').innerText()).includes('SIMULATED')) throw new Error(`${shot.id}: the kingdom must be the simulated fixture`);
    const stats = await page.evaluate(() => ({ ...window.__chatdomKingdom.stats }));
    if (stats.camera !== shot.camera) throw new Error(`${shot.id}: expected the ${shot.camera} camera, got ${stats.camera}`);
    // The still is the world alone: the kingdom page's own title, ribbon and names are not part of it.
    await page.addStyleTag({ content: '.kingdom > :not(canvas){display:none!important}' });
    await page.evaluate(() => new Promise(done => window.requestAnimationFrame(() => window.requestAnimationFrame(done))));
    await page.waitForFunction(() => window.__chatdomKingdom.stats.fieldSettled, null, { timeout: 120_000 });
    if (errors.length) throw new Error(`${shot.id}: ${errors.join('\n')}`);
    const png = join(scratch, `${shot.id}.png`), webp = join(assets, `willowmere-${shot.id}.webp`);
    await page.locator('canvas.kingdom-canvas').screenshot({ path: png });
    await mkdir(assets, { recursive: true });
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', png, '-c:v', 'libwebp', '-quality', '84', '-compression_level', '6', webp]);
    const bytes = (await stat(webp)).size;
    pictures[shot.id] = {
      file: `willowmere-${shot.id}.webp`, width: shot.width, height: shot.height, bytes, alt: shot.alt,
      render: { route: path, seed: SEED, tier: TIER, hour: shot.hour, time: TIME, camera: shot.camera, renderer: 'apps/web/src/kingdom/scene.ts', presence: 'simulated' },
    };
    console.log(`Wrote ${webp} (${Math.round(bytes / 1024)} KB)`);
    await page.close();
  }
  let revision = 'unknown';
  try { revision = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(); } catch { /* outside a checkout */ }
  const provenance = { origin: 'simulated', capturedOn: new Date().toISOString().slice(0, 10), sourceRevision: revision, pictures };
  const source = `// Written by apps/panel/scripts/capture-fixture.mjs. Do not edit by hand: re-render instead.\n// These stills come from our kingdom renderer showing the SIMULATED Willowmere night.\nexport const FIXTURE_PROVENANCE = ${JSON.stringify(provenance, null, 2)} as const;\n`;
  await writeFile(join(assets, 'provenance.ts'), source);
  console.log('Wrote provenance.ts');
} finally {
  await rm(scratch, { recursive: true, force: true });
  try { await browser?.close(); } finally {
    try { if (server) await closeCapturePreview(server); } finally { await release?.(); }
  }
}
