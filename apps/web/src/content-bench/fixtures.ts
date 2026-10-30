import { loadContentCollection } from '@chatdom/content';
import type { Vec3, VoxelBlueprint } from '@chatdom/shared';

/** Bench-only data; this is neither a placement protocol nor blueprint metadata. Positions use build cells. */
export interface ReviewInstance { assetId: string; position: Vec3; quarterTurns: 0 | 1 | 2 | 3 }
export interface ReviewExports {
  HOME_REVIEW?: Record<string, { entrance: Vec3 }>;
  JOIN_FIXTURES?: readonly { id: string; instances: readonly ReviewInstance[] }[];
}
export interface BenchFixture {
  id: string;
  instances: readonly { blueprint: VoxelBlueprint; position: Vec3; yaw: number }[];
  focus?: Vec3;
  normal?: Vec3;
}
const entries = import.meta.glob<ReviewExports>(['../../../../packages/content/src/homes/*/index.ts', '../../../../packages/content/src/props/*/index.ts']);

export async function loadBenchFixture(collection: string, assets: readonly VoxelBlueprint[], selected: VoxelBlueprint, mode: string): Promise<BenchFixture> {
  const single = { blueprint: selected, position: [0,0,0] as Vec3, yaw: 0 };
  if (mode === 'asset') return { id: selected.id, instances: [single] };
  if (mode === 'windows') {
    const window = selected.windows[0];
    if (!window) throw new Error('Window review requires an authored window.');
    const normals = { south: [0,0,1], north: [0,0,-1], east: [1,0,0], west: [-1,0,0] } as const;
    return { id: `windows-${selected.id}`, instances: [single], focus: window.centre, normal: normals[window.facing] };
  }
  if (mode === 'mixed') {
    const homes = assets.filter(b=>b.kind==='home');
    const wanted = collection === 'core' ? ['home-hut-hearth-0','home-house-tide-1','home-hall-grove-2'] : collection === 'homes-hearth'
      ? ['home-hearth-emberfold-hut','home-hearth-bramblecross-house','home-hearth-heatherstead-hall']
      : ['home-tide-gullstep-hut','home-tide-saltbend-house','home-tide-keelcroft-hall'];
    const models = wanted.map(id=>homes.find(b=>b.id===id));
    if (models.some(b=>!b)) throw new Error(`Mixed street needs ${wanted.join(', ')}; finish these assets first.`);
    return { id: 'mixed', instances: models.map((blueprint,i)=>({ blueprint: blueprint!, position: [i*80,0,128-blueprint!.size[2]] as Vec3, yaw: 0 })) };
  }
  if (collection === 'core' && mode === 'threshold') {
    if (selected.kind!=='home') throw new Error('Threshold review requires a home.');
    const variant=Number(selected.id.at(-1));
    return { id: `threshold-${selected.id}`, instances: [single], focus: [variant===1?18:variant===2?39:29,14,selected.size[2]-5], normal: [0,0,1] };
  }
  const path = collection === 'street-props' ? '../../../../packages/content/src/props/street/index.ts' : `../../../../packages/content/src/homes/${collection.slice(6)}/index.ts`;
  const load=entries[path];
  if (!load) throw new Error(`No review fixture module for ${collection}.`);
  const review=await load();
  if (mode === 'threshold') {
    const entrance=review.HOME_REVIEW?.[selected.id]?.entrance;
    if (!entrance || entrance.length!==3 || entrance.some((v,i)=>!Number.isInteger(v)||v<0||v>selected.size[i]!)) throw new Error(`${selected.id}: HOME_REVIEW must declare an in-bounds entrance focus in build cells.`);
    return { id: `threshold-${selected.id}`, instances: [single], focus: entrance, normal: [0,0,1] };
  }
  if (mode === 'joins-hearth' || mode === 'joins-tide') {
    const fixture=review.JOIN_FIXTURES?.find(f=>f.id===mode);
    if (!fixture?.instances.length) throw new Error(`Missing JOIN_FIXTURES scene ${mode}.`);
    const style=mode.slice(6);
    const instances=resolveJoinInstances(mode,fixture,assets);
    const core=await loadContentCollection('core');
    const home=core.find(b=>b.id===`home-house-${style}-0`);
    if(!home) throw new Error(`Missing core ${style} home backdrop.`);
    return {id:mode,instances:[...instances,{blueprint:home,position:[0,0,-home.size[2]] as Vec3,yaw:0}]};
  }
  throw new Error(`Unknown bench scene ${mode}.`);
}

/** Validate the fixture boundary before a render can claim an assembled kit. */
export function resolveJoinInstances(mode: string, fixture: { instances: readonly ReviewInstance[] }, assets: readonly VoxelBlueprint[]): BenchFixture['instances'] {
  const required=['fence-straight','fence-corner','fence-end','wall-straight','wall-corner','wall-end','flower-pot','flower-trough','rock-cluster','leafy-shrub'];
  const style=mode.slice(6);
  if (required.some(form=>!fixture.instances.some(i=>i.assetId===`street-${style}-${form}`))) throw new Error(`${mode}: fixture must exercise all ten street forms.`);
  return fixture.instances.map(item=>{
      const blueprint=assets.find(b=>b.id===item.assetId);
      if(!blueprint || blueprint.styleId!==style || item.position.length!==3 || item.position.some(v=>!Number.isInteger(v)) || item.position[1]!==0 || item.position[2]<0 || ![0,1,2,3].includes(item.quarterTurns)) throw new Error(`${mode}: invalid assembly instance ${item.assetId}.`);
      return {blueprint,position:item.position,yaw:item.quarterTurns*Math.PI/2};
    });
}
