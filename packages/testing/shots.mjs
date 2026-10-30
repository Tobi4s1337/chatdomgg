import { chromium } from '@playwright/test';
import { preview } from 'vite';
import { mkdir } from 'node:fs/promises';
const args = process.argv.slice(2);
const option = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const external = option('--base-url');
const base = external ?? 'http://127.0.0.1:5189';
const area = option('--area') ?? 'foundation';
let server;
let browser;
try {
  if (!external) {
    server = await preview({ root: 'apps/web', configFile: 'apps/web/vite.config.ts', preview: { host: '127.0.0.1', port: 5189, strictPort: true } });
  }
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
  const targets = area === 'atlas' ? [['atlas', '/map', 1440, 900], ['atlas', '/map', 390, 844]] : [['web', '/', 1440, 900], ['web', '/', 390, 844], ['stream', '/stream', 1920, 1080], ['stream', '/stream', 1280, 720], ['panel', '/panel', 318, 496]];
  await mkdir(`shots/${area}`, { recursive: true });
  for (const [name, path, width, height] of targets) {
    const page = await browser.newPage({ viewport: { width, height } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${base}${path}?seed=chatdom&hour=19`);
    await page.waitForFunction(() => window.__chatdomReady === true);
    if (area === 'atlas' && await page.locator('[data-chatdom-atlas]').count() !== 1) throw new Error('Atlas screenshot requires the real Atlas root');
    await page.evaluate(() => document.fonts.ready);
    if (errors.length) throw new Error(errors.join('\n'));
    if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)) throw new Error(`${name} overflows viewport`);
    await page.screenshot({ path: `shots/${area}/${name}@${width}x${height}.png`, fullPage: false });
    await page.close();
  }
} finally {
  await browser?.close();
  if (server) await new Promise((resolve, reject) => server.httpServer.close(error => error ? reject(error) : resolve()));
}
