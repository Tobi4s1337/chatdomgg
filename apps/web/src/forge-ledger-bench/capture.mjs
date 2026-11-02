import { spawnSync } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

// Stills of "the forge remembers": the wall at street distance and up close, at dusk and by day, and the Esc ledger
// page at both web sizes. The bench's ledger is the realm route's real answer for the FW11 town (fifty-town.json).
//   node apps/web/src/forge-ledger-bench/capture.mjs [shot,...]           real GPU through chatdom-pc-lease (5192)
//   node apps/web/src/forge-ledger-bench/capture.mjs --local [shot,...]   SwiftShader under the capture lock, no port
// shot = name:query:WxH
const here = fileURLToPath(new URL('.', import.meta.url));
const web = resolve(here, '../..'), repo = resolve(web, '../..');
const args = process.argv.slice(2), local = args.includes('--local');
const output = local ? '/tmp/chatdom-forge-wish/fw12' : join(repo, 'work/evidence/forge-wish/fw12-ledger');
const built = '/tmp/chatdom-forge-wish/ledger-bench';
const shots = (args.find(arg => !arg.startsWith('--')) ?? [
  'wall-street-dusk:view=wall&shot=street&hour=19.6:1440x900',
  'wall-close-dusk:view=wall&shot=close&hour=19.6:1440x900',
  'wall-street-day:view=wall&shot=street&hour=13:1440x900',
  'wall-street-dusk:view=wall&shot=street&hour=19.6:390x844',
  'page:view=page:1440x900',
  'page:view=page:390x844',
  'page-empty:view=page&empty=1:390x844',
].join(',')).split(',');

await build({ configFile: false, root: web, logLevel: 'warn', base: '/',
  build: { outDir: built, emptyOutDir: true, target: 'es2022', rollupOptions: { input: join(here, 'index.html') } } });
await mkdir(output, { recursive: true });

if (local) {
  const { chromium } = await import('@playwright/test');
  const { acquireCaptureLock } = await import('../../../../packages/testing/capture-lock.mjs');
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.png': 'image/png', '.svg': 'image/svg+xml' };
  const origin = 'http://forge-ledger.bench';
  const release = await acquireCaptureLock({ signal: globalThis.AbortSignal.timeout(240_000) });
  const started = Date.now();
  let browser;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    for (const shot of shots) {
      const [name, query, size] = shot.split(':'); const [width, height] = size.split('x').map(Number);
      const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
      await page.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (url.origin !== origin) return route.abort();
        const file = join(built, decodeURIComponent(url.pathname));
        if (!file.startsWith(built)) return route.abort();
        try { return route.fulfill({ status: 200, contentType: types[extname(file)] ?? 'application/octet-stream', body: await readFile(file) }); }
        catch { return route.fulfill({ status: 404, contentType: 'text/plain', body: 'not found' }); }
      });
      await page.goto(`${origin}/src/forge-ledger-bench/index.html?${query}`);
      await page.waitForFunction(() => window.__chatdomReady === true, undefined, { timeout: 120_000 }).catch(() => errors.push('never ready'));
      await page.screenshot({ path: join(output, `${name}@${size}.png`) });
      const fits = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
      console.log(`${name}@${size}: ${errors.length ? errors.join(' | ') : 'no errors'}; fits ${fits}`);
      await page.close();
    }
  } finally { await browser?.close(); await release(); console.log(`capture lock held ${Math.round((Date.now() - started) / 1000)} s`); }
} else {
  const lines = [
    `(cd ${JSON.stringify(web)} && exec npx vite preview --outDir ${JSON.stringify(built)} --host 127.0.0.1 --port 5192 --strictPort) >/dev/null 2>&1 &`,
    'for i in $(seq 1 60); do curl -sf http://127.0.0.1:5192/src/forge-ledger-bench/index.html >/dev/null && break; sleep 0.5; done',
    ...shots.map(shot => {
      const [name, query, size] = shot.split(':');
      return `chatdom-pc shot ${JSON.stringify(`http://localhost:5192/src/forge-ledger-bench/index.html?${query}`)} ${JSON.stringify(join(output, `gpu-${name}@${size}.png`))} --size ${size} --settle 3`;
    }),
  ];
  const lease = spawnSync('chatdom-pc-lease', ['--wait', '20', '--max', '8', '--', 'bash', '-c', lines.join('\n')], { stdio: 'inherit' });
  process.exitCode = lease.status ?? 1;
}
