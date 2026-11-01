// Run against a Vite server: node apps/web/src/walk/gestures/review-check.mjs http://127.0.0.1:5182
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { acquireCaptureLock } from '../../../../../packages/testing/capture-lock.mjs';
const release = await acquireCaptureLock();
let browser;
try {
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(`${process.argv[2]}/src/walk/gestures/review.html`);
  await page.waitForFunction(() => window.__chatdomReady === true);
  const trigger = page.getByRole('button', { name: 'Gestures' });
  const panel = page.getByRole('group', { name: 'Choose a gesture' });
  assert.equal(await trigger.getAttribute('aria-expanded'), 'true');
  await page.getByRole('textbox', { name: 'Keyboard review' }).focus();
  await page.keyboard.type('hello');
  await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('textbox').inputValue(), 'hello');
  assert.equal(await panel.isVisible(), true);
  await trigger.focus(); await page.keyboard.press('Escape');
  assert.equal(await panel.isVisible(), false);
  assert.equal(await trigger.getAttribute('aria-expanded'), 'false');
  await trigger.click(); await page.getByRole('button', { name: 'Wave' }).click();
  assert.equal(await page.locator('#result').textContent(), 'Local gesture: wave');
  const sent = await page.evaluate(async () => {
    const { createGestureState, mountGestureSelector } = await import('/src/walk/gestures/index.ts');
    const calls = []; const state = createGestureState(value => calls.push(value));
    const surface = document.createElement('div'); document.body.append(surface);
    const selector = mountGestureSelector(surface, { state, available: true });
    selector.setAvailable(false);
    surface.querySelector('.walk-gesture').click();
    selector.dispose(); surface.remove(); return calls;
  });
  assert.deepEqual(sent, []);
  console.log('Gesture browser checks passed');
} finally { try { await browser?.close(); } finally { await release(); } }
