// RS11 stills of the gate in the walking view (march call in play's HUD region, the journey layer) and the road's
// phone walker, under the shared capture lock in headless Chrome (SwiftShader). Build first:
//   (cd apps/web && nice npx vite build --outDir /tmp/rs11-walk-dist --emptyOutDir)
//   node work/lanes/raid-show/capture-walk-gate.mjs [names]
// names: comma-separated of gathering, road, road-phone, walker-countdown (default all). PNGs go to work/evidence/raid-show.
import { setTimeout, clearTimeout } from 'node:timers';
import { chromium } from '@playwright/test';
import { preview } from 'vite';
import { acquireCaptureLock } from '../../../packages/testing/capture-lock.mjs';
import { assertCapturePort } from '../../../packages/testing/capture-ports.mjs';

const OUT = 'work/evidence/raid-show';
// An ephemeral port, as the repo's own capture preview takes: a named port may be held by another worker.
const PORT = 0;
assertCapturePort(PORT, { allowZero: true });
const SHOTS = {
  gathering: { path: '/-/raid-gate?walkGate=gathering', size: [1440, 900] },
  road: { path: '/-/raid-gate?walkGate=road', size: [1440, 900] },
  'road-phone': { path: '/-/raid-gate?walkGate=road', size: [390, 844] },
  'walker-countdown': { path: '/-/raid-gate?bench=simulated&road=1&capture=1', size: [390, 844], seek: 12.5 },
};
const names = (process.argv[2] ?? Object.keys(SHOTS).join(',')).split(',');

const release = await acquireCaptureLock();
const hardStop = setTimeout(() => { console.error('capture over its time; stopping'); process.exit(2); }, 290_000);
const server = await preview({ root: 'apps/web', configFile: 'apps/web/vite.config.ts', logLevel: 'warn',
  build: { outDir: process.env.RAID_WALK_DIST ?? '/tmp/rs11-walk-dist' }, preview: { host: '127.0.0.1', port: PORT, strictPort: true } });
const base = `http://127.0.0.1:${server.httpServer.address().port}`;
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
try {
  for (const name of names) {
    const shot = SHOTS[name];
    if (!shot) throw new Error(`No shot ${name}`);
    const [width, height] = shot.size;
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    page.on('pageerror', error => console.error(`[${name}] page error: ${error.message}`));
    const began = Date.now();
    await page.goto(`${base}${shot.path}`);
    await page.waitForFunction(() => window.__chatdomReady === true, null, { timeout: 180_000 });
    if (shot.seek !== undefined) {
      await page.evaluate(t => window.__raidRoad.seek(t), shot.seek);
      await page.waitForTimeout(600);
    }
    const state = await page.evaluate(() => window.__walkGate ?? (window.__raidRoad ? { act: window.__raidRoad.state().act, t: window.__raidRoad.state().t } : null));
    const file = `${OUT}/walk-gate-${name}@${width}x${height}.png`;
    await page.screenshot({ path: file });
    console.log(`[${name}] ${file} in ${Math.round((Date.now() - began) / 1000)} s`, JSON.stringify(state));
    await page.close();
  }
} finally {
  clearTimeout(hardStop);
  await browser.close();
  await new Promise(resolve => server.httpServer.close(resolve));
  await release();
}
