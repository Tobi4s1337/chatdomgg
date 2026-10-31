// Kingdom light evidence: the real town, real readiness, the main-owned pose seam.
//   node apps/web/src/kingdom/lights/capture.mjs [--views hero,street,castle,window,citizen]
//     [--hours noon,dusk,night] [--sizes desktop,phone] [--tier town|hamlet] [--base-url URL]
// Writes shots/kingdom-light/<view>-<hour>@WxH.png and a greyscale copy of every dusk frame.
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { createServer as createNetServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { createServer, preview } from 'vite';
import { CAPTURE_PORTS } from '../../../../../packages/testing/capture-ports.mjs';
import { acquireCaptureLock } from '../../../../../packages/testing/capture-lock.mjs';

const root = fileURLToPath(new URL('../../../../../', import.meta.url));
const args = process.argv.slice(2);
const option = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const list = (name, all) => {
  const value = option(name)?.split(',').map(item => item.trim()).filter(Boolean) ?? all;
  const unknown = value.filter(item => !all.includes(item));
  if (unknown.length || !value.length) throw new Error(`${name} expects a comma list of ${all.join('|')}`);
  return value;
};
const views = list('--views', ['hero', 'street', 'castle', 'window', 'citizen']);
const hourNames = list('--hours', ['noon', 'dusk', 'night']);
const sizeNames = list('--sizes', ['desktop', 'phone']);
const tier = option('--tier') ?? 'town';
if (!['town', 'hamlet'].includes(tier)) throw new Error('--tier expects town|hamlet');
const hours = { noon: 12, dusk: 19.5, night: 23 };
const sizes = { desktop: [1440, 900], phone: [390, 844] };
const out = `${root}shots/kingdom-light`;
const seed = 'willowmere', time = 30;

/** First free port in the band this host reserves for our servers. */
async function freePort() {
  for (const port of CAPTURE_PORTS) {
    const free = await new Promise(resolve => {
      const probe = createNetServer().once('error', () => resolve(false)).once('listening', () => probe.close(() => resolve(true)));
      probe.listen(port, '127.0.0.1');
    });
    if (free) return port;
  }
  throw new Error('No safe capture port available.');
}

/** Street and castle poses come from the lane's own deterministic layout views, not a second camera. */
async function lightViews() {
  const vite = await createServer({ root: `${root}apps/web`, configFile: `${root}apps/web/vite.config.ts`, logLevel: 'error',
    server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom', optimizeDeps: { noDiscovery: true, include: [] } });
  try {
    const { generateSettlementPlan } = await vite.ssrLoadModule('@chatdom/world');
    const { kingdomLightViews } = await vite.ssrLoadModule('/src/kingdom/lights/views.ts');
    // Mirrors the kingdom page's founding years for this tier and seed.
    const layout = generateSettlementPlan({ seed, tier, firstYear: tier === 'hamlet' ? 2025 : 2022, year: 2026 });
    return kingdomLightViews(layout);
  } finally { await vite.close(); }
}

const greyscale = (from, to) => new Promise((resolve, reject) => {
  const child = spawn('ffmpeg', ['-loglevel', 'error', '-y', '-i', from, '-vf', 'format=gray', to], { stdio: 'inherit' });
  child.once('error', reject);
  child.once('exit', code => code === 0 ? resolve() : reject(new Error(`ffmpeg greyscale exited ${code}`)));
});

let release, server, browser;
const external = option('--base-url');
try {
  const poses = views.some(view => view === 'street' || view === 'castle') ? await lightViews() : null;
  release = await acquireCaptureLock();
  let base = external;
  if (!base) {
    const port = await freePort();
    server = await preview({ root: `${root}apps/web`, configFile: `${root}apps/web/vite.config.ts`, logLevel: 'warn', preview: { host: '127.0.0.1', port, strictPort: true } });
    base = `http://127.0.0.1:${port}`;
    console.log(`Preview started on port ${port}`);
  }
  await mkdir(out, { recursive: true });
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
  for (const view of views) {
    const camera = ['window', 'citizen'].includes(view) ? view : 'hero';
    const [width, height] = sizes[sizeNames[0]];
    const page = await browser.newPage({ viewport: { width, height } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    const fail = message => { throw new Error(`${view}: ${message}${errors.length ? `\n${errors.join('\n')}` : ''}`); };
    await page.goto(`${base}/?source=simulated&seed=${seed}&tier=${tier}&time=${time}&hour=${hours[hourNames[0]]}&camera=${camera}`);
    await page.waitForFunction(() => window.__chatdomKingdom?.stats.ready === true || !!document.querySelector('.kingdom-gate button') || false, null, { timeout: 300_000 });
    if (await page.locator('.kingdom-gate button').count()) fail(`kingdom error gate: ${await page.locator('.kingdom-gate').innerText()}`);
    if (await page.evaluate(() => typeof window.__chatdomKingdom?.pose) !== 'function') fail('the kingdom exposes no pose seam');
    await page.evaluate(() => document.fonts.ready);
    for (const sizeName of sizeNames) {
      const [w, h] = sizes[sizeName];
      await page.setViewportSize({ width: w, height: h });
      if (poses && (view === 'street' || view === 'castle')) {
        const { eye, target, fov } = poses[view];
        await page.evaluate(([e, t, f]) => window.__chatdomKingdom.pose(e, t, f), [eye, target, fov]);
      }
      for (const hourName of hourNames) {
        const hour = hours[hourName];
        await page.evaluate(value => window.__chatdomKingdom.hour(value), hour);
        await page.waitForFunction(value => Math.abs(window.__chatdomKingdom.stats.hour - value) < 0.01, hour, { timeout: 60_000 });
        // Fixed capture time: wait for actual published light, never a flag we set.
        await page.waitForFunction(() => {
          const stats = window.__chatdomKingdom.stats;
          return (stats.ready && stats.lightingReady && stats.fieldSettled) || !!document.querySelector('.kingdom-gate button');
        }, null, { timeout: 180_000 });
        if (await page.locator('.kingdom-gate button').count()) fail(`kingdom error gate: ${await page.locator('.kingdom-gate').innerText()}`);
        await page.evaluate(() => new Promise(resolve => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve))));
        if (!(await page.locator('.source-ribbon').innerText()).includes('SIMULATED')) fail('missing SIMULATED source label');
        if (errors.length) fail('console or page error');
        const name = `${view}-${hourName}@${w}x${h}.png`, path = `${out}/${name}`;
        await page.screenshot({ path, fullPage: false, timeout: 120_000 });
        const stats = await page.evaluate(() => ({ ...window.__chatdomKingdom.stats }));
        console.log(`Captured shots/kingdom-light/${name}  draws=${stats.drawCalls} tris=${stats.triangles} windows=${stats.activeWindows} fieldBytes=${stats.fieldBytes}`);
        if (hourName === 'dusk') {
          await greyscale(path, `${out}/${view}-${hourName}-grey@${w}x${h}.png`);
          console.log(`Captured shots/kingdom-light/${view}-${hourName}-grey@${w}x${h}.png`);
        }
      }
    }
    if (errors.length) fail('console or page error');
    await page.close();
  }
} finally {
  try { await browser?.close(); } finally {
    try { if (server) await new Promise((resolve, reject) => server.httpServer.close(error => error ? reject(error) : resolve())); }
    finally { await release?.(); }
  }
}
