/* global Buffer:readonly */
// Paints the panel's SIMULATED citizen portrait: the sitter's saved look (apps/web/src/citizen-card/sitter.ts) through
// the citizen portrait renderer, the same renderer the builder, the town and the card page use. Writes the portrait the
// panel ships (a small WebP, since the panel never loads three.js) and a generated module with its provenance and the
// worn pieces the look's verified records name. One owned Vite server and one Chrome, under the shared capture lock.
//   node apps/panel/src/card/sit-fixture.mjs [--port 5172]
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { execFile } from 'node:child_process';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { assertCapturePort } from '../../../../packages/testing/capture-ports.mjs';
import { acquireCaptureLock } from '../../../../packages/testing/capture-lock.mjs';

const args = process.argv.slice(2);
const option = name => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
const port = Number(option('--port') ?? 5172);
assertCapturePort(port, { name: '--port' });
const root = fileURLToPath(new URL('../../../..', import.meta.url));
const fixtureDir = `${root}apps/panel/src/assets/fixture`;
const run = promisify(execFile);
const SIZE = 512;

let server, browser, release;
try {
  release = await acquireCaptureLock();
  server = await createServer({ root: `${root}apps/web`, configFile: `${root}apps/web/vite.config.ts`, logLevel: 'error',
    optimizeDeps: { noDiscovery: true, include: ['three'] }, server: { host: '127.0.0.1', port, strictPort: true, hmr: false } });
  await server.listen();
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${port}/src/citizen-card/sitting.html?size=${SIZE}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__chatdomReady === true, {}, { timeout: 240_000 });
  if (errors.length) throw new Error(`The sitting failed: ${errors.join('; ')}`);
  const sitting = await page.evaluate(() => window.__chatdomSitting);
  if (!sitting?.png) throw new Error('The sitting left no portrait');

  await mkdir('/tmp/cp10', { recursive: true });
  const png = '/tmp/cp10/wren-512.png';
  await writeFile(png, Buffer.from(sitting.png.split(',')[1], 'base64'));
  const webp = `${fixtureDir}/wren-portrait.webp`;
  // 320 px holds the panel's 2x window (about 150 px tall) and the phone sheet without shipping the 512 px master.
  await run('ffmpeg', ['-loglevel', 'error', '-y', '-i', png, '-vf', 'scale=320:320:flags=lanczos', '-c:v', 'libwebp', '-quality', '88', webp]);
  const bytes = (await stat(webp)).size;
  const revision = (await run('git', ['rev-parse', '--short', 'HEAD'], { cwd: root }).catch(() => ({ stdout: 'unknown' }))).stdout.trim();
  const capturedOn = new Date().toISOString().slice(0, 10);
  const worn = sitting.worn.map(offer => ({ key: offer.key, name: offer.name, story: offer.story, piece: offer.piece }));
  const module = `// Written by apps/panel/src/card/sit-fixture.mjs. Do not edit by hand: sit the portrait again instead.
// The SIMULATED citizen of the panel's night, painted by our citizen portrait renderer from their saved look.
import type { WornRecord } from '../../card/worn';

export const SITTER_PORTRAIT = ${JSON.stringify({
    origin: 'simulated', file: 'wren-portrait.webp', width: 320, height: 320, bytes,
    alt: `${sitting.sitter.name}’s portrait: auburn braids, a rust coat with the Willowmere hood down on the shoulders and a knitted raid scarf`,
    render: { renderer: 'apps/web/src/avatar-builder/portrait-renderer.ts', look: 'apps/web/src/citizen-card/sitter.ts', size: SIZE },
    sourceRevision: revision, capturedOn,
  }, null, 2)} as const;

/** What the sitter wears of what their SIMULATED records allow, named as the builder names it. */
export const SITTER_WORN: readonly WornRecord[] = ${JSON.stringify(worn, null, 2)};
`;
  await writeFile(`${fixtureDir}/sitter.ts`, module);
  console.log(JSON.stringify({ png, webp, bytes, worn: worn.length }));
} finally {
  await browser?.close();
  await server?.close();
  await release?.();
}
