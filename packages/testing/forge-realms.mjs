import {chromium} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {acquireCaptureLock} from './capture-lock.mjs';
import {startCapturePreview,closeCapturePreview} from './preview.mjs';
const release=await acquireCaptureLock();let browser,server;const errors=[],checks=[];
try{
 const preview=await startCapturePreview();server=preview.server;browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--no-sandbox']});
 const page=await browser.newPage({viewport:{width:1440,height:900}});page.on('pageerror',e=>errors.push(e.message));await mkdir('shots/forge',{recursive:true});
 await page.goto(`${preview.base}/?tier=town&hour=19.5&time=60&forge=1&realm=hearth`);await page.waitForFunction(()=>window.__chatdomReady&&window.__chatdomKingdom?.forge,null,{timeout:240000});
 await page.fill('#forge-wish','!forge a chimney shaped like a sleeping dragon');await page.click('.forge-submit');await page.waitForFunction(()=>window.__chatdomKingdom.forge.status().phase!=='preparing'&&(window.__chatdomKingdom.forge.status().privateError!==null||window.__chatdomKingdom.forge.status().phase!=='idle'),null,{timeout:30000});
 assert.equal(await page.evaluate(()=>window.__chatdomKingdom.forge.status().privateError),null);
 await page.evaluate(()=>window.__chatdomKingdom.forge.seek(20));await page.waitForFunction(()=>window.__chatdomKingdom.forge.placements.length===1);
 const receipt=await page.evaluate(()=>window.__chatdomKingdom.forge.placements[0]);assert.equal(receipt.kitId,'hearth-native');assert.equal(receipt.provenance.kingdomName,'Emberwick');assert.equal(receipt.provenance.makerName,'Juniper');
 await page.screenshot({path:'shots/forge/emberwick-dragon@1440x900.png',timeout:120000});checks.push('Same typed dragon wish attaches in Emberwick using its fixed Hearth kit and records its maker/origin');
 await page.reload();await page.waitForFunction(()=>window.__chatdomReady&&window.__chatdomKingdom?.forge,null,{timeout:240000});assert.equal(await page.evaluate(()=>window.__chatdomKingdom.forge.placements[0]?.provenance?.designId),receipt.provenance.designId);checks.push('Retained piece and first-forger lineage survive reload');
 await page.fill('#forge-wish','!forge unrecognised request');await page.click('.forge-submit');await page.waitForFunction(()=>window.__chatdomKingdom.forge.status().phase==='refusal');await page.screenshot({path:'shots/forge/refusal@1440x900.png',timeout:120000});assert.equal(await page.evaluate(()=>window.__chatdomKingdom.forge.placements.length),1);checks.push('Refusal leaves the retained home piece intact');assert.deepEqual(errors,[]);
}finally{await browser?.close();if(server)await closeCapturePreview(server);await release();await writeFile('shots/forge/realms-report.json',JSON.stringify({errors,checks},null,2));console.log({errors,checks});}
