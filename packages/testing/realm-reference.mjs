import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { acquireCaptureLock } from './capture-lock.mjs';

const release = await acquireCaptureLock({ priority: 'main' });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
const errors = [];
try {
  const pages = [];
  for (let i = 0; i < 3; i++) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://127.0.0.1:5190/-/realm');
    await page.waitForFunction(() => window.__chatdomReady === true, null, { timeout: 60_000 });
    pages.push(page);
  }
  for (const page of pages) await page.waitForFunction(() => window.__chatdomRealm?.poses.length === 3);
  const ids = await Promise.all(pages.map(page => page.evaluate(() => window.__chatdomRealm.client.selfId)));
  if (new Set(ids).size !== 3) throw new Error('Three browsers did not receive distinct walkers');
  const start = await pages[0].evaluate(() => window.__chatdomRealm.poses.find(p => p.self).z);
  await pages[0].evaluate(() => window.__chatdomRealm.setInput({ moveX: 0, moveZ: 127, yaw: 0 }));
  for (const page of pages) await page.waitForFunction(({ id, start }) => (window.__chatdomRealm?.poses.find(p => p.id === id)?.z ?? -100) > start + 2, { id: ids[0], start });
  await pages[0].evaluate(() => window.__chatdomRealm.setInput({ moveX: 0, moveZ: 0 }));
  const tokenId = ids[2];
  await pages[2].reload();
  await pages[2].waitForFunction(() => window.__chatdomReady === true);
  if (await pages[2].evaluate(() => window.__chatdomRealm.client.selfId) !== tokenId) throw new Error('Reload created a second walker');
  await mkdir('shots/realm', { recursive: true });
  await pages[0].screenshot({ path: 'shots/realm/three-walkers@1440x900.png' });
  await pages[0].setViewportSize({ width: 390, height: 844 });
  await pages[0].screenshot({ path: 'shots/realm/three-walkers@390x844.png' });
  const states = await Promise.all(pages.map(page => page.evaluate(() => ({ roomId: window.__chatdomRealm.client.room.roomId, walkers: window.__chatdomRealm.poses.map(({id,x,z})=>({id,x,z})) }))));
  if (errors.length) throw new Error(errors.join('\n'));
  await writeFile('shots/realm/smoke.json', JSON.stringify({ source: 'SIMULATED', browsers: 3, reloadPreservedWalker: true, states, errors }, null, 2));
  console.info('SIMULATED realm: three browsers observed movement; reload retained the walker; desktop and phone shots saved.');
} finally { await browser.close(); await release(); }
