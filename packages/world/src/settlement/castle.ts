import type {Vec3} from '@chatdom/shared';
import type {CastlePlan} from './types';

export function createCastlePlan():CastlePlan {
  const modules:CastlePlan['modules'][number][]=[{id:'castle:keep',kind:'keep',position:[-16,20,-80],rotation:0,size:[32,31,32]}];
  for(const [i,position] of [[-32,20,-84],[20,20,-84],[-32,20,-48],[20,20,-48]].entries())
    modules.push({id:`castle:tower:${i}`,kind:'tower',position:position as unknown as Vec3,rotation:0,size:[12,24,12]});
  modules.push({id:'castle:gatehouse',kind:'gatehouse',position:[-8,20,-46],rotation:0,size:[16,18,10]});
  for(const [i,x] of [-20,8].entries())modules.push({id:`castle:front:${i}`,kind:'curtain',position:[x,20,-39],rotation:0,size:[12,10,3]});
  for(const [i,x] of [-20,0].entries())modules.push({id:`castle:rear:${i}`,kind:'curtain',position:[x,20,-84],rotation:0,size:[20,10,3]});
  for(const [i,x] of [-32,29].entries())modules.push({id:`castle:side:${i}`,kind:'curtain',position:[x,20,-48],rotation:1,size:[24,10,3]});
  return {centre:[0,20,-60],bounds:{minX:-32,maxX:32,minZ:-84,maxZ:-36},modules,
    court:{id:'castle:court',boundary:[[-20,-48],[20,-48],[20,-36],[-20,-36]],elevation:20,nodeId:'castle:gate'},
    gateNodeId:'castle:gate',beaconModuleId:'castle:keep'};
}
