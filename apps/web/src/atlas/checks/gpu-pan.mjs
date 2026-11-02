/* global performance, requestAnimationFrame */
// Frame pacing while a hand pans the map, on Tobias's real-GPU Chrome. Run only inside `chatdom-pc-lease`, with the
// build served on 127.0.0.1:5192 (his tunnel forwards it as localhost:5192). Opens one page of its own, closes it,
// and never closes or reconfigures his browser.
//   node src/atlas/checks/gpu-pan.mjs '/map' 1920x1080 [seconds]
import { chromium } from '@playwright/test';

const CDP = process.env.CHATDOM_PC_CDP ?? 'http://127.0.0.1:9333';
const path = process.argv[2] ?? '/map';
const [width, height] = (process.argv[3] ?? '1920x1080').split('x').map(Number);
const seconds = Number(process.argv[4] ?? 8);

const version = await fetch(`${CDP}/json/version`).then(r => r.json());
// Chrome reports its own port; go through the tunnel's end instead.
const ws = version.webSocketDebuggerUrl.replace(/^ws:\/\/[^/]+/, CDP.replace(/^http/, 'ws'));
const browser = await chromium.connectOverCDP(ws);
const context = browser.contexts()[0];
const page = await context.newPage();
let result;
try {
  await page.setViewportSize({ width, height });
  await page.bringToFront();
  await page.goto(`http://localhost:5192${path}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__chatdomReady === true, null, { timeout: 60_000 });
  await page.waitForSelector('[data-atlas-ready="map"]', { timeout: 60_000 });
  const settled = await page.waitForSelector('[data-atlas-live-work="done"]', { timeout: 60_000 }).then(() => true, () => false);
  await page.waitForTimeout(1_000);
  const before = await page.evaluate(() => window.__chatdomAtlas?.stats()?.camera ?? null);
  await page.evaluate((ms) => {
    const t = [];
    let last = performance.now();
    const end = last + ms;
    window.__pan = new Promise((resolve) => {
      const frame = (now) => {
        t.push(now - last);
        last = now;
        if (now < end) return requestAnimationFrame(frame);
        t.shift();
        const s = [...t].sort((a, b) => a - b);
        const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
        const avg = t.reduce((a, b) => a + b, 0) / t.length;
        resolve({ frames: t.length, fps: 1000 / avg, p50: q(0.5), p95: q(0.95), p99: q(0.99), worst: s.at(-1), over17: t.filter(x => x > 17.5).length, over33: t.filter(x => x > 33.4).length, visible: document.visibilityState });
      };
      requestAnimationFrame(frame);
    });
  }, seconds * 1000);
  // Slow hand pans back and forth through the middle of the map, as long as the sample runs.
  const cx = width / 2;
  const cy = height / 2;
  const reach = Math.min(width, height) * 0.3;
  const stop = Date.now() + seconds * 1000 - 200;
  let legs = 0;
  while (Date.now() < stop) {
    const dir = legs++ % 2 ? -1 : 1;
    await page.mouse.move(cx - dir * reach, cy - dir * reach * 0.4);
    await page.mouse.down();
    for (let i = 1; i <= 40 && Date.now() < stop; i++) await page.mouse.move(cx - dir * reach + dir * i * 2 * reach / 40, cy - dir * reach * 0.4 + dir * i * 0.8 * reach / 40);
    await page.mouse.up();
  }
  const frames = await page.evaluate(() => window.__pan);
  const after = await page.evaluate(() => window.__chatdomAtlas?.stats()?.camera ?? null);
  result = { path, width, height, seconds, settled, legs, moved: !!(before && after && (before.x !== after.x || before.y !== after.y)), ...frames };
} finally {
  await page.close().catch(() => {});
}
const ms = (x) => `${x.toFixed(1)}ms`;
console.log(`${path} · ${width}x${height} · pan ${result.legs} legs · moved ${result.moved} · settled ${result.settled} · ${result.fps.toFixed(1)} fps over ${result.frames} frames · p50 ${ms(result.p50)} · p95 ${ms(result.p95)} · p99 ${ms(result.p99)} · worst ${ms(result.worst)} · ${result.over17} over 17.5ms · ${result.over33} over 33ms · ${result.visible}`);
process.exit(0);
