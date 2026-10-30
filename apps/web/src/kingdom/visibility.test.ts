import { describe,expect,it } from 'vitest';
import { blueprintOccludes,windowOccluded } from './visibility';
import { STYLES } from '@chatdom/content';
import { createCastlePlan } from '@chatdom/world';
import type { VoxelBlueprint } from '@chatdom/shared';
import { createCastleContent } from './castle-content';
const shell:VoxelBlueprint={version:1,id:'visibility-test',styleId:STYLES.hearth.id,kind:'home',lattice:'build',size:[16,16,16],windows:[],boxes:[{from:[0,0,0],to:[16,16,16],material:1},{from:[2,0,2],to:[14,14,14],material:0},{from:[6,0,14],to:[10,10,16],material:0}]};
describe('window name occlusion',()=>{
  it('rejects a name through a wall but sees through an authored open entrance',()=>{
    expect(blueprintOccludes(shell,[1,5,20],[1,5,10])).toBe(true);
    expect(blueprintOccludes(shell,[8,5,20],[8,5,10])).toBe(false);
    expect(blueprintOccludes(shell,[8,5,20],[8,5,-2])).toBe(true);
  });
  it('respects paint order and restored solid boxes',()=>{
    expect(blueprintOccludes({...shell,boxes:[...shell.boxes,{from:[6,0,14],to:[10,10,16],material:2}]},[8,5,20],[8,5,10])).toBe(true);
  });
  it('transforms world metres into a rotated and translated home',()=>{
    const homes=[{slot:0,blueprint:shell,position:[10,2,10] as const,yaw:Math.PI/2}];
    expect(windowOccluded(homes,[12.5,2.625,9],[11.25,2.625,9])).toBe(false);
    expect(windowOccluded(homes,[12.5,2.625,9.875],[11.25,2.625,9.875])).toBe(true);
    expect(windowOccluded(homes,[0,0,0],[1,1,1])).toBe(false);
  });
  it('uses the placed compound walls while retaining its real gate opening',()=>{
    const {buildings}=createCastleContent(createCastlePlan());
    expect(windowOccluded(buildings,[-14,23,-30],[-14,23,-44])).toBe(true);
    expect(windowOccluded(buildings,[0,22,-30],[0,22,-44])).toBe(false);
  });
});
