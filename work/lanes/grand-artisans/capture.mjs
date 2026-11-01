import { acquireArtisanCapture } from './capture-lease.mjs';
import { chromium } from '@playwright/test';
import { startCaptureServer } from './capture-server.mjs';
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
const kits = (process.env.ARTISAN_KITS ?? 'tree,forest,geology,water,windmill,fields,ship,lighthouse,harbour,citadel,walls').split(',');
const views = (process.env.ARTISAN_VIEWS ?? 'hero').split(',');
const channels = (process.env.ARTISAN_CHANNELS ?? 'tobi4s_').split(',');
const lods = (process.env.ARTISAN_LODS ?? '0').split(',');
const sizes = (process.env.ARTISAN_SIZES ?? '1440x900').split(',');
const speciesList = (process.env.ARTISAN_SPECIES ?? 'gold').split(',');
const shadowsList = (process.env.ARTISAN_SHADOWS ?? 'on').split(',');
const directory = 'shots/grand-artisans'; await mkdir(directory, { recursive: true });
const stats = [];
for (const kit of kits) for (const channel of channels) for (const view of views) for (const lod of lods) for (const size of sizes) for (const species of (['forest','tree'].includes(kit) ? speciesList : ['gold'])) for (const shadows of shadowsList) {
  const release = await acquireArtisanCapture(); let browser, server;
  try {
    server = await startCaptureServer();
    browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--no-sandbox'] });
    const [width,height] = size.split('x').map(Number);
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.port}/src/grand/artisans/review.html?kit=${kit}&channel=${channel}&species=${species}&view=${view}&lod=${lod}&shadows=${shadows}&hour=${view==='dusk'?19:17}`, { waitUntil:'networkidle' });
    await page.waitForFunction(() => window.__chatdomReady === true, undefined, { timeout: 90000 });
    if (errors.length) throw new Error(errors.join('\n'));
    const path = `${directory}/${kit}-${channel}-${['forest','tree'].includes(kit)?species+'-':''}${view}-lod${lod}${shadows==='off'?'-shadow-off':''}@${size}.png`;
    await page.screenshot({ path });
    const result = await page.evaluate(() => window.__artisanReview.stats);
    const record={path,...result,capturedAt:new Date().toISOString()};
    stats.push(record); await appendFile(`${directory}/capture-log.jsonl`,JSON.stringify(record)+'\n'); console.log(JSON.stringify(record));
    if (process.env.ARTISAN_ORBIT === '1') {
      // A short moving camera review through near and far distances; samples are kept for contact review.
      for (let frame = 0; frame < 12; frame++) {
        await page.evaluate(({frame}) => window.__artisanReview.setOrbit(frame*Math.PI*2/12, .8+frame/12*.7), {frame});
        await page.screenshot({path:path.replace(/\.png$/,`-orbit-${String(frame).padStart(2,'0')}.png`)});
      }
    }
  } finally {
    try { await browser?.close(); } finally { try { await server?.stop(); } finally { await release(); } }
  }
}
await writeFile(`${directory}/stats-${Date.now()}.json`, JSON.stringify(stats,null,2));
