// Run against the already running lane gateway, realm, Vite server and pw10-harness.
// The test intentionally makes no network mocks except the operator's Helper substitute.
import { acquireCaptureLock } from '../../../packages/testing/capture-lock.mjs';
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { URLSearchParams } from 'node:url';

const base = process.env.PANEL_HARNESS_URL || 'http://127.0.0.1:5192';
const gateway = process.env.PANEL_TEST_GATEWAY;
if (!gateway || !/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(gateway)) throw new Error('PANEL_TEST_GATEWAY must be a local lane gateway origin');
const channel = process.env.PANEL_TEST_CHANNEL || '1234';
const user = process.env.PANEL_TEST_USER || '5678';
const release = await acquireCaptureLock();
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'] });
try {
  for (const identity of ['logged-out', 'unshared', 'shared']) {
    const page = await browser.newPage({ viewport: { width: 318, height: 496 } });
    const tokens = new Set(), consoleMessages = [], urls = [];
    await page.route('**/*', route => {
      const target = new URL(route.request().url());
      return ['localhost', '127.0.0.1'].includes(target.hostname) ? route.continue() : route.abort();
    });
    page.on('request', request => {
      urls.push(request.url());
      const bearer = request.headers().authorization;
      if (request.url().startsWith(`${gateway}/`) && bearer?.startsWith('Bearer ')) tokens.add(bearer.slice(7));
    });
    page.on('console', message => consoleMessages.push(message.text()));
    await page.goto(`${base}/harness/panel.html?${new URLSearchParams({ identity, channel, user })}`);
    await page.waitForFunction(() => window.__chatdomReady === true, null, { timeout: 60000 });
    await page.waitForFunction(() => window.__panelHarness !== undefined);
    await page.waitForTimeout(1000);
    assert.ok(tokens.size > 0, `${identity}: panel made no authenticated gateway request`);
    const exposure = await page.evaluate(() => ({ html: document.documentElement.outerHTML, url: window.location.href, local: JSON.stringify(window.localStorage), session: JSON.stringify(window.sessionStorage) }));
    for (const token of tokens) {
      assert.ok(!Object.values(exposure).some(value => value.includes(token)), `${identity}: token reached DOM, URL or storage`);
      assert.ok(!urls.some(value => value.includes(token)), `${identity}: token reached a request URL`);
      assert.ok(!consoleMessages.some(value => value.includes(token)), `${identity}: token reached console`);
    }
    console.log(`${identity}: authenticated gateway request and token confinement passed`);
    await page.close();
  }
} finally { await browser.close(); await release(); }
