// The Forge fittings: the isolated bench (crest rail and parchment field in every typed state) driven by a
// real keyboard, Tab and touch, and with --kingdom (or --base-url) the actual Forge panel in the kingdom.
// node packages/ui/src/bench/forge.mjs [--kingdom] [--base-url http://127.0.0.1:<port>]
// The kingdom page never reaches a Forge service: /forge-data is answered 503 inside this browser, which is the
// real "cold forge" reply path, so the private error state is the panel's genuine handling of that response.
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { acquireCaptureLock } from '../../../testing/capture-lock.mjs';
import { CAPTURE_PORTS } from '../../../testing/capture-ports.mjs';

const args = process.argv.slice(2);
const option = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const repo = fileURLToPath(new URL('../../../../', import.meta.url));
const benchRoot = fileURLToPath(new URL('./', import.meta.url));
const { default: solid } = await import(createRequire(`${repo}apps/web/package.json`).resolve('vite-plugin-solid'));
const out = `${repo}shots/first-look/fl02`;
const report = { bench: 'typed Forge fittings; no request, travel or Forge', ports: [], checks: [] };

async function serve(config) {
  // Only capture ports: 5187 and 5190–5197 belong to services even when they are down.
  for (const port of CAPTURE_PORTS) {
    const server = await createServer({ ...config, logLevel: 'error', server: { host: '127.0.0.1', port, strictPort: true, ...config.server } });
    try { await server.listen(); report.ports.push(port); return { server, base: `http://127.0.0.1:${port}` }; }
    catch (error) { await server.close(); if (error?.code !== 'EADDRINUSE' && !/already in use/.test(error?.message ?? '')) throw error; }
  }
  throw new Error('No free capture port');
}
const settle = page => page.evaluate(() => document.fonts.ready.then(() => new Promise(r => window.requestAnimationFrame(() => window.requestAnimationFrame(r)))));
function watch(page, allowed = []) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error' && !allowed.some(pattern => pattern.test(message.text()))) errors.push(message.text()); });
  return errors;
}
/** What the focused element is, in words a reader of the report can follow. */
const focus = page => page.evaluate(() => {
  const e = document.activeElement;
  return { role: e?.getAttribute('role') ?? e?.tagName.toLowerCase(), name: e?.querySelector?.('.cd-crest-name')?.textContent ?? e?.textContent?.trim().slice(0, 40), checked: e?.getAttribute('aria-checked'), rail: e?.closest('[class*="kb-crests"], .forge-realms')?.className ?? null, id: e?.id || null };
});
const checkedName = (page, rail) => page.evaluate(rail => document.querySelector(`${rail} [aria-checked="true"] .cd-crest-name`)?.textContent, rail);
const census = (page, scope) => page.evaluate(scope => {
  const root = document.querySelector(scope);
  const text = [...root.querySelectorAll('*')].filter(e => [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()) && e.getClientRects().length);
  const small = text.filter(e => parseFloat(window.getComputedStyle(e).fontSize) < 12).map(e => `${e.className || e.tagName}:${window.getComputedStyle(e).fontSize}`);
  const targets = [...root.querySelectorAll('[role="radio"], .forge-close')].map(e => e.getBoundingClientRect()).filter(r => r.width < 44 || r.height < 44).map(r => `${Math.round(r.width)}x${Math.round(r.height)}`);
  return { small, targets, selects: root.querySelectorAll('select').length, overflow: document.documentElement.scrollWidth > window.innerWidth };
}, scope);

