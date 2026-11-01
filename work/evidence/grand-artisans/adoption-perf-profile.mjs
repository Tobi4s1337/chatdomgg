/** Profile exactly the frozen candidate: only in-memory timing/counters; no server listens. */
import {createServer} from 'vite';
import {Session} from 'node:inspector';
import {writeFile} from 'node:fs/promises';
const plugin={name:'adoption-perf-profile',enforce:'pre',transform(code,id){
 const path=id.split('?')[0];
 const replace=(from,to)=>{if(!code.includes(from))throw Error('Instrumentation mismatch: '+from);code=code.replace(from,to);};
 if(path.endsWith('/packages/world/src/grand/artisans/adoption/index.ts')){
  replace('  if (!guard) return [];','  if (!guard) return []; const __start=performance.now();');
  replace('  return result;\n}', '  globalThis.__adPerf.placements.push({millis:performance.now()-__start,ids:result.map(p=>p.piece.id)}); return result;\n}');
  replace('    let profile=profiles.get(kit);','    globalThis.__adPerf.counts.fitKit++; let profile=profiles.get(kit);');
  replace('  const min: [number,number,number] = [Infinity,Infinity,Infinity]', '  globalThis.__adPerf.counts.kitBounds++; const min: [number,number,number] = [Infinity,Infinity,Infinity]');
  replace('    if(diagnostics) diagnostics.accessAttempts=', '    globalThis.__adPerf.counts.withAccess++; if(diagnostics) diagnostics.accessAttempts=');
  return {code,map:null};
 }

}};
const session=new Session();session.connect();const post=(name,params={})=>new Promise((resolve,reject)=>session.post(name,params,(err,res)=>err?reject(err):resolve(res)));
const server=await createServer({root:'/tmp/grand-artisans-candidate',configFile:false,plugins:[plugin],optimizeDeps:{noDiscovery:true},server:{middlewareMode:true,watch:null,hmr:false,ws:false},logLevel:'error'});
try {
 const {GRAND_CHANNELS}=await server.ssrLoadModule('/apps/web/src/grand/channels.ts');
 const {generateGrandLand}=await server.ssrLoadModule('/packages/world/src/grand/generate.ts');
 const {GRAND_ARTISAN_KITS}=await server.ssrLoadModule('/packages/world/src/grand/artisans/index.ts');
 for(const name of (process.env.ARTISAN_CHANNELS??'tobi4s_,the_aggman').split(',')) {
  const channel=GRAND_CHANNELS.find(c=>c.login.toLowerCase()===name.toLowerCase());
  globalThis.__adPerf={placements:[],counts:{fitKit:0,kitBounds:0,withAccess:0,renderClearance:null}};
  await post('Profiler.enable');await post('Profiler.setSamplingInterval',{interval:1000});await post('Profiler.start');
  const started=performance.now(),land=generateGrandLand(channel.seed),generated=performance.now();
  const placements=GRAND_ARTISAN_KITS.compose.flatMap(fn=>fn(land)),ended=performance.now();
  const {profile}=await post('Profiler.stop');await post('Profiler.disable');
  await writeFile(`/tmp/adoption-perf-${name}.cpuprofile`,JSON.stringify(profile));
  const byId=new Map(profile.nodes.map(n=>[n.id,n])), aggregate=new Map();
  for(let i=0;i<(profile.samples?.length??0);i++){const n=byId.get(profile.samples[i]),frame=n.callFrame;const key=`${frame.functionName||'(anonymous)'} @ ${frame.url.split('/').slice(-3).join('/')}:${frame.lineNumber+1}`;aggregate.set(key,(aggregate.get(key)??0)+(profile.timeDeltas?.[i]??1000)/1000);}
  const data={channel:name,candidate:'/tmp/grand-artisans-candidate',checkpoint:'75bfdb5',generationMs:generated-started,postFloraComposeMs:ended-generated,instrumentation:globalThis.__adPerf,placements:placements.map(p=>({id:p.piece.id,at:p.at,turns:p.turns,boxes:p.piece.boxes.length})),topSelfMs:[...aggregate].sort((a,b)=>b[1]-a[1]).slice(0,40),note:'Sampling profiler overhead and host contention affect wall times. sitePlacements timing includes the connected-sea scan and clearance checks; generated land includes one pre-flora placement pass. Clearance call count was not instrumented.'};
  await writeFile(`work/evidence/grand-artisans/adoption-perf-${name}.json`,JSON.stringify(data,null,2)+'\n');console.log(JSON.stringify(data));
 }
} finally {await server.close();session.disconnect();}
