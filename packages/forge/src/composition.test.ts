import {it,expect} from 'vitest';
import {createHome} from '@chatdom/content';
import {ANVIL_HERO_DRAGON_SURFACE} from '@chatdom/content/anvil-hero';
import {MAT,STYLES} from '@chatdom/content/materials';
import {FORGE_MOTIFS,type HousePartPlan} from '@chatdom/shared';
import {rasterizeBlueprint} from '@chatdom/voxel';
import {assembleForge,checkForge,findForgeSockets,forgeStyleKit} from './index';
it('free-word plans remain native registered connected constructions, without cells from the model',()=>{
 const home=createHome('house','tide',0),sockets=findForgeSockets(home);
 for(const [i,motif]of FORGE_MOTIFS.entries()){
  const kind=(['chimney','lantern','weathervane'] as const)[i%3]!,socket=sockets.find(s=>s.kind===kind)!;
  const plan:HousePartPlan={version:2,kind,motif,finish:'native',accent:i%2?'leaves':'stars'};
  expect(checkForge(assembleForge(plan,forgeStyleKit('tide'),socket),home).solidCells).toBeGreaterThan(80);
 }
});

it.each(['hearth','tide','grove'] as const)('%s dragon finishes and inlays preserve the horns, stack and other authored details',family=>{
 const home=createHome('house',family,0),socket=findForgeSockets(home).find(s=>s.kind==='chimney')!,kit=forgeStyleKit(family);
 const make=(finish:'native'|'copper'|'ceramic',accent:'none'|'stars'|'leaves'|'scales')=>rasterizeBlueprint(assembleForge({version:2,kind:'chimney',motif:'sleeping-dragon',finish,accent},kit,socket).blueprint).voxels;
 const native=make('native','none'),surface=ANVIL_HERO_DRAGON_SURFACE[family];
 for(const finish of ['native','copper','ceramic'] as const){
  const plain=make(finish,'none'),material=finish==='native'?surface:finish==='copper'?MAT.forgeCopper:MAT.cream;
  for(const accent of ['stars','leaves','scales'] as const){
   const cells=make(finish,accent),inlay=accent==='leaves'?MAT.moss:STYLES[family].trim;
   let damagedDetails=0,wrongSurface=0,finishedCells=0,inlayCells=0;
   for(let i=0;i<native.length;i++){
    if(native[i]!==surface){if(cells[i]!==native[i]||plain[i]!==native[i])damagedDetails++;continue;}
    if(plain[i]!==material||cells[i]!==material&&cells[i]!==inlay)wrongSurface++;
    if(cells[i]===material)finishedCells++;
    if(cells[i]!==plain[i])inlayCells++;
   }
   expect({damagedDetails,wrongSurface},`${finish}/${accent}`).toEqual({damagedDetails:0,wrongSurface:0});
   expect(finishedCells).toBeGreaterThan(100);
   // Grove's native moss surface already has the leaves' colour.
   if(inlay!==material)expect(inlayCells,`${finish}/${accent}`).toBeGreaterThan(0);
  }
 }
});
