import {describe,expect,it} from 'vitest';
import {generateSettlementPlan} from './generator';
// The independent geometry audit is also executable from Node for review maps.
// @ts-expect-error standalone mjs module
import {audit,compare} from '../../../testing/settlement-audit.mjs';

describe('installed settlement fixtures',()=>{
  for(const seed of ['lanternmere','willowmere'])for(const tier of ['hamlet','town'] as const){
    it(`${seed}/${tier}: complete reservations, connected frontages and graded public streets`,()=>{
      const config={seed,tier,firstYear:tier==='hamlet'?2025:2022,year:2026};
      const plan=generateSettlementPlan(config);
      expect(plan.homes).toHaveLength(tier==='hamlet'?24:240);
      expect(audit(plan).failures).toEqual([]);
      expect(plan.castle.centre[1]).toBeGreaterThan(plan.market.elevation+8);
      expect(plan.quarters.every(quarter=>plan.courts.some(court=>court.nodeId===quarter.rootNodeId&&quarter.courtIds.includes(court.id)))).toBe(true);
      expect(JSON.stringify(plan).length).toBeLessThan(1024*1024);
      expect(generateSettlementPlan(config)).toEqual(plan);
    },20000);
  }
  it('activates the same reserved addresses when a hamlet becomes a town',()=>{
    const config={seed:'willowmere',firstYear:2025,year:2026};
    const hamlet=generateSettlementPlan({...config,tier:'hamlet'}),town=generateSettlementPlan({...config,tier:'town'});
    expect(compare(hamlet,town,'tier growth')).toEqual([]);
    for(const home of hamlet.homes)expect(town.homes.find(next=>next.id===home.id)).toEqual(home);
  });
});
