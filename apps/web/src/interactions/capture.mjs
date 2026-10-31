/* global requestAnimationFrame:readonly, getComputedStyle:readonly */
// The interactions lane's capture. IN01/IN03: the SIMULATED bench against the real controller, prompt and room authority.
// node apps/web/src/interactions/capture.mjs --base-url http://127.0.0.1:<port of a vite dev server for apps/web>
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { acquireCaptureLock } from '../../../../packages/testing/capture-lock.mjs';

const arg = process.argv.indexOf('--base-url');
const base = arg > 0 ? process.argv[arg + 1]?.replace(/\/$/, '') : undefined;
if (!base) throw new Error('Pass --base-url http://127.0.0.1:<port> of a running apps/web vite server.');
const bench = query => `${base}/src/interactions/bench/index.html?${query}`;
const out = 'shots/interactions';
const report = { base, errors: [], checks: [], localResponse: [], shots: [] };
const LAUNCH = { channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] };

const debug = page => page.evaluate(() => {
  const d = window.__chatdomInteractions;
  return { focus: d.focus, action: d.action, prompt: d.prompt, seats: d.seats.map(s => [s.targetId, s.walkerId, s.status]), self: d.self, localResponse: d.localResponse, camera: d.camera, held: d.held, pick: d.pick };
});
const frames = (page, n = 2) => page.evaluate(count => new Promise(resolve => { const step = left => left ? requestAnimationFrame(() => step(left - 1)) : resolve(); step(count); }), n);
async function open(page, query) {
  await page.goto(bench(query));
  await page.waitForFunction(() => window.__chatdomReady === true, null, { timeout: 180000 });
  await page.waitForFunction(() => document.fonts.status === 'loaded');
  await frames(page, 3);
}
async function until(page, predicate, arg, what) {
  try { await page.waitForFunction(predicate, arg, { timeout: 20000 }); }
  catch { throw new Error(`Timed out waiting for ${what}: ${JSON.stringify(await debug(page))}`); }
  await frames(page, 2);
}
const promptIs = (page, words, tone = 'ready') => until(page, ([w, t]) => window.__chatdomInteractions?.prompt?.words === w && window.__chatdomInteractions.prompt.tone === t, [words, tone], `prompt "${words}" (${tone})`);
async function shot(page, name) {
  const path = `${out}/${name}.png`;
  await page.screenshot({ path });
  report.shots.push(path);
  return path;
}
async function layout(page, name) {
  const facts = await page.evaluate(() => {
    const plaque = document.querySelector('[data-ix-prompt] .ix-plaque');
    if (!plaque) return null;
    const r = plaque.getBoundingClientRect();
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, height: r.height, width: window.innerWidth, viewHeight: window.innerHeight,
      font: getComputedStyle(plaque).fontFamily, overflowX: document.documentElement.scrollWidth > window.innerWidth };
  });
  assert.ok(facts, `${name}: prompt drawn`);
  assert.equal(facts.overflowX, false, `${name}: no horizontal overflow`);
  assert.ok(facts.left >= 0 && facts.right <= facts.width && facts.top >= 0 && facts.bottom <= facts.viewHeight, `${name}: prompt inside the viewport`);
  assert.ok(facts.height >= 44, `${name}: prompt is a 44 px target (${facts.height})`);
  report.checks.push(`${name}: prompt ${Math.round(facts.right - facts.left)}×${Math.round(facts.height)} at (${Math.round(facts.left)}, ${Math.round(facts.top)}), ${facts.font.split(',')[0]}`);
}
function watch(page, label) {
  page.on('pageerror', error => report.errors.push(`${label}: ${error.message}`));
  page.on('console', message => { if (message.type() === 'error') report.errors.push(`${label}: ${message.text()}`); });
}

