/* global URLSearchParams:readonly, Image:readonly */
// Captures the starting-shape bench against the built web app: every finished template from four views at
// 1440×900, the bench at 390×844, the real draft sequence (preview → begin → carve → undo → undo → redo) at both
// web sizes, contact sheets and the measured report of each step.
//   pnpm build && node apps/web/src/template-bench/capture.mjs [--partial] [--base-url http://127.0.0.1:5190] [--hour 19]
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { acquireCaptureLock } from '../../../../packages/testing/capture-lock.mjs';
import { startCapturePreview, closeCapturePreview } from '../../../../packages/testing/preview.mjs';

const args = process.argv.slice(2);
const option = name => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
const partial = args.includes('--partial');
const hour = option('--hour') ?? '19';
if (!/^(?:[01]?\d|2[0-3])$/.test(hour)) throw new Error('--hour must be a whole hour in 0..23.');
const root = fileURLToPath(new URL('../../../..', import.meta.url));
const output = `${root}shots/templates${hour === '19' ? '' : `/hour-${hour}`}`;
const SEED = 'chatdom-templates';
const ANGLES = ['front', 'side', 'back', 'cutaway'];
const DESKTOP = [1440, 900], PHONE = [390, 844];
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');

let loader, server, browser, release;
try {
  release = await acquireCaptureLock();
  loader = await createServer({ root, configFile: false, server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom', logLevel: 'error' });
  const { BUILD_TEMPLATE_CHOICES } = await loader.ssrLoadModule('/packages/content/src/templates/index.ts');
  const choices = BUILD_TEMPLATE_CHOICES.map(({ id, style, form, tier }) => ({ id, style, form, tier }));
  await loader.close(); loader = undefined;
  if (!choices.length) throw new Error('No starting shape is finished.');
  if (!partial && choices.length !== 45) throw new Error(`The full catalogue needs forty-five starting shapes; ${choices.length} are finished. Use --partial for intermediate work.`);
  let base = option('--base-url');
  if (!base) ({ server, base } = await startCapturePreview('CHATDOM_TEMPLATE_PORT'));
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  const errors = [];
  const ready = async (page, label) => {
    await page.waitForFunction(() => window.__chatdomReady === true || typeof window.__chatdomTemplatesError === 'string', {}, { timeout: 300_000 });
    const failure = await page.evaluate(() => window.__chatdomTemplatesError);
    if (failure) throw new Error(`${label}: ${failure}`);
    if (errors.length) throw new Error(errors.join('\n'));
    return page.evaluate(() => window.__chatdomTemplates);
  };
  const open = async (choice, angle, [width, height]) => {
    const page = await browser.newPage({ viewport: { width, height } });
    page.on('pageerror', error => errors.push(`${choice.id}: ${error.message}`));
    page.on('console', message => { if (message.type() === 'error') errors.push(`${choice.id}: ${message.text()}`); });
    const query = new URLSearchParams({ style: choice.style, form: choice.form, tier: choice.tier, angle, hour, seed: SEED });
    await page.goto(`${base}/-/templates?${query}`, { waitUntil: 'domcontentloaded' });
    const report = await ready(page, `${choice.id} ${angle}`);
    if (report?.asset !== choice.id || report.angle !== angle) throw new Error(`${choice.id}: the bench did not render the requested shape. Rebuild the web app.`);
    return { page, report };
  };
  const press = async (page, name, label, check) => {
    await page.getByRole('button', { name, exact: true }).click();
    const report = await ready(page, label);
    if (!check(report)) throw new Error(`${label}: unexpected draft state ${JSON.stringify(report.draft)}`);
    return report;
  };

  const pictures = [], measured = [];
  for (const choice of choices) {
    await mkdir(`${output}/${choice.id}`, { recursive: true });
    const { page, report } = await open(choice, 'front', DESKTOP);
    if (report.mode !== 'preview' || report.draft.revision !== 0 || report.draft.voxelCount !== 0) throw new Error(`${choice.id}: previewing changed the draft.`);
    if (!(report.triangles > 0) || report.draws !== 1) throw new Error(`${choice.id}: expected one draw of real geometry, measured ${report.draws} draws and ${report.triangles} triangles.`);
    if (report.occupied > report.allowance) throw new Error(`${choice.id}: ${report.occupied} blocks exceed the ${report.tier} allowance.`);
    measured.push({ id: choice.id, boxes: report.boxes, occupied: report.occupied, allowance: report.allowance, remaining: report.remaining, triangles: report.triangles, chunks: report.chunks, draws: report.draws, windows: report.windows });
    for (const angle of ANGLES) {
      if (angle !== 'front') {
        await page.getByRole('button', { name: angle[0].toUpperCase() + angle.slice(1), exact: true }).click();
        const next = await ready(page, `${choice.id} ${angle}`);
        if (next.angle !== angle) throw new Error(`${choice.id}: view ${angle} did not settle.`);
      }
      const path = `${output}/${choice.id}/bench-${angle}@1440x900.png`;
      await page.screenshot({ path });
      pictures.push({ caption: `${choice.id} · ${angle}`, data: (await readFile(path)).toString('base64') });
    }
    await page.close();
    const phone = await open(choice, 'front', PHONE);
    await phone.page.screenshot({ path: `${output}/${choice.id}/bench-front@390x844.png` });
    await phone.page.close();
    console.log(`Captured ${choice.id}: ${report.occupied} of ${report.allowance} blocks, ${report.triangles} triangles.`);
  }

  // The real draft at work on the first finished shape: nothing here is a staged mesh.
  const sequence = [];
  const [first] = choices;
  for (const size of [DESKTOP, PHONE]) {
    const tag = `${size[0]}x${size[1]}`;
    const { page, report } = await open(first, 'front', size);
    const shoot = async (step, state) => {
      const path = `${output}/sequence/${String(sequence.filter(s => s.size === tag).length + 1).padStart(2, '0')}-${step}@${tag}.png`;
      await mkdir(`${output}/sequence`, { recursive: true });
      await page.screenshot({ path });
      sequence.push({ size: tag, step, path: path.slice(root.length), mode: state.mode, occupied: state.occupied, draft: state.draft });
      if (size === DESKTOP) pictures.push({ caption: `sequence · ${step}`, data: (await readFile(path)).toString('base64'), sequence: true });
    };
    await shoot('preview', report);
    const begun = await press(page, 'Begin with this shape', 'begin', r => r.mode === 'draft' && r.draft.revision === 1 && r.draft.voxelCount === report.occupied && r.draft.canUndo);
    await shoot('begun', begun);
    const carved = await press(page, 'Carve the block beside the door', 'carve', r => r.draft.revision === 2 && r.draft.voxelCount === begun.draft.voxelCount - 1 && r.draft.edited);
    await shoot('carved', carved);
    const restored = await press(page, 'Undo', 'undo carve', r => r.draft.revision === 3 && r.draft.voxelCount === begun.draft.voxelCount && r.draft.canRedo);
    await shoot('carve-undone', restored);
    const emptied = await press(page, 'Undo', 'undo begin', r => r.draft.voxelCount === 0 && !r.draft.canUndo);
    await shoot('begin-undone', emptied);
    const redone = await press(page, 'Redo', 'redo begin', r => r.draft.voxelCount === begun.draft.voxelCount && r.draft.canRedo);
    await shoot('begin-redone', redone);
    await page.close();
  }

  const sheet = (items, width, columns, title) => {
    const tile = width / columns, tileHeight = Math.round(tile * 900 / 1440), height = 84 + Math.ceil(items.length / columns) * (tileHeight + 28);
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#2c2420"/><text x="18" y="32" fill="#f3e6c9" font-family="Georgia" font-size="${width < 500 ? 15 : 22}">Chatdom · starting shapes · ${escape(title)} · ${escape(hour)}:00</text><text x="18" y="${width < 500 ? 54 : 58}" fill="#e8bd62" font-family="Georgia" font-size="${width < 500 ? 9 : 13}" letter-spacing="1.2">LOCAL REVIEW · production voxel worker and material · real BuildDraft insertion</text>${items.map((p, i) => { const x = (i % columns) * tile, y = 84 + Math.floor(i / columns) * (tileHeight + 28); return `<image x="${x + 2}" y="${y}" width="${tile - 4}" height="${tileHeight}" href="data:image/png;base64,${p.data}"/><text x="${x + 8}" y="${y + tileHeight + 17}" fill="#f3e6c9" font-family="Georgia" font-size="${width < 500 ? 8 : 12}">${escape(p.caption)}</text>`; }).join('')}</svg>`;
  };
  for (const [name, items] of [['views', pictures.filter(p => !p.sequence)], ['sequence', pictures.filter(p => p.sequence)]]) {
    await writeFile(`${output}/contact-${name}.svg`, sheet(items, 1440, 4, name));
    for (const [width, height] of [DESKTOP, PHONE]) {
      const page = await browser.newPage({ viewport: { width, height } });
      await page.setContent(`<html><body style="margin:0;background:#2c2420">${sheet(items, width, width < 500 ? 2 : 4, name)}</body></html>`);
      await page.locator('svg image').evaluateAll(images => Promise.all(images.map(image => new Promise((resolve, reject) => { const probe = new Image(); probe.onload = resolve; probe.onerror = reject; probe.src = image.getAttribute('href'); }))));
      await page.screenshot({ path: `${output}/contact-${name}@${width}x${height}.png`, fullPage: true });
      await page.close();
    }
  }
  await writeFile(`${output}/report.json`, `${JSON.stringify({ hour: Number(hour), seed: SEED, scope: partial ? 'partial' : 'all', templates: measured, sequence }, null, 2)}\n`);
  if (errors.length) throw new Error(errors.join('\n'));
  console.log(`Captured ${choices.length} starting shape${choices.length === 1 ? '' : 's'} and the draft sequence into ${output.slice(root.length)}.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1;
} finally {
  try { await browser?.close(); } finally {
    try { await loader?.close(); } finally {
      try { if (server) await closeCapturePreview(server); } finally { await release?.(); }
    }
  }
}
