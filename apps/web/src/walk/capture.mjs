// Walk the actual kingdom with two real connected browsers and keep the shoulder view at both sizes.
// Usage: node apps/web/src/walk/capture.mjs --base-url http://127.0.0.1:5190 [--path '/?walk=1'] [--out shots/walk]
// Fails, without writing a picture, when the page is not the kingdom, the walk binding is missing, or the
// realm never places a citizen. A bench or the reference court is never accepted in its place.
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { acquireCaptureLock } from '../../../../packages/testing/capture-lock.mjs';

const { values } = parseArgs({ options: {
  'base-url': { type: 'string', default: 'http://127.0.0.1:5190' },
  path: { type: 'string', default: '/?walk=1' },
  out: { type: 'string', default: 'shots/walk' },
} });
const url = new URL(values.path, values['base-url']).href;
const SIZES = [{ name: 'desktop', width: 1440, height: 900 }, { name: 'phone', width: 390, height: 844, isMobile: true, hasTouch: true }];
const LAUNCH = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'];

const release = await acquireCaptureLock();
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: LAUNCH });
const problems = [];
try {
  const pages = [];
  for (const size of SIZES) {
    const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: 1, isMobile: !!size.isMobile, hasTouch: !!size.hasTouch });
    const page = await context.newPage();
    page.on('pageerror', error => problems.push(`${size.name}: ${error.message}`));
    page.on('console', message => {
      const at = message.location().url ?? '';
      // Chrome asks for /favicon.ico on its own; that request is not part of the kingdom.
      if (message.type() === 'error' && !at.endsWith('/favicon.ico')) problems.push(`${size.name}: ${message.text()} ${at}`.trim());
    });
    page.on('response', response => { if (response.status() >= 400 && !response.url().endsWith('/favicon.ico')) problems.push(`${size.name}: ${response.status()} ${response.url()}`); });
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    pages.push({ ...size, page });
  }
  for (const { name, page } of pages) {
    await page.waitForFunction(() => window.__chatdomReady === true || !!document.querySelector('.kingdom-gate button'), null, { timeout: 240_000 })
      .catch(() => { throw new Error(`${name}: ${url} never finished opening`); });
    const surface = await page.evaluate(() => ({ kingdom: !!document.querySelector('[data-chatdom-kingdom]') && !!window.__chatdomKingdom, failed: !!document.querySelector('.kingdom-gate button') }));
    if (!surface.kingdom) throw new Error(`${name}: ${url} is not the kingdom page. Walk evidence must come from the actual kingdom entry.`);
    if (surface.failed) throw new Error(`${name}: the kingdom could not open at ${url}`);
    await page.waitForFunction(() => !!window.__chatdomWalk, null, { timeout: 15_000 })
      .catch(() => { throw new Error(`${name}: the kingdom walk binding is absent at ${url}. The integrator binds createWalkController as described in apps/web/src/walk/README.md.`); });
    await page.waitForFunction(() => window.__chatdomWalk.ready === true && window.__chatdomWalk.owner === 'walking', null, { timeout: 60_000 })
      .catch(() => { throw new Error(`${name}: the walk controller never stood on a connected citizen. Is the kingdom's realm service running?`); });
  }
  const debug = page => page.evaluate(() => JSON.parse(JSON.stringify(window.__chatdomWalk)));
  const [desk, phone] = pages;
  const deskId = (await debug(desk.page)).selfId, phoneId = (await debug(phone.page)).selfId;
  if (deskId === phoneId) throw new Error('Both browsers were given the same citizen');
  for (const [a, b] of [[desk, phoneId], [phone, deskId]]) {
    await a.page.waitForFunction(id => window.__chatdomWalk.peers.some(p => p.id === id), b, { timeout: 30_000 })
      .catch(() => { throw new Error(`${a.name}: never saw the other connected browser`); });
  }

  // Keyboard walk on the desktop: W with Shift, then one press of Space.
  const before = await debug(desk.page);
  await desk.page.mouse.move(desk.width * .7, desk.height * .45);
  await desk.page.keyboard.down('ShiftLeft'); await desk.page.keyboard.down('KeyW');
  await desk.page.waitForTimeout(1200);
  await desk.page.keyboard.up('KeyW'); await desk.page.keyboard.up('ShiftLeft');
  const groundY = (await debug(desk.page)).self.y;
  await desk.page.keyboard.press('Space');
  let peak = groundY;
  for (let n = 0; n < 12; n++) { await desk.page.waitForTimeout(60); peak = Math.max(peak, (await debug(desk.page)).self.y); }
  await desk.page.waitForTimeout(1200);
  const after = await debug(desk.page);
  const walked = Math.hypot(after.authority.x - before.authority.x, after.authority.z - before.authority.z);
  if (!(walked > 2)) throw new Error(`desktop: W with Shift moved the authoritative citizen only ${walked.toFixed(2)} m`);
  if (!(peak - groundY > .3)) throw new Error(`desktop: Space did not lift the citizen (${(peak - groundY).toFixed(2)} m)`);
  if (after.input.moveX || after.input.moveZ || after.input.buttons) throw new Error('desktop: input stayed held after the keys were released');
  await phone.page.waitForFunction(({ id, x, z }) => window.__chatdomWalk.peers.some(p => p.id === id && Math.hypot(p.x - x, p.z - z) < .25), { id: deskId, x: after.authority.x, z: after.authority.z }, { timeout: 10_000 })
    .catch(() => { throw new Error('phone: the other browser does not show the desktop citizen where the room put it'); });

  // Composition in actual drawn pixels, then the pictures.
  const shots = [];
  for (const { name, page, width, height } of pages) {
    await page.waitForTimeout(600);
    const state = await debug(page);
    const { x, y } = state.screen;
    if (!(x > width * .15 && x < width * .42 && y > height * .58 && y < height * .9)) throw new Error(`${name}: the citizen is drawn at ${x.toFixed(0)},${y.toFixed(0)}, outside the lower-left third`);
    const path = `${values.out}/street-shoulder@${width}x${height}.png`;
    await mkdir(values.out, { recursive: true });
    await page.screenshot({ path });
    shots.push({ name, path, screen: state.screen, camera: state.camera, self: state.self, authority: state.authority });
  }

  // The wheel reaches first person and comes back out, with the citizen hidden while inside.
  await desk.page.mouse.move(desk.width * .7, desk.height * .45);
  for (let n = 0; n < 16; n++) { await desk.page.mouse.wheel(0, -100); await desk.page.waitForTimeout(40); }
  await desk.page.waitForFunction(() => window.__chatdomWalk.camera.distance === 0, null, { timeout: 10_000 })
    .catch(() => { throw new Error('desktop: the wheel did not reach first person'); });
  const inside = await debug(desk.page);
  if (inside.selfOpacity !== 0 || inside.camera.filmOffset !== 0) throw new Error('desktop: first person still draws the citizen or keeps the shoulder offset');
  for (let n = 0; n < 12; n++) { await desk.page.mouse.wheel(0, 100); await desk.page.waitForTimeout(40); }
  await desk.page.waitForFunction(() => window.__chatdomWalk.camera.distance > 5 && window.__chatdomWalk.selfOpacity === 1, null, { timeout: 10_000 })
    .catch(() => { throw new Error('desktop: the wheel did not return to the shoulder view'); });

  if (problems.length) throw new Error(`Page problems:\n${problems.join('\n')}`);
  const source = await desk.page.evaluate(() => window.__chatdomKingdom?.stats?.source ?? 'unknown');
  await writeFile(`${values.out}/capture.json`, JSON.stringify({ url, source, browsers: [deskId, phoneId], walked, jump: peak - groundY, shots }, null, 2));
  console.info(`Walked ${walked.toFixed(2)} m and jumped ${(peak - groundY).toFixed(2)} m in ${url} (${source}); the other browser agreed. Shots: ${shots.map(s => s.path).join(', ')}`);
} finally {
  await browser.close();
  await release();
}
