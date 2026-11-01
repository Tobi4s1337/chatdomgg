/** CPU-only producer/adoption evidence. No web server is listened and no capture slot is used. */
import { createServer } from 'vite';
import { writeFile } from 'node:fs/promises';
const server = await createServer({root:'/tmp/grand-artisans-candidate',configFile:false,server:{middlewareMode:true,watch:null,hmr:false,ws:false},logLevel:'error'});
try {
  const { GRAND_CHANNELS } = await server.ssrLoadModule('/apps/web/src/grand/channels.ts');
  const { generateGrandLand } = await server.ssrLoadModule('/packages/world/src/grand/generate.ts');
  const { GRAND_ARTISAN_KITS } = await server.ssrLoadModule('/packages/world/src/grand/artisans/index.ts');
  for(const name of (process.env.ARTISAN_CHANNELS ?? 'tobi4s_').split(',')) {
    const channel=GRAND_CHANNELS.find(c=>c.login.toLowerCase()===name.toLowerCase());
    if(!channel)throw new Error('Unknown source channel '+name);
    const started=performance.now(), land=generateGrandLand(channel.seed), placements=GRAND_ARTISAN_KITS.compose.flatMap(fn=>fn(land));
    const result={channel:channel.login,size:land.size,treeCount:land.treeCount,stats:land.stats,structureCount:land.structureCount,structureColours:land.structureColours.length,placements:placements.map(p=>({id:p.piece.id,at:p.at,turns:p.turns,boxes:p.piece.boxes.length})),millis:performance.now()-started,meaning:'SIMULATED independent source generation and render-only kit fit; no physical adoption or GPU evidence'};
    const suffix=process.env.ARTISAN_EVIDENCE_SUFFIX ?? '';
    if(!/^[a-z0-9-]*$/.test(suffix))throw new Error('Invalid evidence suffix');
    await writeFile(`work/evidence/grand-artisans/source-${name}${suffix}.json`,JSON.stringify(result,null,2)+'\n');
    console.log(JSON.stringify(result));
  }
} finally {await server.close();}
