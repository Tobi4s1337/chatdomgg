// Stills of signing in from anywhere (FD12): the story page signed out and signed in, the header's signed-in card,
// and every state of a kingdom's walk-in gate, at 1440x900 and 390x844. It runs its own public gateway on its own
// port with development sign-in on a throwaway schema (migrated here, dropped afterwards), and no realm, so the
// gate's realm answers are staged per still where a state needs one (see the README beside the stills). One
// capture-lock hold for the whole set.
//
//   node scripts/public/build.mjs --no-panel
//   node --env-file=<file with DATABASE_URL> scripts/public/signin-stills.mjs [--port 5199] [--out work/evidence/front-door/fd12]
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import pg from 'pg';
import { runnerImport } from 'vite';
import { acquireCaptureLock } from '../../packages/testing/capture-lock.mjs';

const args = process.argv.slice(2);
const option = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const port = Number(option('--port', '5199'));
const out = resolve(option('--out', 'work/evidence/front-door/fd12'));
if (!Number.isInteger(port) || !((port >= 5170 && port <= 5186) || port === 5198 || port === 5199)) throw new Error('--port must be 5170–5186, 5198 or 5199');
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not configured (pass it with --env-file)');
const base = `http://localhost:${port}`;
const schema = `realm_simulated_site_${randomBytes(4).toString('hex')}`;
const KINGDOM = '129634568';
const GATE = `/?walk=1&kingdom=${KINGDOM}`;
const ENTRY = `**/api/realm/entry/${KINGDOM}`;
// The kingdom's approved public name, as the live realm gives it for this id.
const NAME = { version: 1, kingdomId: KINGDOM, origin: 'live', name: 'Willowmere' };
const SIZES = [{ name: '1440x900', width: 1440, height: 900, mobile: false }, { name: '390x844', width: 390, height: 844, mobile: true }];
const ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'];

// The realm's migrations are read through Vite (they gather their SQL with import.meta.glob), as its own migrate script does.
const { module: { migrateRealmSchema } } = await runnerImport(resolve(root, 'apps/realm/src/persistence/migrate.ts'), { root: resolve(root, 'apps/realm'), configFile: false, logLevel: 'warn' });
let pool, gateway, browser, release, deadline, log = '';
const problems = [];

async function untilUp() {
  const until = Date.now() + 60_000;
  while (Date.now() < until) {
    if (gateway.exitCode !== null) throw new Error(`The gateway stopped at start:\n${log}`);
    try { if ((await fetch(`${base}/robots.txt`)).ok) return; } catch { /* not yet */ }
    await new Promise(done => setTimeout(done, 250));
  }
  throw new Error(`The gateway did not answer within a minute:\n${log}`);
}

async function shot(page, name) {
  await page.waitForFunction(() => [...document.images].every(image => {
    const box = image.getBoundingClientRect();
    return box.bottom < 0 || box.top > window.innerHeight || (image.complete && image.naturalWidth > 0);
  }), null, { timeout: 30_000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(900);
  const path = join(out, `${name}.png`);
  await page.screenshot({ path, timeout: 60_000 });
  console.log(`wrote ${path}`);
}

/** The realm's answer for this kingdom, staged per still: its name, a refusal, or no answer yet. */
async function stage(page, answer) {
  await page.unroute(ENTRY).catch(() => {});
  if (answer === 'name') await page.route(ENTRY, route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(NAME) }));
  if (answer === 'refused') await page.route(ENTRY, route => route.fulfill({ status: 403, contentType: 'application/json',
    body: JSON.stringify({ version: 1, status: 'refused', message: 'Too many entries were requested. Wait a moment, then walk in again.' }) }));
  if (answer === 'pending') await page.route(ENTRY, () => { /* the realm has not answered yet */ });
}

async function gate(page, name, state, answer, search = GATE) {
  await stage(page, answer);
  await page.goto(`${base}${search}`, { waitUntil: 'domcontentloaded' });
  await page.locator(`[data-gate="${state}"]`).waitFor({ timeout: 30_000 });
  if (answer === 'name' || answer === 'refused') await page.locator('.ke-kicker', { hasText: 'Willowmere' }).waitFor({ timeout: 10_000 }).catch(() => {});
  await shot(page, name);
}

