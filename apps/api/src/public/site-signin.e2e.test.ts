import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page } from '@playwright/test';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrateRealmSchema } from '../../../realm/src/persistence/migrate';

/**
 * The front door's sign-in round trip on the built public gateway: a visitor reading a section of the story page
 * (or a legal page) presses the seal, signs in through the development provider, and comes back to the same place,
 * signed in. Runs against its own throwaway schema, dropped afterwards, and its own port.
 *   node scripts/public/build.mjs --no-panel
 *   PUBLIC_SITE_E2E=1 node --env-file=<file with DATABASE_URL> node_modules/vitest/vitest.mjs run apps/api/src/public/site-signin.e2e.test.ts
 * PUBLIC_SITE_E2E_PORT picks the gateway's port (5198 by default; 5170–5186 or 5198–5199).
 */
const enabled = process.env.PUBLIC_SITE_E2E === '1';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const port = Number(process.env.PUBLIC_SITE_E2E_PORT ?? 5198);
const base = `http://localhost:${port}`;
const schema = `realm_simulated_site_${randomBytes(4).toString('hex')}`;

let pool: pg.Pool, gateway: ChildProcess | null = null, browser: Browser, log = '';

async function untilUp(): Promise<void> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (gateway?.exitCode !== null && gateway?.exitCode !== undefined) throw new Error(`The gateway stopped at start:\n${log}`);
    try { if ((await fetch(`${base}/robots.txt`)).ok) return; } catch { /* not listening yet */ }
    await new Promise(done => setTimeout(done, 250));
  }
  throw new Error(`The gateway did not answer within a minute:\n${log}`);
}

/** Presses the first seal in view and signs in as the provider's first person. */
async function signIn(page: Page): Promise<void> {
  await page.locator('.site-top [data-seal="out"]').click();
  await page.waitForURL(url => url.pathname.endsWith('/simulated-oidc/authorize'));
  await page.locator('button[name="person"]').first().click();
  await page.waitForURL(url => url.origin === base && !url.pathname.startsWith('/api/'));
  await page.locator('[data-seal="in"]').first().waitFor({ timeout: 15_000 });
}

