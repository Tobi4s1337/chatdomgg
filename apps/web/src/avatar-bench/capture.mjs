/* global URLSearchParams:readonly, Image:readonly */
// Captures the avatar bench: every review look from three angles at 480×480, the bench page at web
// sizes, contact sheets per group at 1440×900 and 390×844, and measured render stats. Looks that wear
// a cape also get a walk-to-stop strip (side and back) driven by the citizen runtime's cloth.
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
  const { REVIEW_LOOKS, isCapeForm } = await loader.ssrLoadModule('/packages/content/src/avatars/index.ts');
  const { AVATAR_LOOK_LIMITS } = await loader.ssrLoadModule('/packages/shared/src/avatar.ts');
  const { WALK_STOP_FRAMES, phaseName } = await loader.ssrLoadModule('/apps/web/src/avatar-bench/walk-stop.ts');
  const looks = REVIEW_LOOKS.filter(look => (!lookFilter || look.id === lookFilter) && (!groupFilter || look.group === groupFilter))
    .map(({ id, group, label, note, wear }) => ({ id, group, label, note, cape: wear.some(item => isCapeForm(item.id)) }));
  await loader.close(); loader = undefined;
  if (!looks.length) throw new Error('No review look matches the filter.');
  let base = option('--base-url');
  if (!base) ({ server, base } = await startCapturePreview('CHATDOM_AVATAR_PORT'));
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
  const errors = [];
  const open = async (look, frame, angle, width, height, motion = {}) => {
    const page = await browser.newPage({ viewport: { width, height } });
    page.on('pageerror', error => errors.push(`${look.id}: ${error.message}`));
    page.on('console', message => { if (message.type() === 'error') errors.push(`${look.id}: ${message.text()}`); });
    const query = new URLSearchParams({ look: look.id, angle, hour, frame, seed: 'chatdom-avatars', ...motion });
    await page.goto(`${base}/-/avatars?${query}`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__chatdomReady === true || typeof window.__chatdomAvatarError === 'string', {}, { timeout: 240_000 });
    const failure = await page.evaluate(() => window.__chatdomAvatarError);
    if (failure) throw new Error(`${look.id}: ${failure}`);
    if (await page.locator(`[data-look="${look.id}"]`).count() !== 1) throw new Error(`${look.id}: the bench did not render the requested look. Rebuild the web app.`);
    return page;
  };
  const pictures = [], stats = [], walks = [];
  for (const look of looks) {
    await mkdir(`${output}/${look.group}`, { recursive: true });
    const page = await open(look, 'still', 'front', 480, 480);
    for (const angle of ANGLES) {
      await page.evaluate(next => window.__chatdomAvatarView(next), angle);
      await page.waitForFunction(next => window.__chatdomReady === true && window.__chatdomAvatar?.angle === next, angle);
      if (errors.length) throw new Error(errors.join('\n'));
      const measured = await page.evaluate(() => window.__chatdomAvatar);
      if (!(measured.triangles > 0)) throw new Error(`${look.id}: the renderer returned empty geometry.`);
      const expected = measured.parts + (measured.cape ? 1 : 0);
      if (measured.draws !== expected) throw new Error(`${look.id}: expected one draw per part plus one for cloth, measured ${measured.draws} for ${measured.parts} parts.`);
      if (look.cape !== Boolean(measured.cape)) throw new Error(`${look.id}: the bench ${measured.cape ? 'drew a cape the look does not wear' : 'did not draw the cape'}.`);
      const path = `${output}/${look.group}/${look.id}-${angle}@480x480.png`;
      await page.screenshot({ path });
      pictures.push({ ...look, angle, path, data: (await readFile(path)).toString('base64') });
      if (angle === 'front') stats.push({ look: look.id, group: look.group, label: look.label, note: look.note, parts: measured.parts, boxes: measured.boxes, occupiedCells: measured.occupiedCells, triangles: measured.triangles, draws: measured.draws, cape: measured.cape, materials: measured.materials,
        withinLimits: measured.parts <= AVATAR_LOOK_LIMITS.maxParts && measured.occupiedCells <= AVATAR_LOOK_LIMITS.maxOccupiedCells && measured.triangles <= AVATAR_LOOK_LIMITS.maxTriangles });
    }
    await page.close();
    if (look.cape) {
      // Same look, worn by the citizen runtime: walking in place, stopping, and the cloth settling.
      await mkdir(`${output}/${look.group}/walk-stop`, { recursive: true });
      const walk = await open(look, 'still', 'side', 480, 480, { motion: 'walk-stop', t: String(WALK_STOP_FRAMES[0]) });
      const strip = [];
      for (const angle of ['side', 'back']) for (const at of WALK_STOP_FRAMES) {
        await walk.evaluate(([next, time]) => window.__chatdomAvatarView(next, time), [angle, at]);
        await walk.waitForFunction(([next, time]) => window.__chatdomReady === true && window.__chatdomAvatar?.angle === next && window.__chatdomAvatar?.at === time, [angle, at]);
        if (errors.length) throw new Error(errors.join('\n'));
        const measured = await walk.evaluate(() => window.__chatdomAvatar);
        if (measured.draws !== measured.parts + 1) throw new Error(`${look.id}: walking, expected ${measured.parts + 1} draws, measured ${measured.draws}.`);
        const path = `${output}/${look.group}/walk-stop/${look.id}-${angle}-${at.toFixed(2)}s@480x480.png`;
        await walk.screenshot({ path });
        strip.push({ ...look, angle, caption: `${angle} · ${at.toFixed(2)} s · ${phaseName(at)}`, path, data: (await readFile(path)).toString('base64') });
      }
      await walk.close();
      walks.push({ look, strip });
    }
    if (look.group === 'assembled') for (const [width, height] of PAGE_SIZES) for (const motion of look.cape ? ['rest', 'walk-stop'] : ['rest']) {
      const bench = await open(look, 'page', 'front', width, height, motion === 'rest' ? {} : { motion, t: String(WALK_STOP_FRAMES[0]) });
      if (errors.length) throw new Error(errors.join('\n'));
      await bench.screenshot({ path: `${output}/assembled/${look.id}-${motion === 'rest' ? 'bench' : 'walk-bench'}@${width}x${height}.png` });
      await bench.close();
    }
    console.log(`Captured ${look.group}/${look.id}.`);
  }
  const sheet = (items, width, columns, title, pose = 'static rest pose') => {
    const tile = width / columns, height = 84 + Math.ceil(items.length / columns) * (tile + 28);
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#28232a"/><text x="18" y="32" fill="#efe3c8" font-family="Georgia" font-size="${width < 500 ? 16 : 22}">Chatdom · avatars · ${escape(title)} · ${escape(hour)}:00</text>${width < 500 ? `<text x="18" y="54" fill="#e8bd62" font-family="Georgia" font-size="10" letter-spacing="1.2">SIMULATED review people · ${escape(pose)}</text><text x="18" y="70" fill="#c9b48e" font-family="Georgia" font-size="9">Production avatar voxel pipeline</text>` : `<text x="18" y="58" fill="#e8bd62" font-family="Georgia" font-size="13" letter-spacing="1.5">SIMULATED review people · production avatar voxel pipeline · ${escape(pose)}</text>`}${items.map((p, i) => { const x = (i % columns) * tile, y = 84 + Math.floor(i / columns) * (tile + 28); return `<image x="${x}" y="${y}" width="${tile}" height="${tile}" href="data:image/png;base64,${p.data}"/><text x="${x + 8}" y="${y + tile + 16}" fill="#efe3c8" font-family="Georgia" font-size="${width < 500 ? 8 : 11}">${escape(p.caption ? `${p.id} · ${p.caption}` : `${p.id} · ${p.angle}`)}</text>`; }).join('')}</svg>`;
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
  for (const { look, strip } of walks) {
    const folder = `${output}/${look.group}/walk-stop`, pose = 'walk, then stop · runtime cloth';
    await writeFile(`${folder}/${look.id}-contact-sheet.svg`, sheet(strip, 1440, WALK_STOP_FRAMES.length, 'walk → stop', pose));
    for (const [width, height] of PAGE_SIZES) {
      const page = await browser.newPage({ viewport: { width, height } });
      await page.setContent(`<html><body style="margin:0;background:#28232a">${sheet(strip, width, width < 500 ? 2 : WALK_STOP_FRAMES.length, 'walk → stop', pose)}</body></html>`);
      await page.locator('svg image').evaluateAll(images => Promise.all(images.map(image => new Promise((resolve, reject) => { const probe = new Image(); probe.onload = resolve; probe.onerror = reject; probe.src = image.getAttribute('href'); }))));
      await page.screenshot({ path: `${folder}/${look.id}-contact-sheet@${width}x${height}.png`, fullPage: true });
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
