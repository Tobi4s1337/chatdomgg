import { createServer } from 'vite';
import solid from '../../apps/web/node_modules/vite-plugin-solid/dist/esm/index.mjs';
import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { acquireCaptureLock } from './capture-lock.mjs';
import { CAPTURE_PORTS } from './capture-ports.mjs';

// These are staged public scenes assembled from a real pure growth projection and planner candidate.
const config = { configFile: false, root: process.cwd(), publicDir:'apps/web/public', plugins:[solid({hot:false})], logLevel:'error', optimizeDeps:{noDiscovery:true}, server:{hmr:false,ws:false} };
const ssr = await createServer({ ...config, server:{middlewareMode:true, hmr:false, ws:false} });
let data;
try { data = await (await ssr.ssrLoadModule('/packages/testing/growth-home/fixture.ts')).fixture(); }
finally { await ssr.close(); }
console.log(`SIMULATED ${data.plot.id}: ${data.from} → ${data.to}, ${data.qualifiedDays} qualified stream-days`);
await mkdir('shots/magic',{recursive:true});
for (const side of ['before','after']) {
  let release, server, browser;
  try {
    release = await acquireCaptureLock({signal:globalThis.AbortSignal.timeout(20*60_000)});
    for (const port of CAPTURE_PORTS) {
      try {
        server = await createServer({...config, plugins:[solid({hot:false}),{name:'growth-fixture',configureServer(s){s.middlewares.use('/fixture.json',(_req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data));});}}],server:{host:'127.0.0.1',port,strictPort:true,hmr:false,ws:false}});
        await server.listen(); break;
      } catch (error) { await server?.close(); server=undefined; if (error.code !== 'EADDRINUSE' && !/already in use/.test(error.message)) throw error; }
    }
    if (!server) throw new Error('No safe capture port available');
    const address=server.httpServer.address();
    browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--no-sandbox']});
    const page=await browser.newPage({viewport:{width:1920,height:1080},deviceScaleFactor:1});
    const errors=[];
    let rejectFailure;
    const failure = new Promise((_, reject) => { rejectFailure = reject; });
    page.on('pageerror', e => { errors.push(e.message); rejectFailure(e); });
    page.on('response', response => { if (response.status() >= 400 && /\.(?:[cm]?[jt]sx?|svg)(?:\?|$)/.test(response.url())) rejectFailure(new Error(`Asset failed: ${response.status()} ${response.url()}`)); });
    await Promise.race([page.goto(`http://127.0.0.1:${address.port}/packages/testing/growth-home/index.html?side=${side}`), failure]);
    await Promise.race([page.waitForFunction(()=>window.__chatdomReady && window.__scene?.stats?.ready && window.__scene.stats.fieldSettled, null,{timeout:240000}), failure]);
    await page.evaluate(()=>new Promise(resolve=>window.requestAnimationFrame(()=>window.requestAnimationFrame(resolve))));
    if(errors.length) throw new Error(errors.join('\n'));
    const path=`shots/magic/growth-home-${side}@1920x1080.png`;
    await page.screenshot({path,timeout:120000}); console.log(path);
  } finally {
    try { await browser?.close(); } finally {
      try { await server?.close(); } finally { await release?.(); }
    }
  }
}
