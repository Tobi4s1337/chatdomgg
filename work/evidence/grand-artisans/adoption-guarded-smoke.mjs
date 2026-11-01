import {createServer} from 'vite';
import {readFile,writeFile} from 'node:fs/promises';
const local=await readFile('packages/world/src/grand/artisans/adoption/index.ts','utf8');
const plugin={name:'adoption-guarded-smoke',enforce:'pre',transform(code,id){if(id.split('?')[0].endsWith('/packages/world/src/grand/artisans/adoption/index.ts')) return {code:local.replace('if (!guard) return [];', 'if (!guard) return []; diagnostics ??= globalThis.__adoptionBudget;'),map:null};}};
const server=await createServer({root:'/tmp/grand-adoption-radius-study',configFile:false,plugins:[plugin],optimizeDeps:{noDiscovery:true},server:{middlewareMode:true,watch:null,hmr:false,ws:false},logLevel:'error'});
try {
 const {GRAND_CHANNELS}=await server.ssrLoadModule('/apps/web/src/grand/channels.ts');
 const {generateGrandLand}=await server.ssrLoadModule('/packages/world/src/grand/generate.ts');
 const {GRAND_ARTISAN_KITS}=await server.ssrLoadModule('/packages/world/src/grand/artisans/index.ts');
 for(const name of (process.env.ARTISAN_CHANNELS??'tobi4s_,the_aggman,pinkkittyrose,mashad4').split(',')) {
  const channel=GRAND_CHANNELS.find(c=>c.login.toLowerCase()===name.toLowerCase());const start=performance.now();
  globalThis.__adoptionBudget={orientations:[]};
  const land=generateGrandLand(channel.seed), placements=GRAND_ARTISAN_KITS.compose.flatMap(fn=>fn(land));
  const data={channel:name,diagnostics:globalThis.__adoptionBudget,treeCount:land.treeCount,placements:placements.map(p=>({id:p.piece.id,at:p.at,turns:p.turns,boxes:p.piece.boxes.length})),millis:performance.now()-start,note:'CPU source generation and render-only fit with boundary-connected sea, berth and supported access; default guard and pre-flora reservation. Not visual evidence.'};
  await writeFile(`work/evidence/grand-artisans/adoption-guarded-${name}.json`,JSON.stringify(data,null,2)+'\n');console.log(JSON.stringify(data));
 }
} finally {await server.close();}
