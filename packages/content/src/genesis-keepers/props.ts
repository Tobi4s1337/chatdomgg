import { VoxelBlueprintSchema, type Vec3, type VoxelBlueprint } from '@chatdom/shared';
import { MAT, STYLES, type StyleKey } from '../materials';

/**
 * The furniture keepers work at, proposed for main to place: a court lamp post with the lamplighter's ladder bar, an
 * inn sign on its bracket post, an ale barrel by the inn door and a landing's mooring post. Build lattice (0.125 m
 * cells), y = 0 the ground, +Z the front a keeper works from. Glass is unlit: whether a lamp burns is the host's lighting
 * (warm light is people), never the keeper's. `KEEPER_PROP_ANCHORS` gives each fixture's origin and named points.
 */
type Box = VoxelBlueprint['boxes'][number];
const writer = (boxes: Box[]) => (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, material: number) => {
  boxes.push({ from: [x0, y0, z0], to: [x1, y1, z1], material });
};

function blueprint(id: string, style: StyleKey, size: [number, number, number], boxes: Box[]): VoxelBlueprint {
  return VoxelBlueprintSchema.parse({ version: 1, id, styleId: STYLES[style].id, kind: 'prop', lattice: 'build', size, boxes, windows: [] });
}

function checkStyle(style: StyleKey): void {
  if (!Object.hasOwn(STYLES, style)) throw new Error(`Unknown style ${String(style)}.`);
}

/**
 * A court lamp post: a stepped stone footing, an iron post with a brass collar, the crossbar a lamplighter rests a ladder
 * or a pole against, and a caged lantern on the post's front under a bracket arm and hood with a brass finial.
 */
export function createKeeperLampPost(style: StyleKey): VoxelBlueprint {
  checkStyle(style);
  const boxes: Box[] = [], add = writer(boxes), stone = STYLES[style].stone;
  add(3, 0, 2, 9, 1, 8, stone); add(2, 0, 3, 10, 1, 7, stone);
  add(4, 1, 3, 8, 2, 7, stone);
  add(5, 2, 4, 7, 3, 6, MAT.brass);
  add(5, 3, 4, 7, 24, 6, MAT.darkStone);
  // The ladder bar, with brass knobs at its ends.
  add(1, 14, 4, 11, 15, 6, MAT.darkStone);
  add(0, 14, 4, 1, 15, 6, MAT.brass); add(11, 14, 4, 12, 15, 6, MAT.brass);
  // Cap, bracket arm and the lantern on the post's front.
  add(4, 24, 3, 8, 25, 7, MAT.darkStone);
  add(5, 23, 6, 7, 24, 9, MAT.darkStone);
  add(4, 18, 6, 8, 19, 10, MAT.darkStone);
  add(4, 18, 6, 8, 19, 7, MAT.brass);
  add(4, 19, 6, 8, 22, 10, MAT.glass);
  for (const x of [4, 7]) for (const z of [6, 9]) add(x, 19, z, x + 1, 22, z + 1, MAT.darkStone);
  add(4, 22, 6, 8, 23, 10, MAT.darkStone);
  add(5, 22, 10, 7, 23, 11, MAT.darkStone);
  add(5, 25, 4, 7, 26, 6, MAT.brass);
  return blueprint(`keeper-lamp-post-${style}`, style, [12, 26, 12], boxes);
}

/** A bracket post by the inn door: a timber post, an arm, two iron chains and a painted board with a tankard on it. */
export function createInnSign(style: StyleKey): VoxelBlueprint {
  checkStyle(style);
  const boxes: Box[] = [], add = writer(boxes), kit = STYLES[style];
  add(0, 0, 0, 4, 1, 4, kit.stone);
  add(1, 1, 1, 3, 27, 3, kit.trim);
  add(3, 25, 1, 15, 26, 3, kit.trim);
  add(3, 24, 1, 5, 25, 3, kit.trim);
  for (const x of [6, 13]) add(x, 21, 1, x + 1, 25, 3, MAT.darkStone);
  // The board: a trim frame round a cloth field, and a cream tankard with a brass band, the same on both faces.
  add(5, 11, 1, 15, 21, 3, kit.trim);
  add(6, 12, 1, 14, 20, 3, MAT.cloth);
  add(8, 13, 1, 12, 18, 3, MAT.cream);
  add(8, 17, 1, 12, 18, 3, MAT.plaster);
  add(8, 15, 1, 12, 16, 3, MAT.brass);
  add(12, 14, 1, 13, 17, 3, MAT.cream);
  return blueprint(`keeper-inn-sign-${style}`, style, [16, 27, 4], boxes);
}

/** An ale barrel on its end: timber staves bellied by the middle course, two iron hoops and a bung. */
export function createAleBarrel(style: StyleKey): VoxelBlueprint {
  checkStyle(style);
  const boxes: Box[] = [], add = writer(boxes), trim = STYLES[style].trim;
  add(1, 0, 0, 5, 7, 6, trim); add(0, 0, 1, 6, 7, 5, trim);
  add(0, 2, 0, 6, 5, 6, trim);
  add(0, 1, 1, 6, 2, 5, MAT.darkStone); add(1, 1, 0, 5, 2, 6, MAT.darkStone);
  add(0, 5, 1, 6, 6, 5, MAT.darkStone); add(1, 5, 0, 5, 6, 6, MAT.darkStone);
  add(1, 7, 1, 5, 8, 5, trim);
  add(2, 3, 6, 3, 4, 7, MAT.brass);
  return blueprint(`keeper-ale-barrel-${style}`, style, [6, 8, 7], boxes);
}

/** A landing's mooring post: a weathered timber bollard on a stone footing, an iron ring and a rope collar. */
export function createMooringPost(style: StyleKey): VoxelBlueprint {
  checkStyle(style);
  const boxes: Box[] = [], add = writer(boxes), kit = STYLES[style];
  add(0, 0, 0, 6, 1, 6, kit.stone);
  add(1, 1, 1, 5, 7, 5, kit.trim);
  add(2, 7, 2, 4, 8, 4, kit.trim);
  add(1, 4, 1, 5, 5, 5, MAT.thatch);
  add(2, 2, 5, 4, 3, 6, MAT.darkStone); add(2, 3, 5, 3, 4, 6, MAT.darkStone);
  return blueprint(`keeper-mooring-post-${style}`, style, [6, 8, 6], boxes);
}

/**
 * Fixture origins (build cells: the point a `KeeperFixture.position` names, on the ground, with the fixture's front +Z)
 * and the named points routines aim at, as fixture-local metres.
 */
export const KEEPER_PROP_ANCHORS = {
  lamp: { origin: [6, 0, 5] as Vec3, points: { glass: [0, 20.5 * 0.125, 3 * 0.125] as Vec3, bar: [0, 14.5 * 0.125, 0] as Vec3 } },
  sign: { origin: [2, 0, 2] as Vec3, points: { board: [8 * 0.125, 16 * 0.125, 0] as Vec3 } },
  barrel: { origin: [3, 0, 3] as Vec3, points: { top: [0, 8 * 0.125, 0] as Vec3 } },
  mooring: { origin: [3, 0, 3] as Vec3, points: { top: [0, 8 * 0.125, 0] as Vec3 } },
} as const;
