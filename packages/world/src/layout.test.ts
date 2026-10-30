import { expect,it } from 'vitest';
import { HOME_DEPTH_METRES } from '@chatdom/shared';
import { generateKingdom, terrainHeight } from './layout';
it('uses one generator for a small hamlet and hundreds in a town',()=>{
 const hamlet=generateKingdom({seed:'test',tier:'hamlet',firstYear:2025,year:2026});
 const town=generateKingdom({seed:'test',tier:'town',firstYear:2022,year:2026});
 expect(hamlet.homes).toHaveLength(24);expect(town.homes).toHaveLength(240);
 expect(town).toEqual(generateKingdom(town.config));
 for(const h of town.homes) expect(Math.abs(terrainHeight(town,h.position[0],h.position[2])-h.position[1])).toBeLessThan(.01);
});
it.each(['hamlet','town'] as const)('grounds every current %s footprint, threshold and street edge without flattening future rear land',tier=>{
 const layout=generateKingdom({seed:'lanternmere',tier,firstYear:tier==='hamlet'?2025:2022,year:2026});
 const rendered=(x:number,z:number):number=>{
  const ix=Math.floor(x),iz=Math.floor(z),u=x-ix,v=z-iz;
  const a=Math.fround(terrainHeight(layout,ix,iz)),b=Math.fround(terrainHeight(layout,ix,iz+1));
  const c=Math.fround(terrainHeight(layout,ix+1,iz+1)),d=Math.fround(terrainHeight(layout,ix+1,iz));
  return u<=v?a+u*(c-b)+v*(b-a):a+u*(d-a)+v*(c-d);
 };
 for(const home of layout.homes){
  const depth=HOME_DEPTH_METRES[home.tier],street=home.rotation===0?home.lot.maxZ+4:home.lot.minZ-4;
  const minZ=home.rotation===0?street-4-depth:street+4;
  // Only the current allowed depth is mandatory terrain. A fixed-size Hearth blueprint puts
  // this occupied footprint against +Z; its unused 16 m rear reservation need not be a plinth.
  for(let z=minZ;z<=minZ+depth;z++)for(let x=home.lot.minX;x<=home.lot.maxX;x++){
   if(Math.abs(terrainHeight(layout,x,z)-home.position[1])>1e-10)throw new Error(`Uneven current footprint ${home.id} at ${x},${z}`);
  }
  for(let z=minZ+.375;z<=minZ+depth-.375;z+=.5)for(let x=home.position[0]-3.625;x<=home.position[0]+3.625;x+=.5){
   if(Math.abs(rendered(x,z)-home.position[1])>1e-10)throw new Error(`Floating/buried foundation ${home.id} at ${x},${z}`);
  }
  for(let dz=-4;dz<=4;dz+=.5)expect(rendered(home.position[0],street+dz)).toBe(home.position[1]);
 }
});
it('keeps rounded footprint feathers continuous and independent of iteration order',()=>{
 const layout=generateKingdom({seed:'terrain-feathers',tier:'town',firstYear:2022,year:2026});
 const reversed={...layout,quarters:[...layout.quarters].reverse()};
 for(const x of [-139,-125,-124,-30,0,30,124,125,139])for(let z=-22;z<=190;z+=.25){
  const height=terrainHeight(layout,x,z);
  if(Math.abs(height-terrainHeight(reversed,x,z))>1e-10)throw new Error(`Quarter order changes terrain at ${x},${z}`);
  if(Math.abs(height-terrainHeight(layout,x,z+1e-5))>.001)throw new Error(`Discontinuous quarter join at ${x},${z}`);
 }
 expect(terrainHeight(layout,0,-26)).toBe(13);
 expect(terrainHeight(layout,0,-20)).toBe(9);
});
it('lets unused rear land roll and terraforms growth without changing the reserved address',()=>{
 const layout=generateKingdom({seed:'lanternmere',tier:'hamlet',firstYear:2025,year:2026});
 const home=layout.homes.find(home=>home.tier==='hut'&&home.rotation===2)!;
 const x=home.position[0],z=home.lot.maxZ;
 expect(Math.abs(terrainHeight(layout,x,z)-home.position[1])).toBeGreaterThan(.05);
 const grown={...home,tier:'hall' as const,allowedDepth:16};
 const next={...layout,homes:layout.homes.map(plot=>plot===home?grown:plot)};
 expect(terrainHeight(next,x,z)).toBe(home.position[1]);
 expect({id:grown.id,slot:grown.slot,position:grown.position,lot:grown.lot}).toEqual({id:home.id,slot:home.slot,position:home.position,lot:home.lot});
 // Both snapshots remain usable after the new terrain is queried.
 expect(Math.abs(terrainHeight(layout,x,z)-home.position[1])).toBeGreaterThan(.05);
 const heights=[-42,-36,-27,-18,0,18,27,36,42].map(x=>terrainHeight(layout,x,62));
 expect(Math.max(...heights)-Math.min(...heights)).toBeGreaterThan(1);
});
it.each(['hamlet','town'] as const)('keeps the irregular %s shoreline inside the water plane',tier=>{
 for(const seed of ['lanternmere','willowmere','low-bank']){
  const layout=generateKingdom({seed,tier,firstYear:tier==='hamlet'?2025:2022,year:2026}),lake=layout.lake;
  for(let i=0;i<=100;i++){
   const t=i/100;
   for(const [x,z]of [[lake.x-lake.radiusX*1.3,lake.z+lake.radiusZ*(t*2.6-1.3)],
    [lake.x+lake.radiusX*1.3,lake.z+lake.radiusZ*(t*2.6-1.3)],
    [lake.x+lake.radiusX*(t*2.6-1.3),lake.z-lake.radiusZ*1.3],
    [lake.x+lake.radiusX*(t*2.6-1.3),lake.z+lake.radiusZ*1.3]]){
    if(terrainHeight(layout,x!,z!)<=lake.level)throw new Error(`Water plane cuts a wet bank for ${seed} at ${x},${z}`);
   }
  }
 }
});
it('preserves old addresses during tier growth, new years and late settlement',()=>{
 const cfg={seed:'persist',tier:'hamlet' as const,firstYear:2025,year:2026};
 const old=generateKingdom(cfg),next=generateKingdom({...cfg,tier:'town',year:2027});
 for(const h of old.homes) {
   const found=next.homes.find(n=>n.id===h.id)!;
   expect({...found,slot:h.slot}).toEqual(h);
 }
 for(const a of next.homes) for(const b of next.homes) if(a.id!==b.id) {
  const overlap=a.lot.minX<b.lot.maxX&&a.lot.maxX>b.lot.minX&&a.lot.minZ<b.lot.maxZ&&a.lot.maxZ>b.lot.minZ;
  expect(overlap).toBe(false);
 }
});
