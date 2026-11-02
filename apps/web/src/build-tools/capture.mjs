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
    tool: c.tool, material: c.material, brush: c.brush, budget: c.budget };
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
/** SwiftShader can start the rack's short ink/seat animations late; shoot their final state. */
const still = page => page.evaluate(() => Promise.all(document.querySelector('[data-build-tools-rack]').getAnimations({ subtree: true }).map(a => a.finished)));
/** Media-query listeners the page holds right now: the rack must hand back every one it takes. */
const census = () => {
  const held = new Set(), mql = window.MediaQueryList.prototype, add = mql.addEventListener, remove = mql.removeEventListener;
  mql.addEventListener = function (type, fn, ...rest) { if (type === 'change') held.add(fn); return add.call(this, type, fn, ...rest); };
  mql.removeEventListener = function (type, fn, ...rest) { if (type === 'change') held.delete(fn); return remove.call(this, type, fn, ...rest); };
  Object.defineProperty(window, '__btMediaListeners', { get: () => held.size });
};
/**
 * The plot is dressed (lawn, a paved path, window boxes), so the tour finds open lawn rather than trusting fixed cells.
 * A ½ m patch row is open when its front three courses are bare lawn, its back course at most paving height, and
 * nothing stands within 2 m above it or between it and the street edge.
 * `__btEmpty` counts the empty cells in a box, which is exactly what a placement there may add.
 */
const grounds = () => {
  const draft = () => window.__chatdomKingdom.build.session.draft;
  const ground = (d, x, z) => { for (let y = 15; y >= 0; y--) if (d.get([x, y, z])) return y + 1; return 0; };
  window.__btOpen = (x0, z0, w) => {
    const d = draft(), p = d.policy;
    for (let x = x0; x < x0 + w; x++) {
      if (x < p.editableFrom[0] || x >= p.editableTo[0]) return false;
      for (let z = z0; z < p.editableTo[2]; z++) if (ground(d, x, z) > (z === z0 ? 4 : 0)) return false;
    }
    return true;
  };
  window.__btEmpty = boxes => { const d = draft(); let n = 0;
    for (const [from, to] of boxes) for (let x = from[0]; x <= to[0]; x++) for (let y = from[1]; y <= to[1]; y++) for (let z = from[2]; z <= to[2]; z++) if (!d.get([x, y, z])) n++;
    return n; };
};
/**
 * The core's piece feed, driven the way main feeds kept forged gifts: three small finished pieces in this plot's
 * style and palette, standing on one open patch of lawn at the front (behind its paving course). Returns how many were offered.
 */
const offerPieces = page => page.evaluate(() => {
  const s = window.__chatdomKingdom.build.session, p = s.draft.policy, mats = s.controller.snapshot().materials;
  const m = name => mats.find(item => item.name === name)?.id ?? p.palette[0];
  let spot = null;
  for (let z = p.editableTo[2] - 12; z >= p.editableTo[2] - 40 && !spot; z -= 4) for (let x = p.editableFrom[0] + 4; x + 8 <= p.editableTo[0] - 4; x += 4) if (window.__btOpen(x, z, 8)) { spot = [x, 0, z + 1]; break; }
  if (!spot) return 0;
  const piece = (id, name, note, size, boxes) => ({ id, name, note, origin: spot,
    blueprint: { version: 1, id: `piece-${id}`, styleId: p.styleId, kind: 'prop', lattice: 'build', size, boxes, windows: [] } });
  s.offerPieces([
    piece('lantern', 'Lantern post', 'Kept from the Forge', [8, 34, 8], [
      { from: [3, 0, 3], to: [5, 28, 5], material: m('bark') }, { from: [2, 28, 2], to: [6, 32, 6], material: m('brass') }, { from: [1, 32, 1], to: [7, 34, 7], material: m('bark') }]),
    piece('tub', 'Flower tub', 'Kept from the Forge', [8, 7, 8], [
      { from: [0, 0, 0], to: [8, 4, 8], material: m('bark') }, { from: [1, 4, 1], to: [7, 6, 7], material: m('leaf') },
      { from: [2, 6, 2], to: [3, 7, 3], material: m('petal') }, { from: [5, 6, 4], to: [6, 7, 5], material: m('petal') }, { from: [3, 6, 5], to: [4, 7, 6], material: m('blueFlower') }]),
    piece('step', 'Stone step', 'Kept from the Forge', [8, 2, 8], [{ from: [0, 0, 0], to: [8, 2, 8], material: m('stone') }]),
  ]);
  return 3;
});
const withdrawPieces = page => page.evaluate(() => window.__chatdomKingdom.build.session.offerPieces([]));
const focused = page => page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.className);
/** A finger on the rack: touch events through Chrome's touch emulation, so the phone half is tapped, not clicked. */
let finger;
async function tap(page, locator) {
  const b = await locator.boundingBox();
  assert.ok(b, 'a visible fitting to tap');
  await finger.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: b.x + b.width / 2, y: b.y + b.height / 2 }] });
  await finger.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await frame(page);
}
async function settle(page) { await page.evaluate(() => window.__chatdomKingdom.build.session.settled()); await frame(page); }

