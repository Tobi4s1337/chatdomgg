import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { acquireCaptureLock } from '../../../../packages/testing/capture-lock.mjs';
import { mkdir } from 'node:fs/promises';
const release = await acquireCaptureLock({ priority: 'main' });
let server, browser;
try {
  server = await createServer({ root: 'apps/web', configFile: 'apps/web/vite.config.ts', logLevel: 'error', optimizeDeps: { entries: ['src/citizens/review.html'] }, server: { host: '127.0.0.1', port: 5189, strictPort: true } });
  await server.listen();
  browser = await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--no-sandbox']});
  const page = await browser.newPage({viewport:{width:1440,height:900}});
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto('http://127.0.0.1:5189/src/citizens/review.html', {waitUntil:'domcontentloaded'});
  await page.waitForFunction(() => window.__chatdomReady === true, {}, {timeout:180000});
  if (errors.length) throw new Error(errors.join('\n'));
  await mkdir('shots/citizen-defaults',{recursive:true});
  await page.screenshot({path:'shots/citizen-defaults/review@1440x900.png'});
} finally { await browser?.close(); await server?.close(); await release(); }
