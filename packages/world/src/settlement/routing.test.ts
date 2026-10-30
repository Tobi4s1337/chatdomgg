import {expect,it} from 'vitest';
import {frontagePath,gradeRoute} from './routing';
import {transformCardinalPoint} from './geometry';

it('keeps the entire two-metre entrance ribbon outside its own cardinal reservation',()=>{
  for(const turn of [0,1,2,3] as const)for(const side of [-5,0,5]){
    const front=transformCardinalPoint([13,7,-21],turn,[0,0,0]);
    const outward=transformCardinalPoint([0,0,0],turn,[0,0,1]);
    const join=transformCardinalPoint(front,turn,[side,0,8]);
    const points=frontagePath(front,outward,join);
    const local=points.map(p=>transformCardinalPoint([0,0,0],((4-turn)%4) as 0|1|2|3,[p[0]-front[0],0,p[1]-front[2]]));
    expect(local[0]).toEqual([0,0,0]);
    for(let i=1;i<local.length;i++){
      const a=local[i-1]!,b=local[i]!,dx=b[0]-a[0],dz=b[2]-a[2],length=Math.hypot(dx,dz);
      if(length<1e-8)continue;
      for(const p of [a,b])for(const side of [-1,1])expect(p[2]+side*dx/length).toBeGreaterThanOrEqual(-1e-10);
    }
  }
});

it('keeps flat junction contact and measures grade along actual bent length',()=>{
  const path=Array.from({length:101},(_,i)=>[Math.sin(i*.03)*8,i] as const);
  const graded=gradeRoute(path,9,6,12,.05)!;
  expect(graded).toBeDefined();expect(graded[0]![1]).toBe(9);expect(graded.at(-1)![1]).toBe(6);
  for(let i=1;i<graded.length;i++){
    const a=graded[i-1]!,b=graded[i]!;
    expect(Math.abs(b[1]-a[1])/Math.hypot(b[0]-a[0],b[2]-a[2])).toBeLessThanOrEqual(.05);
  }
});
