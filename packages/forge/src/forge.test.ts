import {describe,it,expect} from 'vitest';
import { createHome, createTideHome, createHearthHome } from '@chatdom/content';
import { HousePartPlanSchema } from '@chatdom/shared';
import { assembleForge, checkForge, findForgeSockets, forgeStyleKit, planLocalForge, createForgeRefusalGate } from './index';
describe('words become retained house attachments',()=>{
  it('assembles three connected parts against actual roofs/fronts in each native kit without changing the source',()=>{
    const signatures=new Set<string>();
    for(const home of [createTideHome('house',0),createTideHome('house',1),createTideHome('house',2),createHearthHome('house',0),createHearthHome('house',1),createHearthHome('house',2)]){const sockets=findForgeSockets(home);expect(sockets.length,home.id+':'+sockets.map(s=>s.kind).join(',')).toBe(3);for(const socket of sockets){const plan=planLocalForge(socket.kind==='chimney'?'dragon chimney':socket.kind==='lantern'?'moon lantern':'owl weathervane');checkForge(assembleForge(plan,forgeStyleKit(home.styleId as 'hearth'|'tide'),socket),home);}}
    for(const family of ['hearth','tide','grove'] as const){
      const home=createHome('house',family,0),before=JSON.stringify(home),sockets=findForgeSockets(home);
      expect(sockets.map(s=>s.kind)).toEqual(['chimney','weathervane','lantern']);
      for(const words of ['!forge a chimney shaped like a sleeping dragon','a crescent moon lantern','an owl weathervane']){
        const plan=planLocalForge(words),socket=sockets.find(s=>s.kind===plan.kind)!;
        const result=assembleForge(plan,forgeStyleKit(family),socket);
        expect(checkForge(result,home).solidCells).toBeGreaterThan(80);
        expect(assembleForge(plan,forgeStyleKit(family),socket)).toEqual(result);
        if(plan.kind==='chimney')signatures.add(JSON.stringify(result.blueprint.boxes.map(b=>[b.from,b.to])));
        expect(()=>checkForge(result,{...home,id:'changed-home'})).toThrow('changed');
      }
      expect(JSON.stringify(home)).toBe(before);
    }
    expect(signatures.size).toBe(3);
    expect(HousePartPlanSchema.safeParse({version:1,kind:'chimney',motif:'sleeping-dragon',approved:true}).success).toBe(false);
    expect(()=>planLocalForge('!forge something unrecognised')).toThrow();
    const gate=createForgeRefusalGate();expect(gate.beat(0)).toEqual({kind:'refusal',variant:0});expect(gate.beat(599999)).toBe(null);expect(gate.beat(600000)).toEqual({kind:'refusal',variant:0});
  });
});
