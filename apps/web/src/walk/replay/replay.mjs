// PL13's mouse look replay on a real browser: page.ts runs the walk controller at the browser's own refresh rate on
// recorded and synthetic locked mouse streams and prints the turn per count and any spin after the hand stops.
//
//   Build once, outside the lease:   node apps/web/src/walk/replay/replay.mjs --build-only
//   Real GPU, inside the lease:      chatdom-pc-lease -- node apps/web/src/walk/replay/replay.mjs --bundle <dir>
//   Headless, under the capture lock: node apps/web/src/walk/replay/replay.mjs --target local --port <free 5170-5186>
//                                     (Chrome and Firefox, one after the other; --browsers chromium or firefox for one)
//
// The page holds no real pointer lock, so it never takes the cursor of the machine it runs on. Dev only: never a
// route, never in the app build.
import { build } from 'vite';
import { mkdtemp, readFile, writeFile, mkdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { acquireCaptureLock } from '../../../../../packages/testing/capture-lock.mjs';

const { values } = parseArgs({ options: {
  target: { type: 'string', default: 'pc' }, bundle: { type: 'string' }, 'build-only': { type: 'boolean', default: false },
  out: { type: 'string', default: 'work/evidence/play/mouse' }, browsers: { type: 'string', default: 'chromium,firefox' }, size: { type: 'string', default: '1440x900' }, port: { type: 'string' },
} });
const here = fileURLToPath(new URL('.', import.meta.url));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

async function buildPage() {
  const outDir = await mkdtemp(join(tmpdir(), 'play-replay-'));
  await build({ root: here, configFile: false, base: './', logLevel: 'warn',
    build: { outDir, emptyOutDir: true, minify: false, sourcemap: false, reportCompressedSize: false, chunkSizeWarningLimit: 1e9 } });
  return outDir;
}

const dir = values.bundle ?? await buildPage();
if (values['build-only']) { console.log(`Replay: page built in ${dir}`); process.exit(0); }

const pc = values.target === 'pc';
const port = Number(values.port ?? (pc ? 5192 : 5178));
const server = createServer((request, response) => {
  const path = decodeURIComponent(new URL(request.url ?? '/', 'http://replay').pathname);
  const file = normalize(join(dir, path === '/' ? 'index.html' : path));
  response.setHeader('Cache-Control', 'no-store');
  if (!file.startsWith(dir + sep)) { response.statusCode = 403; response.end(); return; }
  readFile(file).then(body => { response.setHeader('Content-Type', TYPES[extname(file)] ?? 'application/octet-stream'); response.end(body); },
    () => { response.statusCode = 404; response.end(); });
});
await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
await mkdir(values.out, { recursive: true });
const url = `http://localhost:${port}/index.html`;
let code = 0;
if (pc) {
  const out = `${values.out}/replay-gpu@${values.size}.png`;
  code = await new Promise(resolve => spawn('chatdom-pc', ['shot', url, out, '--size', values.size, '--timeout', '120', '--settle', '1'], { stdio: 'inherit' }).once('exit', resolve));
  console.log(`Replay: ${code === 0 ? out : 'shot failed'}`);
} else {
  const engines = await import('@playwright/test');
  const [width, height] = values.size.split('x').map(Number);
  const release = await acquireCaptureLock();
  try {
    for (const name of values.browsers.split(',')) {
      const browser = await engines[name].launch();
      const tab = await browser.newPage({ viewport: { width, height } });
      await tab.goto(url);
      await tab.waitForFunction(() => window.__chatdomReady === true, null, { timeout: 120_000 });
      const result = await tab.evaluate(() => window.__replay);
      await writeFile(`${values.out}/replay-${name}.json`, JSON.stringify(result, null, 2));
      await tab.screenshot({ path: `${values.out}/replay-${name}@${values.size}.png` });
      await browser.close();
      const failed = result.results.filter(row => !row.ok);
      if (failed.length) code = 1;
      console.log(`Replay ${name}: ${result.hz.toFixed(0)} fps, ${result.results.length - failed.length}/${result.results.length} pass`);
    }
  } finally { await release(); }
}
server.close();
process.exit(code);
