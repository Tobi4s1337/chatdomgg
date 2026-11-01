// Focused SIMULATED /stream revision capture. Run from repo root; owns its server and browser.
import { createServer } from 'vite';
import solid from '../../apps/web/node_modules/vite-plugin-solid/dist/esm/index.mjs';
import { chromium } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdir, readFile, copyFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { CAPTURE_PORTS } from './capture-ports.mjs';
import { acquireCaptureLock } from './capture-lock.mjs';

const config = { configFile:false, root:process.cwd(), publicDir:'apps/web/public', plugins:[solid({hot:false})], logLevel:'error', optimizeDeps:{noDiscovery:true}, server:{hmr:false,ws:false} };
const output='shots/magic', evidence='work/evidence/growth-handoff';
let release, loader, server, browser;
try {
  release=await acquireCaptureLock({signal:AbortSignal.timeout(20*60_000)});
  loader=await createServer({...config,server:{middlewareMode:true,hmr:false,ws:false}});
  const data=await (await loader.ssrLoadModule('/packages/testing/growth-home/fixture.ts')).fixture();
  await loader.close(); loader=undefined;
  const sides=Object.fromEntries(['before','after'].map(side=>{
    const scene=data[side], bytes=JSON.stringify(scene), sceneHash=createHash('sha256').update(bytes).digest('hex');
    return [side,{bytes,manifest:{version:1,kingdomId:scene.kingdomId,origin:'simulated',layoutRevision:scene.layoutRevision,collisionRevision:scene.collisionRevision,sceneHash}}];
  }));
  const baselinePath=process.env.CHATDOM_CAPTURE_BASELINE_MOUNT;
  const oldMount=baselinePath ? await readFile(baselinePath,'utf8') : undefined;
  let side='before', streams=new Set(), delayed=[], requests=[];
  const plugin={name:'growth-handoff-fixture',enforce:'pre',transformIndexHtml:{order:'pre',handler(html){return html.replace('/src/main.tsx','/apps/web/src/main.tsx');}},transform(_code,id){ if (side==='baseline' && id.split('?')[0].endsWith('/apps/web/src/stream/mount.ts')) return {code:oldMount,map:null}; },configureServer(s){s.middlewares.use((req,res,next)=>{
    const path=req.url?.split('?')[0] ?? ''; if(path==='/stream') { req.url='/apps/web/index.html'; return next(); } if(path.startsWith('/src/')) { req.url='/apps/web'+req.url; return next(); } if(!path.startsWith('/api/realm/')) return next();
    requests.push(path); res.setHeader('Cache-Control','no-store');
    if(path==='/api/realm/entry/999000001'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({version:1,kingdomId:'999000001',origin:'simulated',name:'Willowmere'}));return;}
    if(path==='/api/realm/watch/999000001'){
      const current=side==='after'?'after':'before', manifest=sides[current].manifest, now=Date.now();
      res.writeHead(200,{'Content-Type':'text/event-stream','Connection':'keep-alive','Cache-Control':'no-cache'});streams.add(res);req.on('close',()=>streams.delete(res));
      const frame={version:1,kingdomId:manifest.kingdomId,epoch:'simulated:handoff',sequence:1,asOf:now,origin:'simulated',streamLive:true,connection:'fresh',windows:[]};
      const checkpoint={version:1,manifest,checkpoint:{version:1,kingdomId:manifest.kingdomId,writerEpoch:'simulated:handoff',throughSequence:1,throughCursor:1,layoutRevision:manifest.layoutRevision,collisionRevision:manifest.collisionRevision,current:[{type:'presence',frame}]}};
      res.write(`event: checkpoint\ndata: ${JSON.stringify(checkpoint)}\n\n`); let seq=1; const timer=setInterval(()=>{if(current==='before' && side==='after') return; seq++; const message={type:'presence',frame:{...frame,sequence:seq,asOf:Date.now()}}; res.write(`event: world\ndata: ${JSON.stringify({version:1,kingdomId:manifest.kingdomId,writerEpoch:'simulated:handoff',sequence:seq,cursor:seq,eventId:`simulated:${seq}`,message})}\n\n`);},5000); req.on('close',()=>clearInterval(timer)); return;
    }
    const found=Object.values(sides).find(value=>path===`/api/realm/founded/scenes/${value.manifest.sceneHash}`);
    if(found){res.setHeader('Content-Type','application/json');if(found===sides.after) delayed.push(()=>res.end(found.bytes));else res.end(found.bytes);return;}
    res.statusCode=404;res.end();
  });}};
  await mkdir(output,{recursive:true}); await mkdir(evidence,{recursive:true});
  for(const port of CAPTURE_PORTS){try{server=await createServer({...config,plugins:[solid({hot:false}),plugin],server:{host:'127.0.0.1',port,strictPort:true,hmr:false,ws:false}});await server.listen();break;}catch(error){await server?.close();server=undefined;if(error.code!=='EADDRINUSE'&&!/already in use/.test(error.message))throw error;}}
  if(!server)throw Error('No capture port');
  browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--no-sandbox']});
  const report={fixture:{plot:data.plot.id,from:data.from,to:data.to,qualifiedDays:data.qualifiedDays,manifests:{before:sides.before.manifest,after:sides.after.manifest}},runs:[]};
  for(const variant of baselinePath && !process.argv.includes('--replacement-only') ? ['baseline','replacement'] : ['replacement']){
    side=variant==='baseline'?'baseline':'before';requests=[]; delayed=[];
    // Distinct browser module cache; Vite transforms baseline on the first run only.
    const context=await browser.newContext({viewport:{width:1920,height:1080},deviceScaleFactor:1,reducedMotion:'reduce'}),page=await context.newPage();
    const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error' && !m.text().includes('WebSocket connection') && !m.text().includes('[vite] failed to connect') && !m.text().includes('Failed to send error to Vite server'))errors.push(m.text());});
    if(variant==='replacement') { const mod=server.moduleGraph.getModuleById(`${process.cwd()}/apps/web/src/stream/mount.ts`); if(mod)server.moduleGraph.invalidateModule(mod); }
    const url=`http://127.0.0.1:${server.httpServer.address().port}/stream?source=realm&kingdom=999000001&tier=hamlet&hour=19.5&time=30&camera=hero`;
    // Vite fallback serves the real app for /stream when root is the repository.
    await page.goto(url,{waitUntil:'domcontentloaded',timeout:120000});
    await page.waitForFunction(()=>window.__chatdomReady && window.__chatdomKingdom?.stats?.ready && window.__chatdomKingdom.stats.fieldSettled && window.__chatdomStream?.source==='simulated',null,{timeout:240000});
    await page.evaluate(({plot})=>{window.__chatdomStream.hold(true);const [x,y,z]=plot.position;window.__chatdomKingdom.pose([x+16,y+12,z+(plot.rotation===0?1:-1)*28],[x,y+3,z],38);},data);
    await page.waitForTimeout(1500);
    const shot=async label=>{const path=`${output}/growth-handoff-${variant}-${label}@1920x1080.png`;await page.screenshot({path,timeout:120000});await copyFile(path,`${evidence}/${path.split('/').pop()}`);return path;};
    side='after';for(const stream of streams)stream.write('event: revision\ndata: {"collisionRevision":2}\n\n');
    await page.waitForFunction(()=>window.__chatdomStream.stats.mounts>=2,null,{timeout:30000});
    const start=Date.now();while(!delayed.length && Date.now()-start<30000)await new Promise(r=>setTimeout(r,100));assert.ok(delayed.length,'Replacement asset request never arrived');
    const during=await shot('loading');const loading=await page.evaluate(()=>({phase:window.__chatdomStream.phase,stats:{...window.__chatdomStream.stats},source:window.__chatdomStream.source,visible:[...document.querySelectorAll('.stream-canvas')].filter(c=>getComputedStyle(c).visibility!=='hidden').length}));
    assert.equal(loading.phase,variant==='baseline'?'waking':'ready');
    assert.equal(loading.visible,1);
    if(variant==='replacement') assert.equal(loading.source,'simulated');
    let after;
    if(variant==='replacement') {
    for(const resume of delayed.splice(0))resume();
    await page.waitForFunction(()=>window.__chatdomReady && window.__chatdomKingdom?.stats?.ready && window.__chatdomKingdom.stats.fieldSettled && window.__chatdomStream.stats.alive===1 && window.__chatdomStream.stats.mounts>=2 && window.__chatdomStream.source==='simulated',null,{timeout:240000});
    await page.evaluate(({plot})=>{const [x,y,z]=plot.position;window.__chatdomKingdom.pose([x+16,y+12,z+(plot.rotation===0?1:-1)*28],[x,y+3,z],38);},data);
    await page.waitForTimeout(1500);after=await shot('grown');
    }
    assert.equal(errors.length,0,errors.join('\n'));
    report.runs.push({variant,during,after,loading,requests:[...requests],errors});
    await context.close(); for(const stream of streams)stream.end();streams.clear();
  }
  await writeFile(`${evidence}/report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
} finally {for(const close of [()=>browser?.close(),()=>server?.close(),()=>loader?.close(),()=>release?.()])try{await close();}catch{}}
