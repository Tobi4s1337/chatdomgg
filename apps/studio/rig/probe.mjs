// Opens one studio URL in headless Chrome here and reports console errors, failed requests and readiness.
// For debugging pages before a GPU lease; never footage.   node apps/studio/rig/probe.mjs "/studio/set.html?…" [ms]
import { chromium } from '@playwright/test';
import { LOCAL_ARGS } from './record.mjs';
import { startStudio } from '../server/serve.mjs';

const [path = '/studio/', wait = '15000', port = '0'] = process.argv.slice(2);
const studio = await startStudio({ port: Number(port), quiet: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: LOCAL_ARGS });
try {
  const page = await browser.newPage();
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') console.log(`console.${m.type()}`, m.text().slice(0, 400)); });
  page.on('pageerror', e => console.log('pageerror', e.message.slice(0, 400)));
  page.on('requestfailed', r => console.log('requestfailed', r.url()));
  await page.goto(studio.base + path);
  await page.waitForTimeout(Number(wait));
  console.log(await page.evaluate(() => JSON.stringify({ ready: window.__chatdomReady ?? null, set: window.__set ? window.__set.stats() : null, studio: window.__studio ? { shot: window.__studio.shot, duration: window.__studio.duration } : null })));
} finally { await browser.close(); await studio.close(); }
