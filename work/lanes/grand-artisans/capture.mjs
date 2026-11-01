/** Parent-owned resumable art reviews: one still per canonical capture lease. */
import { chromium } from '@playwright/test';
import { leaseCaptureServer } from './capture-server.mjs';
import { canResume, readCaptureRecords, publishCaptureRecord } from './capture-records.mjs';
import { appendFile, mkdir, readFile, readdir, rename } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
const list = (key, fallback) => (process.env[key] ?? fallback).split(',');
const directory = process.env.ARTISAN_OUTPUT ?? 'shots/grand-artisans';
const reviewPath = process.env.ARTISAN_REVIEW_PATH ?? '/src/grand/artisans/review.html';
if (!/^\/src\/grand\/artisans\/[a-z0-9/-]+\.html$/.test(reviewPath)) throw new Error('Review path must name an artisan HTML view');
await mkdir(directory, { recursive: true });
const tasks = [];
if (process.env.ARTISAN_TASKS) tasks.push(...JSON.parse(await readFile(process.env.ARTISAN_TASKS, 'utf8')));
else for (const kit of list('ARTISAN_KITS','tree,forest,geology,water,windmill,fields,ship,lighthouse,harbour,citadel,walls'))
  for (const channel of list('ARTISAN_CHANNELS','tobi4s_')) for (const view of list('ARTISAN_VIEWS','hero'))
  for (const lod of list('ARTISAN_LODS','0')) for (const size of list('ARTISAN_SIZES','1440x900'))
  for (const species of (['forest','tree'].includes(kit) ? list('ARTISAN_SPECIES','gold') : ['gold']))
  for (const shadows of list('ARTISAN_SHADOWS','on')) {
    tasks.push({kit,channel,view,lod,size,species,shadows});
    if (process.env.ARTISAN_ORBIT === '1') for (let orbit = 0; orbit < 12; orbit++) tasks.push({kit,channel,view,lod,size,species,shadows,orbit});
  }
