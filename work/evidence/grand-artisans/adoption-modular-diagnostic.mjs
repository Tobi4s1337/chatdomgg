import { createServer } from 'vite';
import { writeFile } from 'node:fs/promises';
let trace;
globalThis.__adCall = id => { (trace.calls[id] ??= {calls:0, failures:{}, success:0}).calls++; };
globalThis.__adFail = (id, why, detail) => { const s=trace.calls[id]; s.failures[why]=(s.failures[why]??0)+1; if(detail && !(why in trace.examples)) trace.examples[why]=detail; return null; };
globalThis.__adSuccess = id => { trace.calls[id].success++; };
globalThis.__adRun = (n,p,l) => {const k=`${n}:pier=${p}:landing=${l}`;trace.runs[k]=(trace.runs[k]??0)+1;};
const plugin={name:'adoption-observe',enforce:'pre',transform(code,id){
 if(!id.split('?')[0].endsWith('/packages/world/src/grand/artisans/adoption/index.ts')) return;
 const replace=(a,b)=>{if(!code.includes(a)) throw Error('Instrumentation mismatch: '+a);code=code.replace(a,b);};
 replace('let profile=profiles.get(kit);','globalThis.__adCall(kit.id); let profile=profiles.get(kit);');
 replace('if(!cell || cell.ground<=seaLevel || cell.ground>seaLevel+9 || cell.water>cell.ground) return null;',"if(!cell || cell.ground<=seaLevel || cell.ground>seaLevel+9 || cell.water>cell.ground) return globalThis.__adFail(kit.id,'shore',{x,z,cell,seaLevel});");
 replace("if(!within(preliminary) || !accept('harbour',preliminary)) return null;","if(!within(preliminary) || !accept('harbour',preliminary)) return globalThis.__adFail(kit.id,'guard-or-bounds',{preliminary});");
 replace('if(!cell || cell.ground>seaLevel+9 || cell.water>seaLevel) {fits=false;break;}',"if(!cell || cell.ground>seaLevel+9 || cell.water>seaLevel) {globalThis.__adFail(kit.id,'cap-cell',{x,z,cell,seaLevel});fits=false;break;}");
 replace('if(!cell || cell.ground>seaLevel+top) {fits=false;break;}',"if(!cell || cell.ground>seaLevel+top) {globalThis.__adFail(kit.id,'deck-cell',{x,z,top,cell,seaLevel});fits=false;break;}");
 replace('if(!cell || cell.ground<=0 || cell.water>seaLevel || (cell.ground<seaLevel && cell.water!==seaLevel)) {fits=false;break;}',"if(!cell || cell.ground<=0 || cell.water>seaLevel || (cell.ground<seaLevel && cell.water!==seaLevel)) {globalThis.__adFail(kit.id,'support-cell',{column,cell,seaLevel});fits=false;break;}");
 replace('if(depth>64) {fits=false;break;}',"if(depth>64) {globalThis.__adFail(kit.id,'support-depth',{column,cell,seaLevel,depth});fits=false;break;}");
 replace("return within(bounds) && accept('harbour',bounds) ? piece : null;","if(within(bounds) && accept('harbour',bounds)) {globalThis.__adSuccess(kit.id); return piece;} return globalThis.__adFail(kit.id,'extended-guard-or-bounds',{bounds});");
 replace('if(pieces.length<3 || !hasPier || !hasLanding) continue;', 'globalThis.__adRun(pieces.length,hasPier,hasLanding); if(pieces.length<3 || !hasPier || !hasLanding) continue;');
 return {code,map:null};
}};
const server=await createServer({root:'/tmp/grand-artisans-candidate',configFile:false,plugins:[plugin],server:{middlewareMode:true,watch:null,hmr:false,ws:false},logLevel:'error'});
try {
 const {GRAND_CHANNELS}=await server.ssrLoadModule('/apps/web/src/grand/channels.ts');
 const {generateGrandLand}=await server.ssrLoadModule('/packages/world/src/grand/generate.ts');
 const {sitePlacements}=await server.ssrLoadModule('/packages/world/src/grand/artisans/adoption/index.ts');
 for(const name of (process.env.ARTISAN_CHANNELS??'tobi4s_').split(',')) {
  const channel=GRAND_CHANNELS.find(c=>c.login.toLowerCase()===name.toLowerCase());
  trace={calls:{},runs:{},examples:{}};const start=performance.now(); const land=generateGrandLand(channel.seed); const guarded=trace;
  trace={calls:{},runs:{},examples:{}};const placements=sitePlacements(land,()=>true);const unrestricted=trace;
  const data={channel:name,guarded,unrestricted,unrestrictedPlacements:placements.map(p=>p.piece.id),millis:performance.now()-start,note:'CPU-only source diagnostic. Guarded is pre-flora producer fitting; unrestricted removes clearance guard solely to diagnose geometry, not for adoption.'};
  await writeFile(`work/evidence/grand-artisans/adoption-modular-${name}.json`,JSON.stringify(data,null,2)+'\n');console.log(name,JSON.stringify({guardedRuns:guarded.runs,unguardedRuns:unrestricted.runs,placements:data.unrestrictedPlacements,millis:data.millis}));
 }
} finally {await server.close();}
