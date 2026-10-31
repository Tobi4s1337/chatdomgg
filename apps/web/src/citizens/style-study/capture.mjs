// Avatar style study capture (spec 49). Repeatable: same bench, camera, light, fixtures and poses each run.
//
//   node apps/web/src/citizens/style-study/capture.mjs [--out shots/avatar-style/latest] [--styles current,hearthling,blockwright,storybook]
//   node apps/web/src/citizens/style-study/capture.mjs --compare <before-dir> <after-dir> [--out <dir>]
//
// Writes <style>@1920x1080.png per style, `contact-sheet.png` (every style that was captured, one labelled row
// each, full-body bands at 0.85 scale) and, with --compare, `compare-<style>.png`: before and after of the
// same view side by side. Owns a temporary Vite server on capture port 5188 under the shared capture lock.
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { acquireCaptureLock } from '../../../../../packages/testing/capture-lock.mjs';
import { assertCapturePort } from '../../../../../packages/testing/capture-ports.mjs';

const args = process.argv.slice(2);
const flag = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const compare = args.includes('--compare') ? [args[args.indexOf('--compare') + 1], args[args.indexOf('--compare') + 2]] : null;
const out = flag('--out', compare ? `${compare[1]}/compare` : 'shots/avatar-style/latest');
const styles = flag('--styles', 'current,hearthling,blockwright,storybook').split(',');
const PORT = assertCapturePort(5188);
const SIZE = { width: 1920, height: 1080 };
const NAMES = { current: ['Reference', 'Today’s citizen'], hearthling: ['Option A', 'Hearthling · chunky'], blockwright: ['Option B', 'Blockwright · blocky'], storybook: ['Option C', 'Storybook · slim'] };
const LAUNCH = { channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] };

const dataUrl = async path => `data:image/png;base64,${(await readFile(path)).toString('base64')}`;
const exists = path => access(path).then(() => true, () => false);

async function composeSheet(browser, rows, band, path) {
  const scale = .85, w = Math.round(SIZE.width * scale), h = Math.round((band.bottom - band.top) * scale);
  const html = `<!doctype html><html><body style="margin:0;background:#e4d6bb;font-family:Georgia,serif;color:#463a30;width:${w + 260}px">
    <div style="padding:26px 34px 18px"><div style="font:12px sans-serif;letter-spacing:.2em;color:#8a6a4c">SPEC 49 · AVATAR STYLE STUDY · SIMULATED REVIEW PEOPLE</div>
    <div style="font-size:30px;margin-top:6px">Same five everyday looks, same pose, camera and light: three shapes to choose from</div></div>
    ${rows.map(r => `<div style="display:flex;align-items:center;border-top:1px solid #c9b896">
      <div style="width:260px;padding:0 24px 0 34px"><div style="font:12px sans-serif;letter-spacing:.18em;color:#8a6a4c;text-transform:uppercase">${r.kicker}</div><div style="font-size:24px;margin-top:6px">${r.title}</div><div style="font:11px sans-serif;letter-spacing:.16em;margin-top:8px;color:#7a5a3c">SIMULATED</div></div>
      <div style="width:${w}px;height:${h}px;background:url(${r.url}) 0 ${-band.top * scale}px / ${w}px ${Math.round(SIZE.height * scale)}px no-repeat"></div></div>`).join('')}
    </body></html>`;
  const page = await browser.newPage({ viewport: { width: w + 260, height: 400 } });
  await page.setContent(html);
  await page.screenshot({ path, fullPage: true });
  await page.close();
}

async function composeCompare(browser, before, after, title, path) {
  const w = SIZE.width / 2, h = SIZE.height / 2;
  const cell = (label, url) => `<div><div style="font:13px sans-serif;letter-spacing:.2em;padding:10px 14px;color:#7a5a3c">${label}</div><img src="${url}" style="display:block;width:${w}px;height:${h}px"></div>`;
  const html = `<!doctype html><html><body style="margin:0;background:#e4d6bb;font-family:Georgia,serif;color:#463a30;width:${SIZE.width}px">
    <div style="padding:14px 14px 0;font-size:22px">${title} · same view and controls · SIMULATED</div>
    <div style="display:flex">${cell('BEFORE', before)}${cell('AFTER', after)}</div></body></html>`;
  const page = await browser.newPage({ viewport: { width: SIZE.width, height: 300 } });
  await page.setContent(html);
  await page.screenshot({ path, fullPage: true });
  await page.close();
}

await mkdir(out, { recursive: true });
const release = await acquireCaptureLock({ priority: 'main' });
let server, browser;
try {
  browser = await chromium.launch(LAUNCH);
  if (compare) {
    for (const style of styles) {
      const [a, b] = compare.map(dir => join(dir, `${style}@1920x1080.png`));
      if (!(await exists(a)) || !(await exists(b))) continue;
      await composeCompare(browser, await dataUrl(a), await dataUrl(b), NAMES[style].join(' · '), join(out, `compare-${style}.png`));
      console.log(`[style-study] ${join(out, `compare-${style}.png`)}`);
    }
  } else {
    server = await createServer({ root: 'apps/web', configFile: 'apps/web/vite.config.ts', logLevel: 'error', optimizeDeps: { entries: ['src/citizens/style-study/study.html'] }, server: { host: '127.0.0.1', port: PORT, strictPort: true } });
    await server.listen();
    const rows = [];
    let band = { top: Infinity, bottom: 0 };
    for (const style of styles) {
      const page = await browser.newPage({ viewport: SIZE });
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.goto(`http://127.0.0.1:${PORT}/src/citizens/style-study/study.html?style=${style}&hour=12`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.__chatdomReady === true || document.body.textContent?.startsWith('Style study failed'), {}, { timeout: 240000 });
      if (errors.length) throw new Error(`${style}: ${errors.join('\n')}`);
      const b = await page.evaluate(() => window.__studyBand);
      band = { top: Math.min(band.top, b.top), bottom: Math.max(band.bottom, b.bottom) };
      const path = join(out, `${style}@1920x1080.png`);
      await page.screenshot({ path });
      await page.close();
      rows.push({ kicker: NAMES[style][0], title: NAMES[style][1], url: await dataUrl(path) });
      console.log(`[style-study] ${path}`);
    }
    await composeSheet(browser, rows, band, join(out, 'contact-sheet.png'));
    await writeFile(join(out, 'controls.json'), `${JSON.stringify({ styles, size: SIZE, hour: 12, band, fixtures: ['hearth', 'tide', 'grove', 'clay', 'dusk'] }, null, 2)}\n`);
    console.log(`[style-study] ${join(out, 'contact-sheet.png')}`);
  }
} finally {
  await browser?.close(); await server?.close(); await release();
}
