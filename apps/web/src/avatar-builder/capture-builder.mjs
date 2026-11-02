// Avatar builder capture (spec 49 acceptance): the builder at page and panel size, with the bench's invented people and records.
//
//   node apps/web/src/avatar-builder/capture-builder.mjs [--out shots/avatar-style/builder] [--only page-card,page-mirror]
//
// Writes `<name>@<w>x<h>.png` for each view below. Every view is still (no idle spin, no blink) so runs compare.
// Owns a temporary Vite server on a free capture port (5189 first, or `--port <capture port>`) under the shared capture lock.
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { acquireCaptureLock } from '../../../../packages/testing/capture-lock.mjs';
import { CAPTURE_PORTS, assertCapturePort } from '../../../../packages/testing/capture-ports.mjs';
import { createServer as createNetServer } from 'node:net';

const args = process.argv.slice(2);
const flag = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const out = flag('--out', 'shots/avatar-style/builder');
const only = flag('--only', '').split(',').filter(Boolean);
/** The asked capture port, or the first capture port nobody is listening on (other benches keep theirs up). */
async function freePort() {
  const asked = flag('--port', '');
  if (asked) return assertCapturePort(Number(asked));
  for (const port of [5189, ...CAPTURE_PORTS.filter(p => p !== 5189)]) {
    const free = await new Promise(done => {
      const probe = createNetServer().once('error', () => done(false)).once('listening', () => probe.close(() => done(true)));
      probe.listen(port, '127.0.0.1');
    });
    if (free) return port;
  }
  throw new Error('Every capture port is taken just now; pass --port when one is free.');
}
const LAUNCH = { channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] };

/** name, query, width, height. `view` picks the builder, the reveal, the mirror, the ledger page or the sign-in doors. */
const VIEWS = [
  ['page-hair', 'who=veteran&tab=hair', 1440, 900],
  ['page-card', 'who=regular&tab=hair&inspect=hair:curls', 1440, 900],
  ['page-closeup', 'who=regular&tab=face&focus=face', 1440, 900],
  ['page-carry', 'who=regular&tab=carry&focus=hands', 1440, 900],
  ['page-earned', 'who=veteran&tab=earned&focus=badge&inspect=ribbons', 1440, 900],
  ['page-newcomer-earned', 'who=newcomer&tab=earned', 1440, 900],
  ['page-below', 'who=lapsed&tab=below', 1440, 900],
  ['page-reveal', 'view=reveal&who=veteran', 1440, 900],
  ['page-mirror', 'view=mirror&who=newcomer', 1440, 900],
  ['page-ledger', 'view=ledger&who=veteran', 1440, 900],
  ['page-signin', 'view=signin', 1440, 900],
  ['page-wide', 'who=veteran&tab=hat', 1920, 1080],
  ['page-pieces', 'view=pieces&who=regular', 1440, 900],
  ['phone-hair', 'who=regular&tab=hair', 390, 844],
  ['phone-reveal', 'view=reveal&who=regular', 390, 844],
  ['phone-mirror', 'view=mirror&who=newcomer', 390, 844],
  ['phone-ledger', 'view=ledger&who=regular', 390, 844],
  ['panel-hair', 'who=veteran&tab=hair&layout=panel', 318, 496],
  ['panel-earned', 'who=regular&tab=earned&layout=panel', 318, 496],
  ['panel-reveal', 'view=reveal&who=regular&layout=panel', 318, 496],
];

await mkdir(out, { recursive: true });
const release = await acquireCaptureLock({ priority: 'main' });
let server, browser;
try {
  const PORT = await freePort();
  server = await createServer({ root: 'apps/web', configFile: 'apps/web/vite.config.ts', logLevel: 'error', optimizeDeps: { entries: ['src/avatar-builder/builder.html'] }, server: { host: '127.0.0.1', port: PORT, strictPort: true } });
  await server.listen();
  browser = await chromium.launch(LAUNCH);
  for (const [name, query, width, height] of VIEWS) {
    if (only.length && !only.includes(name)) continue;
    const page = await browser.newPage({ viewport: { width, height } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    const started = Date.now();
    await page.goto(`http://127.0.0.1:${PORT}/src/avatar-builder/builder.html?still=1&${query}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__chatdomReady === true, {}, { timeout: 300000 });
    if (errors.length) throw new Error(`${name}: ${errors.join('\n')}`);
    const path = join(out, `${name}@${width}x${height}.png`);
    await page.screenshot({ path });
    await page.close();
    console.log(`[builder] ${path} (${((Date.now() - started) / 1000).toFixed(1)} s)`);
  }
} finally {
  await browser?.close(); await server?.close(); await release();
}
