/** Deterministic proof and microbenchmark of cardinal AABB transformation. No source edits. */
import {createServer} from 'vite';
import {writeFile} from 'node:fs/promises';
const server=await createServer({root:'/tmp/grand-artisans-candidate',configFile:false,optimizeDeps:{noDiscovery:true},server:{middlewareMode:true,watch:null,hmr:false,ws:false},logLevel:'error'});
try {
 const {placeBox}=await server.ssrLoadModule('/packages/world/src/grand/artisans/adoption/index.ts');
 const {createQuay,createQuaySection,createShip,createLighthouse}=await server.ssrLoadModule('/packages/world/src/grand/artisans/harbour/index.ts');
 const {createWindmill}=await server.ssrLoadModule('/packages/world/src/grand/artisans/fields/index.ts');
 const kits=[createQuay('bounds'),...(['frontage','pier','landing'].flatMap(kind=>[-4,-2,0,2,4].map(s=>createQuaySection('bounds',kind,s)))),createShip('bounds'),createLighthouse('bounds'),createWindmill('bounds')];
 function baseline(piece,at,turns){const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];for(const box of piece.boxes){const b=placeBox(box,at,turns);for(let d=0;d<3;d++){min[d]=Math.min(min[d],b.min[d]);max[d]=Math.max(max[d],b.min[d]+b.size[d]);}}return {min,max};}
 const cache=new WeakMap();
 function cached(piece,at,turns){let local=cache.get(piece);if(!local){const b=baseline(piece,[0,0,0],0);local={min:b.min,size:b.max.map((v,i)=>v-b.min[i]),colour:'#000000'};cache.set(piece,local);}const b=placeBox(local,at,turns);return {min:b.min,max:b.min.map((v,i)=>v+b.size[i])};}
 let comparisons=0;
 for(const k of kits)for(const turn of [-4,-3,-2,-1,0,1,2,3,4,7])for(const at of [[0,0,0],[-300,22,-400],[333,44,777],[10000,100,-9000]]){const a=baseline(k,at,turn),b=cached(k,at,turn);if(JSON.stringify(a)!==JSON.stringify(b))throw Error('bounds mismatch '+k.id);comparisons++;}
 const loops=1200;let sink=0,start=performance.now();for(let i=0;i<loops;i++)sink+=baseline(kits[i%kits.length],[i-600,48,-i],i%4).min[0];const baselineMs=performance.now()-start;
 start=performance.now();for(let i=0;i<loops;i++)sink-=cached(kits[i%kits.length],[i-600,48,-i],i%4).min[0];const cachedMs=performance.now()-start;
 const data={checkpoint:'75bfdb5',kitCount:kits.length,comparisons,loops,baselineMs,cachedMs,sink,notes:'Cached local AABB transformed as one half-open box; 0/90/180/270-degree rotations preserve axis alignment exactly. This microbenchmark is not an end-to-end source-run validation. Proposed cache lifetime is one sitePlacements call, after validating all constituent boxes once.'};
 await writeFile('work/evidence/grand-artisans/adoption-perf-bounds.json',JSON.stringify(data,null,2)+'\n');console.log(JSON.stringify(data));
} finally {await server.close();}