describe.skipIf(!enabled)('signing in from the front door', () => {
  beforeAll(async () => {
    if (!Number.isInteger(port) || !((port >= 5170 && port <= 5186) || port === 5198 || port === 5199)) throw new Error('PUBLIC_SITE_E2E_PORT must be 5170–5186, 5198 or 5199');
    for (const built of ['apps/api/dist/public.mjs', 'apps/web/dist/index.html', 'apps/web/dist/site/index.html']) {
      if (!existsSync(resolve(root, built))) throw new Error(`${built} is missing; run node scripts/public/build.mjs --no-panel`);
    }
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not configured (pass it with --env-file)');
    pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1, application_name: 'chatdom-site-e2e' });
    await migrateRealmSchema(pool, schema);
    gateway = spawn(process.execPath, [resolve(root, 'apps/api/dist/public.mjs')], {
      cwd: root, stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env, PUBLIC_REPO_ROOT: root, PUBLIC_HOST: '127.0.0.1', PUBLIC_PORT: String(port), REALM_PUBLIC_ORIGIN: base,
        REALM_AUTH_MODE: 'simulated', REALM_DATABASE_SCHEMA: schema, PUBLIC_KINGDOMS: '129634568:tobi4s_', PUBLIC_INDEXING: 'closed',
        // No realm is needed for sign-in; the kingdom list simply comes back empty and the seal offers the map.
        PUBLIC_REALM_TARGET: 'http://127.0.0.1:9',
      },
    });
    const keep = (chunk: Buffer) => { log = `${log}${chunk.toString('utf8')}`.slice(-4_000); };
    gateway.stdout?.on('data', keep);
    gateway.stderr?.on('data', keep);
    await untilUp();
    browser = await chromium.launch();
  }, 120_000);

  afterAll(async () => {
    await browser?.close();
    if (gateway && gateway.exitCode === null) {
      const stopped = new Promise(done => gateway!.once('exit', done));
      gateway.kill('SIGTERM');
      await Promise.race([stopped, new Promise(done => setTimeout(done, 10_000))]);
      if (gateway.exitCode === null) gateway.kill('SIGKILL');
    }
    if (pool) {
      if (/^realm_simulated_site_[0-9a-f]{8}$/.test(schema)) await pool.query(`drop schema if exists "${schema}" cascade`);
      await pool.end();
    }
  }, 60_000);

  it('comes back to the same section of the story page, signed in', async () => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    await page.goto(`${base}/`);
    await page.evaluate(() => document.getElementById('growth')!.scrollIntoView({ block: 'start', behavior: 'instant' }));
    const before = await page.evaluate(() => document.getElementById('growth')!.getBoundingClientRect().top);
    await signIn(page);
    expect(new URL(page.url()).pathname).toBe('/');
    expect(new URL(page.url()).search).toBe('');
    const top = await page.evaluate(() => document.getElementById('growth')!.getBoundingClientRect().top);
    // The section sits just under the header, exactly where it was when the seal was pressed.
    expect(Math.abs(top - before)).toBeLessThan(4);
    expect(top).toBeLessThan(120);
    await expect.poll(() => page.locator('[data-seal="in"]').count()).toBe(3);
    expect(await page.locator('[data-seal="out"]').count()).toBe(0);
    // The development provider names its people; the seal says who is signed in once the session reply carries it.
    await expect.poll(() => page.locator('.site-top .seal-who-label').textContent()).toBe('Signed in with Twitch');
    expect(await page.locator('.site-top .seal-walk').getAttribute('href')).toBe('/map');

    // Signing out turns the seals back, says so, and the session is gone.
    // In the header the wax opens the card with the way out.
    await page.locator('.site-top button.seal-wax').click();
    await page.locator('.site-top .seal-out').click();
    await page.locator('[data-seal="out"]').first().waitFor();
    await expect.poll(() => page.locator('[data-site-notice-words]').textContent()).toContain('You have signed out');
    const session = await page.evaluate(async () => (await fetch('/api/realm/session', { cache: 'no-store' })).json() as Promise<{ status: string }>);
    expect(session.status).toBe('anonymous');
    await context.close();
  }, 90_000);

  it('comes back to the same legal page at the same place', async () => {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const page = await context.newPage();
    await page.goto(`${base}/privacy`);
    await page.evaluate(() => window.scrollTo({ top: 1600, behavior: 'instant' }));
    await signIn(page);
    expect(new URL(page.url()).pathname).toBe('/privacy');
    expect(Math.abs(await page.evaluate(() => window.scrollY) - 1600)).toBeLessThan(4);
    await context.close();
  }, 90_000);

  it('carries a visitor on to How it works, which sign-in itself cannot return to', async () => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    await page.goto(`${base}/how-it-works`);
    await signIn(page);
    await page.waitForURL(`${base}/how-it-works`);
    await page.locator('[data-seal="in"]').first().waitFor();
    await context.close();
  }, 90_000);

  it('says so when the visitor turns back at the gate', async () => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    await page.goto(`${base}/terms`);
    await page.locator('.site-top [data-seal="out"]').click();
    await page.waitForURL(url => url.pathname.endsWith('/simulated-oidc/authorize'));
    await page.locator('button[name="decision"][value="deny"]').click();
    await page.waitForURL(url => url.origin === base && url.pathname === '/terms');
    await expect.poll(() => page.locator('[data-site-notice-words]').textContent()).toContain('turned back');
    expect(new URL(page.url()).search).toBe('');
    expect(await page.locator('[data-seal="out"]').count()).toBeGreaterThan(0);
    await context.close();
  }, 90_000);
});
