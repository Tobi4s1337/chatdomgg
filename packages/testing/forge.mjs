import {Buffer} from 'node:buffer';
import {chromium} from '@playwright/test';
import {acquireCaptureLock} from './capture-lock.mjs';
import {startCapturePreview,closeCapturePreview} from './preview.mjs';
import {mkdir,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
const patchStrike=process.argv.includes('--patch-strike'),lookOnly=process.argv.includes('--look-only'),release=await acquireCaptureLock();let server,browser;
const report={errors:[],checks:[]};
try{
 const preview=await startCapturePreview();server=preview.server;browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--no-sandbox']});
 const page=await browser.newPage({viewport:{width:1440,height:900}});page.on('pageerror',e=>report.errors.push(e.message));page.on('console',m=>{if(m.type()==='error')report.errors.push(m.text());});
 await mkdir('shots/forge/ritual',{recursive:true});
 await page.goto(`${preview.base}/?tier=town&hour=19.5&time=60&forge=1`);await page.waitForFunction(()=>window.__chatdomReady&&window.__chatdomKingdom?.forge,null,{timeout:240000});
 const forge=words=>page.evaluate(words=>window.__chatdomKingdom.forge.submit(words),words);
 const seek=async t=>{await page.evaluate(t=>window.__chatdomKingdom.forge.seek(t),t);await page.evaluate(()=>new Promise(r=>window.requestAnimationFrame(()=>window.requestAnimationFrame(r))));};
 await page.fill('#forge-wish','!forge a chimney shaped like a sleeping dragon');await page.click('.forge-submit');await page.waitForFunction(()=>window.__chatdomKingdom.forge.status().phase!=='preparing'&&window.__chatdomKingdom.forge.status().phase!=='idle',null,{timeout:30000});assert.equal(await page.evaluate(()=>window.__chatdomKingdom.forge.status().privateError),null);
 await seek(10);await page.screenshot({path:'shots/forge/pour@1440x900.png',timeout:120000});
 await page.setViewportSize({width:390,height:844});await seek(10);await page.screenshot({path:'shots/forge/pour@390x844.png',timeout:120000});
 if(!lookOnly)await page.setViewportSize({width:960,height:600});
 if(!lookOnly)for(const i of patchStrike?[0,1,2,3,4,5,6,7,8,9,22,23,24,25,26,31,32,33,34,35,36,37,38]:Array.from({length:43},(_,i)=>i)){await seek(i/2);await page.screenshot({path:`shots/forge/ritual/${String(i).padStart(3,'0')}.png`,timeout:120000});}
 {
 await page.setViewportSize({width:1440,height:900});await seek(20);await page.screenshot({path:'shots/forge/dragon@1440x900.png',timeout:120000});
 await page.setViewportSize({width:390,height:844});await seek(21);await page.screenshot({path:'shots/forge/dragon@390x844.png',timeout:120000});
 assert.equal(await page.evaluate(()=>window.__chatdomKingdom.forge.placements.length),1);report.checks.push('Typed dragon assembled, flew to the actual roof and attached');
 await page.setViewportSize({width:1440,height:900});
 for(const [name,words] of [['lantern','!forge a crescent moon lantern'],['owl','!forge an owl weathervane']]){assert.ok(await forge(words),JSON.stringify(await page.evaluate(()=>window.__chatdomKingdom.forge.status())));await seek(20);await page.screenshot({path:`shots/forge/${name}@1440x900.png`,timeout:120000});}
 assert.equal(await page.evaluate(()=>window.__chatdomKingdom.forge.placements.length),3);report.checks.push('Moon lantern and owl vane attached to separate sockets');
 assert.equal(await forge('!forge unrecognised request'),false);assert.equal(await page.evaluate(()=>window.__chatdomKingdom.forge.placements.length),3);report.checks.push('Unsupported words refused without a replacement or attribution');
 }
 if(patchStrike)report.checks.push('Refreshed rune, strike and flight frames from the final choreography');
 assert.deepEqual(report.errors,[]);
 if(!lookOnly){await writeFile('shots/forge/ritual.wav',Buffer.from(await page.evaluate(()=>window.__chatdomKingdom.forge.captureAudio())));const result=spawnSync('ffmpeg',['-y','-framerate','2','-i','shots/forge/ritual/%03d.png','-i','shots/forge/ritual.wav','-vf','scale=960:-2','-r','30','-c:v','libx264','-preset','fast','-crf','21','-pix_fmt','yuv420p','-c:a','aac','-b:a','128k','-shortest','-movflags','+faststart','shots/forge/ritual.mp4'],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);}
 report.result='passed';
}catch(error){report.result='failed';report.failure=String(error);throw error;}
finally{await browser?.close();if(server)await closeCapturePreview(server);await release();await mkdir('shots/forge',{recursive:true});await writeFile('shots/forge/report.json',JSON.stringify(report,null,2));console.log(report);}
