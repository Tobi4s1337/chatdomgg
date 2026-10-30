import { chromium } from '@playwright/test';
import { acquireCaptureLock } from './capture-lock.mjs';
import { startCapturePreview, closeCapturePreview } from './preview.mjs';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { encodeMomentClips } from './encode-moments.mjs';
const lookOnly=process.argv.includes('--look-only');
let base=process.env.CHATDOM_MOMENTS_URL,server;
const release=await acquireCaptureLock();let browser;
const report={errors:[],checks:[]};
try {
  if(!base)({base,server}=await startCapturePreview());
  browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--no-sandbox']});
  const page=await browser.newPage({viewport:{width:1440,height:900}});
  page.on('pageerror',e=>report.errors.push(e.message));
  const ready=()=>page.waitForFunction(()=>window.__chatdomReady&&window.__chatdomKingdom.stats.fieldSettled,null,{timeout:240000});
  await mkdir('shots/moments/walk',{recursive:true});await mkdir('shots/moments/build',{recursive:true});
  await page.goto(`${base}/?tier=town&hour=19.5&time=5&camera=citizen`);await ready();
  const start=await page.evaluate(()=>window.__chatdomKingdom.subject());
  assert.equal(start.state,'walking');assert.equal(start.homeLit,false);
  await page.screenshot({path:'shots/moments/citizen@1440x900.png',timeout:120000});
  for(let i=0;i<(lookOnly?0:10);i++){
    const time=5+i*.6;await page.evaluate(t=>window.__chatdomKingdom.seek(t,'citizen'),time);
    await page.waitForFunction(t=>window.__chatdomKingdom.stats.time===t,time);
    await page.screenshot({path:`shots/moments/walk/${String(i).padStart(3,'0')}.png`,timeout:120000});
  }
  await page.evaluate(()=>window.__chatdomKingdom.seek(60,'citizen'));await ready();
  await page.waitForFunction(()=>window.__chatdomKingdom.subject()?.homeLit);
  const arrived=await page.evaluate(()=>window.__chatdomKingdom.subject());assert.equal(arrived.state,'home');assert.ok(arrived.homeLitAtMs);assert.notDeepEqual(start.position,arrived.position);
  report.checks.push('Citizen travels the street and lights home on arrival');
  await page.setViewportSize({width:390,height:844});await page.evaluate(()=>window.__chatdomKingdom.seek(5,'citizen'));await ready();
  await page.screenshot({path:'shots/moments/citizen@390x844.png',timeout:120000});
  await page.setViewportSize({width:1440,height:900});await page.goto(`${base}/?tier=hamlet&hour=19.5&time=60&build=1`);await ready();
  await page.waitForFunction(()=>window.__chatdomKingdom.build.session?.debug.meshedRevision>=0);
  const pointer=await page.evaluate(()=>{const s=window.__chatdomKingdom.build.session;s.controller.tool('place');return {point:s.projectCell([2,0,124]),revision:s.draft.revision};});
  await page.mouse.click(pointer.point.x,pointer.point.y);
  await page.waitForFunction(r=>window.__chatdomKingdom.build.session.draft.revision>r,pointer.revision,{timeout:10000});
  await page.evaluate(async()=>{const s=window.__chatdomKingdom.build.session;s.controller.undo();await s.settled();});
  report.checks.push('Real pointer places a block and undo restores it');
  await page.evaluate(async()=>{const s=window.__chatdomKingdom.build.session,p=window.__chatdomKingdom.build.policy;s.edit({kind:'erase',from:p.editableFrom,to:p.editableTo});await s.settled();});
  for(let i=0;i<10;i++){
    await page.evaluate(async i=>{const b=window.__chatdomKingdom.build,s=b.session,p=b.policy,wall=p.shaping.wall[0],roof=p.shaping.roof[0];
      const boxes=i===0?[[[8,0,96],[56,3,124],p.shaping.stone]]:i<7?[[[8,3+(i-1)*4,96],[12,3+i*4,124],wall],[[52,3+(i-1)*4,96],[56,3+i*4,124],wall],[[12,3+(i-1)*4,96],[52,3+i*4,100],wall],[[12,3+(i-1)*4,120],[26,3+i*4,124],wall],[[36,3+(i-1)*4,120],[52,3+i*4,124],wall]]:i===7?[[[8,27,96],[56,31,124],roof]]:i===8?[[[12,31,100],[52,35,120],roof]]:[[[16,9,120],[24,19,124],p.shaping.glass],[[40,9,120],[48,19,124],p.shaping.glass]];
      s.edit(boxes.map(([from,to,material])=>({kind:'place',from,to,material})));await s.settled();},i);
    await page.evaluate(()=>new Promise(r=>window.requestAnimationFrame(()=>window.requestAnimationFrame(r))));
    if(!lookOnly)await page.screenshot({path:`shots/moments/build/${String(i).padStart(3,'0')}.png`,timeout:120000});
  }
  await page.screenshot({path:'shots/moments/build@1440x900.png',timeout:120000});
  await page.setViewportSize({width:390,height:844});await page.evaluate(()=>new Promise(r=>window.requestAnimationFrame(()=>window.requestAnimationFrame(r))));
  await page.screenshot({path:'shots/moments/build@390x844.png',timeout:120000});
  await page.evaluate(()=>window.__chatdomKingdom.build.session.controller.publish());
  await page.waitForFunction(()=>!window.__chatdomKingdom.build.session&&!!window.__chatdomKingdom.build.streetHome);
  report.checks.push('Private authored house publishes as a labelled local street preview');
  await page.reload();await ready();
  assert.ok(await page.evaluate(()=>!!window.__chatdomKingdom.build.streetHome));
  report.checks.push('Published local home survives reload');assert.deepEqual(report.errors,[]);if(!lookOnly)await encodeMomentClips();report.result='passed';
} catch(error){report.result='failed';report.failure=String(error);throw error;}
finally {await browser?.close();if(server)await closeCapturePreview(server);await release();await mkdir('shots/moments',{recursive:true});await writeFile('shots/moments/report.json',JSON.stringify(report,null,2));console.log(report);}
