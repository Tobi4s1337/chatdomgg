// One still through the actual kingdom scene. GPU runs use this page through pc-lease instead.
import { chromium } from '@playwright/test';
import { preview } from 'vite';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { setTimeout, clearTimeout } from 'node:timers';
import { acquireCaptureLock } from '../../../packages/testing/capture-lock.mjs';
import { startCapturePreview, closeCapturePreview } from '../../../packages/testing/preview.mjs';
import { superviseCapture } from '../../../apps/web/src/twitch-moments-bench/capture-supervisor.mjs';

if (!process.argv.includes('--worker')) {
  await superviseCapture(process.execPath, [fileURLToPath(import.meta.url), '--worker', ...process.argv.slice(2)], { deadlineMs: 3_600_000 });
} else {
  const release = await acquireCaptureLock({ signal: globalThis.AbortSignal.timeout(3_000_000) });
  const controller = new globalThis.AbortController();
  // One still per lock hold, bounded below five minutes.
  const timer = setTimeout(() => controller.abort(new Error('Short still exceeded four and a half minutes')), 270_000);
  let server, browser;
  controller.signal.addEventListener('abort', () => { void browser?.close().catch(() => {}); }, { once: true });
  try {
    let base;
    // Highest free lane port first: another worker's cleanup has reclaimed 5171 under a running capture.
    for (let port = 5186; port >= 5170; port--) {
      if (port === 5175) continue; // Shared with another worker's wildcard listener.
      controller.signal.throwIfAborted();
      process.env.CHATDOM_RAID_SHOW_PORT = String(port);
      try {
        // An alternate build directory (outside the repo) leaves the shared dist alone for captures already queued.
        if (process.env.CHATDOM_RAID_SHOW_DIST) {
          server = await preview({ root: 'apps/web', configFile: 'apps/web/vite.config.ts', build: { outDir: process.env.CHATDOM_RAID_SHOW_DIST },
            preview: { host: '127.0.0.1', port, strictPort: true } });
          base = `http://127.0.0.1:${port}`;
        } else ({ server, base } = await startCapturePreview('CHATDOM_RAID_SHOW_PORT'));
        break;
      }
      catch (error) { if (!/EADDRINUSE|in use/i.test(String(error?.message ?? error))) throw error; }
    }
    if (!base) throw new Error('No free lane preview port in 5170–5186');
    console.log(`[capture] own preview ${base}`);
    browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
    const argument = (name, fallback) => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback;
    // One incoming still per lock hold.
    const shots = (argument('--shots', null)?.split(',') ?? [`${argument('--viewers', '140')}@${argument('--size', '1920x1080')}:${argument('--at', '12000')}`]).map(spec => {
      const match = /^(\d+)@(\d+x\d+):(\d+)$/.exec(spec);
      if (!match) throw new Error(`Shot ${spec} must read viewers@WxH:ms`);
      const [, viewers, size, at] = match;
      if (!/^(1920x1080|1280x720|1440x900|390x844)$/.test(size)) throw new Error('Use a standard stream, web or phone size.');
      if (![3, 140, 10000, 70000].includes(Number(viewers)) || Number(at) > 600000) throw new Error('Choose a specified raid scale and a time within the ten-minute arrival window.');
      return { viewers: Number(viewers), size, at: Number(at) };
    });
    if (shots.length !== 1) throw new Error('Take one still per lock hold.');
    for (const { viewers, size, at } of shots) {
    const [width, height] = size.split('x').map(Number);
    const chatAge = Number(argument('--chat-age', '2000'));
    if (!Number.isFinite(chatAge) || chatAge < 500 || chatAge > 89500) throw new Error('Chat age must retain some of its original light lease.');
    const scene = argument('--scene', 'incoming');
    if (!['incoming', 'insignia'].includes(scene)) throw new Error('Choose incoming or insignia.');
    const archivePage = Number(argument('--archive-page', '0'));
    if (!Number.isInteger(archivePage) || archivePage < 0 || archivePage > 7 || archivePage && scene !== 'incoming') throw new Error('Choose archive page 1–7 on the incoming bench.');
    const route = scene === 'insignia' ? '/-/raid-gate?guestInsignia=1' : `/-/raid-gate?incoming=1&viewers=${viewers}&at=${at}${archivePage ? '&browse=1' : ''}${process.argv.includes('--pennants') ? '&pennants=1' : ''}${process.argv.includes('--chat') ? `&chat=1&chatAge=${chatAge}` : ''}`;
    const page = await browser.newPage({ viewport: { width, height } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${base}${route}`);
    console.log('[capture] incoming page opened');
    try {
      await page.waitForFunction(() => window.__chatdomReady === true || document.querySelector('.raid-show-error'), null, { timeout: 240_000 });
    } catch (error) {
      console.error(await page.evaluate(() => ({ ready: window.__chatdomReady, state: window.__chatdomRaidShow?.inspect() })));
      throw error;
    }
    const failure = await page.locator('.raid-show-error').count() ? await page.locator('.raid-show-error').textContent() : null;
    if (failure) throw new Error(failure);
    if (errors.length) throw new Error(errors.join('\n'));
    let book;
    if (archivePage) {
      await page.locator('.raid-pennant-browser__trigger').click();
      for (let chapter = 1; chapter <= archivePage; chapter++) {
        await page.waitForFunction(expected => {
          const state = window.__chatdomRaidShow?.inspect();
          return state?.raidPennants?.archiveReads === expected && document.querySelectorAll('.raid-pennant-browser__row').length === Math.min(12, 73 - (expected - 1) * 12);
        }, chapter);
        await page.evaluate(() => window.__chatdomRaidShow?.redraw());
        await page.evaluate(() => new Promise(resolve => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve))));
        if (chapter < archivePage) {
          const earlier = page.locator('.raid-pennant-browser__older');
          await earlier.focus(); await earlier.press('Enter');
          const focus = await page.evaluate(() => document.activeElement?.textContent);
          if (focus !== 'Earlier visits' && focus !== 'Recent visits') throw new Error('Keyboard paging lost its action focus');
        }
      }
      book = await page.evaluate(() => ({
        rows: [...document.querySelectorAll('.raid-pennant-browser__row')].map(node => node.textContent),
        status: document.querySelector('.raid-pennant-browser__message')?.textContent,
        horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
        activeControl: document.activeElement?.textContent,
        keyboardPagination: true,
      }));
      if (book.horizontalOverflow || archivePage === 7 && book.status !== 'No earlier visits') throw new Error('Archive layout or final-page state failed');
    }
    await page.evaluate(() => document.fonts.ready);
    const file = argument('--out', scene === 'insignia' ? `guest-insignia@${size}.png` : `caravan-${viewers}@${size}.png`);
    if (!/^[a-z0-9@.-]+\.png$/.test(file)) throw new Error('Output must be a plain evidence PNG name.');
    const out = `work/evidence/raid-show/${file}`;
    await mkdir('work/evidence/raid-show', { recursive: true });
    // SwiftShader may need more than Playwright's default 30 seconds to flush a completed world frame.
    // The worker's four-minute deadline still bounds the entire time holding the shared lock.
    await page.screenshot({ path: out, timeout: 90_000 });
    await writeFile(out.replace('.png', '.json'), JSON.stringify({ renderer: 'SwiftShader', performanceEvidence: false,
      route, size: [width, height], errors,
      book,
      state: await page.evaluate(() => window.__chatdomRaidShow?.inspect() ?? window.__guestInsignia),
    }, null, 2));
    console.log(`Look at ${out}`);
    await page.close();
    }
  } finally {
    clearTimeout(timer); await browser?.close(); if (server) await closeCapturePreview(server); await release();
  }
}
