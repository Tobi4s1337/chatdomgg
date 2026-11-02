/* global AbortSignal, clearTimeout, innerWidth, innerHeight */
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { acquireCaptureLock } from '../../../../../packages/testing/capture-lock.mjs';
const base = process.env.ATLAS_CHECK_URL ?? 'http://127.0.0.2:5175';
const out = 'work/evidence/atlas-map';
const release = await acquireCaptureLock({ signal: AbortSignal.timeout(600_000) });
let browser;
const deadline = setTimeout(() => { void browser?.close(); }, 240_000);
const captures = [], errors = [], requests = [];
let checks = 0;
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--disable-webgl', '--no-sandbox'] });
  await mkdir(out, { recursive: true });
  for (const width of [1440, 390]) {
    let replyTemplate;
    const page = await browser.newPage({ viewport: { width, height: width === 390 ? 844 : 900 }, isMobile: width === 390, hasTouch: width === 390 });
    page.on('pageerror', e => errors.push(e.message));
    page.on('request', r => { if (/api\.twitch\.tv|id\.twitch\.tv/.test(r.url())) requests.push(r.url()); });
    for (const login of ['tobi4s_', 'zliifer']) {
      await page.goto(`${base}/map`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('[data-atlas-ready="still"] [data-state="still"]', { timeout: 45_000 });
      const response = page.waitForResponse(r => new URL(r.url()).pathname.endsWith('/search') && r.ok());
      await page.getByRole('combobox', { name: 'Find a channel' }).pressSequentially(login, { delay: 250 });
      const search = await (await response).json();
      replyTemplate = search;
      const result = search.results.find(r => r.channel.login === login);
      if (!result?.position || result.average !== null) throw new Error(`${login}: expected real channel outside survey with a pencil point`);
      const row = page.getByRole('option').filter({ hasText: login }).first();
      await row.waitFor();
      await page.evaluate(() => document.fonts.ready);
      let path = `${out}/am10-fallback-search-${login}-${width}.png`;
      await page.screenshot({ path }); captures.push({ path, kind: 'search', login, width, position: result.position, id: result.channel.id });
      const cardRead = page.waitForResponse(r => /\/card\//.test(new URL(r.url()).pathname) && r.ok());
      await row.click(); const card = await (await cardRead).json();
      await page.getByRole('heading', { name: login, exact: true, level: 2 }).waitFor();
      await page.locator('[data-atlas-pencil-place]').waitFor();
      if (JSON.stringify(card.position) !== JSON.stringify(result.position) || card.average !== null || card.roads !== null) throw new Error(`${login}: card differs or invents facts`);
      const text = await page.locator('.atlas-card').innerText();
      if (/0 average|0 avg|found via|from Twitch/i.test(text)) throw new Error(`${login}: misleading card facts`);
      const visible = await page.locator('.atlas-card-head').evaluate(el => {const r=el.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight;});
      if (!visible) throw new Error(`${login}: clipped card header`);
      await page.locator('.atlas-card-head [data-atlas-face="picture"]').waitFor({timeout:15_000});
      path = `${out}/am10-fallback-card-${login}-${width}.png`;
      await page.screenshot({ path }); captures.push({ path, kind: 'card', login, width, position: card.position, id: card.channel.id, live: card.stream?.live, observedAt: card.asOf });
      await page.getByRole('button', { name: 'Close card' }).click();
      if (await page.locator('[data-atlas-pencil-place]').count()) throw new Error('Pencil marker survived close');
    }
    let retries = 0;
    await page.route(/\/search\?/, async route => {
      retries++;
      await route.fulfill({ status: 200, json: { ...replyTemplate, servedAt: Date.now(), asOf: Date.now(), key: 'simulated absent', results: [], more: false, unavailable: 'limited' } });
    });
    const input = page.getByRole('combobox', { name: 'Find a channel' });
    await input.fill('');
    const typedReply = page.waitForResponse(r => new URL(r.url()).pathname.endsWith('/search'));
    await input.pressSequentially('SIMULATED absent', { delay: 250 });
    await typedReply;
    await page.getByRole('button', { name: 'Search again', exact: true }).waitFor();
    if (retries !== 1) throw new Error(`Typing spent ${retries} requests instead of one`);
    checks++;
    let retryReply = page.waitForResponse(r => new URL(r.url()).pathname.endsWith('/search'));
    await input.press('Enter');
    await retryReply;
    await page.getByRole('button', { name: 'Search again', exact: true }).waitFor();
    if (retries < 2) throw new Error('Enter did not retry an empty limited search');
    retryReply = page.waitForResponse(r => new URL(r.url()).pathname.endsWith('/search'));
    await page.getByRole('button', { name: 'Search again', exact: true }).click();
    await retryReply;
    await page.getByRole('button', { name: 'Search again', exact: true }).waitFor();
    if (retries < 3) throw new Error('Search again did not retry');
    checks += 2;
    await page.route(/\/card\/login\/simulated_absent\?/, route => route.fulfill({ status: 503, json: { error: 'lookup-disabled' } }));
    await page.goto(`${base}/map/simulated_absent`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Look on Twitch', exact: true }).waitFor();
    if (!(await page.locator('.atlas').innerText()).includes('is not on the map yet')) throw new Error('Disabled fallback did not degrade plainly');
    checks++;
    await page.close();
  }
  if (errors.length || requests.length) throw new Error(JSON.stringify({ errors, browserTwitchRequests: requests }));
  await writeFile(`${out}/am10-fallback-shots.json`, JSON.stringify({ capturedAt:new Date().toISOString(), renderer:'dated Canvas2D still', captures, pageErrors:errors, browserTwitchRequests:requests, controlledBrowserChecks:checks }, null, 2)+'\n');
  console.log(JSON.stringify({captures:captures.length,pageErrors:errors.length,browserTwitchRequests:requests.length,controlledBrowserChecks:checks}));
} finally { clearTimeout(deadline); await browser?.close(); await release(); }
