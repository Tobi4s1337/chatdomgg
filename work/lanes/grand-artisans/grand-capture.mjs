/** Actual builder renderer in a disposable adoption candidate; one still/short orbit per lock. */
import { acquireArtisanCapture } from './capture-lease.mjs';
import { chromium } from '@playwright/test';
import { startCaptureServer } from './capture-server.mjs';
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
const directory='shots/grand-artisans/in-land'; await mkdir(directory,{recursive:true});
const channels=(process.env.ARTISAN_CHANNELS ?? 'tobi4s_,the_aggman,pinkkittyrose,mashad4').split(',');
const views=(process.env.ARTISAN_VIEWS ?? 'orbit,castle,harbour,fields,summit,mere').split(',');
const sizes=(process.env.ARTISAN_SIZES ?? '1440x900').split(',');
const stats=[];
for(const channel of channels) for(const view of views) for(const size of sizes) {
  const release=await acquireArtisanCapture(); let server,browser;
  try {
    server=await startCaptureServer('/tmp/grand-artisans-candidate');
    browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--no-sandbox']});
    const [width,height]=size.split('x').map(Number),page=await browser.newPage({viewport:{width,height},deviceScaleFactor:1});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    const hour=process.env.ARTISAN_HOUR ?? '17.6';
    await page.goto(`http://127.0.0.1:${server.port}/-/grand?channel=${channel}&view=${view}&hour=${hour}&tier=software&capture=1&t=0&still=1`,{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>window.__chatdomReady===true,undefined,{timeout:360000});
    if(errors.length)throw new Error(errors.join('\n'));
    // Clean builder captures hide its chrome. Keep the independent study's status visible.
    await page.evaluate(()=>{
      const label=document.createElement('div');label.textContent='SIMULATED · GRAND LAND STUDY';
      Object.assign(label.style,{position:'fixed',left:'16px',top:'16px',padding:'10px 14px',background:'#e4d2b4',color:'#4f3d3e',border:'3px double #967a56',font:'bold 13px Georgia,serif',letterSpacing:'.08em',zIndex:'2147483647',pointerEvents:'none'});
      document.body.appendChild(label);
    });
    const path=`${directory}/${channel}-${view}-hour${hour}@${size}.png`;
    await page.screenshot({path});
    const result=await page.evaluate(()=>window.__chatdomGrand.stats());
    const record={path,...result,capturedAt:new Date().toISOString()};stats.push(record);
    await appendFile(`${directory}/capture-log.jsonl`,JSON.stringify(record)+'\n');console.log(JSON.stringify(record));
  }finally{
    try { await browser?.close(); } finally { try { await server?.stop(); } finally { await release(); } }
  }
}
await writeFile(`${directory}/stats-${Date.now()}.json`,JSON.stringify(stats,null,2));
