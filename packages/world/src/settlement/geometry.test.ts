import {expect,it} from 'vitest';
import {currentFootprint,homeFrame,homeOrigin,transformCardinalPoint} from './geometry';
import type {CardinalTurn} from './types';
it('transforms exact cardinal building coordinates without changing their scale',()=>{
  const expected=[[12,4,24],[14,4,18],[8,4,16],[6,4,22]];
  for(let turn=0;turn<4;turn++)expect(transformCardinalPoint([10,3,20],turn as CardinalTurn,[2,1,4])).toEqual(expected[turn]);
});
it('aligns fixed and variable-depth blueprints to the same frontage in every orientation',()=>{
  for(const rotation of [0,1,2,3] as const){
    const plot={position:[10,8,20] as const,rotation,allowedDepth:8};
    for(const depth of [8,10,12,14,16]){
      const origin=homeOrigin(plot,depth),front=transformCardinalPoint(origin,rotation,[4,0,depth]);
      expect(front).toEqual(homeFrame(plot).front);
    }
    const footprint=currentFootprint(plot);
    expect((footprint.maxX-footprint.minX)*(footprint.maxZ-footprint.minZ)).toBe(64);
  }
});
