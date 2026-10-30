/* global URLSearchParams:readonly */
// Captures the Forge review cottages through the built /-/forge route with Chrome/SwiftShader.
// node apps/web/src/forge-bench/capture.mjs [--family hearthfold|tidewake|grovebough] [--base-url http://127.0.0.1:5190]
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { acquireCaptureLock } from '../../../../packages/testing/capture-lock.mjs';
import { closeCapturePreview, startCapturePreview } from '../../../../packages/testing/preview.mjs';

const args = process.argv.slice(2);
const option = name => { const i = args.indexOf(name); return i < 0 ? undefined : args[i + 1]; };
const familyFilter = option('--family');
const root = fileURLToPath(new URL('../../../..', import.meta.url));
const SIZES = { desktop: [1440, 900], phone: [390, 844], stream: [1920, 1080] };

/** Every state the review needs, each with its own path so dusk, hours, door and light states never overwrite. */
function plan(family) {
  const shots = [];
  for (const [label, size] of Object.entries(SIZES)) shots.push({ dir: 'assembly', name: `dusk-${label}`, size, query: { view: 'assembly', door: 'open', hour: '19' } });
  for (const hour of ['12', '0']) for (const label of ['desktop', 'phone']) shots.push({ dir: 'assembly', name: `${hour === '12' ? 'noon' : 'night'}-${label}`, size: SIZES[label], query: { view: 'assembly', door: 'open', hour } });
  for (const door of ['closed', 'open']) shots.push({ dir: 'door', name: `door-${door}`, size: SIZES.desktop, query: { view: 'door', door, hour: '19' } });
  for (const presence of ['off', 'on']) shots.push({ dir: 'window', name: `window-${presence}`, size: SIZES.desktop, query: { view: 'window', door: 'closed', presence, hour: '21' } });
  return shots.map(shot => ({ ...shot, query: { family, ...shot.query } }));
}

let loader, server, browser, release;
try {
  release = await acquireCaptureLock();
  loader = await createServer({ root, configFile: false, server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom' });
  const forge = await loader.ssrLoadModule('/packages/content/src/forge/index.ts');
  const families = forge.FORGE_REVIEW.map(f => f.familyId).filter(id => !familyFilter || id === familyFilter);
  if (familyFilter && !forge.FORGE_FAMILIES.includes(familyFilter)) throw new Error(`Unknown --family ${familyFilter}. Choose ${forge.FORGE_FAMILIES.join(', ')}.`);
  if (!families.length) throw new Error(`No finished review cottage for ${familyFilter ?? 'any family'}.`);
  // The source of truth for each state; a built bench reporting anything else is stale.
  const expected = {};
  for (const fixture of forge.FORGE_REVIEW) for (const door of ['open', 'closed']) expected[`${fixture.familyId}/${door}`] = forge.fingerprint(forge.composeForgeFixture(fixture, forge.FORGE_PIECES, door).blueprint);
  await loader.close(); loader = undefined;
  let base = option('--base-url');
  if (!base) ({ server, base } = await startCapturePreview('CHATDOM_FORGE_PORT'));
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
  const summary = [];
  for (const family of families) {
    const out = `shots/forge-pieces/${family}`;
    const taken = [];
    for (const shot of plan(family)) {
      const [width, height] = shot.size;
      const page = await browser.newPage({ viewport: { width, height } });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => { if (message.type() === 'error') errors.push(`${message.text()} ${message.location().url}`); });
      await page.goto(`${base}/-/forge?${new URLSearchParams(shot.query)}`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.__chatdomReady === true || typeof window.__chatdomForgeError === 'string', {}, { timeout: 240_000 });
      const error = await page.evaluate(() => window.__chatdomForgeError);
      if (error) throw new Error(`${family}/${shot.name}: ${error}`);
      if (errors.length) throw new Error(`${family}/${shot.name}: ${errors.join('\n')}`);
      const measured = await page.evaluate(() => window.__chatdomForge);
      const q = shot.query;
      if (!measured || measured.family !== family || measured.view !== q.view || measured.door !== q.door || measured.hour !== Number(q.hour) || measured.presence !== (q.presence ?? 'off')) throw new Error(`${family}/${shot.name}: the bench reported a different state.`);
      if (measured.fingerprint !== expected[`${family}/${q.door}`]) throw new Error(`${family}/${shot.name}: the built bench shows a stale cottage. Run pnpm build.`);
      if (measured.width !== width || measured.height !== height || !(measured.triangles > 0)) throw new Error(`${family}/${shot.name}: wrong viewport or empty geometry.`);
      await mkdir(`${out}/${shot.dir}`, { recursive: true });
      const path = `${out}/${shot.dir}/${shot.name}@${width}x${height}.png`;
      await page.screenshot({ path });
      await page.close();
      taken.push({ ...shot, path, measured });
      console.log(`[forge] ${path} · ${measured.triangles} triangles · ${measured.draws} draws`);
    }
    // One review sheet per family: every captured state side by side at a readable size.
    const tiles = await Promise.all(taken.map(async shot => ({ ...shot, data: (await readFile(shot.path)).toString('base64') })));
    const sheet = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await sheet.setContent(`<html><body style="margin:0;background:#292830;color:#eadfc8;font:13px Georgia"><h1 style="font-weight:normal;font-size:20px;margin:16px 20px 4px">Chatdom · Forge pieces · ${family}</h1><p style="margin:0 20px 12px;color:#c6b493">Production voxel pipeline · unoccupied review assemblies · window pair uses SIMULATED presence</p><div style="display:flex;flex-wrap:wrap;gap:10px;padding:0 20px 20px">${tiles.map(t => `<figure style="margin:0;width:${t.size[0] < 1000 ? 160 : 340}px"><img style="width:100%;display:block" src="data:image/png;base64,${t.data}"><figcaption style="padding-top:4px">${t.dir} · ${t.name}</figcaption></figure>`).join('')}</div></body></html>`);
    await sheet.waitForFunction(() => [...document.images].every(image => image.complete && image.naturalWidth > 0));
    await sheet.screenshot({ path: `${out}/review-sheet@1440.png`, fullPage: true });
    await sheet.close();
    await writeFile(`${out}/capture-stats.json`, JSON.stringify(taken.map(({ path, query, measured }) => ({ path, query, ...measured })), null, 2) + '\n');
    summary.push(`${family}: ${taken.length} views, sheet ${out}/review-sheet@1440.png`);
  }
  console.log(summary.join('\n'));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  try { await browser?.close(); } finally {
    try { await loader?.close(); } finally {
      try { if (server) await closeCapturePreview(server); } finally { await release?.(); }
    }
  }
}