try {
  await mkdir(out, { recursive: true });
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.addInitScript(census); await context.addInitScript(grounds);
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

  // Keyboard travel: arrows walk focus along a row without choosing; Enter chooses through the core; Tab reaches the next row.
  await rack(page).locator('.bt-tool').first().focus();
  await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight');
  assert.equal(await focused(page), 'Paint'); assert.equal((await core(page)).tool, 'place', 'arrows only move focus');
  await page.keyboard.press('End'); assert.equal(await focused(page), 'Fill');
  await page.keyboard.press('Enter'); await frame(page);
  assert.equal((await core(page)).tool, 'fill'); assert.equal(await pressed(page, '.bt-tool'), 'Fill');
  assert.equal(await page.evaluate(() => window.getComputedStyle(document.activeElement).outlineStyle), 'solid', 'focus shows the brass wire');
  await page.keyboard.press('Home'); await page.keyboard.press('Enter'); await frame(page);
  assert.equal((await core(page)).tool, 'place');
  await rack(page).locator('.bt-swatch').first().focus(); await page.keyboard.press('ArrowRight');
  assert.equal(await focused(page), await rack(page).locator('.bt-swatch').nth(1).getAttribute('aria-label'), 'arrows cross shelves');
  await page.keyboard.press('3'); await frame(page);
  assert.equal((await core(page)).tool, 'paint', 'the core’s own keys pass through a focused rack');
  await page.keyboard.press('1'); await frame(page);
  await page.evaluate(() => document.activeElement?.blur());
  report.checks.push('Keyboard: arrows/Home/End walk focus along tools and across palette shelves without choosing; Enter seats Fill then Place via the core; core keys 3/1 still work from a focused swatch; focus is a solid brass outline');

  // Place: a run of brass along the front of the plot, one gesture per box.
  const brass = await idOf(page, 'brass');
  await rack(page).getByRole('button', { name: 'Brass', exact: true }).click();
  assert.equal((await core(page)).material, brass);
  assert.equal(await rack(page).locator('.bt-materials .bt-label > span').innerText(), 'Brass');
  const start = await core(page);
  // Open lawn for a 1 m run at the front of the plot, in view left of the rack, leaving the far-left lawn free.
  const [x0, z0] = await page.evaluate(() => {
    const s = window.__chatdomKingdom.build.session, p = s.draft.policy, xs = p.editableFrom[0] + p.editableTo[0] - 1;
    const edge = document.querySelector('[data-build-tools-rack]').getBoundingClientRect().left;
    for (let z0 = p.editableTo[2] - 4; z0 >= p.editableTo[2] - 24; z0 -= 4) for (let x0 = p.editableFrom[0] + 8; x0 + 8 <= xs - 7; x0 += 4) {
      if (!window.__btOpen(x0, z0, 8)) continue;
      const seen = [[x0, 0, z0], [x0 + 8, 4, p.editableTo[2]]].map(c => s.projectCell(c)).every(q => q.x > 20 && q.x < edge - 20 && q.y > 20 && q.y < window.innerHeight - 20);
      if (seen) return [x0, z0];
    }
    throw new Error('no open lawn at the front of the plot');
  });
  const box = (x, z) => [[x, 0, z], [x + 3, 3, z + 3]];
  const room = await page.evaluate(boxes => window.__btEmpty(boxes), [box(x0, z0), box(x0 + 4, z0)]);
  // Surface points (…½) are exact faces, so each click lands on the intended cell: the lawn, then the run's faces.
  for (const cell of [[x0 + 2, -0.5, z0 + 2], [x0 + 6, -0.5, z0 + 2]]) await edited(page, [cell]);
  const placed = await core(page);
  assert.equal(placed.occupied - start.occupied, room, 'two ½ m boxes fill exactly their empty cells');
  report.checks.push(`Place: two ½ m boxes on open lawn at x ${x0}, z ${z0} (+${room}, the paving behind kept), ${start.occupied} → ${placed.occupied} blocks`);

  // Fill: one click recolours the whole connected brass run and adds nothing.
  const timber = await idOf(page, await swatch(page, 'Timber').getAttribute('aria-label'));
  await swatch(page, 'Timber').click(); await button(page, 'Fill').click();
  const fill = await edited(page, [[x0 + 2, 1, z0 + 3.5]]);
  assert.equal(fill.to.occupied, fill.from.occupied, 'fill adds no blocks');
  for (const cell of [[x0, 0, z0 + 3], [x0 + 7, 3, z0 + 3]]) assert.equal(await cellAt(page, cell), timber, `fill reached ${cell}`);
  report.checks.push(`Fill: one click recoloured the connected run to the Timber shelf’s material at both ends; ${fill.to.occupied} blocks unchanged`);

  // Paint: recolour the second box only; volume stays the same.
  const cloth = await idOf(page, 'cloth');
  await rack(page).getByRole('button', { name: 'Cloth', exact: true }).click(); await button(page, 'Paint').click();
  const paint = await edited(page, [[x0 + 6, 1, z0 + 3.5]]);
  assert.equal(paint.to.occupied, paint.from.occupied, 'paint adds no blocks');
  assert.equal(await cellAt(page, [x0 + 5, 1, z0 + 2]), cloth); assert.equal(await cellAt(page, [x0 + 1, 1, z0 + 2]), timber);
  report.checks.push('Paint: the second box became cloth, the first stayed timber, block count unchanged');

  // Every brush size through the rack, with real placements at ¼ m and ⅛ m.
  await rack(page).getByRole('button', { name: 'Brass', exact: true }).click(); await button(page, 'Place').click();
  await button(page, 'A quarter metre').click(); assert.equal((await core(page)).brush, 2);
  const quarter = await edited(page, [[x0 + 5, 3.5, z0 + 2]]);
  await button(page, 'An eighth of a metre').click(); assert.equal((await core(page)).brush, 1);
  const eighth = await edited(page, [[x0 + 2, 3.5, z0 + 2]]);
  assert.equal(quarter.to.occupied - quarter.from.occupied, 8, '¼ m adds a 2×2×2 box');
  assert.equal(eighth.to.occupied - eighth.from.occupied, 1, '⅛ m adds one block');
  await button(page, 'Half a metre').click(); assert.equal((await core(page)).brush, 4);
  report.checks.push('Brushes: ¼ m added 8 blocks on top of the run, ⅛ m added 1, back to ½ m');

  // A drag along a flat open row lays the whole run, and history treats the whole drag as one gesture.
  const row = await page.evaluate(([taken, width]) => {
    const p = window.__chatdomKingdom.build.session.draft.policy;
    for (let z = p.editableTo[2] - 4; z >= p.editableTo[2] - 24; z -= 4) for (let x0 = p.editableFrom[0]; x0 + 8 <= p.editableTo[0]; x0 += 4) {
      if (z === taken[1] && x0 + 8 > taken[0] && x0 < taken[0] + width) continue;
      if (window.__btOpen(x0, z, 8)) return [x0, z];
    }
    return null;
  }, [[x0, z0], 8]);
  assert.ok(row !== null, 'a second open row of lawn on the plot');
  const [rx, rz] = row;
  const run = await page.evaluate(boxes => window.__btEmpty(boxes), [box(rx, rz), box(rx + 4, rz)]);
  const dragged = await edited(page, [[rx + 2, -0.5, rz + 2], [rx + 6, -0.5, rz + 2]]);
  assert.equal(dragged.to.occupied - dragged.from.occupied, run, `the drag along ${row} laid the whole run`);
  assert.equal(await cellAt(page, [rx + 7, 0, rz + 3]), brass, 'the far end of the run is brass');
  await settle(page);
  assert.equal(await button(page, 'Redo').isDisabled(), true);
  await button(page, 'Undo').click(); await frame(page);
  const undone = await core(page);
  assert.equal(undone.occupied, dragged.from.occupied, 'one undo removes the whole drag');
  assert.equal(await button(page, 'Redo').isEnabled(), true);
  await page.keyboard.press('Control+Shift+Z'); await frame(page);
  const redone = await core(page);
  assert.equal(redone.occupied, dragged.to.occupied, 'one redo (core shortcut) restores it');
  assert.equal(await button(page, 'Redo').isDisabled(), true);
  report.checks.push(`Drag: +${dragged.to.occupied - dragged.from.occupied} along one row in one gesture; rack Undo → ${undone.occupied}, Ctrl+Shift+Z → ${redone.occupied}; Redo enabled only in between`);

  // Plain words, never the engine's mode name (decision 25); the heading is the owner's home, or plainly “Your home”.
  const words = await rack(page).innerText();
  assert.doesNotMatch(words, /SIMULATED/, 'no SIMULATED on the rack');
  assert.match(await rack(page).locator('.bt-privacy').innerText(), /Private to you/);
  assert.match(await rack(page).locator('.bt-owner').innerText(), /^(Your home|.+’s home)$/);
  report.checks.push(`Words: heading “${await rack(page).locator('.bt-owner').innerText()}”, “${(await rack(page).locator('.bt-privacy').innerText()).replace(/\s+/g, ' ')}”; no SIMULATED anywhere on the rack`);

  await settle(page);
  await page.mouse.move(380, 640); await frame(page);
  await layout(page, '1440x900');
  await page.screenshot({ path: `${out}/palette@1440x900.png`, timeout: 120000 });

  // A rejected edit: build until the core refuses at the block allowance, then try once more.
  const before = await core(page);
  /** A front-quadrant column whose top (and the columns towards the camera) are clear. */
  const clear = top => page.evaluate(top => {
    const d = window.__chatdomKingdom.build.session.draft, p = d.policy, height = p.editableTo[1];
    const open = (x0, z0, from) => { for (let x = x0; x < x0 + 4; x++) for (let z = z0; z < z0 + 4; z++) for (let y = from; y < Math.min(height, from + 16); y++) if (d.get([x, y, z])) return false; return true; };
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
  // Start on the lowest course that has a clear, supported column; each gesture lays a ½ m slab over the front quadrant.
  const height = await page.evaluate(() => window.__chatdomKingdom.build.session.draft.policy.editableTo[1]);
  let top = 0, slabs = 0, refusal = null;
  while (top <= 16 && !(await clear(top))) top += 4;
  while (top + 4 <= height && !refusal) {
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
  report.checks.push(`Rejection: after ${slabs} slab gestures the core said “${refused.to.status}”; one more click left revision ${refused.to.revision} and ${refused.to.occupied}/${refused.to.budget} blocks unchanged, Place still seated`);
  await page.mouse.move(380, 640);
  await page.screenshot({ path: `${out}/refused@1440x900.png`, timeout: 120000 });
  // The same refusal on a phone: the core's reason sits in the slip above the thumb rack, the home above both.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(150); await frame(page); await frame(page);
  const phoneRefusal = await layout(page, '390x844 refused');
  assert.equal(await rack(page).locator('.bt-slip-text').innerText(), refused.to.status);
  const slip = await rack(page).locator('.bt-slip').boundingBox();
  assert.ok(slip.y >= phoneRefusal.rack.top && slip.y + slip.height <= 844, 'the reason is fully in view');
  await still(page);
  await page.screenshot({ path: `${out}/refused@390x844.png`, timeout: 120000 });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(150); await frame(page); await frame(page);
  for (let i = 0; i < slabs; i++) { await button(page, 'Undo').click(); await frame(page); }
  const restored = await core(page);
  assert.equal(restored.occupied, before.occupied, 'undoing the slabs restores the home exactly');
  report.checks.push(`Undo ×${slabs} restored ${restored.occupied} blocks`);
  await rack(page).getByRole('button', { name: 'Brass', exact: true }).click();
  await settle(page);

  // Your pieces: absent while the core offers none; once offered, one tap away under their own carved tab.
  assert.equal(await rack(page).locator('.bt-tabs, .bt-pieces, .bt-piece-opener').count(), 0, 'no pieces shelf while nothing is offered');
  assert.equal(await offerPieces(page), 3, 'open lawn for the pieces');
  await frame(page);
  await rack(page).getByRole('tab', { name: /Your pieces/ }).click();
  assert.equal(await rack(page).locator('.bt-piece').count(), 3);
  assert.equal(await rack(page).locator('.bt-swatch').first().isVisible(), false, 'the pieces tab takes the shelf well');
  const beforePiece = await core(page);
  await rack(page).getByRole('button', { name: 'Lantern post', exact: true }).click(); await frame(page);
  assert.equal(await page.evaluate(() => window.__chatdomKingdom.build.session.imports.rack.previewing()), 'lantern', 'the core previews the chosen piece');
  assert.equal((await core(page)).revision, beforePiece.revision, 'a preview changes nothing in the draft');
  await settle(page); await page.mouse.move(380, 640); await frame(page); await still(page);
  await layout(page, '1440x900 pieces');
  await page.screenshot({ path: `${out}/pieces@1440x900.png`, timeout: 120000 });
  await rack(page).getByRole('button', { name: 'Set it in', exact: true }).click(); await frame(page);
  const setIn = await core(page);
  assert.equal(setIn.revision, beforePiece.revision + 1, 'setting a piece in is one change');
  assert.ok(setIn.occupied > beforePiece.occupied, 'the piece entered the draft');
  assert.equal(await page.evaluate(() => window.__chatdomKingdom.build.session.imports.rack.previewing()), null);
  await button(page, 'Undo').click(); await frame(page);
  assert.equal((await core(page)).occupied, beforePiece.occupied, 'one undo takes the piece away again');
  await rack(page).getByRole('tab', { name: 'Materials' }).click();
  assert.equal(await rack(page).locator('.bt-swatch').first().isVisible(), true);
  report.checks.push(`Pieces: shelf absent with nothing offered; 3 offered → a “Your pieces” tab; choosing Lantern post previewed it (draft revision unchanged); Set it in → +${setIn.occupied - beforePiece.occupied} blocks as one change; one undo restored ${beforePiece.occupied}`);
  await withdrawPieces(page); await frame(page);
  assert.equal(await rack(page).locator('.bt-tabs, .bt-pieces').count(), 0, 'withdrawn pieces leave no stand-in');
  await settle(page);

  // Phone: compact rack, then the palette drawer.
  finger = await context.newCDPSession(page);
  await finger.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(150); await frame(page); await frame(page);
  assert.equal(await rack(page).locator('.bt-swatch').first().isVisible(), false, 'phone palette starts folded');
  assert.equal(await rack(page).locator('.bt-material-opener').innerText().then(t => t.includes('Brass')), true, 'the opener shows the swatch in hand');
  const closed = await layout(page, '390x844 closed');
  const untouched = (await core(page)).revision;
  /** Lowest on-screen point of the editable plot at ground level: the home and its doorstep sit above it. */
  const plotFoot = () => page.evaluate(() => {
    const s = window.__chatdomKingdom.build.session, p = s.draft.policy;
    return Math.max(...[[p.editableFrom[0], 0, p.editableFrom[2]], [p.editableTo[0], 0, p.editableTo[2]], [p.editableFrom[0], 0, p.editableTo[2]], [p.editableTo[0], 0, p.editableFrom[2]]].map(c => s.projectCell(c).y));
  });
  const foot = await plotFoot();
  assert.ok(closed.rack.top > foot, `closed rack (top ${closed.rack.top}) clears the plot (foot ${foot})`);
  await still(page);
  await page.screenshot({ path: `${out}/rack@390x844.png`, timeout: 120000 });
  await tap(page, rack(page).locator('.bt-material-opener'));
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Brass', 'focus lands on the chosen swatch');
  assert.equal(await rack(page).locator('.bt-tools').isVisible(), false);
  const drawer = await layout(page, '390x844 drawer');
  assert.equal(drawer.small, 0, 'drawer: every fitting is at least 44 px');
  assert.ok(drawer.rack.top >= closed.rack.top, `the open drawer (top ${drawer.rack.top}) covers no more of the home than the closed rack (${closed.rack.top})`);
  assert.equal(await rack(page).locator('.bt-slip').isVisible(), true, 'the core’s words stay in view with the drawer out');
  assert.equal(await rack(page).locator('.bt-readout').innerText().then(t => t.startsWith('Place · ½ m')), true, 'tool and block stay legible in the drawer');
  const names = await rack(page).locator('.bt-swatch').evaluateAll(list => list.map(b => b.getAttribute('aria-label')));
  await page.keyboard.press('ArrowRight');
  assert.equal(await focused(page), names[names.indexOf('Brass') + 1], 'arrows walk the drawer from the chosen sample');
  await tap(page, swatch(page, 'Roof'));
  const roofName = await swatch(page, 'Roof').getAttribute('aria-label');
  assert.equal(await rack(page).locator('.bt-drawer-title span').innerText(), roofName);
  assert.equal(await rack(page).locator('.bt-swatch').first().isVisible(), true, 'the drawer stays open after a pick');
  await still(page);
  await page.screenshot({ path: `${out}/drawer@390x844.png`, timeout: 120000 });
  await page.keyboard.press('Escape'); await frame(page);
  assert.equal(await rack(page).isVisible(), true, 'Escape in the drawer did not leave build mode');
  assert.equal(await rack(page).locator('.bt-swatch').first().isVisible(), false, 'Escape folded the drawer');
  assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('bt-opener')), true, 'focus returns to the opener');
  assert.equal(await rack(page).locator('.bt-material-opener').innerText().then(t => t.includes(roofName)), true);
  await tap(page, rack(page).locator('.bt-material-opener'));
  await tap(page, rack(page).getByRole('button', { name: 'Close', exact: true }));
  assert.equal(await page.evaluate(() => document.activeElement?.classList.contains('bt-opener')), true, 'Close returns focus to the opener');
  assert.equal((await core(page)).revision, untouched, 'taps on the rack never reach the canvas as edits');
  // The pieces drawer on the thumb rack: a second opener beside the material, the same choose-then-set-in.
  await offerPieces(page); await frame(page);
  await tap(page, rack(page).locator('.bt-piece-opener'));
  assert.equal(await rack(page).locator('.bt-piece').first().isVisible(), true, 'the pieces drawer is open');
  await tap(page, rack(page).getByRole('button', { name: 'Flower tub', exact: true }));
  assert.equal(await rack(page).getByRole('button', { name: 'Set it in', exact: true }).isVisible(), true);
  const piecesDrawer = await layout(page, '390x844 pieces drawer');
  assert.equal(piecesDrawer.small, 0, 'pieces drawer: every fitting is at least 44 px');
  await settle(page); await still(page);
  await page.screenshot({ path: `${out}/pieces-drawer@390x844.png`, timeout: 120000 });
  await tap(page, rack(page).getByRole('button', { name: 'Put it back', exact: true }));
  await tap(page, rack(page).getByRole('button', { name: 'Close', exact: true }));
  await withdrawPieces(page); await frame(page);
  assert.equal(await rack(page).locator('.bt-piece-opener').count(), 0);
  assert.equal((await core(page)).revision, untouched, 'choosing and putting back a piece changed nothing');
  report.checks.push(`Phone pieces drawer: opener → drawer, Flower tub chosen and previewed, top ${Math.round(piecesDrawer.rack.top)}; Put it back and Close left revision ${untouched}`);
  report.checks.push(`Phone drawer: plot foot at ${Math.round(foot)} px, closed rack top ${Math.round(closed.rack.top)}, open drawer top ${Math.round(drawer.rack.top)} (never taller than the rack); opens with focus on Brass, arrows walk it, slip and Place · ½ m readout stay in view; picking ${roofName} keeps it open; Escape and Close fold it back to the opener without leaving build mode`);

  // A phone on its side: the rack stands at the right edge, clear of the scene's seal and the home.
  await page.setViewportSize({ width: 844, height: 390 });
  await page.waitForTimeout(150); await frame(page); await frame(page);
  const side = await layout(page, '844x390');
  const seal = await page.evaluate(() => document.querySelector('.source-ribbon').getBoundingClientRect().bottom);
  assert.equal(side.small, 0, 'landscape: every fitting is at least 44 px');
  assert.ok(side.rack.top > seal, 'landscape rack clears the scene’s seal');
  await tap(page, rack(page).locator('.bt-material-opener'));
  const sideDrawer = await layout(page, '844x390 drawer');
  assert.ok(sideDrawer.rack.top > seal, 'landscape drawer clears the scene’s seal');
  const sideFoot = await page.evaluate(() => { const s = window.__chatdomKingdom.build.session, p = s.draft.policy; return Math.max(s.projectCell([p.editableTo[0], 0, p.editableTo[2]]).x, s.projectCell([p.editableTo[0], 0, p.editableFrom[2]]).x); });
  assert.ok(side.rack.left > sideFoot, `landscape rack (left ${side.rack.left}) clears the plot (right ${Math.round(sideFoot)})`);
  await page.keyboard.press('Escape'); await frame(page);
  report.checks.push(`Landscape 844×390: rack ${Math.round(side.rack.right - side.rack.left)}×${Math.round(side.rack.bottom - side.rack.top)} beside the plot (plot right ${Math.round(sideFoot)}, rack left ${Math.round(side.rack.left)}), drawer top ${Math.round(sideDrawer.rack.top)} below the seal (${Math.round(seal)})`);

  // Leaving and coming back: the rack hands back its listeners and one click is still one gesture.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(150); await frame(page);
  const held = await page.evaluate(() => window.__btMediaListeners);
  await tap(page, button(page, 'Return to the street'));
  await page.waitForFunction(() => !document.querySelector('[data-build-tools-rack]'));
  const after = await page.evaluate(() => window.__btMediaListeners);
  assert.equal(after, held - 1, 'the rack released its one media listener');
  await tap(page, page.getByRole('button', { name: 'Build my home' }));
  await rack(page).waitFor({ state: 'visible', timeout: 60000 });
  await page.waitForFunction(() => window.__chatdomKingdom?.build.session?.debug.meshedRevision >= 0, null, { timeout: 120000 }); await frame(page);
  assert.equal(await page.locator('[data-build-tools-rack]').count(), 1, 'one rack after reopening');
  assert.equal(await page.evaluate(() => window.__btMediaListeners), held, 'reopening takes exactly one listener back');
  await tap(page, button(page, 'Erase'));
  assert.equal((await core(page)).tool, 'erase', 'the reopened rack drives the new session');
  // One click on the front of the first brass box takes that ½ m box away as a single gesture.
  const reopened = await edited(page, [[x0 + 2, 1, z0 + 3.5]]);
  assert.equal(reopened.to.revision - reopened.from.revision, 1, 'one click after reopening is one gesture');
  assert.ok(reopened.to.occupied < reopened.from.occupied, 'and it erased');
  await page.keyboard.press('Control+Z'); await frame(page);
  assert.equal((await core(page)).occupied, reopened.from.occupied, 'one undo puts the whole box back');
  report.checks.push(`Close/reopen: media listeners ${held} → ${after} → ${held}; one rack; Erase tapped on the new rack, one click erased ${reopened.from.occupied - reopened.to.occupied} blocks as revision ${reopened.from.revision} → ${reopened.to.revision}, one undo restored them`);

  // The browser-local street: the rack says in plain words which street it reaches, one double tap is one publication,
  // and what it stores stays in this browser.
  const welcome = rack(page).locator('.bt-welcome');
  assert.doesNotMatch(await welcome.innerText(), /SIMULATED/, 'the welcome plate speaks plainly');
  assert.match(await welcome.innerText(), /browser/i, 'the welcome plate says it reaches this browser’s street');
  assert.equal(await rack(page).locator('.bt-slip-note').isVisible(), true, 'the edited draft is marked as not yet on the local street');
  await page.evaluate(() => { const c = window.__chatdomKingdom.build.session.controller, real = c.publish; window.__btPublishes = 0; c.publish = () => { window.__btPublishes++; return real.call(c); }; });
  const plate = await welcome.boundingBox();
  for (let i = 0; i < 2; i++) {
    await finger.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: plate.x + plate.width / 2, y: plate.y + plate.height / 2 }] });
    await finger.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  }
  await page.waitForFunction(() => !!window.__chatdomKingdom.build.housewarming, null, { timeout: 120000 });
  assert.equal(await page.evaluate(() => window.__btPublishes), 1, 'two quick taps reached the core once');
  await page.locator('.housewarming-name').waitFor({ state: 'visible' });
  const sign = await page.locator('.housewarming-name').innerText();
  assert.doesNotMatch(sign, /SIMULATED/, 'the housewarming speaks plainly');
  assert.equal(await page.locator('[data-build-tools-rack]').count(), 0, 'the core closed build mode for the housewarming');
  const stored = await page.evaluate(() => Object.keys(window.localStorage).filter(k => k.startsWith("chatdom:build:")).map(k => ({ key: k, published: !!JSON.parse(window.localStorage.getItem(k)).published })));
  // The storage key keeps its old name so existing drafts are not lost.
  assert.ok(stored.length === 1 && stored[0].key.startsWith('chatdom:build:SIMULATED:') && stored[0].published, 'one browser-local save holds the publication');
  assert.ok(await page.evaluate(() => !!window.__chatdomKingdom.build.streetHome), 'the local street shows the new version');
  // No shot here: under SwiftShader the six-second housewarming has ended before a frame can be written.
  await page.waitForFunction(() => !window.__chatdomKingdom.build.housewarming, null, { timeout: 60000 });
  await tap(page, page.getByRole('button', { name: 'Build my home' }));
  await rack(page).waitFor({ state: 'visible', timeout: 60000 });
  await page.waitForFunction(() => window.__chatdomKingdom?.build.session?.debug.meshedRevision >= 0, null, { timeout: 120000 }); await frame(page);
  assert.equal(await rack(page).locator('.bt-slip-note').count(), 0, 'the reopened draft matches the local street');
  const fresh = await rack(page).locator('.bt-slip-text').innerText();
  report.checks.push(`Publication: welcome plate “${(await welcome.innerText()).replace(/\s+/g, ' ')}”; two quick taps → ${await page.evaluate(() => window.__btPublishes)} publish() call; core closed build for the housewarming (“${sign.replace(/\s+/g, ' ')}”); storage ${stored.map(s => s.key).join(', ')} (browser-local, holds the published version); reopened draft shows no unpublished note, slip “${fresh}”`);
  assert.deepEqual(report.errors, []);

  // LIVE: there is no draft or review service yet, so the kingdom offers no build mode at all and the core declines to open one.
  const live = await context.newPage();
  const liveErrors = [];
  live.on('pageerror', error => liveErrors.push(error.message));
  await live.setViewportSize({ width: 1440, height: 900 });
  await live.goto(url.replace('source=simulated', 'source=herald'));
  await live.waitForFunction(() => window.__chatdomReady === true && !!window.__chatdomKingdom?.build, null, { timeout: 240000 });
  assert.equal(await live.getByRole('button', { name: 'Build my home' }).count(), 0, 'LIVE offers no build entry');
  assert.equal(await live.evaluate(() => window.__chatdomKingdom.build.enter()), false, 'the core will not open a LIVE draft');
  assert.equal(await live.locator('[data-build-tools-rack]').count(), 0);
  assert.deepEqual(liveErrors, []);
  report.checks.push(`LIVE (source=herald): no “Build my home”, build.enter() → false, no rack; ribbon “${await live.locator('.source-ribbon').innerText()}”. The rack's own resting branch (locked fittings, “Not open to building yet”) cannot be reached through the integration`);
  await live.close();
  report.result = 'passed';
} catch (error) {
  report.result = 'failed'; report.failure = String(error?.stack ?? error); process.exitCode = 1;
} finally {
  await browser?.close(); await release();
  await mkdir(out, { recursive: true }); await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
