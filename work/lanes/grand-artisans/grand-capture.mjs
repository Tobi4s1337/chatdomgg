/** Actual builder renderer in a disposable adoption candidate; one still/short orbit per lock. */
import { acquireCaptureLock } from '../../../packages/testing/capture-lock.mjs';
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
const directory='shots/grand-artisans/in-land'; await mkdir(directory,{recursive:true});
const channels=(process.env.ARTISAN_CHANNELS ?? 'tobi4s_,the_aggman,pinkkittyrose,mashad4').split(',');
const views=(process.env.ARTISAN_VIEWS ?? 'orbit,castle,harbour,fields,summit,mere').split(',');
const sizes=(process.env.ARTISAN_SIZES ?? '1440x900').split(',');
const stats=[];
for(const channel of channels) for(const view of views) for(const size of sizes) {
  const release=await acquireCaptureLock(); let server,browser;
  try {
    server=spawn('pnpm',['--filter','@chatdom/web','exec','vite','--port','5180','--strictPort'],{cwd:'/tmp/grand-artisans-candidate',stdio:['ignore','pipe','pipe'],detached:true});
    let log=''; server.stderr.on('data',b=>{log+=b;});
    await new Promise((resolve,reject)=>{ const timer=setTimeout(()=>reject(new Error('Startup timeout '+log)),20000); server.stdout.on('data',b=>{if(b.toString().includes('Local:')){clearTimeout(timer);resolve();}});server.once('exit',code=>{clearTimeout(timer);reject(new Error(`Vite ${code}: ${log}`));}); });
    browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--no-sandbox']});
    const [width,height]=size.split('x').map(Number),page=await browser.newPage({viewport:{width,height},deviceScaleFactor:1});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    const hour=process.env.ARTISAN_HOUR ?? '17.6';
    await page.goto(`http://127.0.0.1:5180/-/grand?channel=${channel}&view=${view}&hour=${hour}&tier=software&capture=1&t=0&still=1`,{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>window.__chatdomReady===true,undefined,{timeout:360000});
    if(errors.length)throw new Error(errors.join('\n'));
    const path=`${directory}/${channel}-${view}-hour${hour}@${size}.png`;
    await page.screenshot({path});
    const result=await page.evaluate(()=>window.__chatdomGrand.stats());stats.push({path,...result});console.log(JSON.stringify({path,...result}));
  }finally{
    await browser?.close();
    if(server){process.kill(-server.pid,'SIGTERM');await new Promise(resolve=>server.once('close',resolve));}
    await release();
  }
}
await writeFile(`${directory}/stats-${Date.now()}.json`,JSON.stringify(stats,null,2));
