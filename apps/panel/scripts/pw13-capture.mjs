/* global AbortSignal, structuredClone */
// Layout fixture capture only: it does not prove that settings were saved to Twitch or the realm.
// Run with the panel Vite server on 5192 and a real-GPU lease forwarding CDP to 9333.
// --fallback captures only config@318x496 with local SwiftShader if the tunnel is down.
import { randomBytes } from 'node:crypto';
import { mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { runnerImport } from 'vite';
import { acquireCaptureLock } from '../../../packages/testing/capture-lock.mjs';
import { HELPER_URL, helperSource } from '../harness/helper.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const panelRoot = join(root, 'apps/panel');
const evidence = join(root, 'work/evidence/panel-window/PW13');
const args = process.argv.slice(2);
const baseIndex = args.indexOf('--base-url');
if (baseIndex >= 0 && !args[baseIndex + 1]) throw new Error('--base-url needs a URL');
const base = new URL(baseIndex >= 0 ? args[baseIndex + 1] : 'http://localhost:5192');
if (!['localhost', '127.0.0.1'].includes(base.hostname) || !['http:', 'https:'].includes(base.protocol)) throw new Error('Capture base must be local.');
const fallback = args.includes('--fallback');
const backend = new URL(process.env.VITE_CHATDOM_ORIGIN || 'https://chatdom.io').origin;
const load = async name => (await runnerImport(join(panelRoot, name), { root: panelRoot, configFile: false, logLevel: 'warn' })).module;
const { DEFAULT_SETTINGS } = await load('src/settings/schema.ts');
const { GIFT_CATALOGUE } = await load('src/gifts/catalogue.ts');
const products = GIFT_CATALOGUE.flatMap(gift => gift.bands.map(band => ({ sku: band.id, cost: { amount: band.suggestedBits, type: 'bits' } })));
const helper = helperSource(randomBytes(32).toString('base64'), { role: 'broadcaster', channel: '129634568', user: '129634568', identity: 'shared', bits: true, products });
const errors = [];
await mkdir(evidence, { recursive: true });
const release = await acquireCaptureLock();
let browser;
try {
  if (fallback) {
    browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
  } else {
    const response = await fetch('http://127.0.0.1:9333/json/version', { signal: AbortSignal.timeout(4000) });
    if (!response.ok) throw new Error('GPU Chrome tunnel unavailable');
    const ws = new URL((await response.json()).webSocketDebuggerUrl);
    if (!['ws:', 'wss:'].includes(ws.protocol) || !ws.pathname.startsWith('/devtools/browser/')) throw new Error('GPU tunnel did not return Chrome');
    ws.protocol = 'ws:'; ws.host = '127.0.0.1:9333';
    browser = await chromium.connectOverCDP(ws.href, { timeout: 10000 });
  }
  const sizes = fallback ? [[318, 496]] : [[318, 496], [390, 844]];
  for (const [width, height] of sizes) for (const view of fallback ? ['config'] : ['config', 'live_config']) {
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
    let reading = { version: 1, status: 'settings', revision: '1', connected: true, settings: structuredClone(DEFAULT_SETTINGS) };
    let revision = 1;
    try {
      await context.route('**/*', async route => {
        const req = route.request(), url = new URL(req.url());
        if (req.url() === HELPER_URL) return route.fulfill({ status: 200, contentType: 'application/javascript', body: helper });
        if (url.origin === backend && ['/api/panel/v1/configuration', '/api/panel/v1/configure'].includes(url.pathname)) {
          const headers = { 'access-control-allow-origin': base.origin, 'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-methods': 'POST, OPTIONS' };
          if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
          if (req.method() !== 'POST') return route.abort();
          if (url.pathname.endsWith('/configure')) {
            const body = req.postDataJSON();
            if (body.expectedRevision !== reading.revision) return route.fulfill({ status: 200, headers, json: { status: 'conflict', current: reading } });
            reading = { ...reading, revision: String(++revision), settings: body.settings };
          }
          return route.fulfill({ status: 200, headers, json: reading });
        }
        if (url.origin === base.origin) return route.continue();
        return route.abort();
      });
      const page = await context.newPage();
      await page.goto(new URL(`/${view}.html`, base).href, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForFunction(() => window.__chatdomReady === true, null, { timeout: 60000 });
      await page.getByRole('heading', { name: view === 'config' ? 'A window for your people' : 'A quiet switch for tonight' }).waitFor();
      await page.getByText('Kingdom connected', { exact: true }).waitFor();
      await (view === 'config' ? page.getByRole('switch', { name: 'Show you tab' }) : page.getByRole('button', { name: 'Hide panel gifts' })).waitFor();
      async function capture(name) {
        const horizontal = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
        if (horizontal) errors.push(`${name}: horizontal overflow`);
        const small = await page.locator('button:visible').evaluateAll(buttons => buttons.filter(button => { const box = button.getBoundingClientRect(); return box.width < 44 || box.height < 44; }).map(button => `${button.getAttribute('aria-label') || button.textContent?.trim()}: ${Math.round(button.getBoundingClientRect().width)}x${Math.round(button.getBoundingClientRect().height)}`));
        if (small.length) errors.push(`${name}: targets under 44px: ${small.join(', ')}`);
        const path = join(evidence, `${name}@${width}x${height}.png`);
        await page.screenshot({ path });
        if ((await stat(path)).size > 2 * 1024 * 1024) errors.push(`${path}: larger than 2 MiB`);
        console.info(`Captured ${path}`);
      }
      await capture(view === 'config' ? 'config' : 'live-config');
      if (view === 'config' && !fallback) {
        await page.getByRole('heading', { name: 'Little celebrations' }).scrollIntoViewIfNeeded();
        await page.locator('.cfg-band').first().scrollIntoViewIfNeeded();
        await capture('config-gift-bands');
      }
    } finally { await context.close(); }
  }
  if (errors.length) throw new Error(errors.join('\n'));
} finally {
  // Disconnect from the leased browser; only contexts made here were closed.
  await browser?.close();
  await release();
}
