// Silent, explicitly simulated 90-second rehearsal from a hash-verified cached adopted scene.
// Run from the repository root: node packages/testing/live-evening.mjs
// CHATDOM_EVENING_SCENE selects the cached scene path; the required SHA-256 is checked below.
// Recording captures four actual frames per logical second; still reviews use one.
// No live chat, judged approval, authoritative receipt or realm write is implied.
import { setInterval, clearInterval } from 'node:timers';
import { createServer } from '../../apps/web/node_modules/vite/dist/node/index.js';
import { chromium } from '../../node_modules/@playwright/test/index.mjs';
import { acquireCaptureLock } from './capture-lock.mjs';
import { CAPTURE_PORTS } from './capture-ports.mjs';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createServer as tcp } from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
const root=process.cwd(),web=root+'/apps/web',out=root+'/shots/kingdom/live-evening';
const expected='008f059a38530d09717d045c463440c93c244ea4b614663eac983adb6756bd73';
const path=process.env.CHATDOM_EVENING_SCENE ?? `${root}/../worktrees/realm-runtime.local/scenes/${expected}.json`;
const raw=await readFile(path),hash=createHash('sha256').update(raw).digest('hex');if(hash!==expected)throw Error('Cached adopted scene hash mismatch');
const module=await readFile(root+'/packages/testing/live-evening/rehearsal.mjs','utf8');
const landingOnly=process.argv.includes('--landing-only');
const stills=landingOnly||process.argv.includes('--stills');
const fps=stills?1:Number(process.env.CHATDOM_EVENING_FPS??4),duration=90,errors=[],telemetry=[];if(!Number.isInteger(fps)||fps<1||fps>24)throw Error('CHATDOM_EVENING_FPS must be an integer from 1 to 24');let server,browser,encoder,diagnostics;const release=await acquireCaptureLock({priority:'main'});
try{
 await mkdir(out,{recursive:true});let port;for(const p of CAPTURE_PORTS){if(await new Promise(resolve=>{const s=tcp().once('error',()=>resolve(false)).once('listening',()=>s.close(()=>resolve(true))).listen(p,'127.0.0.1')})){port=p;break}}if(!port)throw Error('No capture port');
 server=await createServer({root:web,configFile:web+'/vite.config.ts',logLevel:'error',server:{host:'127.0.0.1',port,strictPort:true,hmr:false,watch:null,fs:{allow:[root]}},plugins:[{name:'evening-rehearsal',resolveId(id){if(id==='/src/__evening_rehearsal__.js')return web+id},load(id){if(id===web+'/src/__evening_rehearsal__.js')return module},configureServer(v){v.middlewares.use((req,res,next)=>{if(req.url==='/review-scene.json'){res.setHeader('Content-Type','application/json');res.end(prospective)}else if(req.url==='/evening-rehearsal'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(`<link rel="stylesheet" href="/src/kingdom/kingdom.css"><style>body{margin:0;overflow:hidden;background:#171d24}canvas{width:100vw;height:100vh;display:block}label{position:fixed;top:20px;left:20px;z-index:5;padding:10px 14px;background:#2c241de8;color:#ffe0a1;font:16px Georgia}</style><canvas></canvas><div id="names" class="window-names"></div><div id="speech" class="citizen-speech"></div><label>SIMULATED REHEARSAL · PROSPECTIVE CIVIC FIXTURES AND AUTHORED WISH · NO ACTUAL CHAT OR JUDGED APPROVAL</label><script type="module" src="/src/__evening_rehearsal__.js"></script>`)}else if(req.url==='/favicon.ico'){res.statusCode=204;res.end()}else next()})}}]});const {prepareForgeRehearsal}=await server.ssrLoadModule(root+'/packages/testing/live-evening/prepare.ts');
 const prospective=JSON.stringify(await prepareForgeRehearsal(JSON.parse(raw.toString())));await server.listen();
 browser=await chromium.launch({channel:'chrome',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--no-sandbox']});const page=await browser.newPage({viewport:{width:1920,height:1080}});let recording=false;page.on('framenavigated',frame=>{if(recording&&frame===page.mainFrame())errors.push('Page navigated during recording')});page.on('pageerror',e=>{errors.push(e.message);console.error('page error:',e.stack||e.message)});page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});
 diagnostics=setInterval(async()=>{try{console.log('status',JSON.stringify(await page.evaluate(()=>({stage:window.__initStage,progress:window.__progress,ready:window.__chatdomReady,queued:window.__queuedFrames}))))}catch(error){console.error('DIAGNOSTIC ERROR',String(error))}},10000);await page.goto(`http://127.0.0.1:${port}/evening-rehearsal`,{waitUntil:'commit'});await page.waitForFunction(()=>window.__chatdomReady||window.__reviewError||window.__captureError,null,{timeout:240000});if(await page.evaluate(()=>window.__reviewError||window.__captureError))throw Error(await page.evaluate(()=>window.__reviewError||window.__captureError));try{await page.waitForFunction(()=>window.__scene?.debug.ready,null,{timeout:120000})}catch(error){console.error('READINESS DIAGNOSTICS',JSON.stringify(await page.evaluate(()=>({reviewError:window.__reviewError,captureError:window.__captureError,debug:window.__scene?.debug,inspect:window.__scene?.inspect()}))));throw error}
 await page.evaluate(()=>window.__begin());
 // Allow the last native animation callback to enter the manual queue.
 await page.waitForFunction(()=>window.__queuedFrames>0,null,{timeout:30000});recording=true;

 if(!stills) encoder=spawn('ffmpeg',['-hide_banner','-loglevel','error','-y','-f','image2pipe','-framerate',String(fps),'-vcodec','mjpeg','-i','-','-c:v','libx264','-threads','2','-preset','veryfast','-crf','20','-pix_fmt','yuv420p','-movflags','+faststart',out+'/rehearsal-02-SIMULATED.mp4'],{stdio:['pipe','ignore','inherit']});
 for(let i=0;i<fps*duration;i++){
  const ms=i*1000/fps;
  if(landingOnly && ms<64000 && ![0,2000,13000,31000,38000,62000].includes(ms))continue;
  if(landingOnly && ms>84000)break;
  await page.evaluate(ms=>window.__setClock(ms),ms);
  if(ms===2000)await page.evaluate(()=>window.__arrive());
  if(ms===13000)await page.evaluate(()=>window.__chat());
  if(ms===38000)await page.evaluate(()=>window.__stage());
  if(ms===64000)await page.evaluate(()=>window.__commit());
  // Scene creation and worker messages need real event-loop turns; logical time stays fixed.
  await page.evaluate(async ms=>{window.__step(ms);await new Promise(resolve=>setTimeout(resolve,0))},ms);
  if(i%fps===0){
   telemetry.push(await page.evaluate(ms=>({ms,subject:window.__scene.subject(),activeWindows:window.__scene.debug.activeWindows,walking:window.__scene.debug.walking,forgeDirecting:window.__scene.forgeDirecting(),momentDirecting:window.__scene.momentDirecting()}),ms));
   await writeFile(out+'/rehearsal-02-progress.json',JSON.stringify({fps,duration,sha256:hash,stills,telemetry,events:await page.evaluate(()=>window.__events),errors},null,2));
  }
  if(!stills){const frame=await page.screenshot({type:'jpeg',quality:90,timeout:120000});if(!encoder.stdin.write(frame))await once(encoder.stdin,'drain')}
  if((!landingOnly&&ms===62000)||(stills&&ms===84000)){await page.screenshot({path:`${out}/rehearsal-02-${ms/1000}s-SIMULATED.png`,timeout:120000});console.log('captured',ms/1000,'logical seconds')}
  if(errors.length)throw Error(errors.join('\n'));
 }
 if(encoder){encoder.stdin.end();const [code]=await once(encoder,'exit');if(code!==0)throw Error(`ffmpeg exited ${code}`);encoder=undefined}
 const report={fps,duration,source:'hash-verified cached adopted scene with prospective civic fixtures',sha256:hash,stills,muted:true,telemetry,events:await page.evaluate(()=>window.__events),home:await page.evaluate(()=>window.__home),errors};await writeFile(out+'/rehearsal-02-report.json',JSON.stringify(report,null,2));console.log('Rehearsal complete');
} catch(error){errors.push(String(error.stack||error));await writeFile(out+'/rehearsal-02-error.json',JSON.stringify({stills,errors,telemetry},null,2)).catch(()=>{});throw error
}finally{
 clearInterval(diagnostics);encoder?.kill();
 try{await browser?.close()}finally{try{await server?.close()}finally{await release()}}
}
