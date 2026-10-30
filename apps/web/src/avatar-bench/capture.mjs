/* global URLSearchParams:readonly, Image:readonly */
// Captures the avatar bench: every review look from three angles at 480×480, the bench page at web
// sizes, contact sheets per group at 1440×900 and 390×844, and measured render stats.
//   node apps/web/src/avatar-bench/capture.mjs --base-url http://127.0.0.1:5190 [--hour 19] [--look id] [--group bodies]
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { acquireCaptureLock } from '../../../../packages/testing/capture-lock.mjs';
import { startCapturePreview, closeCapturePreview } from '../../../../packages/testing/preview.mjs';

const args = process.argv.slice(2);
const option = name => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
const hour = option('--hour') ?? '19';
if (!/^(?:[01]?\d|2[0-3])$/.test(hour)) throw new Error('--hour must be a whole hour in 0..23.');
const lookFilter = option('--look');
const groupFilter = option('--group');
const root = fileURLToPath(new URL('../../../..', import.meta.url));
const output = `${root}shots/avatars/wardrobe-body${hour === '19' ? '' : `/hour-${hour}`}`;
const ANGLES = ['front', 'side', 'back'];
const PAGE_SIZES = [[1440, 900], [390, 844]];
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');

let loader, server, browser, release;
try {
  release = await acquireCaptureLock();
  loader = await createServer({ root, configFile: false, server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom', logLevel: 'error' });
  const { REVIEW_LOOKS, AVATAR_LOOK_LIMITS } = await loader.ssrLoadModule('/packages/content/src/avatars/index.ts').then(async m => ({ ...m, ...(await loader.ssrLoadModule('/packages/shared/src/avatar.ts')) }));
  const looks = REVIEW_LOOKS.filter(look => (!lookFilter || look.id === lookFilter) && (!groupFilter || look.group === groupFilter))
    .map(({ id, group, label, note }) => ({ id, group, label, note }));
  await loader.close(); loader = undefined;
  if (!looks.length) throw new Error('No review look matches the filter.');
  let base = option('--base-url');
  if (!base) ({ server, base } = await startCapturePreview('CHATDOM_AVATAR_PORT'));
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
  const errors = [];
  const open = async (look, frame, angle, width, height) => {
    const page = await browser.newPage({ viewport: { width, height } });
    page.on('pageerror', error => errors.push(`${look.id}: ${error.message}`));
    page.on('console', message => { if (message.type() === 'error') errors.push(`${look.id}: ${message.text()}`); });
    const query = new URLSearchParams({ look: look.id, angle, hour, frame, seed: 'chatdom-avatars' });
    await page.goto(`${base}/-/avatars?${query}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__chatdomReady === true || typeof window.__chatdomAvatarError === 'string', {}, { timeout: 240_000 });
    const failure = await page.evaluate(() => window.__chatdomAvatarError);
    if (failure) throw new Error(`${look.id}: ${failure}`);
    if (await page.locator(`[data-look="${look.id}"]`).count() !== 1) throw new Error(`${look.id}: the bench did not render the requested look. Rebuild the web app.`);
    return page;
  };
  const pictures = [], stats = [];
  for (const look of looks) {
    await mkdir(`${output}/${look.group}`, { recursive: true });
    const page = await open(look, 'still', 'front', 480, 480);
    for (const angle of ANGLES) {
      await page.evaluate(next => window.__chatdomAvatarView(next), angle);
      await page.waitForFunction(next => window.__chatdomReady === true && window.__chatdomAvatar?.angle === next, angle);
      if (errors.length) throw new Error(errors.join('\n'));
      const measured = await page.evaluate(() => window.__chatdomAvatar);
      if (!(measured.triangles > 0)) throw new Error(`${look.id}: the renderer returned empty geometry.`);
      if (measured.draws !== measured.parts) throw new Error(`${look.id}: expected one draw per part, measured ${measured.draws} for ${measured.parts}.`);
      const path = `${output}/${look.group}/${look.id}-${angle}@480x480.png`;
      await page.screenshot({ path });
      pictures.push({ ...look, angle, path, data: (await readFile(path)).toString('base64') });
      if (angle === 'front') stats.push({ look: look.id, group: look.group, label: look.label, note: look.note, parts: measured.parts, boxes: measured.boxes, occupiedCells: measured.occupiedCells, triangles: measured.triangles, draws: measured.draws, materials: measured.materials,
        withinLimits: measured.parts <= AVATAR_LOOK_LIMITS.maxParts && measured.occupiedCells <= AVATAR_LOOK_LIMITS.maxOccupiedCells && measured.triangles <= AVATAR_LOOK_LIMITS.maxTriangles });
    }
    await page.close();
    if (look.group === 'assembled') for (const [width, height] of PAGE_SIZES) {
      const bench = await open(look, 'page', 'front', width, height);
      if (errors.length) throw new Error(errors.join('\n'));
      await bench.screenshot({ path: `${output}/assembled/${look.id}-bench@${width}x${height}.png` });
      await bench.close();
    }
    console.log(`Captured ${look.group}/${look.id}.`);
  }
  const sheet = (items, width, columns, title) => {
    const tile = width / columns, height = 84 + Math.ceil(items.length / columns) * (tile + 28);
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#28232a"/><text x="18" y="32" fill="#efe3c8" font-family="Georgia" font-size="${width < 500 ? 16 : 22}">Chatdom · avatars · ${escape(title)} · ${escape(hour)}:00</text>${width < 500 ? '<text x="18" y="54" fill="#e8bd62" font-family="Georgia" font-size="10" letter-spacing="1.2">SIMULATED review people · static rest pose</text><text x="18" y="70" fill="#c9b48e" font-family="Georgia" font-size="9">Production avatar voxel pipeline</text>' : '<text x="18" y="58" fill="#e8bd62" font-family="Georgia" font-size="13" letter-spacing="1.5">SIMULATED review people · production avatar voxel pipeline · static rest pose</text>'}${items.map((p, i) => { const x = (i % columns) * tile, y = 84 + Math.floor(i / columns) * (tile + 28); return `<image x="${x}" y="${y}" width="${tile}" height="${tile}" href="data:image/png;base64,${p.data}"/><text x="${x + 8}" y="${y + tile + 16}" fill="#efe3c8" font-family="Georgia" font-size="${width < 500 ? 8 : 11}">${escape(p.id)} · ${p.angle}</text>`; }).join('')}</svg>`;
  };
  const groups = [...new Set(pictures.map(p => p.group)), 'all'];
  for (const group of groups) {
    const items = group === 'all' ? pictures : pictures.filter(p => p.group === group);
    const folder = group === 'all' ? output : `${output}/${group}`;
    await writeFile(`${folder}/contact-sheet.svg`, sheet(items, 1440, 6, group));
    for (const [width, height] of PAGE_SIZES) {
      const page = await browser.newPage({ viewport: { width, height } });
      await page.setContent(`<html><body style="margin:0;background:#28232a">${sheet(items, width, width < 500 ? 3 : 6, group)}</body></html>`);
      await page.locator('svg image').evaluateAll(images => Promise.all(images.map(image => new Promise((resolve, reject) => { const probe = new Image(); probe.onload = resolve; probe.onerror = reject; probe.src = image.getAttribute('href'); }))));
      await page.screenshot({ path: `${folder}/contact-sheet@${width}x${height}.png`, fullPage: true });
      await page.close();
    }
  }
  await writeFile(`${output}/render-stats.json`, `${JSON.stringify({ hour: Number(hour), pose: 'rest', simulated: true, limits: AVATAR_LOOK_LIMITS, scope: lookFilter || groupFilter ? 'filtered' : 'all', looks: stats }, null, 2)}\n`);
  const over = stats.filter(s => !s.withinLimits);
  if (over.length) throw new Error(`Over the look budget: ${over.map(s => s.look).join(', ')}`);
  console.log(`Captured ${looks.length} looks / ${pictures.length} stills into ${output}.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1;
} finally {
  try { await browser?.close(); } finally {
    try { await loader?.close(); } finally {
      try { if (server) await closeCapturePreview(server); } finally { await release?.(); }
    }
  }
}
