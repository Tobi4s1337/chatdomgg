import type { Vec3, VoxelBlueprint } from '@chatdom/shared';
import type { StyleKey } from '../materials';
import { createPier, type PierSite, type PierModule } from '../places/water/pier';
import { turnBox } from '../places/water/place-piece';
import { createPierFurnishings, type PierFurnishing, type PierFurnishingKind } from './index';

export interface FishingPierModule {
  readonly id: string;
  readonly blueprint: VoxelBlueprint;
  /** Relative to the deck datum, in build cells, in the existing pier's frame (walk X=0..20). */
  readonly offset: Vec3;
}
export interface FishingPierLight { readonly id: string; readonly at: Vec3; readonly reach: number }
export interface FishingPierContent {
  readonly modules: readonly FishingPierModule[];
  readonly lights: readonly FishingPierLight[];
  readonly anchors: {
    readonly rack: Vec3; readonly almanac: Vec3; readonly board: Vec3; readonly bench: Vec3;
    readonly fishing: readonly Vec3[];
  };
}

/** Authored furnishings become part of supported deck modules, never a loose non-colliding scenery layer. */
export function createFishingPier(style: StyleKey, site: PierSite): FishingPierContent {
  const pier = createPier(style, site);
  const props = new Map(createPierFurnishings(style).map(prop => [prop.kind, prop]));
  const additions = new Map<PierModule, { prop: PierFurnishing; at: Vec3; turn: 0 | 2 }[]>();
  const lights: FishingPierLight[] = [];
  const atDeck = (module: PierModule, z: number) => {
    const strip = module.piece.walks.find(walk => walk.axis === 'z');
    const localZ = z - module.offset[2];
    const tops = strip ? strip.tops.slice(Math.max(0, localZ - strip.along[0]), Math.max(0, localZ - strip.along[0]) + 4) : [];
    return module.offset[1] + (tops.length ? Math.max(...tops) : -module.offset[1]);
  };
  const place = (module: PierModule, kind: PierFurnishingKind, x: number, z: number, turn: 0 | 2 = 0) => {
    const prop = props.get(kind)!;
    const at: Vec3 = [x, atDeck(module, z), z];
    const list = additions.get(module) ?? [];
    list.push({ prop, at, turn }); additions.set(module, list);
    if (prop.light) lights.push({ id: `${module.role}-${module.offset[2]}-${x}`, at: [at[0] + prop.light.position[0], at[1] + prop.light.position[1], at[2] + prop.light.position[2]], reach: prop.light.reach });
  };
  for (const module of pier.modules) {
    if (module.role === 'head') {
      place(module, 'board', -20, site.walk + 12, 2);
      place(module, 'bench', 20, site.walk);
      place(module, 'lectern', 24, site.walk + 12, 2);
      place(module, 'mooring', 21, site.walk + 24);
      place(module, 'bucket', -10, site.walk + 22);
      place(module, 'lantern', -21, site.walk + 23);
      place(module, 'lantern', 37, site.walk + 16);
    } else {
      const z = module.role === 'root' ? 26 : Math.floor((module.piece.blueprint.size[2] - 4) / 2) + module.offset[2];
      for (const x of [0, 16]) place(module, 'lantern', x, z);
      if (module.role === 'root') place(module, 'rack', 0, 12);
    }
    for (const light of module.piece.emitters) lights.push({ id: light.id, at: [module.offset[0] + light.position[0], module.offset[1] + light.position[1], module.offset[2] + light.position[2]], reach: light.reach });
  }
  const modules = pier.modules.map((module): FishingPierModule => {
    // The source gateway was made for scenery. A physical bank can support a foot half a metre above
    // its centre sample; lift the board and braces while extending their posts, so a real body clears it.
    const lift = module.role === 'root' ? 8 : 0;
    const boxes = module.piece.blueprint.boxes.map(box => {
      if (!lift) return box;
      const threshold = 12 - module.offset[1];
      return { ...box, from: [box.from[0], box.from[1] >= threshold ? box.from[1] + lift : box.from[1], box.from[2]] as [number, number, number],
        to: [box.to[0], box.to[1] > threshold ? box.to[1] + lift : box.to[1], box.to[2]] as [number, number, number] };
    });
    let height = module.piece.blueprint.size[1] + lift;
    for (const { prop, at, turn } of additions.get(module) ?? []) {
      const local: Vec3 = [at[0] - module.offset[0], at[1] - module.offset[1], at[2] - module.offset[2]];
      if (local[0] < 0 || local[2] < 0 || local[0] + prop.blueprint.size[0] > module.piece.blueprint.size[0] || local[2] + prop.blueprint.size[2] > module.piece.blueprint.size[2]) throw new Error('A pier furnishing leaves its supported deck.');
      height = Math.max(height, local[1] + prop.blueprint.size[1]);
      for (const box of prop.blueprint.boxes) {
        const rotated = turnBox(box, prop.blueprint.size, turn);
        boxes.push({ from: [rotated.from[0] + local[0], rotated.from[1] + local[1], rotated.from[2] + local[2]], to: [rotated.to[0] + local[0], rotated.to[1] + local[1], rotated.to[2] + local[2]], material: box.material });
      }
    }
    return { id: module.role === 'bay' ? `bay-${module.offset[2]}` : module.role, offset: module.offset,
      blueprint: { ...module.piece.blueprint, id: `fishing-${module.piece.blueprint.id}`, size: [module.piece.blueprint.size[0], height, module.piece.blueprint.size[2]], boxes } };
  });
  return { modules, lights, anchors: {
    rack: [10, 0, 18], almanac: [30, 0, site.walk + 10], board: [-12, 0, site.walk + 9], bench: [25, 0, site.walk + 10],
    fishing: [2, 10, 18].map(x => [x, 0, site.walk + 29] as Vec3),
  } };
}
