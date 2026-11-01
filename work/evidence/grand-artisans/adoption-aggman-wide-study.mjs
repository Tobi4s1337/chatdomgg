import {createServer} from 'vite';
import {readFile,writeFile} from 'node:fs/promises';
const local=await readFile('packages/world/src/grand/artisans/adoption/index.ts','utf8');
for(const radius of [144,192]) {
 const plugin={name:'adoption-wide-shore-study',enforce:'pre',transform(code,id){if(id.split('?')[0].endsWith('/packages/world/src/grand/artisans/adoption/index.ts')) {const marker=/r<=(?:48|96)/;if(!marker.test(local))throw Error('radius mismatch');return {code:local.replace(marker,`r<=${radius}`),map:null};}}};
 const server=await createServer({root:'/tmp/grand-adoption-radius-study',configFile:false,plugins:[plugin],optimizeDeps:{noDiscovery:true},server:{middlewareMode:true,watch:null,hmr:false,ws:false},logLevel:'error'});
 try {
  const {GRAND_CHANNELS}=await server.ssrLoadModule('/apps/web/src/grand/channels.ts');
  const {generateGrandLand}=await server.ssrLoadModule('/packages/world/src/grand/generate.ts');
  const {GRAND_ARTISAN_KITS}=await server.ssrLoadModule('/packages/world/src/grand/artisans/index.ts');
  const channel=GRAND_CHANNELS.find(c=>c.login.toLowerCase()==='the_aggman');const start=performance.now();
  const land=generateGrandLand(channel.seed);const placements=GRAND_ARTISAN_KITS.compose.flatMap(fn=>fn(land));
  const {size,ground,water,seaLevel,sites}=land;
  const connected=new Uint8Array(size*size),queue=new Int32Array(size*size);let front=0,back=0;
  function push(x,z){const i=x+z*size;if(!connected[i]&&water[i]===seaLevel&&ground[i]<seaLevel){connected[i]=1;queue[back++]=i;}}
  for(let x=0;x<size;x++){push(x,0);push(x,size-1);}for(let z=1;z<size-1;z++){push(0,z);push(size-1,z);}
  while(front<back){const i=queue[front++],x=i%size,z=Math.floor(i/size);if(x>0)push(x-1,z);if(x+1<size)push(x+1,z);if(z>0)push(x,z-1);if(z+1<size)push(x,z+1);}
  const harbour=sites.harbour, localCounts={seaConnected:0,seaDisconnected:0,raisedWater:0,dry:0};
  for(let z=Math.max(0,harbour.z-radius);z<=Math.min(size-1,harbour.z+radius);z++)for(let x=Math.max(0,harbour.x-radius);x<=Math.min(size-1,harbour.x+radius);x++){const i=x+z*size;if(water[i]>seaLevel)localCounts.raisedWater++;else if(water[i]===seaLevel&&ground[i]<seaLevel)localCounts[connected[i]?'seaConnected':'seaDisconnected']++;else localCounts.dry++;}
  const at=harbour.x+harbour.z*size;
  const data={channel:channel.login,radius,sites,seaLevel,nominalHarbour:{ground:ground[at],water:water[at],boundarySeaConnected:!!connected[at]},localCounts,treeCount:land.treeCount,placements:placements.map(p=>({id:p.piece.id,at:p.at,turns:p.turns,boxes:p.piece.boxes.length})),millis:performance.now()-start,note:'CPU-only actual source generation, default clearance and pre-flora reservation. Boundary-connected sea is 4-neighbour water==seaLevel and ground<seaLevel; no hydrology graph is implied.'};
  await writeFile(`work/evidence/grand-artisans/adoption-wide-${radius}-the_aggman.json`,JSON.stringify(data,null,2)+'\n');console.log(JSON.stringify(data));
 } finally {await server.close();}
}
