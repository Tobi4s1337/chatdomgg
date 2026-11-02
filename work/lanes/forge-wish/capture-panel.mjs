import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { acquireCaptureLock } from '../../../packages/testing/capture-lock.mjs';

// DOM-only review: no kingdom, WebGL context, Twitch connection or performance claim.
const output = 'work/evidence/forge-wish/wish-panel', port = Number(process.env.FORGE_WISH_CAPTURE_PORT ?? 5172);
if (!Number.isInteger(port) || port < 5170 || port > 5189 || port === 5187) throw new Error('Choose an unreserved lane preview port.');
const release = await acquireCaptureLock({ signal: globalThis.AbortSignal.timeout(120_000) });
let server, browser, cleanup;
function closeOwned() {
  return cleanup ??= (async () => {
    await browser?.close();
    if (server && server.exitCode === null && server.signalCode === null) {
      const closed = once(server, 'close');
      try { process.kill(-server.pid, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
      await closed;
    }
    await release();
  })();
}
process.once('SIGTERM', () => { void closeOwned().finally(() => process.exit(143)); });
process.once('SIGINT', () => { void closeOwned().finally(() => process.exit(130)); });
try {
  await mkdir(output, { recursive: true });
  server = spawn('pnpm', ['exec', 'vite', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'],
    { cwd: 'apps/web', stdio: ['ignore', 'pipe', 'inherit'], detached: true });
  let listening = false, exited = false;
  server.stdout.on('data', chunk => { if (chunk.toString().includes(`:${port}`)) listening = true; });
  server.once('exit', () => { exited = true; });
  const start = Date.now();
  while (!listening) {
    if (exited || Date.now() - start > 20_000) throw new Error('Owned panel preview failed to start.');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--no-sandbox'] });
  const base = `http://127.0.0.1:${port}/src/forge-wish-panel-bench/index.html`;
  for (const [state, width, height] of [
    ['ready', 1440, 900], ['ready', 390, 844], ['consent', 1440, 900], ['consent', 390, 844],
    ['unknown', 390, 844], ['delivered', 390, 844], ['cold', 390, 844], ['held', 390, 844],
  ]) {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    // Fixture pages never get an external network connection, including a consent click.
    await page.route('**/*', route => new URL(route.request().url()).origin === new URL(base).origin ? route.continue() : route.abort());
    await page.goto(`${base}?state=${state}`);
    await page.waitForFunction(() => window.__chatdomReady === true, undefined, { timeout: 15_000 });
    await page.evaluate(() => document.fonts.ready);
    assert.equal(errors.length, 0, 'Panel fixture must have no browser exceptions');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'Panel must fit the viewport');
    await page.screenshot({ path: `${output}/${state}@${width}x${height}.png` });
    await page.close();
  }

  // Exercise the actual default HTTP transport. Every API response here is intercepted fixture data.
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  let scope = 'authored-browser-session-123', sessionReads = 0, sends = 0, latest = null, statusMode = 'normal', sendMode = 'delayed';
  let waitForSend, releaseSend, postedId, switchAfterReads = Infinity;
  const sendStarted = () => new Promise(resolve => { waitForSend = resolve; });
  const pendingSend = new Promise(resolve => { releaseSend = resolve; });
  const session = () => ({ version: 1, status: 'authenticated', expiresAt: Date.now() + 3_600_000,
    resumeScope: scope, csrfToken: 'c'.repeat(40) });
  const reply = (wish = latest) => ({ version: 1, status: 'ok', kingdomId: '123', grant: { status: 'ready' }, availability: { status: 'ready' }, wish });
  const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  await page.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== new URL(base).origin) return route.abort();
    if (!url.pathname.startsWith('/api/realm/')) return route.continue();
    if (url.pathname === '/api/realm/session') {
      sessionReads++; if (sessionReads >= switchAfterReads) scope = 'another-browser-session-456';
      return json(route, session());
    }
    if (url.pathname.endsWith('/status')) {
      if (statusMode === 'expired' && url.searchParams.has('requestId')) return json(route,
        { version: 1, status: 'error', code: 'request-expired', message: 'This wish receipt has expired. This request will never send again.' }, 409);
      return json(route, reply());
    }
    if (url.pathname.endsWith('/wish')) {
      sends++; postedId = route.request().postDataJSON().requestId; waitForSend?.();
      if (sendMode === 'rate') {
        latest = { requestId: postedId, kingdomId: '123', status: 'not-sent', updatedAt: Date.now(),
          reason: 'rate-limited', message: 'Twitch chat is busy. Wait a moment before making a new wish.', retryAt: Date.now() + 1500 };
        return json(route, { version: 1, status: 'accepted', wish: latest }, 202);
      }
      await pendingSend;
      return json(route, { version: 1, status: 'accepted', wish: latest }, 202);
    }
    throw new Error('Unexpected mocked API route');
  });
  await page.goto(`${base}?transport=browser`);
  await page.getByLabel('What would you like to make?').waitFor();
  await page.getByLabel('What would you like to make?').fill('a small moon lantern');
  const started = sendStarted();
  await page.getByRole('button', { name: 'Send wish to chat' }).focus();
  await page.keyboard.press('Enter'); await started;
  assert.equal(await page.getByLabel('What would you like to make?').isDisabled(), true, 'Pending send must preserve its exact draft');
  await page.keyboard.press('Escape');
  assert.deepEqual(await page.evaluate(() => ({ restore: window.__forgeBench.restore, closed: window.__forgeBench.closed })), { restore: 1, closed: 1 });
  await page.evaluate(() => window.__forgeBench.reopen());
  await page.getByRole('heading', { name: 'Still checking' }).waitFor();
  assert.equal(sends, 1, 'Closing and reopening a pending send cannot repost');
  latest = { requestId: postedId, kingdomId: '123', updatedAt: Date.now(), status: 'delivered', messageId: 'fixture-message',
    receiptId: 'forge:fixture', attachmentId: 'fixture-piece', committedAt: Date.now(), message: 'Your home now carries a moon lantern.' };
  releaseSend();
  await page.getByRole('heading', { name: 'Made in the kingdom' }).waitFor({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Make another wish' }).click();
  const unsent = 'a new little copper lantern';
  await page.getByLabel('What would you like to make?').fill(unsent);
  await page.keyboard.press('Escape'); await page.evaluate(() => window.__forgeBench.reopen());
  await page.getByLabel('What would you like to make?').waitFor();
  assert.equal(await page.getByLabel('What would you like to make?').inputValue(), unsent, 'Old delivery cannot erase a new draft');
  sendMode = 'rate';
  await page.getByRole('button', { name: 'Send wish to chat' }).click();
  await page.getByRole('heading', { name: 'Not sent' }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Send wish to chat' }).isDisabled(), true);
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent === 'Send wish to chat' && !button.disabled));
  assert.equal(await page.getByLabel('What would you like to make?').inputValue(), unsent, 'A dropped send must retain its words');
  statusMode = 'expired'; latest = null;
  await page.keyboard.press('Escape'); await page.evaluate(() => window.__forgeBench.reopen());
  await page.getByText('This wish’s status has expired.', { exact: false }).waitFor();
  await page.getByRole('button', { name: 'Check again' }).click();
  await page.getByLabel('What would you like to make?').waitFor();
  assert.equal(await page.getByLabel('What would you like to make?').inputValue(), unsent, 'Receipt expiry must preserve a new draft');
  switchAfterReads = sessionReads + 2;
  await page.getByRole('button', { name: 'Send wish to chat' }).click();
  await page.getByText('Your Chatdom session changed.', { exact: false }).waitFor();
  assert.equal(sends, 2, 'A changed session cannot post the previous citizen draft');
  await page.close();
  await writeFile(`${output}/browser-checks.json`, JSON.stringify({ fixtureOnly: true, liveWrites: 0,
    defaultTransport: true, pendingCloseReopenPosts: 1, totalMockPosts: sends, freshDraftPreserved: true, scopeSwitchBlocked: true,
    rateLimitUnlocks: true, expiredReceiptRecovered: true,
    viewportOverflow: false, pointerRestoredOnce: true, screenshots: 8 }, null, 2) + '\n');
} finally { await closeOwned(); }
