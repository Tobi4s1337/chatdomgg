/* global AbortSignal, clearTimeout, getComputedStyle, innerHeight, innerWidth, MutationObserver, NodeFilter, performance, requestAnimationFrame */
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { acquireCaptureLock } from '../../../../../packages/testing/capture-lock.mjs';

// Real preview and live state only. Test-only footer content is mounted after the screenshots are taken.
const base = process.env.ATLAS_CHECK_URL ?? 'http://127.0.0.2:5175';
const out = 'work/evidence/atlas-map';
const checks = [], captures = [], errors = [];
const check = (name, passed, detail) => {
  checks.push({ name, passed: !!passed, ...(detail === undefined ? {} : { detail }) });
};
const release = await acquireCaptureLock({ signal: AbortSignal.timeout(600_000) });
let browser;
// No client can hold the shared capture slot for five minutes.
const deadline = setTimeout(() => { void browser?.close(); }, 240_000);
const shot = async (page, kind, width) => {
  await page.evaluate(() => document.fonts.ready);
  const path = `${out}/am10-carved-${kind}-${width}.png`;
  const bytes = await page.screenshot();
  if (bytes.length >= 2_000_000) throw new Error(`${path} exceeds 2 MB (${bytes.length} bytes)`);
  await writeFile(path, bytes);
  captures.push({ path, width, bytes: bytes.length });
};
const settle = async page => {
  await page.waitForSelector('[data-atlas-ready="still"] [data-state="still"]', { timeout: 60_000 });
  await page.evaluate(() => document.fonts.ready);
};

