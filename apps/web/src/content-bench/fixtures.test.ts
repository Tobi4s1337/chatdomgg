import { describe, expect, it } from 'vitest';
import { createHome } from '@chatdom/content';
import { loadBenchFixture, resolveJoinInstances } from './fixtures';

const assets=[createHome('hut','hearth',0),createHome('house','tide',1),createHome('hall','grove',2)];
describe('content review scenes use authored assets',()=>{
  it('aligns different-depth street facades without changing their source boxes',async()=>{
    const before=JSON.stringify(assets);
    const fixture=await loadBenchFixture('core',assets,assets[0]!,'mixed');
    expect(fixture.instances.map(i=>i.blueprint)).toEqual(assets);
    expect(fixture.instances.map(i=>i.position[2]+i.blueprint.size[2])).toEqual([128,128,128]);
    expect(JSON.stringify(assets)).toBe(before);
  });
  it('fails a mixed scene when its required real model is absent',async()=>{
    await expect(loadBenchFixture('core',assets.slice(0,2),assets[0]!,'mixed')).rejects.toThrow('finish these assets first');
  });
  it('focuses the actual window plane and authored cardinal normal',async()=>{
    const home=assets[0]!;
    const fixture=await loadBenchFixture('core',assets,home,'windows');
    expect(fixture.focus).toEqual(home.windows[0]!.centre);
    expect(fixture.normal).toEqual([0,0,1]);
    await expect(loadBenchFixture('core',assets,{...home,windows:[]},'windows')).rejects.toThrow('authored window');
  });
  it('places core threshold review at the doorway rather than the lot centre',async()=>{
    const home=assets[1]!;
    const fixture=await loadBenchFixture('core',assets,home,'threshold');
    expect(fixture.focus).toEqual([18,14,home.size[2]-5]);
  });
});

describe('SIMULATED join fixture boundary',()=>{
  const forms=['fence-straight','fence-corner','fence-end','wall-straight','wall-corner','wall-end','flower-pot','flower-trough','rock-cluster','leafy-shrub'];
  // Test-only one-cell solids exercise fixture validation; these are never content-library assets or renders.
  const simulated=forms.map(form=>({...assets[0]!,id:`street-hearth-${form}`,kind:'prop' as const,size:[1,1,1] as [number,number,number],boxes:[{from:[0,0,0] as [number,number,number],to:[1,1,1] as [number,number,number],material:4}],windows:[]}));
  const instances=simulated.map((b,i)=>({assetId:b.id,position:[i*2,0,0] as [number,number,number],quarterTurns:(i%4) as 0|1|2|3}));
  it('preserves authored transforms and source identity for all required forms',()=>{
    const resolved=resolveJoinInstances('joins-hearth',{instances},simulated);
    expect(resolved[1]!.blueprint).toBe(simulated[1]);
    expect(resolved[1]!.position).toEqual([2,0,0]);
    expect(resolved[1]!.yaw).toBe(Math.PI/2);
  });
  it('refuses incomplete kits and references to missing or wrong-style assets',()=>{
    expect(()=>resolveJoinInstances('joins-hearth',{instances:instances.slice(1)},simulated)).toThrow('all ten');
    expect(()=>resolveJoinInstances('joins-hearth',{instances},simulated.slice(1))).toThrow('invalid assembly');
    expect(()=>resolveJoinInstances('joins-hearth',{instances},simulated.map(b=>({...b,styleId:assets[1]!.styleId})))).toThrow('invalid assembly');
  });
});