const release = await acquireCaptureLock();
const servers = [];
let browser;
try {
  await mkdir(out, { recursive: true });
  const bench = await serve({ root: benchRoot, configFile: false, plugins: [solid()], server: { fs: { allow: [`${repo}packages/ui`] } } });
  servers.push(bench.server);
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });

  // Keyboard and Tab, the way a person uses them.
  {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } }), errors = watch(page);
    await page.goto(`${bench.base}/index.html?kit=forge`);
    await page.waitForFunction(() => window.__chatdomReady === true, null, { timeout: 60_000 });
    for (let i = 0; i < 12 && (await focus(page)).rail?.includes('kb-crests-live') !== true; i++) await page.keyboard.press('Tab');
    let at = await focus(page);
    assert.deepEqual([at.role, at.name, at.checked], ['radio', 'Willowmere', 'true'], 'Tab enters the rail on the chosen crest');
    await page.keyboard.press('ArrowRight'); at = await focus(page);
    assert.equal(at.name, 'Mossmere'); assert.equal(await checkedName(page, '.kb-crests-live'), 'Willowmere', 'walking does not choose');
    await page.keyboard.press('Space');
    assert.equal(await checkedName(page, '.kb-crests-live'), 'Mossmere', 'Space chooses');
    await page.keyboard.press('Home'); assert.equal((await focus(page)).name, 'Emberwick');
    await page.keyboard.press('End'); assert.equal((await focus(page)).name, 'Mossmere');
    await page.keyboard.press('ArrowRight'); assert.equal((await focus(page)).name, 'Emberwick', 'arrows wrap');
    await page.keyboard.press('Enter');
    assert.equal(await checkedName(page, '.kb-crests-live'), 'Emberwick', 'Enter chooses');
    assert.match(await page.textContent('.kb-crests-live .cd-crests-hint'), /Wood cues: 2\./, 'one wood cue per choice, none per step');
    await page.keyboard.press('Tab'); assert.equal(await page.evaluate(() => document.activeElement?.hasAttribute('data-bench-after')), true, 'Tab leaves the rail in one press');
    await page.keyboard.press('Shift+Tab'); at = await focus(page);
    assert.deepEqual([at.name, at.checked], ['Emberwick', 'true'], 'Shift+Tab returns to the chosen crest');
    await page.click('.kb-crests-partial [data-crest="hearth"]'); await page.keyboard.press('ArrowRight');
    assert.equal((await focus(page)).name, 'Mossmere', 'a resting crest is stepped over');
    await page.click('.kb-crests-resting [data-crest="grove"]', { force: true });
    assert.equal(await checkedName(page, '.kb-crests-resting'), 'Emberwick', 'a resting rail ignores a press');
    await page.focus('#kb-words'); await page.keyboard.press('End'); await page.keyboard.type(' with a moth');
    assert.equal(await page.textContent('#kb-words-allowance'), `${240 - '!forge a crescent moon lantern with a moth'.length} letters left`);
    assert.match(await page.getAttribute('#kb-invalid', 'aria-describedby'), /kb-invalid-error/);
    assert.equal(await page.getAttribute('#kb-invalid', 'aria-invalid'), 'true');
    assert.deepEqual(errors, []);
    report.checks.push('bench keyboard: Tab enters on the chosen crest, arrows walk without choosing and wrap, Home/End, Space and Enter choose (one wood cue each), Tab leaves in one press, Shift+Tab returns, resting crest skipped, resting rail ignores presses, allowance counts typing, invalid field described');
    await page.close();
  }

  // Touch, then the looked-at stills with a keyboard focus showing.
  for (const [width, height] of [[1440, 900], [390, 844]]) {
    const context = await browser.newContext({ viewport: { width, height }, hasTouch: true, isMobile: width < 700, deviceScaleFactor: 1 });
    const page = await context.newPage(), errors = watch(page);
    await page.goto(`${bench.base}/index.html?kit=forge`);
    await page.waitForFunction(() => window.__chatdomReady === true, null, { timeout: 60_000 });
    await page.tap('.kb-crests-live [data-crest="grove"]');
    assert.equal(await checkedName(page, '.kb-crests-live'), 'Mossmere', 'a tap chooses');
    const facts = await census(page, '[data-bench-forge]');
    assert.deepEqual(facts, { small: [], targets: [], selects: 0, overflow: false }, `bench ${width}x${height}`);
    await page.focus('.kb-crests-live [aria-checked="true"]'); await page.keyboard.press('ArrowLeft');
    await settle(page);
    assert.deepEqual(errors, []);
    await page.screenshot({ path: `${out}/forge-kit-bench@${width}x${height}.png`, fullPage: true });
    report.checks.push(`bench ${width}x${height}: a tap chooses, no text under 12 px, every crest at least 44×44, no select, no overflow`);
    await context.close();
  }

  let base = option('--base-url');
  if (!base && args.includes('--kingdom')) {
    const web = await serve({ root: `${repo}apps/web`, configFile: `${repo}apps/web/vite.config.ts` });
    servers.push(web.server); base = web.base;
  }
  if (base) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, hasTouch: true });
    const page = await context.newPage(), errors = watch(page, [/status of 503/]);
    await page.route('**/forge-data/**', route => route.fulfill({ status: 503, contentType: 'text/plain', body: 'cold' }));
    await page.goto(`${base.replace(/\/$/, '')}/?source=simulated&tier=town&hour=19.5&time=30&forge=1&realm=tide`);
    await page.waitForFunction(() => window.__chatdomReady === true && window.__chatdomKingdom?.stats.ready && window.__chatdomKingdom.stats.fieldSettled && document.querySelector('.forge-panel'), null, { timeout: 300_000 });
    const shot = async name => { await settle(page); await page.waitForFunction(() => window.__chatdomKingdom.stats.fieldSettled, null, { timeout: 120_000 }); await page.screenshot({ path: `${out}/${name}`, timeout: 120_000 }); };
    for (const [width, height] of [[1440, 900], [390, 844]]) {
      await page.setViewportSize({ width, height });
      const facts = await census(page, '.forge-panel');
      assert.deepEqual(facts, { small: [], targets: [], selects: 0, overflow: false }, `forge ${width}x${height}`);
      // A staged night with practice open and no owner words: the seal stays in place but presses nothing.
      const seal = await page.evaluate(() => { const s = document.querySelector('.kingdom-seal'), p = document.querySelector('.forge-panel').getBoundingClientRect(); return { text: s.innerText, hidden: s.hidden, rects: s.getClientRects().length, practice: s.dataset.practice, role: s.getAttribute('role'), panel: [p.left, p.top, p.width, p.height].map(Math.round) }; });
      assert.deepEqual([seal.text, seal.hidden, seal.rects, seal.practice, seal.role], ['', true, 0, 'true', 'status'], 'the staged seal is in place, marked practice, and hidden beside the panel');
      await shot(`forge-panel@${width}x${height}.png`);
      report.checks.push(`forge ${width}x${height}: no select, radiogroup present, no text under 12 px, 44 px targets, staged seal hidden in place, panel at ${seal.panel.join(',')}`);
    }
    // Keyboard through the real panel, then the real cold-forge reply.
    await page.focus('#forge-wish');
    for (const expected of ['forge-submit', 'Dragon chimney', 'Moon lantern', 'Owl vane']) { await page.keyboard.press('Tab'); const at = await focus(page); assert.ok(at.name?.includes(expected) || (expected === 'forge-submit' && at.name?.startsWith('Set the words')), `Tab reached ${JSON.stringify(at)} not ${expected}`); }
    await page.keyboard.press('Tab'); let at = await focus(page);
    assert.deepEqual([at.role, at.name, at.checked], ['radio', 'Willowmere', 'true'], 'Tab reaches the chosen realm');
    await page.keyboard.press('ArrowRight'); at = await focus(page);
    assert.equal(at.name, 'Mossmere'); assert.equal(new URL(page.url()).searchParams.get('realm'), 'tide', 'walking the rail never travels');
    await page.fill('#forge-wish', '!forge an owl weathervane');
    await page.click('.forge-submit');
    await page.waitForSelector('.forge-panel .cd-field[data-invalid="true"]', { timeout: 60_000 });
    const failed = await page.evaluate(() => ({ words: document.querySelector('#forge-wish').value, error: document.querySelector('#forge-wish-error')?.innerText, status: window.__chatdomKingdom.forge.status().privateError }));
    assert.equal(failed.words, '!forge an owl weathervane', 'the words come back after a failed attempt');
    assert.equal(failed.status, 'The forge is cold tonight. Please try another night.');
    assert.ok(failed.error.includes(failed.status) && failed.error.includes('Only you'));
    report.checks.push('forge keyboard: Tab order words → anvil → three wishes → chosen realm; ArrowRight walks without travelling; a 503 reply returns the words with the private reason on the field');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.focus('.forge-realms [aria-checked="true"]'); await page.keyboard.press('ArrowLeft');
    await shot('forge-error-focus@390x844.png');
    await page.setViewportSize({ width: 1440, height: 900 });
    await shot('forge-error-focus@1440x900.png');
    // A real touch on a crest chooses that realm, which travels there.
    await page.tap('.forge-realms [data-crest="grove"]');
    await page.waitForURL(/realm=grove/, { timeout: 30_000 });
    report.checks.push('forge touch: tapping the Mossmere crest takes the road to realm=grove');
    assert.deepEqual(errors, []);
    await context.close();
  }
  await writeFile(`${out}/report.json`, `${JSON.stringify(report, null, 2)}\n`);
  console.log(report.checks.join('\n'));
} finally {
  await browser?.close();
  for (const server of servers) await server.close();
  await release();
}
