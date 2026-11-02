// Stills of the front page's living hero and every story section, in one capture-lock hold.
//
//   node scripts/public/hero-stills.mjs --base http://127.0.0.1:5173 [--path /site/] --out work/evidence/front-door/fd13 [--only <name>…]
//
// The base serves the site build (the public gateway, or `vite preview --config src/site/vite.config.mjs` from
// apps/web, where the story is at /site/). On this host Chrome draws with SwiftShader, so the page itself keeps its
// pictures (a software renderer never gets the live land); the `hero-live` still asks for the live land through the
// session choice the page reads (`chatdom:hero`), which on a software renderer uses the land's software tier and holds
// the picture's camera. These stills show layout and the handover, never frame timing.
//
// Stills: hero-poster and hero-live at 1440x900 (the same view before and after the live land fades in), every story
// section at 1440x900 and 390x844, and the story with WebGL switched off.
/* global sessionStorage, getComputedStyle -- used in functions that run in the page */
import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { acquireCaptureLock } from '../../packages/testing/capture-lock.mjs';

const args = process.argv.slice(2);
const option = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const only = args.flatMap((value, i) => (value === '--only' ? [args[i + 1]] : []));
const base = option('--base');
const path = option('--path', '/');
const out = resolve(option('--out', 'work/evidence/front-door/fd13'));
if (!base || !/^http:\/\/(?:localhost|127\.0\.0\.1):\d+$/.test(base)) throw new Error('Pass --base http://127.0.0.1:<port> (a loopback server)');

const SIZES = [{ name: '1440x900', width: 1440, height: 900, mobile: false }, { name: '390x844', width: 390, height: 844, mobile: true }];
const SECTIONS = ['home', 'light', 'forge', 'growth', 'twitch', 'how-it-works', 'atlas', 'window'];
const wanted = name => !only.length || only.some(prefix => name.startsWith(prefix));
const ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'];

async function settle(page) {
  await page.waitForFunction(() => [...document.images].every(image => {
    const box = image.getBoundingClientRect();
    return box.bottom < 0 || box.top > window.innerHeight || (image.complete && image.naturalWidth > 0);
  }), null, { timeout: 30_000 });
  await page.waitForTimeout(1_400);
}

async function open(browser, size, { live = false } = {}) {
  const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: 1, isMobile: size.mobile, hasTouch: size.mobile });
  if (live) await context.addInitScript(() => sessionStorage.setItem('chatdom:hero', 'live'));
  const page = await context.newPage();
  const problems = [];
  page.on('pageerror', error => problems.push(`pageerror: ${error.message}`));
  page.on('console', message => {
    if (message.type() === 'error') problems.push(`console: ${message.text().slice(0, 300)}`);
    if (message.type() === 'info' || message.type() === 'warning') console.log(`  page ${message.type()}: ${message.text().slice(0, 300)}`);
  });
  await page.goto(`${base}${path}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForFunction(() => window.__chatdomReady === true, null, { timeout: 60_000 });
  return { context, page, problems };
}

async function shot(page, name) {
  const file = join(out, `${name}.png`);
  await page.screenshot({ path: file, timeout: 120_000 });
  console.log(`wrote ${file}`);
}

let release, browser, deadline;
const problems = [];
try {
  await mkdir(out, { recursive: true });
  release = await acquireCaptureLock({ signal: globalThis.AbortSignal.timeout(20 * 60_000) });
  deadline = setTimeout(() => { console.error('The hero stills ran past their five-minute hold.'); process.exit(124); }, 5 * 60_000);
  browser = await chromium.launch({ channel: 'chrome', headless: true, timeout: 60_000, args: ARGS });

  if (wanted('hero')) {
    const size = SIZES[0];
    const started = Date.now();
    const { context, page, problems: found } = await open(browser, size, { live: true });
    await settle(page);
    await shot(page, `hero-poster@${size.name}`);
    await page.waitForFunction(() => ['live', 'still'].includes(document.querySelector('.story-hero')?.dataset.heroState ?? ''), null, { timeout: 200_000 });
    const state = await page.evaluate(() => ({ state: document.querySelector('.story-hero').dataset.heroState, plan: document.querySelector('.story-hero').dataset.heroPlan }));
    console.log(`  hero ${state.state} (${state.plan}) after ${((Date.now() - started) / 1000).toFixed(0)} s`);
    await page.waitForTimeout(2_400);
    await shot(page, `hero-live@${size.name}`);
    if (state.state === 'live') {
      // The handover, side by side: the live land pinned to the held picture's drift, then hidden over that picture.
      const pin = opacity => page.evaluate(value => {
        const layer = document.querySelector('.story-hero-live');
        const held = document.querySelector('.story-hero-frame.is-shown img');
        layer.style.transition = 'none';
        layer.style.transform = held ? getComputedStyle(held).transform : '';
        layer.style.opacity = String(value);
      }, opacity);
      await pin(1);
      await page.waitForTimeout(300);
      await shot(page, `hero-handover-live@${size.name}`);
      await pin(0);
      await page.waitForTimeout(300);
      await shot(page, `hero-handover-picture@${size.name}`);
    }
    problems.push(...found);
    await context.close();
  }

  for (const size of SIZES) {
    if (!SECTIONS.some(section => wanted(`story-${section}@${size.name}`))) continue;
    const { context, page, problems: found } = await open(browser, size);
    for (const section of SECTIONS) {
      const name = `story-${section}@${size.name}`;
      if (!wanted(name)) continue;
      await page.evaluate(id => document.getElementById(id).scrollIntoView({ block: 'start', behavior: 'instant' }), section);
      await settle(page);
      await shot(page, name);
    }
    problems.push(...found);
    await context.close();
  }
  await browser.close();

  if (wanted('nowebgl')) {
    browser = await chromium.launch({ channel: 'chrome', headless: true, timeout: 60_000, args: [...ARGS, '--disable-webgl', '--disable-3d-apis'] });
    const size = SIZES[0];
    const { context, page, problems: found } = await open(browser, size, { live: true });
    if (await page.evaluate(() => Boolean(document.createElement('canvas').getContext('webgl2') ?? document.createElement('canvas').getContext('webgl')))) throw new Error('WebGL is still on');
    await settle(page);
    // Even when asked for the live land, without WebGL the hero keeps its pictures.
    await page.waitForTimeout(2_500);
    console.log(`  no WebGL: hero plan ${await page.evaluate(() => document.querySelector('.story-hero')?.dataset.heroPlan ?? 'none')}`);
    await shot(page, `nowebgl-home@${size.name}`);
    problems.push(...found);
    await context.close();
  }
  for (const line of new Set(problems)) console.log(line);
} finally {
  try { await browser?.close(); }
  finally { globalThis.clearTimeout(deadline); await release?.(); }
}
