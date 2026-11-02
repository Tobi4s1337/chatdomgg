// GW13 still of an unfounded channel's own world on the public grand view: /-/grand?channel=<login>.
// usage: node work/lanes/grand-world/capture-sketch.mjs <login> [width height]
// Builds the realm's land bake child and a sketch host (sketch-host.ts) into shots/grand-world/sketch-host, serves the
// lane's sketch store on capture port 5198 and apps/web with Vite on 5182 (GW13_LAND_PORT, GW13_WEB_PORT) (the Atlas read through its usual public
// proxy). The page asks the realm for the channel's land; the bake runs at nice 19 with two threads before the capture
// lock is taken, and the lock is held only while the browser draws the raised land.
import { spawn } from 'node:child_process';
import { mkdir, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';
import { build } from 'vite';
import { acquireCaptureLock } from '../../../packages/testing/capture-lock.mjs';
import { assertCapturePort } from '../../../packages/testing/capture-ports.mjs';

const [login, width = '1440', height = '900'] = process.argv.slice(2);
if (!login) throw new Error('usage: capture-sketch.mjs <login> [width height]');
const webPort = assertCapturePort(Number(process.env.GW13_WEB_PORT ?? 5182)), landPort = assertCapturePort(Number(process.env.GW13_LAND_PORT ?? 5198));
const out = 'shots/grand-world/gw13', host = resolve('shots/grand-world/sketch-host'), store = resolve('shots/grand-world/sketches');
await mkdir(out, { recursive: true });
const bundle = (entry, name) => build({ configFile: false, root: process.cwd(), ssr: { noExternal: true, target: 'node' }, logLevel: 'warn',
  build: { ssr: resolve(entry), target: 'node22', outDir: host, emptyOutDir: false, minify: false, rollupOptions: { output: { entryFileNames: name } } } });
await bundle('apps/realm/src/land/cli.ts', 'land-bake.mjs');
await bundle('work/lanes/grand-world/sketch-host.ts', 'host.mjs');
const { serveSketches } = await import(pathToFileURL(`${host}/host.mjs`).href);
const land = await serveSketches(store, `${host}/land-bake.mjs`, landPort, line => console.log('[realm]', line));
const server = spawn('nice', ['-n', '10', 'npx', 'vite', '--port', String(webPort), '--strictPort', '--host', '127.0.0.1'],
  { cwd: 'apps/web', stdio: ['ignore', 'pipe', 'inherit'], detached: true, env: { ...process.env, CHATDOM_LAND_TARGET: `http://127.0.0.1:${landPort}`, CHATDOM_REALM_TARGET: `http://127.0.0.1:${landPort}` } });
const stopServer = () => { try { process.kill(-server.pid, 'SIGTERM'); } catch {} };
process.once('exit', stopServer);
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { stopServer(); process.exit(130); });
await new Promise((done, fail) => {
  server.stdout.on('data', data => { if (String(data).includes('Local')) done(); });
  server.once('exit', code => fail(new Error(`vite exited ${code}`)));
});
const url = `http://127.0.0.1:${webPort}/-/grand?channel=${encodeURIComponent(login)}&capture=1&tier=software&hour=17.6`;
const launch = () => chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
const raised = async () => { try { for (const id of await readdir(store + '/sketches')) if ((await readdir(`${store}/sketches/${id}`)).some(f => f.endsWith('.json'))) return true; } catch {} return false; };
let browser, release;
try {
  // 1. Ask for the land without the lock: the page shows only its loading words while the realm raises it.
  if (!await raised()) {
    browser = await launch();
    const page = await browser.newPage({ viewport: { width: Number(width), height: Number(height) } });
    page.on('pageerror', error => console.error('[page]', error.message));
    let said = '';
    await page.route('**/api/realm/land/*/*/*', route => route.abort());
    await page.goto(url);
    const started = Date.now();
    while (!await raised()) {
      if (Date.now() - started > 20 * 60_000) throw new Error('The sketch was not raised in twenty minutes');
      const text = await page.locator('body').innerText().catch(() => '');
      const line = text.split('\n').find(l => /raising|regions|before this one|Asking|Reading|cannot|Atlas/.test(l)) ?? '';
      if (line && line !== said) { said = line; console.log(`[page ${Math.round((Date.now() - started) / 1000)} s]`, line); }
      await new Promise(done => setTimeout(done, 2000));
    }
    console.log(`raised in ${Math.round((Date.now() - started) / 1000)} s`);
    await browser.close(); browser = undefined;
  }
  // 2. Draw it under the lock.
  release = await acquireCaptureLock({ priority: 'lane' });
  const started = Date.now();
  browser = await launch();
  const page = await browser.newPage({ viewport: { width: Number(width), height: Number(height) } });
  page.on('pageerror', error => console.error('[page]', error.message));
  await page.goto(url);
  await page.waitForFunction(() => window.__chatdomReady === true, null, { timeout: 240_000, polling: 1000 });
  console.log(`ready after ${Math.round((Date.now() - started) / 1000)} s`);
  console.log(JSON.stringify(await page.evaluate(() => window.__chatdomGrand?.stats())));
  const file = `${out}/sketch-${login}@${width}x${height}.png`;
  // A software frame at capture detail takes tens of seconds; the screenshot waits for one.
  await page.screenshot({ path: file, timeout: 180_000 });
  console.log(file, `${Math.round((Date.now() - started) / 1000)} s under the lock`);
  // The same address for a founded kingdom: the page answers with its door, never a sketch (the receipt is staged here).
  const door = await browser.newPage({ viewport: { width: Number(width), height: Number(height) } });
  await door.route('**/api/realm/founded/*', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{"version":1}' }));
  await door.goto(url);
  await door.getByText('has founded its kingdom').waitFor({ timeout: 60_000 });
  await door.screenshot({ path: `${out}/sketch-${login}-founded@${width}x${height}.png` });
  console.log(`${out}/sketch-${login}-founded@${width}x${height}.png`);
} finally {
  await browser?.close();
  await release?.();
  stopServer();
  await land.close();
}