// Source bytes identify each still, including dirty source, so a resumed queue cannot
// silently reuse a picture from another model. There is no PID or timeout liveness guess.
async function fingerprint(cwd, kit) {
  const hash = createHash('sha256');
  async function visit(relative) {
    const path = resolve(cwd, relative);
    for (const item of (await readdir(path, {withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))) {
      const child = `${relative}/${item.name}`;
      if (item.isDirectory()) await visit(child);
      else if (item.isFile() && /\.(?:ts|tsx|html|css)$/.test(item.name) && !item.name.includes('.test.')) {
        hash.update(child); hash.update(await readFile(resolve(cwd,child)));
      }
    }
  }
  const folder = ({tree:'forest',forest:'forest',water:'geology',geology:'geology',windmill:'fields',fields:'fields',ship:'harbour',lighthouse:'harbour',harbour:'harbour',quay:'harbour',pier:'harbour',landing:'harbour',citadel:'citadel',walls:'citadel'})[kit];
  await visit(`packages/world/src/grand/artisans${folder?'/'+folder:''}`);
  hash.update(await readFile(resolve(cwd,'packages/world/src/grand/artisans/kit.ts')));
  await visit('apps/web/src/grand/artisans');
  if (kit === 'composition') await visit('packages/content/src');
  if (kit === 'source-fields' || kit === 'source-water') {
    await visit('packages/world/src/grand');
    await visit('packages/render/src/grand');
    await visit('packages/voxel/src/grand');
    hash.update(await readFile(resolve(cwd,'apps/web/src/grand/channels.ts')));
  }
  for (const relative of ['pnpm-lock.yaml','package.json','apps/web/package.json','apps/web/vite.config.ts']) {
    hash.update(relative);
    try { hash.update(await readFile(resolve(cwd,relative))); }
    catch(error) { if(error.code !== 'ENOENT') throw error; hash.update('absent'); }
  }
  return hash.digest('hex');
}
const log = `${directory}/capture-log.jsonl`;
const previous=await readCaptureRecords(directory);
for (const input of tasks) {
  const task = {channel:'tobi4s_',view:'hero',lod:'0',size:'1440x900',species:'gold',shadows:'on',...input};
  const {kit,channel,view,lod,size,species,shadows,orbit} = task;
  const cwd = resolve(task.cwd ?? process.env.ARTISAN_REVIEW_CWD ?? '.');
  const key = JSON.stringify({...task,cwd,...(reviewPath === '/src/grand/artisans/review.html' ? {} : {reviewPath})});
  const sourceHash = await fingerprint(cwd,kit);
  const basename = `${directory}/${kit}-${channel}-${['forest','tree'].includes(kit)?species+'-':''}${view}-lod${lod}${shadows==='off'?'-shadow-off':''}${orbit===undefined?'':`-orbit-${String(orbit).padStart(2,'0')}`}@${size}.png`;
  const prior=previous.findLast(record=>record.key===key && record.sourceHash===sourceHash);
  const imageHash=prior && await readFile(prior.path).then(bytes=>createHash('sha256').update(bytes).digest('hex'),error=>{if(error.code !== 'ENOENT') throw error;return undefined;});
  if(process.env.ARTISAN_RESUME==='1' && prior && canResume(previous,{path:prior.path,key,sourceHash,imageHash})) {
    console.log(`[capture] resume: ${prior.path}`); continue;
  }
  console.log(`[capture] queued still: ${basename}`);
  const {release,server}=await leaseCaptureServer(cwd); let browser;
  try {
    // Source can change while a ticket waits. Identify what the browser actually reads.
    const capturedSourceHash = await fingerprint(cwd,kit);
    browser = await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--no-sandbox']});
    const [width,height] = size.split('x').map(Number);
    const page = await browser.newPage({viewport:{width,height},deviceScaleFactor:1});
    // Standalone review HTML has no favicon. Handle only that browser request;
    // real missing modules/assets and shader diagnostics remain fatal.
    await page.route('**/favicon.ico',route=>route.fulfill({status:204,body:''}));
    const errors=[]; page.on('pageerror',error=>errors.push(error.message));
    page.on('console',message=>{ if(message.type()==='error')errors.push(message.text()); });
    const params = new URLSearchParams({kit,channel,species,view,lod:String(lod),shadows,hour:view==='dusk'?'19':'17'});
    if (task.crop) params.set('crop', task.crop);
    await page.goto(`http://127.0.0.1:${server.port}${reviewPath}?${params}`,{waitUntil:'networkidle'});
    await page.waitForFunction(()=>window.__chatdomReady===true,undefined,{timeout:90000});
    if (orbit !== undefined) await page.evaluate(({frame})=>window.__artisanReview.setOrbit(frame*Math.PI*2/12,.8+frame/12*.7),{frame:orbit});
    if(errors.length) throw new Error(errors.join('\n'));
    const identity=createHash('sha256').update(key).digest('hex').slice(0,10);
    const path=basename.replace(/\.png$/,`-${identity}-${capturedSourceHash.slice(0,12)}-${randomUUID().slice(0,8)}.png`);
    const temporary=path.replace(/\.png$/,'.pending.png');
    const result=await page.evaluate(()=>window.__artisanReview.stats);
    await page.screenshot({path:temporary});
    if(await fingerprint(cwd,kit)!==capturedSourceHash) throw new Error('Review source changed during capture; pending still not published');
    await rename(temporary,path);
    const imageHash=createHash('sha256').update(await readFile(path)).digest('hex');
    const record={path,key,sourceHash:capturedSourceHash,imageHash,...result,capturedAt:new Date().toISOString()};
    await publishCaptureRecord(record);
    await appendFile(log,JSON.stringify(record)+'\n'); previous.push(record); console.log(JSON.stringify(record));
  } finally {
    try { await browser?.close(); } finally { try { await server?.stop(); } finally { await release(); } }
  }
}
