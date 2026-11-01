import {createServer} from 'vite';
import {readFile,writeFile} from 'node:fs/promises';
const local=await readFile('packages/world/src/grand/artisans/adoption/index.ts','utf8');
const channels=(process.env.ARTISAN_CHANNELS??'tobi4s_,the_aggman,pinkkittyrose').split(',');
for(const radius of [48,96]) {
 const plugin={name:'adoption-radius-study',enforce:'pre',transform(code,id){if(id.split('?')[0].endsWith('/packages/world/src/grand/artisans/adoption/index.ts')) {const marker=/r<=(?:48|96)/;if(!marker.test(local))throw Error('radius mismatch');return {code:local.replace(marker,`r<=${radius}`),map:null};}}};
 const server=await createServer({root:'/tmp/grand-adoption-radius-study',configFile:false,plugins:[plugin],optimizeDeps:{noDiscovery:true},server:{middlewareMode:true,watch:null,hmr:false,ws:false},logLevel:'error'});
 try {
  const {GRAND_CHANNELS}=await server.ssrLoadModule('/apps/web/src/grand/channels.ts');
  const {generateGrandLand}=await server.ssrLoadModule('/packages/world/src/grand/generate.ts');
  const {GRAND_ARTISAN_KITS}=await server.ssrLoadModule('/packages/world/src/grand/artisans/index.ts');
  for(const name of channels) {
   const channel=GRAND_CHANNELS.find(c=>c.login.toLowerCase()===name.toLowerCase());const start=performance.now();
   const land=generateGrandLand(channel.seed);const placements=GRAND_ARTISAN_KITS.compose.flatMap(fn=>fn(land));
   const data={channel:name,radius,treeCount:land.treeCount,placements:placements.map(p=>({id:p.piece.id,at:p.at,turns:p.turns,boxes:p.piece.boxes.length})),millis:performance.now()-start,note:'CPU source generation with current backtracking fitter, default clearance and pre-flora reservation; radius altered only in Vite memory.'};
   await writeFile(`work/evidence/grand-artisans/adoption-radius-${radius}-${name}.json`,JSON.stringify(data,null,2)+'\n');console.log(JSON.stringify(data));
  }
 } finally {await server.close();}
}
