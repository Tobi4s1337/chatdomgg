import { expect,it } from 'vitest';
import { generateKingdom, terrainHeight } from './layout';
it('uses one generator for a small hamlet and hundreds in a town',()=>{
 const hamlet=generateKingdom({seed:'test',tier:'hamlet',firstYear:2025,year:2026});
 const town=generateKingdom({seed:'test',tier:'town',firstYear:2022,year:2026});
 expect(hamlet.homes).toHaveLength(24);expect(town.homes).toHaveLength(240);
 expect(town).toEqual(generateKingdom(town.config));
 for(const h of town.homes) expect(Math.abs(terrainHeight(town,h.position[0],h.position[2])-h.position[1])).toBeLessThan(.01);
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