/** Count visible product chrome, including a visible placeholder; map geography/name marks are not UI copy. */
const visibleWords = page => page.locator('.atlas').evaluate(root => {
  const excluded = '.atlas-map, .atlas-still-marks, canvas, svg, .atlas-visually-hidden, .sr-only, [hidden], [inert], [aria-hidden="true"]';
  const visible = element => {
    if (element.closest(excluded)) return false;
    if (!element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0 && rect.top < innerHeight && rect.left < innerWidth;
  };
  const parts = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.parentElement && visible(node.parentElement) && node.textContent.trim()) parts.push(node.textContent.trim());
  }
  for (const input of root.querySelectorAll('input[placeholder],textarea[placeholder]')) {
    if (visible(input) && !input.value) parts.push(input.placeholder);
  }
  const text = parts.join(' ').replace(/\s+/g, ' ').trim();
  return { text, count: (text.match(/[\p{L}\p{N}]+(?:[-’'][\p{L}\p{N}]+)*/gu) ?? []).length };
});

try {
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--disable-webgl', '--no-sandbox'] });
  await mkdir(out, { recursive: true });
  for (const width of [1440, 390]) {
    const page = await browser.newPage({ viewport: { width, height: width === 390 ? 844 : 900 }, isMobile: width === 390, hasTouch: width === 390 });
    page.on('pageerror', error => errors.push({ width, message: error.message }));
    await page.goto(`${base}/map`, { waitUntil: 'domcontentloaded' });
    await settle(page);
    const actual = await visibleWords(page);
    check(`${width}: at most 25 visible chrome words including search placeholder`, actual.count <= 25, actual);
    check(`${width}: no simulated or raw error text in the default chrome`, !/\bsimulated\b|\b(?:error|exception|stack trace)\b/i.test(actual.text), actual.text);
    check(`${width}: a real preview date is retained`, await page.locator('.atlas').getAttribute('data-as-of') !== null);
    await shot(page, 'default', width);

    const search = page.getByRole('combobox', { name: 'Find a channel' });
    const baselineFocus = await search.evaluate(element => {
      const field = element.closest('.atlas-search-field') ?? element;
      return { shadow: getComputedStyle(field).boxShadow, fieldOutline: getComputedStyle(field).outline, outline: getComputedStyle(element).outline };
    });
    await page.keyboard.press('Tab');
    await search.focus();
    await page.waitForFunction(before => {
      const element = document.querySelector('.atlas-search-field input');
      if (!element) return false;
      const field = element.closest('.atlas-search-field') ?? element;
      return getComputedStyle(field).boxShadow !== before.shadow || getComputedStyle(field).outline !== before.fieldOutline || getComputedStyle(element).outline !== before.outline;
    }, baselineFocus, { timeout: 2_000 }).catch(() => undefined);
    const focus = await search.evaluate(element => {
      const field = element.closest('.atlas-search-field') ?? element;
      const style = getComputedStyle(field);
      const inputStyle = getComputedStyle(element);
      return { shadow: style.boxShadow, fieldOutline: style.outline, outline: inputStyle.outline, focused: document.activeElement === element };
    });
    check(`${width}: keyboard search has a crafted visible focus treatment`, focus.focused && (focus.shadow !== baselineFocus.shadow || focus.fieldOutline !== baselineFocus.fieldOutline || focus.outline !== baselineFocus.outline), { before: baselineFocus, focused: focus });
    await shot(page, 'focus', width);
    await search.blur();

    const survey = page.getByRole('button', { name: 'About this map' });
    await survey.waitFor();
    await survey.focus();
    const surveyDetails = page.locator('.atlas-survey-hint[role=tooltip]');
    await surveyDetails.waitFor();
    const surveyText = (await surveyDetails.innerText()).trim();
    const surveyLines = await surveyDetails.evaluate(element => { const range = document.createRange(); range.selectNodeContents(element); return new Set([...range.getClientRects()].map(rect => Math.round(rect.top))).size; });
    check(`${width}: survey seal explains the dated preview in one line`, surveyText.length > 5 && !surveyText.includes('\n') && surveyLines === 1, { text: surveyText, lines: surveyLines });
    await survey.blur();

    const key = page.locator('.atlas-key');
    const keyToggle = page.getByRole('button', { name: 'Key', exact: true });
    if (width === 390) {
      check('phone: key begins closed', (await keyToggle.getAttribute('aria-expanded')) === 'false');
      await keyToggle.click();
      check('phone: key opens', (await keyToggle.getAttribute('aria-expanded')) === 'true');
      const box = await key.boundingBox();
      check('phone: key is a fitting bottom sheet', !!box && box.width >= width * 0.8 && box.height <= 844 * 0.5 && box.y + box.height <= 845, box);
      await shot(page, 'phone-key', width);
    }
    const labels = ['Live', 'Founded', 'Waiting land', 'Road', 'Your home'];
    const symbols = labels.map(label => key.getByRole('button', { name: label, exact: true }));
    check(`${width}: exactly five key glyph buttons`, (await key.locator('button[data-atlas-key-glyph]').count()) === 5);
    check(`${width}: descriptions are absent until requested`, await key.locator('[data-atlas-key-detail]').count() === 0);
    for (let i = 0; i < symbols.length; i++) {
      await symbols[i].waitFor();
      if (width === 390) await symbols[i].click();
      else await symbols[i].hover();
      const hint = key.locator('[data-atlas-key-detail]');
      await hint.waitFor();
      const content = (await hint.innerText()).trim();
      const lines = await hint.evaluate(element => {
        const range = document.createRange(); range.selectNodeContents(element);
        return new Set([...range.getClientRects()].map(rect => Math.round(rect.top))).size;
      });
      check(`${width}: ${labels[i]} gives one readable line`, content.length > 4 && !content.includes('\n') && lines === 1, { content, lines });
    }
    if (width === 390) {
      await symbols[4].focus();
      await page.keyboard.press('Escape');
      check('phone: first Escape clears the description and retains glyph focus', await key.locator('[data-atlas-key-detail]').count() === 0 && await symbols[4].evaluate(element => document.activeElement === element));
      await page.keyboard.press('Escape');
      check('phone: second Escape closes the key', (await keyToggle.getAttribute('aria-expanded')) === 'false');
      check('phone: Escape restores focus to the Key control', await keyToggle.evaluate(element => document.activeElement === element));
    }

    const mute = page.getByRole('button', { name: 'Mute map sounds', exact: true });
    await mute.waitFor();
    await mute.click();
    const unmute = page.getByRole('button', { name: 'Unmute map sounds', exact: true });
    check(`${width}: mute toggles to unmute`, await unmute.isVisible() && (await unmute.getAttribute('aria-pressed')) === 'true');
    await unmute.click();
    check(`${width}: unmute toggles back`, await mute.isVisible());

    const replyPromise = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/search') && response.ok());
    await search.fill('squeezie');
    const reply = await (await replyPromise).json();
    const result = reply.results.find(item => item.channel.login === 'squeezie');
    check(`${width}: real survey search finds mapped Squeezie`, result?.channel.place === 'mapped', result?.channel);
    const option = page.getByRole('option').filter({ hasText: /squeezie/i }).first();
    await option.waitFor();
    await page.evaluate(() => {
      window.__carvedWaxProbe = { press: null, up: null, click: null, painted: null, transform: null, mounted: null };
      const observer = new MutationObserver(() => {
        if (document.querySelector('.atlas-card-head .atlas-face-seal') && window.__carvedWaxProbe.press !== null) {
          window.__carvedWaxProbe.mounted = performance.now();
          observer.disconnect();
        }
      });
      observer.observe(document.querySelector('.atlas'), { childList: true, subtree: true });
      for (const [type, field] of [['pointerdown', 'press'], ['pointerup', 'up'], ['click', 'click']]) {
        document.addEventListener(type, event => {
          const row = event.target.closest('.atlas-search-result');
          if (!row) return;
          window.__carvedWaxProbe[field] = performance.now();
          if (type === 'click') requestAnimationFrame(() => {
            window.__carvedWaxProbe.painted = performance.now();
            window.__carvedWaxProbe.transform = getComputedStyle(row.querySelector('.atlas-face-seal')).transform;
          });
        }, { capture: true, once: true });
      }
    });
    if (width === 390) await option.tap();
    else await option.click();
    const card = page.locator('.atlas-card');
    await card.waitFor();
    const seal = card.locator('.atlas-card-head .atlas-face-seal');
    await seal.waitFor();
    const wax = await seal.evaluate(element => {
      const animation = element.getAnimations().find(item => item.animationName === 'atlas-wax-press');
      const duration = animation?.effect?.getComputedTiming().duration;
      const pressed = animation?.effect?.getKeyframes().find(frame => {
        const match = /scale\(([\d.]+)\)/.exec(frame.transform ?? '');
        return frame.offset > 0 && match && Number(match[1]) < 1;
      });
      const probe = window.__carvedWaxProbe;
      return { ...probe, duration, pressedOffset: pressed?.computedOffset, firstPressMs: probe.mounted - probe.press + duration * pressed?.computedOffset };
    });
    check(`${width}: selected row wax paints compressed within 100 ms of pointer down`, wax.press !== null && wax.painted !== null && wax.painted - wax.press <= 100 && wax.transform !== 'none' && wax.transform !== 'matrix(1, 0, 0, 1, 0, 0)', wax);
    check(`${width}: card wax has a separate pressed keyframe`, wax.mounted !== null && wax.duration > 0 && wax.pressedOffset > 0 && wax.firstPressMs > 0, wax);
    const box = await card.boundingBox();
    check(`${width}: Squeezie card fits the viewport`, !!box && box.x >= -1 && box.y >= -1 && box.x + box.width <= width + 1 && box.y + box.height <= (width === 390 ? 845 : 901), box);
    check(`${width}: real card identifies Squeezie`, /squeezie/i.test(await card.innerText()));
    const action = card.getByRole('link', { name: /watch on twitch/i });
    const actionBox = await action.boundingBox();
    check(`${width}: Watch on Twitch is fully within the visible card`, !!actionBox && !!box && actionBox.y >= box.y && actionBox.y + actionBox.height <= box.y + box.height + 1, { card: box, action: actionBox });
    await seal.locator('img').waitFor({ state: 'visible', timeout: 10_000 }).catch(() => undefined);
    await shot(page, 'card', width);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const motion = await seal.evaluate(element => ({ seal: getComputedStyle(element).animationName, card: getComputedStyle(element.closest('.atlas-card')).animationName }));
    check(`${width}: reduced motion disables card and wax animations`, motion.seal === 'none' && motion.card === 'none', motion);
    await page.close();
  }

  // Hold the search-owned animation frames to exercise cancellation before selection commits.
  const cancelPage = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await cancelPage.goto(`${base}/map`, { waitUntil: 'domcontentloaded' });
  await settle(cancelPage);
  const cancelSearch = cancelPage.getByRole('combobox', { name: 'Find a channel' });
  for (const reason of ['query', 'Escape', 'blur']) {
    await cancelSearch.fill('squeezie');
    const option = cancelPage.getByRole('option').filter({ hasText: /squeezie/i }).first();
    await option.waitFor();
    await cancelSearch.focus();
    await option.evaluate(element => {
      window.__carvedFrames = { originalRequest: window.requestAnimationFrame, originalCancel: window.cancelAnimationFrame, callbacks: new Map(), next: 0 };
      window.requestAnimationFrame = callback => { const id = ++window.__carvedFrames.next; window.__carvedFrames.callbacks.set(id, callback); return id; };
      window.cancelAnimationFrame = id => { window.__carvedFrames.callbacks.delete(id); };
      element.click();
    });
    if (reason === 'query') await cancelSearch.fill('different query');
    else if (reason === 'Escape') await cancelPage.keyboard.press('Escape');
    else await cancelSearch.blur();
    const pending = await cancelPage.evaluate(() => {
      const frames = window.__carvedFrames;
      const count = frames.callbacks.size;
      window.requestAnimationFrame = frames.originalRequest; window.cancelAnimationFrame = frames.originalCancel;
      for (const callback of frames.callbacks.values()) callback(performance.now());
      return count;
    });
    check(`pending search selection is cancelled on ${reason}`, pending === 0 && await cancelPage.locator('.atlas-card').count() === 0, { pending });
  }
  await cancelPage.close();

  // Exercise the longer previous-UTC-day label without replacing the actual survey or capturing simulated evidence.
  const datePage = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await datePage.addInitScript(() => { const realNow = Date.now; Date.now = () => realNow() + 86_400_000; });
  await datePage.goto(`${base}/map`, { waitUntil: 'domcontentloaded' });
  await settle(datePage);
  const dated = await datePage.locator('.atlas-cartouche').evaluate(header => {
    const title = header.querySelector('.atlas-title').getBoundingClientRect();
    const seal = header.querySelector('.atlas-survey-seal').getBoundingClientRect();
    const words = header.querySelector('.atlas-survey-words').getBoundingClientRect();
    const frame = header.getBoundingClientRect();
    return { text: header.querySelector('.atlas-survey-live').textContent, title: title.toJSON(), seal: seal.toJSON(), words: words.toJSON(), frame: frame.toJSON() };
  });
  check('phone: previous-day held label remains inside cartouche without overlapping title', /\d{1,2} \w{3}/.test(dated.text) && (dated.title.right <= dated.seal.left || dated.title.bottom <= dated.seal.top) && dated.words.right <= dated.frame.right && dated.words.left >= dated.frame.left, dated);
  await datePage.close();

  // Fail only the land baker, not the survey data; never capture this induced failure.
  const missingPage = await browser.newPage({ viewport: { width: 390, height: 844 } });
  let blockedBakers = 0;
  await missingPage.route('**/assets/bake.worker-*.js', route => {
    blockedBakers++;
    return route.fulfill({ contentType: 'text/javascript', body: "self.onmessage = ({data}) => { if (data.type === 'bake') self.postMessage({type:'failed', id:data.id, message:'test bake failure'}); };" });
  });
  await missingPage.goto(`${base}/map`, { waitUntil: 'domcontentloaded' });
  const warning = missingPage.locator('[data-still-warning="missing-land"][role="status"]');
  await warning.waitFor({ timeout: 60_000 });
  check('missing land is disclosed in the compact still', blockedBakers > 0 && /incomplete/i.test(await warning.innerText()), { blockedBakers, text: await warning.innerText() });
  await missingPage.close();

  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on('pageerror', error => errors.push({ width: 1440, message: error.message }));
  await page.goto(`${base}/-/atlas-embed?mode=hero`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.__atlasBench?.handle);
  await settle(page);
  check('hero: no map cartouche intercepts the page', await page.locator('.atlas-cartouche').count() === 0);
  await shot(page, 'hero', 1440);
  await page.getByRole('button', { name: 'Turn the map' }).click();
  await page.locator('[data-chatdom-atlas][data-atlas-mode="explore"] .atlas-cartouche').waitFor();
  check('embed: hero turns into explore without remounting', await page.locator('[data-chatdom-atlas]').count() === 1);
  await shot(page, 'explore', 1440);

  // The host owns this DOM and its cleanup; atlas must dispose it on mode changes and teardown.
  await page.evaluate(() => {
    window.__carvedFooter = { mounted: 0, cleaned: 0 };
    window.__atlasBench.mount({ mode: 'explore', slots: { footer(element) {
      window.__carvedFooter.mounted++;
      const link = document.createElement('a');
      link.textContent = 'How it works'; link.href = '/how-it-works'; element.append(link);
      return () => { window.__carvedFooter.cleaned++; link.remove(); };
    } } });
  });
  await page.locator('[data-chatdom-atlas] a[href="/how-it-works"]').waitFor();
  check('embed: host footer is mounted', await page.evaluate(() => window.__carvedFooter.mounted === 1));
  await page.evaluate(() => window.__atlasBench.handle.setMode('hero'));
  check('embed: leaving explore disposes the host footer', await page.evaluate(() => window.__carvedFooter.cleaned === 1 && !document.querySelector('[data-chatdom-atlas] a[href="/how-it-works"]')));
  await page.evaluate(() => window.__atlasBench.handle.setMode('explore'));
  await page.locator('[data-chatdom-atlas] a[href="/how-it-works"]').waitFor();
  check('embed: returning to explore remounts the host footer', await page.evaluate(() => window.__carvedFooter.mounted === 2));
  await page.evaluate(() => window.__atlasBench.dispose());
  check('embed: disposal removes the map and host footer', await page.evaluate(() => window.__carvedFooter.cleaned === 2 && !document.querySelector('[data-chatdom-atlas]')));
  await page.close();
  check('no uncaught page errors', errors.length === 0, errors);
  const report = { capturedAt: new Date().toISOString(), renderer: 'dated Canvas2D still', captures, checks, pageErrors: errors };
  await writeFile(`${out}/am10-carved-checks.json`, JSON.stringify(report, null, 2) + '\n');
  const failures = checks.filter(item => !item.passed);
  console.log(JSON.stringify({ captures: captures.length, checks: checks.length, failures, pageErrors: errors }));
  if (failures.length) process.exitCode = 1;
} catch (error) {
  const report = { capturedAt: new Date().toISOString(), renderer: 'dated Canvas2D still', captures, checks, pageErrors: errors, failure: String(error?.stack ?? error) };
  await writeFile(`${out}/am10-carved-checks.json`, JSON.stringify(report, null, 2) + '\n');
  console.error(report.failure);
  process.exitCode = 1;
} finally {
  clearTimeout(deadline);
  await browser?.close();
  await release();
}
