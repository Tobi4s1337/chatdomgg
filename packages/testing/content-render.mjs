/* global URLSearchParams:readonly, Image:readonly */
import { chromium } from '@playwright/test';
import { acquireCaptureLock } from './capture-lock.mjs';
import { createServer } from 'vite';
import { startCapturePreview, closeCapturePreview } from './preview.mjs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const option = name => { const i=args.indexOf(name);return i<0?undefined:args[i+1]; };
const collection=option('--collection')??'core';
const assetFilter=option('--asset');
const styleFilter=option('--style');
if(styleFilter&&!['hearth','tide','grove'].includes(styleFilter)) throw new Error('Unknown --style.');
const scene=option('--scene')??'asset';
const presence=option('--presence')??'none';
if(!['asset','castle','mixed','threshold','windows','joins-hearth','joins-tide','civic-square-hearth','civic-square-tide'].includes(scene)) throw new Error('Unknown --scene.');
const assembly=scene==='mixed'||scene==='castle'||scene.startsWith('joins-')||scene.startsWith('civic-square-');
if(!['none','on','off'].includes(presence)||(presence!=='none'&&scene!=='windows')||(scene==='windows'&&presence==='none')) throw new Error('Use --scene windows with --presence on or off.');
const hour=option('--hour')??'19';
if (!/^(?:[01]?\d|2[0-3])(?:\.\d+)?$/.test(hour)) throw new Error('--hour must be in [0,24).');
const root=fileURLToPath(new URL('../..',import.meta.url));
let loader,server,browser,release;
const escape=value=>value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
try {
  release = await acquireCaptureLock();
  loader=await createServer({root,configFile:false,server:{middlewareMode:true,hmr:false,ws:false},appType:'custom'});
  const {loadContentCollection,coreRenderAssets}=await loader.ssrLoadModule('/packages/content/src/catalogue.ts');
  const collectionAssets=await loadContentCollection(collection);
  let assets=assetFilter?collectionAssets.filter(asset=>asset.id===assetFilter):collection==='core'&&!args.includes('--all')?coreRenderAssets(collectionAssets):collectionAssets;
  if(styleFilter) assets=assets.filter(asset=>asset.styleId===styleFilter);
  if(assembly) assets=assets.slice(0,1);
  if(!assets.length) throw new Error(`No asset ${assetFilter} exists in ${collection}.`);
  await loader.close();loader=undefined;
  let base=option('--base-url');
  if(!base) ({server,base}=await startCapturePreview('CHATDOM_CONTENT_PORT'));
  browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--no-sandbox']});
  const suffix=scene==='asset'?'':`/${scene}${presence==='none'?'':`-${presence}`}`;
  const output=`shots/content/${collection}${styleFilter?`/style-${styleFilter}`:''}${suffix}${assetFilter?`/asset-${assetFilter}`:''}${hour==='19'?'':`/hour-${hour}`}`;
  await mkdir(output,{recursive:true});
  const page=await browser.newPage({viewport:{width:480,height:480}});
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error')errors.push(`${message.text()} ${message.location().url}`);});
  const pictures=[],stats=[];
  for(const asset of assets) {
    const query=new URLSearchParams({collection,asset:asset.id,angle:'front',scene,presence,hour,seed:'chatdom-content'});
    await page.goto(`${base}/-/content?${query}`,{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>window.__chatdomReady===true||typeof window.__chatdomContentError==='string',{},{timeout:240_000});
    const error=await page.evaluate(()=>window.__chatdomContentError);
    if(error)throw new Error(error);
    const marker=assembly?`[data-scene="${scene}"]`:`[data-asset="${asset.id}"]`;
    if(await page.locator(marker).count()!==1)throw new Error(`Content renderer did not expose requested scene/asset ${scene}/${asset.id}.`);
    const views=scene==='asset'||scene==='castle'?['front','side','back']:['front'];
    const sizes=scene==='castle'?[[1440,900],[390,844]]:assembly?[[1440,900],[390,844],[1920,1080]]:[[480,480]];
    for(const angle of views) for(const [width,height] of sizes) {
      await page.setViewportSize({width,height});
      await page.evaluate(angle=>window.__chatdomContentView(angle),angle);
      await page.waitForFunction(angle=>window.__chatdomReady===true&&window.__chatdomContent?.angle===angle,angle);
      if(errors.length)throw new Error(errors.join('\n'));
      const measured=await page.evaluate(()=>window.__chatdomContent);
      if(measured?.scene!==scene||measured?.presence!==presence) throw new Error('Content build is stale: scene/presence did not match. Run pnpm build.');
      if(scene==='asset'&&measured.draws!==1) throw new Error(`${asset.id}: expected one measured model draw, got ${measured.draws}.`);
      if(!(measured.triangles>0)) throw new Error(`${asset.id}: renderer returned empty geometry.`);
      const label=scene==='asset'||scene==='threshold'||scene==='windows'?asset.id:scene;
      const path=`${output}/${label}-${angle}@${width}x${height}.png`;
      await page.screenshot({path});
      pictures.push({asset:label,angle,path,data:(await readFile(path)).toString('base64')});
      stats.push({...measured,width,height,path});
    }
    console.log(`Rendered ${scene}: ${asset.id}.`);
  }
  await page.close();
  const makeSheet=(width,columns)=>{
    const tile=width/columns,height=80+Math.ceil(pictures.length/columns)*(tile+26);
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#292830"/><text x="20" y="32" fill="#eadfc8" font-family="Georgia" font-size="${width<500?17:22}">Chatdom · ${escape(collection)} · ${escape(scene)} · ${escape(hour)}:00</text><text x="20" y="57" fill="#c6b493" font-family="Georgia" font-size="${width<500?9:13}">Production voxel pipeline · ${presence==='none'?'unoccupied models':`SIMULATED window presence ${presence.toUpperCase()}`}</text>${pictures.map((p,i)=>{const x=(i%columns)*tile,y=80+Math.floor(i/columns)*(tile+26);return `<image x="${x}" y="${y}" width="${tile}" height="${tile}" href="data:image/png;base64,${p.data}"/><text x="${x+8}" y="${y+tile+14}" fill="#eadfc8" font-family="Georgia" font-size="${width<500?8:10}">${escape(p.asset)} · ${p.angle}</text>`;}).join('')}</svg>`;
  };
  const svg=makeSheet(1440,6);
  await writeFile(`${output}/contact-sheet.svg`,svg);
  await writeFile(`${output}/render-stats.json`,JSON.stringify({collection,scene,presence,style:styleFilter??null,hour:Number(hour),scope:assembly?'fixture':assetFilter?'filtered':styleFilter?'style':collection==='core'&&!args.includes('--all')?'representative':'all',assets:stats},null,2)+'\n');
  for(const [width,height] of [[1440,900],[390,844]]) {
    const sheet=await browser.newPage({viewport:{width,height}});
    await sheet.setContent(`<html><body style="margin:0;background:#292830">${makeSheet(width,width<500?2:6)}</body></html>`);
    await sheet.locator('svg image').evaluateAll(images=>Promise.all(images.map(image=>new Promise((resolve,reject)=>{const probe=new Image();probe.onload=resolve;probe.onerror=reject;probe.src=image.getAttribute('href');}))));
    await sheet.screenshot({path:`${output}/contact-sheet@${width}x${height}.png`,fullPage:true});
    await sheet.close();
  }
  console.log(`Rendered ${assets.length} selected ${assembly?'fixtures':'assets'} / ${pictures.length} views. Contact sheets: ${output}/contact-sheet.svg and contact-sheet@1440x900.png / @390x844.png`);
} catch(error) {
  console.error(error instanceof Error?error.message:String(error));process.exitCode=1;
} finally {
  try { await browser?.close(); } finally {
    try { await loader?.close(); } finally {
      try { if(server) await closeCapturePreview(server); } finally { await release?.(); }
    }
  }
}