const release = await acquireCaptureLock();
let browser;
try {
  await mkdir(out, { recursive: true });
  browser = await chromium.launch(LAUNCH);

  // Desktop: the first prompt, a turn of the head, then one real request to the room.
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage(); watch(page, 'desktop');
    await open(page, 'look=north&latency=600');
    await promptIs(page, 'Sit by the fire');
    assert.equal((await debug(page)).focus, 'fire:bench:seat:north');
    await layout(page, 'desktop first prompt');
    await shot(page, 'prompt@1440x900');
    // Same feet, new gaze: the prompt follows the look between the anvil and the two logs.
    for (const [target, words] of [['anvil:bench', 'Work the anvil'], ['fire:bench:seat:east', null], ['fire:bench:seat:north', 'Sit by the fire']]) {
      await page.evaluate(id => window.__chatdomInteractions.face(id), target);
      // The east log is in view but out of arm's reach from here: nothing is offered.
      await until(page, ([id, offered]) => window.__chatdomInteractions.focus === (offered ? id : null) && (offered || !window.__chatdomInteractions.prompt), [target, words], `focus ${target}`);
      assert.equal((await debug(page)).prompt?.words ?? null, words);
      if (target === 'anvil:bench') await shot(page, 'look-anvil@1440x900');
      report.checks.push(`desktop: looking at ${target} → ${words ? `"${words}"` : 'no prompt (out of reach)'} without moving`);
    }
    // A click on the out-of-reach east log says so quietly; nothing is sent. (Turn via the anvil: straight from the
    // north log, its 42° hysteresis rightly keeps that log in focus.)
    await page.evaluate(() => window.__chatdomInteractions.face('anvil:bench'));
    await promptIs(page, 'Work the anvil');
    await page.evaluate(() => window.__chatdomInteractions.face('fire:bench:seat:east'));
    await until(page, () => window.__chatdomInteractions.focus === null, null, 'east log unfocused');
    const east = await page.evaluate(() => window.__chatdomInteractions.screenOf('fire:bench:seat:east'));
    await page.mouse.click(east.x, east.y);
    await promptIs(page, 'Walk a little closer', 'quiet');
    assert.deepEqual((await debug(page)).pick, { targetId: 'fire:bench:seat:east', used: false });
    assert.equal((await debug(page)).self.mode, 'standing');
    report.checks.push('desktop: click on the east log out of reach → quiet "Walk a little closer", nothing sent');
    // A click on the anvil itself (not the plaque) uses it through the same registry; the bench has no Forge view,
    // so the walking camera stays and the prompt returns once the room has answered.
    await page.evaluate(() => window.__chatdomInteractions.face('anvil:bench'));
    await promptIs(page, 'Work the anvil');
    const anvil = await page.evaluate(() => window.__chatdomInteractions.screenOf('anvil:bench'));
    await page.mouse.click(anvil.x, anvil.y + 18);
    await promptIs(page, 'Reaching for the anvil…', 'pending');
    assert.deepEqual((await debug(page)).pick, { targetId: 'anvil:bench', used: true });
    await promptIs(page, 'Work the anvil');
    assert.equal((await debug(page)).camera, 'walking');
    report.checks.push('desktop: click on the anvil → "Reaching for the anvil…" → room accepted → camera still walking (no Forge on the bench)');

    // E: pending at once, then the room's own answer; the seat's framing takes the camera only after it.
    await page.evaluate(() => window.__chatdomInteractions.face('fire:bench:seat:north'));
    await promptIs(page, 'Sit by the fire');
    await page.keyboard.press('KeyE');
    await promptIs(page, 'Sitting down…', 'pending');
    assert.equal((await debug(page)).camera, 'walking', 'no camera before the room answers');
    await shot(page, 'pending@1440x900');
    await until(page, () => window.__chatdomInteractions.self.mode === 'seated', null, 'seated by the room');
    await promptIs(page, 'Stand up');
    const seated = await debug(page);
    assert.deepEqual(seated.seats.map(s => s[0]), ['fire:bench:seat:north']);
    assert.equal(seated.camera, 'released');
    assert.deepEqual(seated.held, { targetId: 'fire:bench:seat:north', action: 'sit' });
    report.localResponse.push({ size: '1440x900', dom: seated.localResponse });
    // The pending cue is in the DOM synchronously with the key press; paint time is SwiftShader's here and unjudged.
    assert.ok(seated.localResponse !== null && seated.localResponse < 100, `local pending response under 100 ms (${seated.localResponse})`);
    await frames(page, 4);
    await shot(page, 'seated@1440x900');
    // Escape: the camera is back the same instant, while the stand is still honestly pending with the room.
    await page.keyboard.press('Escape');
    const escaped = await debug(page);
    assert.equal(escaped.camera, 'walking');
    assert.equal(escaped.held, null);
    assert.deepEqual(escaped.prompt && [escaped.prompt.tone, escaped.prompt.words], ['pending', 'Getting up…']);
    assert.equal(escaped.self.mode, 'seated', 'still seated until the room says otherwise');
    await until(page, () => window.__chatdomInteractions.self.mode === 'standing', null, 'standing again');
    await promptIs(page, 'Sit by the fire');
    report.checks.push('desktop: E → pending → room seated → seated framing "Stand up"; Escape → camera walking at once, "Getting up…" pending → room standing');
    // Held E (key repeat) sends one request; walking off the seat (W) asks to stand, then walking works.
    await page.keyboard.down('KeyE'); await frames(page, 4);
    await until(page, () => window.__chatdomInteractions.self.mode === 'seated', null, 'seated again');
    await page.keyboard.up('KeyE');
    await page.keyboard.down('KeyW'); await frames(page, 2); await page.keyboard.up('KeyW');
    await until(page, () => window.__chatdomInteractions.self.mode === 'standing' && window.__chatdomInteractions.camera === 'walking', null, 'stood by walking away');
    report.checks.push('desktop: held E seated once; W while seated → stand, camera walking');
    await context.close();
  }

  // Desktop race: Wren's claim for the same log reaches the room first. The room's refusal is what shows.
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage(); watch(page, 'race');
    await open(page, 'look=north&race=north&latency=600');
    await promptIs(page, 'Sit by the fire');
    await page.keyboard.press('KeyE');
    await promptIs(page, 'Someone is already sitting there.', 'refused');
    const raced = await debug(page);
    assert.equal(raced.self.mode, 'standing');
    assert.deepEqual(raced.seats, [['fire:bench:seat:north', 'bench-walker-2', 'occupied']]);
    await shot(page, 'refused@1440x900');
    // After the refusal fades, the taken log only says so quietly; the free one next to it is still offered.
    await until(page, () => window.__chatdomInteractions.prompt?.tone === 'quiet', null, 'quiet taken log');
    report.checks.push(`race: room seated Wren, refused you → "${raced.prompt.words}", then quiet "${(await debug(page)).prompt.words}"`);
    await context.close();
  }

  // Phone: the first prompt, and a tap on it does the same as E.
  {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const page = await context.newPage(); watch(page, 'phone');
    await open(page, 'look=north&latency=600');
    await promptIs(page, 'Sit by the fire');
    await layout(page, 'phone first prompt');
    assert.equal(await page.locator('[data-ix-prompt] .ix-key').count(), 0, 'phone: no keyboard key on a touch screen');
    await shot(page, 'prompt@390x844');
    await page.locator('[data-ix-prompt] .ix-plaque').tap();
    await promptIs(page, 'Sitting down…', 'pending');
    await until(page, () => window.__chatdomInteractions.self.mode === 'seated', null, 'phone seated');
    await promptIs(page, 'Stand up');
    assert.equal((await debug(page)).camera, 'released');
    report.localResponse.push({ size: '390x844', dom: (await debug(page)).localResponse });
    await frames(page, 4);
    await layout(page, 'phone seated prompt');
    await shot(page, 'seated@390x844');
    // The 44 px "Stand up" plaque is the phone's Escape: camera back at once, the stand pending with the room.
    await page.locator('[data-ix-prompt] .ix-plaque').tap();
    assert.equal((await debug(page)).camera, 'walking');
    await until(page, () => window.__chatdomInteractions.self.mode === 'standing', null, 'phone standing');
    report.checks.push('phone: tap → seated framing → tap "Stand up" → camera walking at once → room standing');
    await context.close();
  }

  // The room has closed: "not now" in its own tone, the authority's own sentence, and E is free again after.
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage(); watch(page, 'closed');
    await open(page, 'look=north&latency=600&room=closed');
    await promptIs(page, 'Sit by the fire');
    await page.keyboard.press('KeyE');
    await promptIs(page, 'The kingdom moved on. Reconnect to try again.', 'unavailable');
    assert.equal((await debug(page)).camera, 'walking');
    await layout(page, 'desktop unavailable');
    await shot(page, 'unavailable@1440x900');
    report.checks.push('closed room: E → pending → unavailable "The kingdom moved on. Reconnect to try again." (camera walking)');
    await context.close();
  }

  // Reduced motion: the prompt arrives without its rise and the ember holds still.
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    const page = await context.newPage(); watch(page, 'reduced');
    await open(page, 'look=north&latency=600');
    await promptIs(page, 'Sit by the fire');
    const animation = await page.evaluate(() => getComputedStyle(document.querySelector('[data-ix-prompt]')).animationName);
    assert.equal(animation, 'none');
    report.checks.push('reduced motion: prompt animation none');
    await context.close();
  }

  assert.deepEqual(report.errors, [], 'no page or console errors');
  const sheet = (inputs, name, width) => {
    const path = `${out}/${name}.png`;
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...inputs.flatMap(i => ['-i', i]), '-filter_complex',
      `${inputs.map((_, i) => `[${i}:v]scale=${width}:-1[v${i}]`).join(';')};${inputs.map((_, i) => `[v${i}]`).join('')}hstack=inputs=${inputs.length}`, path]);
    report.shots.push(path);
  };
  sheet([`${out}/prompt@1440x900.png`, `${out}/look-anvil@1440x900.png`, `${out}/pending@1440x900.png`, `${out}/seated@1440x900.png`, `${out}/refused@1440x900.png`, `${out}/unavailable@1440x900.png`], 'sheet@1440x900', 720);
  sheet([`${out}/prompt@390x844.png`, `${out}/seated@390x844.png`], 'sheet@390x844', 390);
} finally {
  await browser?.close();
  await writeFile(`${out}/report.json`, `${JSON.stringify(report, null, 2)}\n`).catch(() => {});
  await release();
}
console.log(JSON.stringify({ checks: report.checks, localResponse: report.localResponse, shots: report.shots }, null, 2));
