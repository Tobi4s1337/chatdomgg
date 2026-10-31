// Citizen portrait capture (spec 49). Repeatable: fixed looks, camera, light and sizes every run.
//
//   node apps/web/src/avatar-builder/capture.mjs [--out shots/avatar-style/portraits] [--sets fixtures,seeded]
//   node apps/web/src/avatar-builder/capture.mjs --compare <before-dir> <after-dir> [--out <dir>]
//
// For each set writes the bench page (`<set>-bench@1440.png`), every portrait at 512 and 128 px
// (`<set>/<nn>@512.png`, `@128.png`), `<set>-sheet.png` (4 × 5 at 500 px cells, the reference's layout) and
// `<set>-vs-reference.png` (ours beside `work/references/avatar-style/reference.png`, same scale).
// With --compare: `compare-<set>.png`, the same sheet before and after, side by side.
// Owns a temporary Vite server on capture port 5189 under the shared capture lock.
import { chromium } from '@playwright/test';
import { createServer } from 'vite';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Buffer } from 'node:buffer';
import { acquireCaptureLock } from '../../../../packages/testing/capture-lock.mjs';
import { assertCapturePort } from '../../../../packages/testing/capture-ports.mjs';

const args = process.argv.slice(2);
const flag = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const compare = args.includes('--compare') ? [args[args.indexOf('--compare') + 1], args[args.indexOf('--compare') + 2]] : null;
const out = flag('--out', compare ? `${compare[1]}/compare` : 'shots/avatar-style/portraits');
const sets = flag('--sets', 'fixtures,seeded').split(',');
const PORT = assertCapturePort(5189);
const REFERENCE = 'work/references/avatar-style/reference.png';
const LAUNCH = { channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] };

const dataUrl = async path => `data:image/png;base64,${(await readFile(path)).toString('base64')}`;
const exists = path => access(path).then(() => true, () => false);
const png = url => Buffer.from(url.slice(url.indexOf(',') + 1), 'base64');

async function shoot(browser, html, width, path) {
  const page = await browser.newPage({ viewport: { width, height: 400 } });
  await page.setContent(html, { waitUntil: 'load' });
  await page.screenshot({ path, fullPage: true });
  await page.close();
}

const grid = (urls, cell) => `<div style="display:grid;grid-template-columns:repeat(5,${cell}px)">${urls.map(u => `<img src="${u}" style="display:block;width:${cell}px;height:${cell}px">`).join('')}</div>`;

await mkdir(out, { recursive: true });
const release = await acquireCaptureLock({ priority: 'main' });
let server, browser;
try {
  browser = await chromium.launch(LAUNCH);
  if (compare) {
    for (const set of sets) {
      const [a, b] = compare.map(dir => join(dir, `${set}-sheet.png`));
      if (!(await exists(a)) || !(await exists(b))) continue;
      const cell = label => `<div><div style="font:600 18px system-ui;letter-spacing:.18em;padding:14px 18px;color:#d8c8ff">${label}</div>`;
      await shoot(browser, `<body style="margin:0;background:#1b1430;width:2520px"><div style="font:24px system-ui;color:#efe7ff;padding:16px 18px 0">${set} portraits · same looks, camera and light · SIMULATED</div>
        <div style="display:flex;gap:20px">${cell('BEFORE')}<img src="${await dataUrl(a)}" style="width:1250px;height:1000px;display:block"></div>${cell('AFTER')}<img src="${await dataUrl(b)}" style="width:1250px;height:1000px;display:block"></div></div></body>`, 2520, join(out, `compare-${set}.png`));
      console.log(`[portraits] ${join(out, `compare-${set}.png`)}`);
    }
  } else {
    server = await createServer({ root: 'apps/web', configFile: 'apps/web/vite.config.ts', logLevel: 'error', optimizeDeps: { entries: ['src/avatar-builder/portraits.html'] }, server: { host: '127.0.0.1', port: PORT, strictPort: true } });
    await server.listen();
    const reference = await dataUrl(REFERENCE);
    for (const set of sets) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      await page.goto(`http://127.0.0.1:${PORT}/src/avatar-builder/portraits.html?set=${set}`, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => window.__chatdomReady === true, {}, { timeout: 300000 });
      if (errors.length) throw new Error(`${set}: ${errors.join('\n')}`);
      await page.screenshot({ path: join(out, `${set}-bench@1440.png`), fullPage: true });
      const portraits = await page.evaluate(() => window.__portraits);
      await page.close();
      await mkdir(join(out, set), { recursive: true });
      for (const [i, p] of portraits.entries()) {
        const n = String(i + 1).padStart(2, '0');
        await writeFile(join(out, set, `${n}@512.png`), png(p.p512));
        await writeFile(join(out, set, `${n}@128.png`), png(p.p128));
      }
      await writeFile(join(out, set, 'looks.json'), `${JSON.stringify(portraits.map(p => ({ name: p.name, look: p.look })), null, 2)}\n`);
      const urls = portraits.map(p => p.p512);
      await shoot(browser, `<body style="margin:0;width:2500px">${grid(urls, 500)}</body>`, 2500, join(out, `${set}-sheet.png`));
      const label = text => `<div style="font:600 20px system-ui;letter-spacing:.2em;padding:16px 4px 12px;color:#d8c8ff">${text}</div>`;
      await shoot(browser, `<body style="margin:0;background:#1b1430;padding:0 20px 20px;width:2560px"><div style="display:flex;gap:20px">
        <div>${label(`OURS · ${set.toUpperCase()} · SIMULATED`)}${grid(urls, 250)}</div>
        <div>${label('REFERENCE')}<img src="${reference}" style="display:block;width:1250px;height:1000px"></div></div></body>`, 2560, join(out, `${set}-vs-reference.png`));
      console.log(`[portraits] ${join(out, `${set}-vs-reference.png`)}`);
    }
  }
} finally {
  await browser?.close(); await server?.close(); await release();
}
