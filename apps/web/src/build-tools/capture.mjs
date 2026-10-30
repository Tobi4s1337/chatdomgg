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
const core = page => page.evaluate(() => {
  const s = window.__chatdomKingdom.build.session, c = s.controller.snapshot();
  return { revision: s.draft.revision, occupied: s.draft.voxelCount, canUndo: s.draft.canUndo, canRedo: s.draft.canRedo, status: s.debug.status,
    tool: c.tool, material: c.material, brush: c.brush, mirror: c.mirror, budget: c.budget };
});
const cellAt = (page, at) => page.evaluate(cell => window.__chatdomKingdom.build.session.draft.get(cell), at);
const button = (page, name) => rack(page).getByRole('button', { name, exact: true });
const pressed = async (page, selector) => (await rack(page).locator(`${selector}[aria-pressed="true"]`).getAttribute('aria-label'))
  ?? (await rack(page).locator(`${selector}[aria-pressed="true"]`).innerText()).split('\n')[0];
const swatch = (page, shelf, index = 0) => rack(page).locator(`.bt-shelf[aria-label="${shelf}"] .bt-swatch`).nth(index);
const idOf = (page, label) => page.evaluate(name => window.__chatdomKingdom.build.session.controller.snapshot().materials
  .find(m => m.name.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase() === name.toLowerCase())?.id, label);

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
    const small = [...document.querySelectorAll('[data-build-tools-rack] button')].filter(b => b.getClientRects().length)
      .map(b => b.getBoundingClientRect()).filter(b => b.width < 44 || b.height < 44).length;
    return { overflowX: document.documentElement.scrollWidth > window.innerWidth, rack: { top: r.top, left: r.left, right: r.right, bottom: r.bottom }, width: window.innerWidth, height: window.innerHeight, small };
  });
  assert.equal(facts.overflowX, false, `${name}: viewport overflow`);
  assert.ok(facts.rack.left >= 0 && facts.rack.right <= facts.width && facts.rack.top >= 0 && facts.rack.bottom <= facts.height, `${name}: rack clipped`);
  report.checks.push(`${name}: rack within viewport (${Math.round(facts.rack.right - facts.rack.left)}×${Math.round(facts.rack.bottom - facts.rack.top)}, top ${Math.round(facts.rack.top)}); ${facts.small} visible buttons under 44 px`);
  return facts;
}

const point = (page, cell) => page.evaluate(at => window.__chatdomKingdom.build.session.projectCell(at), cell);
/** One canvas gesture through the core's own projection: press on the first cell, drag through the rest. */
async function gesture(page, cells) {
  const from = await core(page);
  const first = await point(page, cells[0]);
  await page.mouse.move(first.x, first.y); await page.mouse.down();
  for (const cell of cells.slice(1)) { const p = await point(page, cell); await page.mouse.move(p.x, p.y, { steps: 2 }); }
  await page.mouse.up();
  await frame(page);
  const to = await core(page);
  return { from, to };
}
async function edited(page, cells) {
  const result = await gesture(page, cells);
  assert.ok(result.to.revision > result.from.revision, `gesture at ${cells[0]} changed the draft (${result.to.status})`);
  return result;
}
async function settle(page) { await page.evaluate(() => window.__chatdomKingdom.build.session.settled()); await frame(page); }

