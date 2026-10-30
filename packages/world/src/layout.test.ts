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
it.each(['hamlet','town'] as const)('keeps every %s reserved lot and actual foundation on its authored elevation',tier=>{
 const layout=generateKingdom({seed:'lanternmere',tier,firstYear:tier==='hamlet'?2025:2022,year:2026});
 const rendered=(x:number,z:number):number=>{
  const ix=Math.floor(x),iz=Math.floor(z),u=x-ix,v=z-iz;
  const a=Math.fround(terrainHeight(layout,ix,iz)),b=Math.fround(terrainHeight(layout,ix,iz+1));
  const c=Math.fround(terrainHeight(layout,ix+1,iz+1)),d=Math.fround(terrainHeight(layout,ix+1,iz));
  return u<=v?a+u*(c-b)+v*(b-a):a+u*(d-a)+v*(c-d);
 };
 for(const home of layout.homes){
  // Full 16 m reservation, including an eventual hall, not merely today's home centre.
  for(let z=home.lot.minZ;z<=home.lot.maxZ;z++)for(let x=home.lot.minX;x<=home.lot.maxX;x++){
   if(Math.abs(terrainHeight(layout,x,z)-home.position[1])>1e-10)throw new Error(`Uneven reserved lot ${home.id} at ${x},${z}`);
  }
  const depth=HOME_DEPTH_METRES[home.tier],street=home.rotation===0?home.lot.maxZ+4:home.lot.minZ-4;
  const minZ=home.rotation===0?street-4-depth:street+4;
  // Blueprint's actual foundation starts three build cells inside its rectangular footprint.
  for(let z=minZ+.375;z<=minZ+depth-.375;z+=.5)for(let x=home.position[0]-3.625;x<=home.position[0]+3.625;x+=.5){
   if(Math.abs(rendered(x,z)-home.position[1])>1e-10)throw new Error(`Floating/buried foundation ${home.id} at ${x},${z}`);
  }
 }
});
it('keeps overlapping quarter feathers continuous and independent of iteration order',()=>{
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
