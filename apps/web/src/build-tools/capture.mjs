// The build-tools lane's one focused tour: the real kingdom build scene, driven through the rack.
// node apps/web/src/build-tools/capture.mjs --base-url http://127.0.0.1:<port>
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { acquireCaptureLock } from '../../../../packages/testing/capture-lock.mjs';

const arg = process.argv.indexOf('--base-url');
const base = arg > 0 ? process.argv[arg + 1] : undefined;
if (!base) throw new Error('Pass --base-url http://127.0.0.1:<port> of a running preview.');
const url = `${base.replace(/\/$/, '')}/?tier=hamlet&hour=19.5&time=60&seed=willowmere&build=1&source=simulated`;
const out = 'shots/build-tools';
const report = { url, errors: [], checks: [] };
const release = await acquireCaptureLock();
let browser;
const frame = page => page.evaluate(() => new Promise(r => window.requestAnimationFrame(() => window.requestAnimationFrame(r))));
const rack = page => page.locator('[data-build-tools-rack]');
const session = page => page.evaluate(() => {
  const s = window.__chatdomKingdom.build.session;
  return s && { revision: s.draft.revision, occupied: s.draft.voxelCount, canUndo: s.draft.canUndo, status: s.debug.status };
});

async function open(page) {
  await page.goto(url);
  await page.waitForFunction(() => window.__chatdomReady === true && !!document.querySelector('[data-chatdom-build]'), null, { timeout: 240000 });
  await page.waitForFunction(() => window.__chatdomKingdom?.build.session?.debug.meshedRevision >= 0, null, { timeout: 120000 });
  await rack(page).waitFor({ state: 'visible', timeout: 30000 });
  await frame(page);
}

async function layout(page, name) {
  const facts = await page.evaluate(() => {
    const r = document.querySelector('[data-build-tools-rack]').getBoundingClientRect();
    const small = [...document.querySelectorAll('[data-build-tools-rack] button')].filter(b => window.getComputedStyle(b).display !== 'none')
      .map(b => b.getBoundingClientRect()).filter(b => b.width < 44 || b.height < 30).length;
    return { overflowX: document.documentElement.scrollWidth > window.innerWidth, rack: { top: r.top, left: r.left, right: r.right, bottom: r.bottom }, width: window.innerWidth, height: window.innerHeight, small };
  });
  assert.equal(facts.overflowX, false, `${name}: viewport overflow`);
  assert.ok(facts.rack.left >= 0 && facts.rack.right <= facts.width && facts.rack.top >= 0 && facts.rack.bottom <= facts.height, `${name}: rack clipped`);
  report.checks.push(`${name}: rack within viewport (${Math.round(facts.rack.right - facts.rack.left)}×${Math.round(facts.rack.bottom - facts.rack.top)})`);
  return facts;
}

/** Click the canvas at a plot cell, through the core's own projection. */
async function clickCell(page, cell) {
  const point = await page.evaluate(at => window.__chatdomKingdom.build.session.projectCell(at), cell);
  await page.mouse.move(point.x, point.y); await page.mouse.down(); await page.mouse.up();
}

try {
  await mkdir(out, { recursive: true });
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  page.on('pageerror', error => report.errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') report.errors.push(message.text()); });
  await open(page);
  assert.equal(await rack(page).locator('.bt-tool[aria-pressed="true"]').innerText().then(t => t.split('\n')[0]), 'Place');
  report.checks.push('Rack opens on the core’s Place tool');

  // Choose the tool and material on the rack, then make one real edit in the scene.
  await rack(page).getByRole('button', { name: 'Erase' }).click();
  assert.equal(await page.evaluate(() => window.__chatdomKingdom.build.session.controller.snapshot().tool), 'erase');
  await rack(page).getByRole('button', { name: 'Place' }).click();
  const swatches = rack(page).locator('.bt-swatch');
  const brass = await swatches.evaluateAll(list => list.findIndex(b => b.getAttribute('aria-label') === 'Brass'));
  await swatches.nth(brass >= 0 ? brass : 0).click();
  const chosen = await swatches.nth(brass >= 0 ? brass : 0).getAttribute('aria-label');
  assert.equal(await rack(page).locator('.bt-materials .bt-label span').innerText(), chosen);
  const before = await session(page);
  for (const cell of [[2, 0, 124], [6, 0, 124], [10, 0, 124]]) {
    const from = await session(page);
    await clickCell(page, cell);
    await page.waitForFunction(r => window.__chatdomKingdom.build.session.draft.revision > r, from.revision, { timeout: 10000 });
  }
  const after = await session(page);
  assert.ok(after.occupied > before.occupied, 'placing added blocks');
  await page.evaluate(() => window.__chatdomKingdom.build.session.settled());
  await frame(page);
  const shown = await rack(page).locator('.bt-budget > span b').innerText();
  assert.equal(shown.replace(/\D/g, ''), String(after.occupied));
  assert.equal(await rack(page).locator('.bt-history').first().isEnabled(), true);
  report.checks.push(`Rack Place + ${chosen} placed three real gestures (${before.occupied} → ${after.occupied} blocks); budget and undo follow the core`);
  report.checks.push(`Status: ${after.status}`);
  await layout(page, '1440x900');
  await page.screenshot({ path: `${out}/rack@1440x900.png`, timeout: 120000 });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(150); await frame(page); await frame(page);
  const phone = await layout(page, '390x844');
  report.checks.push(`390x844: ${phone.small} visible buttons under 44 px wide or 30 px tall`);
  await page.screenshot({ path: `${out}/rack@390x844.png`, timeout: 120000 });
  assert.deepEqual(report.errors, []);
  report.result = 'passed';
} catch (error) {
  report.result = 'failed'; report.failure = String(error?.stack ?? error); process.exitCode = 1;
} finally {
  await browser?.close(); await release();
  await mkdir(out, { recursive: true }); await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
