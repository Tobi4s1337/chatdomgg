/* global URLSearchParams:readonly */
// Capture the picture-land fixture at stream size under the machine-wide capture lock.
// node apps/web/src/kingdom/terrain-art/capture.mjs [--view street] [--hour 18.9] [--land accepted] [--name street]
//   [--eye x,y,z --target x,y,z --fov n] [--size 1920x1080]
// or several stills on one server: --shot 'street=view=street&hour=18.9' --shot 'street-accepted=view=street&land=accepted'
import { createServer as createNetServer } from 'node:net';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { acquireCaptureLock } from '../../../../../packages/testing/capture-lock.mjs';
import { CAPTURE_PORTS } from '../../../../../packages/testing/capture-ports.mjs';

const args = process.argv.slice(2);
const option = (name) => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
const [width, height] = (option('--size') ?? '1920x1080').split('x').map(Number);
if (!(width > 0 && height > 0)) throw new Error('--size must look like 1920x1080.');
const query = new URLSearchParams();
for (const key of ['view', 'hour', 'land', 'eye', 'target', 'fov', 'quality']) { const value = option(`--${key}`); if (value !== undefined) query.set(key, value); }
const name = option('--name') ?? `${option('--view') ?? 'street'}${option('--land') === 'accepted' ? '-accepted' : ''}`;
const shots = args.flatMap((arg, i) => arg === '--shot' ? [args[i + 1]] : []).map((shot) => {
  const at = shot.indexOf('=');
  if (at <= 0) throw new Error('--shot needs name=query.');
  return { name: shot.slice(0, at), query: new URLSearchParams(shot.slice(at + 1)) };
});
if (!shots.length) shots.push({ name, query });
const root = fileURLToPath(new URL('../../../../..', import.meta.url));
const web = fileURLToPath(new URL('../../..', import.meta.url));

const free = (port) => new Promise((resolve) => {
  const probe = createNetServer().once('error', () => resolve(false)).once('listening', () => probe.close(() => resolve(true)));
  probe.listen(port, '127.0.0.1');
});

let release, server, browser;
try {
  release = await acquireCaptureLock();
  // Only ports in the capture range below the reserved service block; never a service port.
  let port;
  for (const candidate of CAPTURE_PORTS.filter((p) => p >= 5176 && p <= 5186)) if (await free(candidate)) { port = candidate; break; }
  if (!port) throw new Error('No free capture port in 5176–5186.');
  server = await createServer({ root: web, configFile: `${web}/vite.config.ts`, logLevel: 'warn',
    server: { host: '127.0.0.1', port, strictPort: true, hmr: false, fs: { allow: [root] } } });
  await server.listen();
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
  const output = `${root}shots/terrain-art`;
  await mkdir(output, { recursive: true });
  for (const shot of shots) {
    // A fresh page per still: no state, worker or GPU memory carries from one capture to the next.
    const page = await browser.newPage({ viewport: { width, height } });
    page.on('console', (message) => { if (message.type() === 'error') console.error(`[page] ${message.text()}`); });
    page.on('pageerror', (error) => console.error(`[page] ${error.message}`));
    const url = `http://127.0.0.1:${port}/src/kingdom/terrain-art/fixture.html?${shot.query}`;
    console.log(`Capturing ${url}`);
    const started = Date.now();
    await page.goto(url, { waitUntil: 'load', timeout: 180_000 });
    await page.waitForFunction(() => window.__chatdomReady === true, undefined, { timeout: 900_000, polling: 1000 });
    const stats = await page.evaluate(() => window.__pictureLand);
    const path = `${output}/${shot.name}@${width}x${height}.png`;
    await page.screenshot({ path, timeout: 600_000 });
    console.log(`${path} · ${((Date.now() - started) / 1000).toFixed(0)} s · ${JSON.stringify(stats)}`);
    await page.close();
  }
} finally {
  await browser?.close();
  await server?.close();
  await release?.();
}
