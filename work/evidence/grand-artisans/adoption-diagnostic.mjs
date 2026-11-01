import { createServer } from 'vite';
const server=await createServer({root:'/tmp/grand-artisans-candidate',configFile:false,server:{middlewareMode:true,watch:null,hmr:false,ws:false},logLevel:'error'});
try {
 const { GRAND_CHANNELS }=await server.ssrLoadModule('/apps/web/src/grand/channels.ts');
 const { generateGrandLand }=await server.ssrLoadModule('/packages/world/src/grand/generate.ts');
 const { GRAND_ARTISAN_KITS,sitePlacements }=await server.ssrLoadModule('/packages/world/src/grand/artisans/index.ts');
 const { createWindmill }=await server.ssrLoadModule('/packages/world/src/grand/artisans/fields/index.ts');
 const { createLighthouse }=await server.ssrLoadModule('/packages/world/src/grand/artisans/harbour/index.ts');
 const land=generateGrandLand(GRAND_CHANNELS.find(c=>c.login==='tobi4s_').seed);
 const reached={}; const open=sitePlacements(land,(k,b)=>{(reached[k]??=[]).push(b);return true});
 const actual=GRAND_ARTISAN_KITS.compose.flatMap(fn=>fn(land));
 const species=['oak','lime','birch','autumn-gold','autumn-red','pine','spruce','cherry','teal','willow','shrub','hero-gold','hero-teal','hero-cherry'];
 const rejected={};
 sitePlacements(land,(kind,b)=>{
   const causes=new Set();const {town,castle}=land.sites,c=Math.cos(town.angle),s=Math.sin(town.angle);
   for(let i=0;i<land.treeCount;i++){const o=i*6,x=land.trees[o],z=land.trees[o+1],y=land.trees[o+2],e=GRAND_ARTISAN_KITS.trees.extent(species[land.trees[o+3]],land.trees[o+5]);if(x+e.radius>=b.min[0]&&x-e.radius<b.max[0]&&z+e.radius>=b.min[2]&&z-e.radius<b.max[2]&&y+e.height>=b.min[1]&&y-8<b.max[1])causes.add('tree');}
   for(let z=b.min[2];z<b.max[2];z++)for(let x=b.min[0];x<b.max[0];x++){if(land.cover[x+z*land.size]===13)causes.add('reserved');const dx=x-town.x,dz=z-town.z,u=(dx*c+dz*s)/town.rx,v=(-dx*s+dz*c)/town.rz;if(u*u+v*v<1.44)causes.add('town');if((x-castle.x)**2+(z-castle.z)**2<(castle.radius*1.3)**2)causes.add('castle');}
   const data=rejected[kind]??={total:0,clear:0,tree:0,reserved:0,town:0,castle:0};data.total++;if(!causes.size)data.clear++;for(const c of causes)data[c]++;return false;
 });

 const projection=kit=>{let min=Math.min(...kit.boxes.map(b=>b.min[1]));const a=new Set;for(const b of kit.boxes)if(b.min[1]===min)for(let z=b.min[2];z<b.min[2]+b.size[2];z++)for(let x=b.min[0];x<b.min[0]+b.size[0];x++)a.add(`${x},${z}`);return [...a].map(s=>s.split(',').map(Number))};
 const columns=(foot,x,z)=>{let lo=Infinity,hi=-Infinity,wet=0,out=0;for(const [dx,dz] of foot){const X=x+dx,Z=z+dz;if(X<0||Z<0||X>=land.size||Z>=land.size){out++;continue}const i=X+Z*land.size,g=land.ground[i],w=land.water[i];lo=Math.min(lo,g);hi=Math.max(hi,g);if(w>g)wet++}return {lo,hi,range:hi-lo,wet,out}};
 const ring=(rmax)=>{const v=[[0,0]];for(let r=12;r<=rmax;r+=12)for(let z=-r;z<=r;z+=12)for(let x=-r;x<=r;x+=12)if(Math.max(Math.abs(x),Math.abs(z))===r)v.push([x,z]);return v};
 const f=land.sites.fields,head=land.sites.headland, mill=projection(createWindmill('x')),tower=projection(createLighthouse('x'));
 const summarize=(arr,kind)=>({candidates:arr.length,dry:arr.filter(a=>a.wet===0&&a.out===0).length,fit:arr.filter(a=>a.wet===0&&a.out===0&&a.range<=4&&(kind!=='tower'||a.lo>land.seaLevel)).length,minDryRange:Math.min(...arr.filter(a=>a.wet===0&&a.out===0).map(a=>a.range)),best:arr.filter(a=>a.wet===0&&a.out===0).sort((a,b)=>a.range-b.range).slice(0,3)});
 const ms=ring(Math.min(96,Math.floor(f.radius))).map(([x,z])=>({x:Math.round(f.x)+x,z:Math.round(f.z)+z,...columns(mill,Math.round(f.x)+x,Math.round(f.z)+z)}));
 const hs=ring(60).map(([x,z])=>({x:Math.round(head.x)+x,z:Math.round(head.z)+z,...columns(tower,Math.round(head.x)+x,Math.round(head.z)+z)}));
 const h=land.sites.harbour,turns=((Math.round((h.facing+Math.PI/2)/(Math.PI/2))%4)+4)%4;
 function rot(x,z,cell=false){for(let i=0;i<turns;i++)[x,z]=[-z-(cell?1:0),x];return [x,z]}
 const qq=[];for(let rz=-48;rz<=48;rz+=8)for(let rx=-48;rx<=48;rx+=8){const [ox,oz]=rot(rx,rz);let dry=0,tall=0,wet=0;for(let z=21;z<23;z++)for(let x=-61;x<62;x++){const [xx,zz]=rot(x,z,true);const X=h.x+ox+xx,Z=h.z+oz+zz;if(X<0||Z<0||X>=land.size||Z>=land.size){wet++;continue}const i=X+Z*land.size,g=land.ground[i],w=land.water[i];if(g>land.seaLevel&&g<=land.seaLevel+9&&w<=g)dry++;else if(g>land.seaLevel+9)tall++;else wet++}qq.push({rx,rz,dry,tall,wet})}
 console.log(JSON.stringify({sea:land.seaLevel,sites:land.sites,open:open.map(p=>({id:p.piece.id,at:p.at})),actual:actual.map(p=>({id:p.piece.id,at:p.at})),guardReasons:rejected,guardReached:Object.fromEntries(Object.entries(reached).map(([k,v])=>[k,v.length])),mill:summarize(ms,'mill'),lighthouse:summarize(hs,'tower'),quay:{candidates:qq.length,passingJoin:qq.filter(q=>q.dry===246).length,best:qq.sort((a,b)=>b.dry-a.dry).slice(0,3)}},null,2));
} finally {await server.close()}