try {
  await mkdir(out, { recursive: true });
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  page.on('pageerror', error => report.errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') report.errors.push(message.text()); });
  await open(page);
  assert.equal(await pressed(page, '.bt-tool'), 'Place');
  assert.equal(await pressed(page, '[aria-label="Block size"] button'), 'Half a metre');
  report.checks.push('Rack opens on the core’s Place tool and ½ m brush');

  // Shelves only arrange the core's palette: every supplied material appears once, with its human name.
  const palette = await page.evaluate(() => window.__chatdomKingdom.build.session.controller.snapshot().materials.length);
  const shelves = await rack(page).locator('.bt-shelf').evaluateAll(list => list.map(s => `${s.getAttribute('aria-label')}: ${[...s.querySelectorAll('.bt-swatch')].map(b => b.getAttribute('aria-label')).join(', ')}`));
  assert.equal(await rack(page).locator('.bt-swatch').count(), palette);
  report.checks.push(`Palette shelves (${palette} core materials): ${shelves.join(' | ')}`);

  // The core's own 1–4 shortcuts move the rack's seated tool.
  await page.keyboard.press('2'); await frame(page);
  assert.equal((await core(page)).tool, 'erase'); assert.equal(await pressed(page, '.bt-tool'), 'Erase');
  await page.keyboard.press('1'); await frame(page);
  assert.equal(await pressed(page, '.bt-tool'), 'Place');
  report.checks.push('Keys 2 and 1 (core shortcuts) seat Erase then Place on the rack');

  // Place: a run of brass along the front of the plot, one gesture per box.
  const brass = await idOf(page, 'brass');
  await rack(page).getByRole('button', { name: 'Brass', exact: true }).click();
  assert.equal((await core(page)).material, brass);
  assert.equal(await rack(page).locator('.bt-materials .bt-label > span').innerText(), 'Brass');
  const start = await core(page);
  // Floor points (y −½) and face points (…½) are exact surfaces, so each click lands on the intended cell.
  for (const cell of [[2, -0.5, 126], [6, -0.5, 126], [10, -0.5, 126]]) await edited(page, [cell]);
  const placed = await core(page);
  assert.equal(placed.occupied - start.occupied, 3 * 64, 'three ½ m boxes of new blocks');
  report.checks.push(`Place: three ½ m boxes, ${start.occupied} → ${placed.occupied} blocks`);

  // Fill: one click recolours the whole connected brass run and adds nothing.
  const timber = await idOf(page, await swatch(page, 'Timber').getAttribute('aria-label'));
  await swatch(page, 'Timber').click(); await button(page, 'Fill').click();
  const fill = await edited(page, [[2, 1, 127.5]]);
  assert.equal(fill.to.occupied, fill.from.occupied, 'fill adds no blocks');
  for (const cell of [[0, 0, 124], [11, 3, 127]]) assert.equal(await cellAt(page, cell), timber, `fill reached ${cell}`);
  report.checks.push(`Fill: one click recoloured the connected run to the Timber shelf’s material at both ends; ${fill.to.occupied} blocks unchanged`);

  // Paint: recolour the middle box only; volume stays the same.
  const cloth = await idOf(page, 'cloth');
  await rack(page).getByRole('button', { name: 'Cloth', exact: true }).click(); await button(page, 'Paint').click();
  const paint = await edited(page, [[6, 1, 127.5]]);
  assert.equal(paint.to.occupied, paint.from.occupied, 'paint adds no blocks');
  assert.equal(await cellAt(page, [5, 1, 126]), cloth); assert.equal(await cellAt(page, [1, 1, 126]), timber);
  report.checks.push('Paint: middle box became cloth, its neighbours stayed timber, block count unchanged');

  // Every brush size through the rack, with real placements at ¼ m and ⅛ m.
  await rack(page).getByRole('button', { name: 'Brass', exact: true }).click(); await button(page, 'Place').click();
  await button(page, 'A quarter metre').click(); assert.equal((await core(page)).brush, 2);
  const quarter = await edited(page, [[9, 3.5, 126]]);
  await button(page, 'An eighth of a metre').click(); assert.equal((await core(page)).brush, 1);
  const eighth = await edited(page, [[2, 3.5, 126]]);
  assert.equal(quarter.to.occupied - quarter.from.occupied, 8, '¼ m adds a 2×2×2 box');
  assert.equal(eighth.to.occupied - eighth.from.occupied, 1, '⅛ m adds one block');
  await button(page, 'Half a metre').click(); assert.equal((await core(page)).brush, 4);
  report.checks.push('Brushes: ¼ m added 8 blocks on top of the run, ⅛ m added 1, back to ½ m');

  // Mirror X: one drag along a free row lands twice, and history treats the whole drag as one gesture.
  await button(page, 'Mirror left and right').click(); assert.equal((await core(page)).mirror, 'x');
  const row = await page.evaluate(() => {
    const d = window.__chatdomKingdom.build.session.draft, p = d.policy, xSum = p.editableFrom[0] + p.editableTo[0] - 1;
    // A strip along the front, clear from the floor up and all the way to the plot edge on both sides, so nothing hides it.
    for (let z = p.editableTo[2] - 4; z >= p.editableTo[2] - 24; z -= 4) for (let x0 = 0; x0 <= 20; x0 += 4) {
      let free = true;
      for (let x = x0; x < x0 + 12 && free; x++) for (let y = 0; y < p.editableTo[1] && free; y++) for (let zz = z; zz < p.editableTo[2] && free; zz++) free = !d.get([x, y, zz]) && !d.get([xSum - x, y, zz]);
      if (free) return [x0, z];
    }
    return null;
  });
  assert.ok(row !== null, 'a free mirrored row in front of the house');
  const mirrored = await edited(page, [[row[0] + 2, -0.5, row[1] + 2], [row[0] + 6, -0.5, row[1] + 2], [row[0] + 10, -0.5, row[1] + 2]]);
  const xSum = await page.evaluate(() => { const p = window.__chatdomKingdom.build.session.draft.policy; return p.editableFrom[0] + p.editableTo[0] - 1; });
  assert.equal(mirrored.to.occupied - mirrored.from.occupied, 2 * 3 * 64, `mirrored drag along ${row} placed both sides`);
  assert.equal(await cellAt(page, [xSum - row[0] - 1, 0, row[1]]), brass, 'the mirror side is brass');
  await settle(page);
  assert.equal(await button(page, 'Redo').isDisabled(), true);
  await button(page, 'Undo').click(); await frame(page);
  const undone = await core(page);
  assert.equal(undone.occupied, mirrored.from.occupied, 'one undo removes the whole mirrored drag');
  assert.equal(await button(page, 'Redo').isEnabled(), true);
  await page.keyboard.press('Control+Shift+Z'); await frame(page);
  const redone = await core(page);
  assert.equal(redone.occupied, mirrored.to.occupied, 'one redo (core shortcut) restores it');
  assert.equal(await button(page, 'Redo').isDisabled(), true);
  report.checks.push(`Mirror X drag: +${mirrored.to.occupied - mirrored.from.occupied} on both sides in one gesture; rack Undo → ${undone.occupied}, Ctrl+Shift+Z → ${redone.occupied}; Redo enabled only in between`);

  await settle(page);
  await page.mouse.move(380, 640); await frame(page);
  await layout(page, '1440x900');
  await page.screenshot({ path: `${out}/palette@1440x900.png`, timeout: 120000 });

  // A rejected edit: build until the core refuses at the block allowance, then try once more.
  const before = await core(page);
  await button(page, 'Mirror into all four corners').click();
  /** A front-quadrant column whose top (and the columns towards the camera) are clear in all four mirrors. */
  const clear = top => page.evaluate(top => {
    const d = window.__chatdomKingdom.build.session.draft, p = d.policy;
    const xs = p.editableFrom[0] + p.editableTo[0] - 1, zs = p.editableFrom[2] + p.editableTo[2] - 1, height = p.editableTo[1];
    const mirrors = (x, z) => [[x, z], [xs - x, z], [x, zs - z], [xs - x, zs - z]];
    const open = (x0, z0, from) => { for (let x = x0; x < x0 + 4; x++) for (let z = z0; z < z0 + 4; z++) for (const [mx, mz] of mirrors(x, z)) for (let y = from; y < height; y++) if (d.get([mx, y, mz])) return false; return true; };
    const solid = (x0, z0, y) => { for (let x = x0; x < x0 + 4; x++) for (let z = z0; z < z0 + 4; z++) if (!d.get([x, y, z])) return false; return true; };
    const mid = (p.editableFrom[2] + p.editableTo[2]) / 2;
    for (let z0 = p.editableTo[2] - 4; z0 >= mid; z0 -= 4) for (let x0 = 0; x0 < 32; x0 += 4) {
      if (!open(x0, z0, top) || (top > 0 && !solid(x0, z0, top - 1))) continue;
      const ahead = [[x0, z0 + 4], [x0, z0 + 8], [x0 - 4, z0 + 4], [x0 + 4, z0 + 4]].filter(([x, z]) => x >= 0 && x < 32 && z < p.editableTo[2]);
      if (ahead.every(([x, z]) => open(x, z, top))) return [x0, z0];
    }
    return null;
  }, top);
  const quadrant = [];
  for (let z = 126; z >= 90; z -= 4) for (let i = 0; i < 8; i++) quadrant.push([(z - 126) % 8 === 0 ? 2 + i * 4 : 30 - i * 4, z]);
  let top = 0, slabs = 0, refusal = null;
  while (top < 24 && !refusal) {
    const seed = await clear(top);
    assert.ok(seed, `a clear column at height ${top}`);
    const g = await gesture(page, [[seed[0] + 2, top - 0.5, seed[1] + 2], ...quadrant.map(([x, z]) => [x, top - 0.5, z])]);
    if (g.to.revision > g.from.revision) slabs++;
    if (/allowance/.test(g.to.status)) refusal = g.to; else top += 4;
  }
  assert.ok(refusal, 'the core refused at the allowance');
  await settle(page);
  await swatch(page, 'Roof').click();
  let probe = null;
  for (let y = top + 4; y > 0 && !probe; y -= 4) { const seed = await clear(y); if (seed) probe = [seed[0] + 2, y - 0.5, seed[1] + 2]; }
  assert.ok(probe, 'a clear spot to try once more');
  const refused = await gesture(page, [probe]);
  assert.equal(refused.to.revision, refused.from.revision, 'the refused edit did not enter history');
  assert.equal(refused.to.occupied, refused.from.occupied, 'the refused edit left the build unchanged');
  assert.equal(refused.to.canUndo, refused.from.canUndo);
  assert.match(refused.to.status, /allowance/);
  assert.equal(await rack(page).locator('.bt-slip-text').innerText(), refused.to.status, 'the rack shows the core’s reason');
  assert.equal(await pressed(page, '.bt-tool'), 'Place', 'the tool stays selected');
  report.checks.push(`Rejection: after ${slabs} X+Z gestures the core said “${refused.to.status}”; one more click left revision ${refused.to.revision} and ${refused.to.occupied}/${refused.to.budget} blocks unchanged, Place still seated`);
  await page.mouse.move(380, 640);
  await page.screenshot({ path: `${out}/refused@1440x900.png`, timeout: 120000 });
  for (let i = 0; i < slabs; i++) { await button(page, 'Undo').click(); await frame(page); }
  const restored = await core(page);
  assert.equal(restored.occupied, before.occupied, 'undoing the slabs restores the home exactly');
  report.checks.push(`Undo ×${slabs} restored ${restored.occupied} blocks`);
  await button(page, 'No mirror').click();
  await rack(page).getByRole('button', { name: 'Brass', exact: true }).click();
  await settle(page);

  // Phone: compact rack, then the palette drawer.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(150); await frame(page); await frame(page);
  assert.equal(await rack(page).locator('.bt-swatch').first().isVisible(), false, 'phone palette starts folded');
  assert.equal(await rack(page).locator('.bt-opener').innerText().then(t => t.includes('Brass')), true, 'the opener shows the swatch in hand');
  await layout(page, '390x844 closed');
  await page.screenshot({ path: `${out}/rack@390x844.png`, timeout: 120000 });
  await rack(page).locator('.bt-opener').click(); await frame(page);
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Brass', 'focus lands on the chosen swatch');
  assert.equal(await rack(page).locator('.bt-tools').isVisible(), false);
  const drawer = await layout(page, '390x844 drawer');
  await swatch(page, 'Roof').click(); await frame(page);
  const roofName = await swatch(page, 'Roof').getAttribute('aria-label');
  assert.equal(await rack(page).locator('.bt-drawer-title span').innerText(), roofName);
  assert.equal(await rack(page).locator('.bt-swatch').first().isVisible(), true, 'the drawer stays open after a pick');
  await page.screenshot({ path: `${out}/drawer@390x844.png`, timeout: 120000 });
  await page.keyboard.press('Escape'); await frame(page);
  assert.equal(await rack(page).isVisible(), true, 'Escape in the drawer did not leave build mode');
  assert.equal(await rack(page).locator('.bt-swatch').first().isVisible(), false, 'Escape folded the drawer');
  assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('bt-opener')), true, 'focus returns to the opener');
  assert.equal(await rack(page).locator('.bt-opener').innerText().then(t => t.includes(roofName)), true);
  report.checks.push(`Phone drawer: opens with focus on Brass, rack top at ${Math.round(drawer.rack.top)} px; picking ${roofName} keeps it open; Escape folds it, returns focus to the opener and stays in build mode`);
  assert.deepEqual(report.errors, []);
  report.result = 'passed';
} catch (error) {
  report.result = 'failed'; report.failure = String(error?.stack ?? error); process.exitCode = 1;
} finally {
  await browser?.close(); await release();
  await mkdir(out, { recursive: true }); await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
