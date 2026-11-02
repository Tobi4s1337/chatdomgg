// Stills of the site for review: every story section and every site page at the web sizes, the story page with
// WebGL switched off, and the seal signed in. One capture-lock hold for the whole set, released as soon as the last
// still is written.
//
//   node scripts/public/site-stills.mjs --base http://localhost:5198 --out work/evidence/front-door/fd10 [--only <name>…] [--no-signin]
//
// The base is a running public gateway (scripts/public/start.mjs, or the sign-in check's own gateway). Signing in
// for the signed-in stills needs that gateway on development sign-in (REALM_AUTH_MODE=simulated, loopback only).
import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { acquireCaptureLock } from '../../packages/testing/capture-lock.mjs';

const args = process.argv.slice(2);
const option = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const only = args.flatMap((value, i) => (value === '--only' ? [args[i + 1]] : []));
const base = option('--base');
const out = resolve(option('--out', 'work/evidence/front-door/fd10'));
if (!base || !/^http:\/\/(?:localhost|127\.0\.0\.1):\d+$/.test(base)) throw new Error('Pass --base http://localhost:<port> (a loopback gateway)');

const SIZES = [{ name: '1440x900', width: 1440, height: 900, mobile: false }, { name: '390x844', width: 390, height: 844, mobile: true }];
const SECTIONS = ['home', 'light', 'forge', 'growth', 'twitch', 'how-it-works', 'atlas', 'window'];
const PAGES = [['how-it-works', '/how-it-works'], ['imprint', '/imprint'], ['privacy', '/privacy'], ['terms', '/terms'], ['not-found', '/no-such-road']];
const wanted = name => !only.length || only.some(prefix => name.startsWith(prefix));
const ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'];

/** Waits until every picture inside the viewport has decoded and the section's settle-in has run. */
async function settle(page) {
  await page.waitForFunction(() => [...document.images].every(image => {
    const box = image.getBoundingClientRect();
    return box.bottom < 0 || box.top > window.innerHeight || (image.complete && image.naturalWidth > 0);
  }), null, { timeout: 30_000 });
  await page.waitForTimeout(1_400);
}

async function open(browser, size, path) {
  const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: 1, isMobile: size.mobile, hasTouch: size.mobile });
  const page = await context.newPage();
  const problems = [];
  page.on('pageerror', error => problems.push(`pageerror: ${error.message}`));
  page.on('console', message => { if (message.type() === 'error') problems.push(`console: ${message.text().slice(0, 300)}`); });
  await page.goto(`${base}${path}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForFunction(() => window.__chatdomReady === true, null, { timeout: 60_000 });
  return { context, page, problems };
}

async function shot(page, name) {
  const path = join(out, `${name}.png`);
  await page.screenshot({ path, timeout: 60_000 });
  console.log(`wrote ${path}`);
}

async function story(browser, size, prefix) {
  const { context, page, problems } = await open(browser, size, '/');
  for (const section of SECTIONS) {
    const name = `${prefix}${section}@${size.name}`;
    if (!wanted(name)) continue;
    await page.evaluate(id => document.getElementById(id).scrollIntoView({ block: 'start', behavior: 'instant' }), section);
    await settle(page);
    await shot(page, name);
  }
  await context.close();
  return problems;
}

let release, browser, deadline;
const problems = [];
try {
  await mkdir(out, { recursive: true });
  release = await acquireCaptureLock({ signal: globalThis.AbortSignal.timeout(20 * 60_000) });
  deadline = setTimeout(() => { console.error('The site stills ran past their six-minute hold.'); process.exit(124); }, 6 * 60_000);
  browser = await chromium.launch({ channel: 'chrome', headless: true, timeout: 60_000, args: ARGS });
  for (const size of SIZES) {
    problems.push(...await story(browser, size, 'story-'));
    for (const [name, path] of PAGES) {
      if (!wanted(`${name}@${size.name}`)) continue;
      const { context, page, problems: found } = await open(browser, size, path);
      await settle(page);
      await shot(page, `${name}@${size.name}`);
      if (name === 'privacy') {
        // A second still from deep in the policy, where the tables and lists are.
        await page.evaluate(() => document.getElementById('retention')?.scrollIntoView({ block: 'start', behavior: 'instant' }));
        await settle(page);
        await shot(page, `privacy-retention@${size.name}`);
      }
      problems.push(...found);
      await context.close();
    }
  }
  await browser.close();

  // The story with WebGL switched off: every picture stays, nothing waits on a map that cannot open.
  if (wanted('nowebgl')) {
    browser = await chromium.launch({ channel: 'chrome', headless: true, timeout: 60_000, args: [...ARGS, '--disable-webgl', '--disable-3d-apis'] });
    const size = SIZES[0];
    const { context, page, problems: found } = await open(browser, size, '/');
    if (await page.evaluate(() => Boolean(document.createElement('canvas').getContext('webgl2') ?? document.createElement('canvas').getContext('webgl')))) throw new Error('WebGL is still on');
    for (const section of ['home', 'atlas']) {
      await page.evaluate(id => document.getElementById(id).scrollIntoView({ block: 'start', behavior: 'instant' }), section);
      await settle(page);
      await shot(page, `nowebgl-${section}@${size.name}`);
    }
    problems.push(...found);
    await context.close();
    await browser.close();
  }

  // The seal signed in, at the top of the story page and in its header on a phone.
  if (!args.includes('--no-signin') && wanted('signed-in')) {
    browser = await chromium.launch({ channel: 'chrome', headless: true, timeout: 60_000, args: ARGS });
    for (const size of SIZES) {
      const { context, page, problems: found } = await open(browser, size, '/');
      await page.locator('.site-top [data-seal="out"], .story-hero [data-seal="out"]').first().click();
      await page.waitForURL(url => url.pathname.endsWith('/simulated-oidc/authorize'), { timeout: 30_000 });
      await page.locator('button[name="person"]').first().click();
      await page.waitForURL(url => url.origin === base && url.pathname === '/', { timeout: 30_000 });
      await page.locator('[data-seal="in"]').first().waitFor({ timeout: 30_000 });
      await page.waitForFunction(() => window.__chatdomReady === true, null, { timeout: 60_000 });
      await settle(page);
      await shot(page, `signed-in-home@${size.name}`);
      await page.evaluate(() => document.getElementById('window').scrollIntoView({ block: 'start', behavior: 'instant' }));
      await settle(page);
      await shot(page, `signed-in-window@${size.name}`);
      problems.push(...found);
      await context.close();
    }
  }
  for (const line of new Set(problems)) console.log(line);
} finally {
  try { await browser?.close(); }
  finally { globalThis.clearTimeout(deadline); await release?.(); }
}
