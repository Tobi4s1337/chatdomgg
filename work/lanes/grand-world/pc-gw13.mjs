// GW13 on Tobias's RTX 5080, in one lease: a golden-hour still of each channel's own world (unfounded channels as
// private sketches, raised beforehand by sheet-gw13.mjs raise), the same wide view of one world at each reveal
// milestone (staged citizen counts on the dev bench, never a real kingdom), that world at night with the hamlet's
// valley open, and a short clip of one opening as it lifts.
// usage (inside the lease):
//   chatdom-pc-lease --max 10 -- node work/lanes/grand-world/pc-gw13.mjs <bench-channel> <login…>
// Serves the built apps/web on 5192 and the lane's sketch store as the realm's land routes on 5191.
import { Buffer } from 'node:buffer';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { preview as createPreview } from 'vite';

const [benchChannel, ...logins] = process.argv.slice(2);
if (!benchChannel) throw new Error('usage: pc-gw13.mjs <bench-channel> <login…>');
const out = resolve('shots/grand-world/gw13-pc'), base = 'http://localhost:5192';
await mkdir(`${out}/clip`, { recursive: true });
const report = { started: new Date().toISOString(), sketches: [], milestones: [], errors: [] };
const sleep = ms => new Promise(done => setTimeout(done, ms));

const land = spawn('node', ['work/lanes/grand-world/sheet-gw13.mjs', 'serve', '5191'], { stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((done, fail) => { land.stdout.on('data', data => { if (String(data).includes('serving')) done(); }); land.once('exit', code => fail(new Error(`land server exited ${code}`))); });
process.env.CHATDOM_LAND_TARGET = 'http://127.0.0.1:5191';
process.env.CHATDOM_REALM_TARGET = 'http://127.0.0.1:5191';
const server = await createPreview({ root: 'apps/web', configFile: 'apps/web/vite.config.ts', logLevel: 'error', preview: { host: '127.0.0.1', port: 5192, strictPort: true } });
const browser = await chromium.connectOverCDP('http://127.0.0.1:9333', { timeout: 15_000 });
const context = browser.contexts()[0];

async function open(path, width = 1440, height = 900, timeout = 120_000) {
  const page = await context.newPage();
  page.on('pageerror', error => report.errors.push(`${path}: ${error.message}`));
  await page.setViewportSize({ width, height });
  await page.bringToFront();
  const started = Date.now();
  await page.goto(`${base}${path}`);
  await page.waitForFunction(() => window.__chatdomReady === true, null, { timeout, polling: 250 });
  return { page, readyMs: Date.now() - started };
}

try {
  // 1. Each channel's own world at golden hour, as a visitor opens it.
  for (const login of logins) {
    try {
      const { page, readyMs } = await open(`/-/grand?channel=${encodeURIComponent(login)}&hour=17.6`);
      await sleep(2500);
      const stats = await page.evaluate(() => window.__chatdomGrand?.stats());
      const file = `${out}/gw13-sheet-${login}-golden@1440x900.png`;
      await page.screenshot({ path: file, timeout: 30_000 });
      report.sketches.push({ login, readyMs, file, landform: stats?.sketch?.landform, recipe: stats?.sketch?.recipeHash?.slice(0, 8), networkBytes: stats?.sketch?.networkBytes });
      console.log(JSON.stringify(report.sketches.at(-1)));
      await page.close();
    } catch (error) { report.errors.push(`${login}: ${error.message}`); console.log(login, 'failed', error.message); }
  }
  // 2. One world, the same wide view, at each milestone (staged on the bench), then at night, then one opening lifting.
  const { page, readyMs } = await open(`/-/grand-bench?channel=${encodeURIComponent(benchChannel)}&world=1&citizens=9&view=orbit&hour=17.6`, 1440, 900, 240_000);
  report.bench = { channel: benchChannel, readyMs };
  await sleep(3000);
  for (const citizens of [9, 25, 60, 150, 400, 1000, 2500, 5000]) {
    await page.evaluate(n => window.__chatdomGrand.setCitizens(n, 0), citizens);
    await sleep(2500);
    const file = `${out}/gw13-milestone-${benchChannel}-${String(citizens).padStart(4, '0')}-golden@1440x900.png`;
    await page.screenshot({ path: file, timeout: 30_000 });
    report.milestones.push({ citizens, file });
    console.log('milestone', citizens);
  }
  await page.evaluate(() => { window.__chatdomGrand.setCitizens(9, 0); window.__chatdomGrand.setHour(21.8); });
  await sleep(3000);
  await page.screenshot({ path: `${out}/gw13-hamlet-${benchChannel}-0009-night@1440x900.png`, timeout: 30_000 });
  // The opening: the mist lifting off the next valley over its nine seconds, as the stream shows it.
  await page.evaluate(() => window.__chatdomGrand.setHour(17.6));
  await sleep(2000);
  const cdp = await context.newCDPSession(page);
  let frame = 0;
  const frames = [];
  cdp.on('Page.screencastFrame', async ({ data, sessionId, metadata }) => {
    frames.push(writeFile(`${out}/clip/${String(frame++).padStart(4, '0')}.jpg`, Buffer.from(data, 'base64')));
    report.clipFirst ??= metadata.timestamp; report.clipLast = metadata.timestamp;
    await cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => undefined);
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 85, maxWidth: 1440, maxHeight: 900, everyNthFrame: 2 });
  await sleep(800);
  await page.evaluate(() => window.__chatdomGrand.setCitizens(25, 9));
  await sleep(10_500);
  await cdp.send('Page.stopScreencast');
  await Promise.all(frames);
  report.clipFrames = frame;
  await page.close();
} catch (error) { report.errors.push(String(error?.stack ?? error)); console.log('failed', error.message); }
finally {
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 1));
  await browser.close().catch(() => undefined);
  await new Promise(done => server.httpServer.close(() => done()));
  land.kill('SIGTERM');
}
console.log(JSON.stringify({ sketches: report.sketches.length, milestones: report.milestones.length, clipFrames: report.clipFrames, errors: report.errors }));
