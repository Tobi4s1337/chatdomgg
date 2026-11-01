// One SIMULATED /stream watch witnesses a real native geometry commit and revision.
import { createServer } from 'vite';
import solid from '../../apps/web/node_modules/vite-plugin-solid/dist/esm/index.mjs';
import { chromium } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { CAPTURE_PORTS } from './capture-ports.mjs';
import { acquireCaptureLock } from './capture-lock.mjs';

const config={configFile:false,root:process.cwd(),publicDir:'apps/web/public',plugins:[solid({hot:false})],logLevel:'error',optimizeDeps:{noDiscovery:true},server:{hmr:false,ws:false}};
const output='shots/magic', evidence='work/evidence/growth-ceremony';
let release,loader,server,browser,activeDeadline,page,phase='lock',errors=[],requests=[];
const deadline=globalThis.setTimeout(()=>{console.error('Capture deadline exceeded');process.exitCode=1;void cleanup();},20*60_000);
async function cleanup(){for(const close of [()=>browser?.close(),()=>server?.close(),()=>loader?.close(),()=>release?.()])try{await close();}catch{/* Continue releasing resources. */} browser=server=loader=release=undefined;}
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{console.error(`Capture interrupted during ${phase}`);void cleanup().finally(()=>process.exit(1));});
try {
  release=await acquireCaptureLock({signal:globalThis.AbortSignal.timeout(20*60_000)});
  loader=await createServer({...config,server:{middlewareMode:true,hmr:false,ws:false}});
  const data=await (await loader.ssrLoadModule('/packages/testing/growth-home/fixture.ts')).fixture();
  await loader.close();loader=undefined;
  const sides=Object.fromEntries(['before','after'].map(side=>{const scene=data[side],bytes=JSON.stringify(scene),sceneHash=createHash('sha256').update(bytes).digest('hex');return [side,{bytes,manifest:{version:1,kingdomId:scene.kingdomId,origin:'simulated',layoutRevision:scene.layoutRevision,collisionRevision:scene.collisionRevision,sceneHash}}];}));
  let side='before',cursor=0,presenceSeq=0;const streams=new Set();
  const plugin={name:'growth-ceremony-fixture',enforce:'pre',transformIndexHtml:{order:'pre',handler(html){return html.replace('/src/main.tsx','/apps/web/src/main.tsx');}},configureServer(s){s.middlewares.use((req,res,next)=>{
    const path=req.url?.split('?')[0]??'';if(path==='/stream'){req.url='/apps/web/index.html';return next();}if(path.startsWith('/src/')){req.url='/apps/web'+req.url;return next();}if(!path.startsWith('/api/realm/'))return next();
    requests.push(path);res.setHeader('Cache-Control','no-store');
    if(path==='/api/realm/entry/999000001'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({version:1,kingdomId:'999000001',origin:'simulated',name:'Willowmere'}));return;}
    if(path==='/api/realm/watch/999000001'){
      const current=side,manifest=sides[current].manifest,now=Date.now();const seq=current==='before'?data.bootstrap.sequence:data.delivery.frame.sequence;
      const frame={version:1,kingdomId:manifest.kingdomId,epoch:'simulated:ceremony',sequence:++presenceSeq,asOf:now,origin:'simulated',streamLive:true,connection:'fresh',windows:[data.plot.slot,...data.before.plan.homes.filter(p=>p.id!==data.plot.id).slice(0,5).map(p=>p.slot)].map((slot,i)=>({slot,present:true,publicName:i===0?'Juniper':null,since:now-60_000}))};
      const growth=current==='before'?data.bootstrap:{...data.delivery.frame,beats:[]};
      const checkpoint={version:1,manifest,checkpoint:{version:1,kingdomId:manifest.kingdomId,writerEpoch:'simulated:ceremony',throughSequence:seq,throughCursor:cursor,layoutRevision:manifest.layoutRevision,collisionRevision:manifest.collisionRevision,current:[{type:'presence',frame},{type:'growth',frame:growth}]}};
      res.writeHead(200,{'Content-Type':'text/event-stream','Connection':'keep-alive','Cache-Control':'no-cache'});streams.add(res);req.on('close',()=>streams.delete(res));res.write(`event: checkpoint\ndata: ${JSON.stringify(checkpoint)}\n\n`);
      const timer=globalThis.setInterval(()=>{cursor++;const message={type:'presence',frame:{...frame,sequence:++presenceSeq,asOf:Date.now()}};res.write(`event: world\ndata: ${JSON.stringify({version:1,kingdomId:manifest.kingdomId,writerEpoch:'simulated:ceremony',sequence:seq,cursor,eventId:`simulated:presence:${cursor}`,message})}\n\n`);},5000);req.on('close',()=>globalThis.clearInterval(timer));return;
    }
    const found=Object.values(sides).find(value=>path===`/api/realm/founded/scenes/${value.manifest.sceneHash}`);if(found){res.setHeader('Content-Type','application/json');res.end(found.bytes);return;}res.statusCode=404;res.end();
  });}};
  await mkdir(output,{recursive:true});await mkdir(evidence,{recursive:true});
  const preview=process.env.CHATDOM_CAPTURE_PREVIEW;
  const middleOnly=process.env.CHATDOM_CAPTURE_MIDDLE_ONLY==='1';
  const deviceScale=Number(process.env.CHATDOM_CAPTURE_DEVICE_SCALE??1);
  assert.ok(Number.isFinite(deviceScale)&&deviceScale>=0.5&&deviceScale<=1,'Capture device scale must be between 0.5 and 1');
  if(middleOnly){const prior=JSON.parse(await readFile(`${evidence}/report.json`,'utf8'));for(const key of ['before','after']){assert.equal(prior.fixture.manifests[key].sceneHash,sides[key].manifest.sceneHash,`${key} scene changed since prior capture`);await readFile(prior[key]);}}
  if(!preview){for(const port of CAPTURE_PORTS){try{server=await createServer({...config,plugins:[solid({hot:false}),plugin],server:{host:'127.0.0.1',port,strictPort:true,hmr:false,ws:false}});await server.listen();break;}catch(error){await server?.close();server=undefined;if(error.code!=='EADDRINUSE'&&!/already in use/.test(error.message))throw error;}}if(!server)throw Error('No capture port');}
  browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--no-sandbox']});
  const context=await browser.newContext({viewport:{width:1920,height:1080},deviceScaleFactor:deviceScale,reducedMotion:'reduce'});page=await context.newPage();
  if(preview){
    await page.route('**/api/realm/**',async route=>{const path=new URL(route.request().url()).pathname;requests.push(path);
      if(path==='/api/realm/entry/999000001')return route.fulfill({json:{version:1,kingdomId:'999000001',origin:'simulated',name:'Willowmere'}});
      const found=Object.values(sides).find(value=>path===`/api/realm/founded/scenes/${value.manifest.sceneHash}`);
      if(found)return route.fulfill({status:200,contentType:'application/json',body:found.bytes});
      return route.fulfill({status:404,body:''});});
    await page.addInitScript(({data,sides})=>{
      let side='before',cursor=0,presenceSeq=0;const sources=new Set();
      class SimulatedEventSource extends globalThis.EventTarget {
        constructor(){super();this.current=side;this.sequence=side==='before'?data.bootstrap.sequence:data.delivery.frame.sequence;this.cursor=cursor;sources.add(this);
          const manifest=sides[side].manifest,now=Date.now();this.frame={version:1,kingdomId:manifest.kingdomId,epoch:'simulated:ceremony',sequence:++presenceSeq,asOf:now,origin:'simulated',streamLive:true,connection:'fresh',windows:[data.plot.slot,...data.before.plan.homes.filter(p=>p.id!==data.plot.id).slice(0,5).map(p=>p.slot)].map((slot,i)=>({slot,present:true,publicName:i===0?'Juniper':null,since:now-60_000}))};
          const growth=side==='before'?data.bootstrap:{...data.delivery.frame,beats:[]};
          const checkpoint={version:1,manifest,checkpoint:{version:1,kingdomId:manifest.kingdomId,writerEpoch:'simulated:ceremony',throughSequence:this.sequence,throughCursor:this.cursor,layoutRevision:manifest.layoutRevision,collisionRevision:manifest.collisionRevision,current:[{type:'presence',frame:this.frame},{type:'growth',frame:growth}]}};
          setTimeout(()=>this.emit('checkpoint',checkpoint),0);this.timer=globalThis.setInterval(()=>{this.cursor=++cursor;this.emit('world',{version:1,kingdomId:manifest.kingdomId,writerEpoch:'simulated:ceremony',sequence:this.sequence,cursor:this.cursor,eventId:`simulated:presence:${cursor}`,message:{type:'presence',frame:{...this.frame,sequence:++presenceSeq,asOf:Date.now()}}});},5000);
        }
        emit(type,payload){this.dispatchEvent(new globalThis.MessageEvent(type,{data:JSON.stringify(payload)}));}
        close(){globalThis.clearInterval(this.timer);sources.delete(this);}
      }
      window.EventSource=SimulatedEventSource;
      window.__deliverSimulatedGrowth=()=>{const sequence=data.delivery.frame.sequence;
        for(const [index,message] of data.publicCommit.entries()){cursor++;for(const source of sources)source.emit('world',{version:1,kingdomId:data.before.kingdomId,writerEpoch:'simulated:ceremony',sequence,cursor,eventId:`simulated:growth:commit:${index}`,message});}
        side='after';for(const source of [...sources]){source.emit('revision',{layoutRevision:sides.after.manifest.layoutRevision,collisionRevision:sides.after.manifest.collisionRevision});source.emit('closed',{version:1,kingdomId:data.before.kingdomId,reason:'revision'});source.close();}
      };
    },{data,sides});
  }
  page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&!m.text().includes('WebSocket connection')&&!m.text().includes('[vite] failed to connect')&&!m.text().includes('Failed to send error to Vite server'))errors.push(m.text());});
  const url=`${preview??`http://127.0.0.1:${server.httpServer.address().port}`}/stream?source=realm&kingdom=999000001&tier=hamlet&hour=19.5&time=30&camera=hero`;
  phase='initial navigation';await page.goto(url,{waitUntil:'domcontentloaded',timeout:120000});
  phase='initial scene readiness';await page.waitForFunction(()=>window.__chatdomReady&&window.__chatdomKingdom?.stats?.ready&&window.__chatdomKingdom.stats.fieldSettled&&window.__chatdomStream?.source==='simulated',null,{timeout:240000});
  activeDeadline=globalThis.setTimeout(()=>{console.error('Active capture deadline exceeded');process.exitCode=1;void cleanup();},10*60_000);
  const pose=()=>page.evaluate(({plot,frame})=>{window.__chatdomStream.hold(true);const [x,y,z]=plot.position,[ox,,oz]=frame.outward,[rx,,rz]=frame.right;window.__chatdomKingdom.pose([x+ox*31+rx*7,y+7,z+oz*31+rz*7],[x,y+3,z],38);},data);
  const settle=async()=>{await page.evaluate(()=>new Promise(resolve=>globalThis.requestAnimationFrame(()=>globalThis.requestAnimationFrame(()=>resolve()))));await page.waitForTimeout(700);await page.evaluate(()=>new Promise(resolve=>globalThis.requestAnimationFrame(()=>globalThis.requestAnimationFrame(()=>resolve()))));};
  const shot=async label=>{await pose();await settle();const path=`${output}/growth-ceremony-${label}@1920x1080.png`;await page.screenshot({path,scale:'css',timeout:120000});await copyFile(path,`${evidence}/${path.split('/').pop()}`);return path;};
  phase='before still';const before=middleOnly?`${output}/growth-ceremony-before@1920x1080.png`:await shot('before');
  if(middleOnly){await pose();await settle();}
  const beforeState=await page.evaluate(()=>({stats:{...window.__chatdomKingdom.stats},inspect:window.__chatdomKingdom.inspect(),canvasBacking:[...document.querySelectorAll('.stream-canvas')].map(canvas=>({width:canvas.width,height:canvas.height,visible:globalThis.getComputedStyle(canvas).visibility!=='hidden'}))}));
  const targetPlacement=data.before.placements.find(placement=>placement.plotId===data.plot.id);
  const targetBlueprint=data.before.assets.find(asset=>asset.assetHash===targetPlacement?.assetHash)?.blueprint;
  const windows=targetBlueprint?.windows.map(window=>{const [x,y,z]=window.centre.map(value=>value/8),angle=targetPlacement.rotation*Math.PI/2,c=Math.cos(angle),s=Math.sin(angle),[px,py,pz]=targetPlacement.position;return {...window,worldCentre:[px+x*c+z*s,py+y,pz-x*s+z*c]};});
  await writeFile(`${evidence}/before-state.json`,JSON.stringify({before,beforeState,targetPlacement,windows},null,2));
  // A public row from decideRealm is witnessed on the old watch before its revision.
  const sequence=data.delivery.frame.sequence;assert.ok(sequence>data.bootstrap.sequence);
  if(preview)await page.evaluate(()=>window.__deliverSimulatedGrowth());
  else {for(const [index,message] of data.publicCommit.entries()){cursor++;for(const stream of streams)stream.write(`event: world\ndata: ${JSON.stringify({version:1,kingdomId:data.before.kingdomId,writerEpoch:'simulated:ceremony',sequence,cursor,eventId:`simulated:growth:commit:${index}`,message})}\n\n`);}
    side='after';for(const stream of streams){stream.write(`event: revision\ndata: ${JSON.stringify({layoutRevision:sides.after.manifest.layoutRevision,collisionRevision:sides.after.manifest.collisionRevision})}\n\n`);stream.write('event: closed\ndata: {"reason":"revision"}\n\n');stream.end();}}
  phase='replacement and ceremony';
  for(let attempt=0;;attempt++){
    try{await page.waitForFunction(()=>window.__chatdomStream.stats.mounts>=2&&window.__chatdomStream.stats.alive===1&&window.__chatdomKingdom?.inspect().growth?.active,null,{timeout:30000});break;}
    catch(error){const snapshot=await page.evaluate(()=>({stream:window.__chatdomStream&&{phase:window.__chatdomStream.phase,source:window.__chatdomStream.source,stats:{...window.__chatdomStream.stats}},scene:window.__chatdomKingdom?.inspect()}));console.log(JSON.stringify({phase,attempt:attempt+1,snapshot,requests,errors}));if(snapshot.stream?.phase==='failed')throw Error('Replacement scene failed during preparation',{cause:error});if(attempt>=11)throw error;}
  }
  await page.evaluate(()=>window.__chatdomKingdom.seekGrowthCeremony(3.5));
  await page.waitForFunction(()=>window.__chatdomKingdom?.inspect().growth?.elapsed>=3.5,null,{timeout:30000});
  phase='scaffold still';const midState=await page.evaluate(()=>window.__chatdomKingdom.inspect().growth),mid=await shot('scaffold');
  let after=`${output}/growth-ceremony-after@1920x1080.png`;
  if(!middleOnly){await page.evaluate(()=>window.__chatdomKingdom.seekGrowthCeremony(null));await page.waitForFunction(()=>!window.__chatdomKingdom?.inspect().growth?.active,null,{timeout:60000});phase='after still';after=await shot('after');}
  assert.equal(errors.length,0,errors.join('\n'));
  const canvasBacking=await page.evaluate(()=>[...document.querySelectorAll('.stream-canvas')].map(canvas=>({width:canvas.width,height:canvas.height,visible:globalThis.getComputedStyle(canvas).visibility!=='hidden'})));
  const report={transport:preview?'SIMULATED browser EventSource and API fixtures against managed production preview':'SIMULATED SSE and API fixture server',deviceScale,canvasBacking,stillOrigins:middleOnly?'Before and after from prior run; scaffold from this run using the same fixture, plot, and camera.':'All stills from this run.',fixture:{plot:data.plot.id,from:data.from,to:data.to,qualifiedDays:data.qualifiedDays,delivery:data.delivery,targetPlacement,windows,manifests:{before:sides.before.manifest,after:sides.after.manifest}},before,beforeState,mid,after,midState,requests,errors};
  await writeFile(`${evidence}/report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
  await context.close();for(const stream of streams)stream.end();
} catch(error) {
  const snapshot=await page?.evaluate(()=>({ready:window.__chatdomReady,stream:window.__chatdomStream&&{phase:window.__chatdomStream.phase,source:window.__chatdomStream.source,stats:{...window.__chatdomStream.stats}},scene:window.__chatdomKingdom?.inspect(),stats:window.__chatdomKingdom?.stats})).catch(()=>null);
  const diagnostic={phase,error:String(error),snapshot,requests,errors};await mkdir(evidence,{recursive:true});await writeFile(`${evidence}/failure.json`,JSON.stringify(diagnostic,null,2));console.error(JSON.stringify(diagnostic,null,2));throw error;
} finally {globalThis.clearTimeout(deadline);globalThis.clearTimeout(activeDeadline);await cleanup();}