try {
  await mkdir(out, { recursive: true });
  pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1, application_name: 'chatdom-signin-stills' });
  await migrateRealmSchema(pool, schema);
  gateway = spawn(process.execPath, [resolve(root, 'apps/api/dist/public.mjs')], {
    cwd: root, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PUBLIC_REPO_ROOT: root, PUBLIC_HOST: '127.0.0.1', PUBLIC_PORT: String(port), REALM_PUBLIC_ORIGIN: base,
      REALM_AUTH_MODE: 'simulated', REALM_DATABASE_SCHEMA: schema, PUBLIC_KINGDOMS: `${KINGDOM}:tobi4s_`, PUBLIC_INDEXING: 'closed',
      PUBLIC_REALM_TARGET: 'http://127.0.0.1:9' },
  });
  const keep = chunk => { log = `${log}${chunk.toString('utf8')}`.slice(-4_000); };
  gateway.stdout.on('data', keep); gateway.stderr.on('data', keep);
  await untilUp();

  release = await acquireCaptureLock({ signal: globalThis.AbortSignal.timeout(20 * 60_000) });
  deadline = setTimeout(() => { console.error('The sign-in stills ran past their five-minute hold.'); process.exit(124); }, 5 * 60_000);
  browser = await chromium.launch({ channel: 'chrome', headless: true, timeout: 60_000, args: ARGS });
  for (const size of SIZES) {
    const context = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: 1, isMobile: size.mobile, hasTouch: size.mobile });
    const page = await context.newPage();
    page.on('pageerror', error => problems.push(`pageerror: ${error.message}`));
    page.on('console', message => { if (message.type() === 'error') problems.push(`console: ${message.text().slice(0, 200)}`); });

    // Signed out.
    await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__chatdomReady === true, null, { timeout: 60_000 });
    await shot(page, `story-signed-out@${size.name}`);
    await gate(page, `gate-lost@${size.name}`, 'lost', null, '/?walk=1');
    await gate(page, `gate-waiting@${size.name}`, 'waiting', 'name');
    // Turning back at Twitch from the gate: back at the same gate, which says so.
    await page.locator('.ke-ways [data-seal="out"]').click();
    await page.waitForURL(url => url.pathname.endsWith('/simulated-oidc/authorize'));
    await page.locator('button[name="decision"][value="deny"]').click();
    await page.waitForURL(url => url.origin === base && url.searchParams.get('kingdom') === KINGDOM, { timeout: 30_000 });
    await page.locator('[data-gate="waiting"]').waitFor();
    await page.locator('.cd-notice.is-open').waitFor();
    await shot(page, `gate-declined@${size.name}`);

    // Signing in from the story page, then the same visitor at the gate.
    await page.unroute(ENTRY).catch(() => {});
    await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
    await page.locator('.site-top [data-seal="out"]').click();
    await page.waitForURL(url => url.pathname.endsWith('/simulated-oidc/authorize'));
    await page.locator('button[name="person"]').first().click();
    await page.waitForURL(url => url.origin === base && url.pathname === '/', { timeout: 30_000 });
    await page.locator('.story-hero [data-seal="in"]').waitFor({ timeout: 30_000 });
    await page.waitForFunction(() => window.__chatdomReady === true, null, { timeout: 60_000 });
    await shot(page, `story-signed-in@${size.name}`);
    await page.locator('.site-top button.cd-signin-wax').click();
    await shot(page, `story-signed-in-card@${size.name}`);

    await gate(page, `gate-opening@${size.name}`, 'opening', 'pending');
    await gate(page, `gate-closed@${size.name}`, 'closed', 'name');
    await gate(page, `gate-refused@${size.name}`, 'refused', 'refused');
    await context.close();
  }
  for (const line of new Set(problems)) console.log(line);
} finally {
  try { await browser?.close(); } catch { /* gone */ }
  globalThis.clearTimeout(deadline);
  await release?.();
  if (gateway && gateway.exitCode === null) {
    const stopped = new Promise(done => gateway.once('exit', done));
    gateway.kill('SIGTERM');
    await Promise.race([stopped, new Promise(done => setTimeout(done, 10_000))]);
    if (gateway.exitCode === null) gateway.kill('SIGKILL');
  }
  if (pool) {
    if (/^realm_simulated_site_[0-9a-f]{8}$/.test(schema)) await pool.query(`drop schema if exists "${schema}" cascade`);
    await pool.end();
  }
}
