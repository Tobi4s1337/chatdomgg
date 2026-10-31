// Reciprocal glass evidence: the same real window of the actual town, from the street and from the room behind it.
// Run from the repository root after `pnpm build`:
//   node apps/web/src/kingdom/lights/glass-capture.mjs [--slot N] [--hours noon,dusk] [--size 1440x900] [--base-url URL]
// It takes the machine-wide capture lock before any server or browser, starts its own preview on a free port unless
// --base-url is given, waits for the scene's own readiness and settled fields, and fails on any page or shader error.
import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { createServer } from 'vite';
import { acquireCaptureLock } from '../../../../../packages/testing/capture-lock.mjs';
import { startCapturePreview, closeCapturePreview } from '../../../../../packages/testing/preview.mjs';

const args = process.argv.slice(2);
const option = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const HOURS = { noon: 12, afternoon: 16, dusk: 19.5, night: 23 };
const hours = (option('--hours') ?? 'noon,dusk').split(',');
if (hours.some(hour => !(hour in HOURS))) throw new Error('Expected --hours from noon,afternoon,dusk,night');
const [width, height] = (option('--size') ?? '1440x900').split('x').map(Number);
if (![width, height].every(value => Number.isInteger(value) && value > 0)) throw new Error('Expected --size WxH');
const views = (option('--views') ?? 'street,room').split(',');

/** The actual first-slot window (or --slot), computed from the same layout and placement the scene uses. */
async function windowPose() {
  const ssr = await createServer({ root: process.cwd(), configFile: false, server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom', logLevel: 'error' });
  try {
    const { generateSettlementPlan, terrainHeight } = await ssr.ssrLoadModule('/packages/world/src/index.ts');
    const { placeSettlementContent } = await ssr.ssrLoadModule('/apps/web/src/kingdom/settlement-content.ts');
    const layout = generateSettlementPlan({ seed: 'willowmere', tier: 'town', firstYear: 2022, year: 2026 });
    const { houses } = placeSettlementContent(layout.homes, (x, z) => terrainHeight(layout, x, z));
    // Same arrival choice as the scene: a 'house' among the most neighbours, nearest the centre.
    const neighbours = home => layout.homes.filter(h => Math.hypot(h.position[0] - home.position[0], h.position[2] - home.position[2]) < 35).length;
    const arrival = layout.homes.filter(h => h.tier === 'house').sort((a, b) => neighbours(b) - neighbours(a)
      || Math.hypot(a.position[0], a.position[2]) - Math.hypot(b.position[0], b.position[2]))[0];
    const slot = option('--slot') === undefined ? arrival.slot : Number(option('--slot'));
    const house = houses.find(h => h.slot === slot);
    if (!house) throw new Error(`No home in slot ${slot}`);
    const pane = house.blueprint.windows[0];
    const angle = { north: Math.PI, east: Math.PI / 2, south: 0, west: -Math.PI / 2 }[pane.facing] + house.yaw;
    const normal = [Math.sin(angle), 0, Math.cos(angle)], side = [Math.cos(angle), 0, -Math.sin(angle)];
    const [lx, ly, lz] = pane.centre.map(value => value * 0.125), c = Math.cos(house.yaw), s = Math.sin(house.yaw);
    const anchor = [house.position[0] + c * lx + s * lz, house.position[1] + ly, house.position[2] - s * lx + c * lz];
    const at = (out, across, up) => anchor.map((value, axis) => value + normal[axis] * out + side[axis] * across + (axis === 1 ? up : 0));
    return { slot, blueprint: house.blueprint.id, facing: pane.facing, normal, anchor, size: [pane.width, pane.height],
      street: { eye: at(3.6, 1.1, 0.25), target: at(-1.6, -0.2, -0.45), fov: 50 },
      // Standing in the room, a pace back from the wall, looking out through the same glass to the street.
      room: { eye: at(-2.2, 0, 0.2), target: at(4, 0, -0.9), fov: 64 },
      // Back in the room, looking down at the window wall and the floor just inside it, where the sun lands.
      sun: { eye: at(-2.8, 0.9, 0.7), target: at(-1.1, -0.1, -1.7), fov: 70 } };
  } finally { await ssr.close(); }
}

let server, browser, release;
try {
  release = await acquireCaptureLock();
  const pose = await windowPose();
  console.log(`Window: slot ${pose.slot} ${pose.blueprint} facing ${pose.facing} (${pose.size.join('×')} cells) at ${pose.anchor.map(v => v.toFixed(2)).join(',')}`);
  let base = option('--base-url');
  if (!base) ({ server, base } = await startCapturePreview());
  console.log(`Preview: ${base}${server ? ' (started here)' : ''}`);
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width, height } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  // Shader failures log an object of compiler messages; keep their text, not a handle name.
  page.on('console', message => {
    if (message.type() !== 'error') return;
    void Promise.all(message.args().map(arg => arg.jsonValue().catch(() => String(arg))))
      .then(parts => { errors.push(parts.map(part => typeof part === 'string' ? part : JSON.stringify(part)).join(' ')); console.error(errors.at(-1)); });
  });
  await page.goto(`${base}/?source=simulated&seed=willowmere&tier=town&hour=${HOURS[hours[0]]}&time=30&camera=window`);
  await page.waitForFunction(() => (window.__chatdomReady === true && window.__chatdomKingdom?.stats.ready && window.__chatdomKingdom.stats.lightingReady)
    || !!document.querySelector('.kingdom-gate button'), null, { timeout: 300_000 });
  if (await page.locator('.kingdom-gate button').count()) throw new Error(`Kingdom error gate: ${await page.locator('.kingdom-gate').innerText()}\n${errors.join('\n')}`);
  if (await page.evaluate(() => typeof window.__chatdomKingdom.pose) !== 'function') throw new Error('Capture pose API is missing');
  await mkdir('shots/kingdom-light', { recursive: true });
  for (const label of hours) {
    await page.evaluate(hour => window.__chatdomKingdom.hour(hour), HOURS[label]);
    await page.waitForFunction(hour => Math.abs(window.__chatdomKingdom.stats.hour - hour) < 0.01, HOURS[label], { timeout: 120_000 });
    for (const view of views) {
      const { eye, target, fov } = pose[view];
      await page.evaluate(([eye, target, fov]) => window.__chatdomKingdom.pose(eye, target, fov), [eye, target, fov]);
      await page.evaluate(() => new Promise(resolve => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve))));
      await page.waitForFunction(() => window.__chatdomKingdom.stats.fieldSettled, null, { timeout: 180_000 });
      await page.evaluate(() => new Promise(resolve => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve))));
      if (errors.length) throw new Error(errors.join('\n'));
      const path = `shots/kingdom-light/glass-${view}-${label}${option('--slot') ? `-slot${pose.slot}` : ''}@${width}x${height}.png`;
      await page.screenshot({ path, timeout: 120_000 });
      const stats = await page.evaluate(() => ({ ...window.__chatdomKingdom.stats }));
      console.log(`Captured ${path} (draws ${stats.drawCalls}, triangles ${stats.triangles}, windows ${stats.activeWindows}, source ${stats.source})`);
    }
  }
  await page.evaluate(() => window.__chatdomKingdom.pose(null));
} finally {
  await browser?.close();
  if (server) await closeCapturePreview(server);
  await release?.();
}
