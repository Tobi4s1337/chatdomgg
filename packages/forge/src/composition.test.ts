import {it,expect} from 'vitest';
import {createHome} from '@chatdom/content';
import {FORGE_MOTIFS,type HousePartPlan} from '@chatdom/shared';
import {assembleForge,checkForge,findForgeSockets,forgeStyleKit} from './index';
it('free-word plans remain native registered connected constructions, without cells from the model',()=>{
 const home=createHome('house','tide',0),sockets=findForgeSockets(home);
 for(const [i,motif]of FORGE_MOTIFS.entries()){
  const kind=(['chimney','lantern','weathervane'] as const)[i%3]!,socket=sockets.find(s=>s.kind===kind)!;
  const plan:HousePartPlan={version:2,kind,motif,finish:'native',accent:i%2?'leaves':'stars'};
  expect(checkForge(assembleForge(plan,forgeStyleKit('tide'),socket),home).solidCells).toBeGreaterThan(80);
 }
});
