import type { VoxelBlueprint } from '@chatdom/shared';
import { MAT, STYLES } from '../materials';

type Style = 'hearth' | 'tide' | 'grove';
type Box = VoxelBlueprint['boxes'][number];
type Add = (x: number, y: number, z: number, X: number, Y: number, Z: number, material: number) => void;
const writer = (boxes: Box[]): Add => (x, y, z, X, Y, Z, material) => {
  boxes.push({ from: [x, y, z], to: [X, Y, Z], material });
};

/** Local build-cell coordinates; the mounting plane is z=0, facing outward along +Z. */
export const DOOR_LANTERN_MOUNT = [2.5, 5, 0] as const;
export const DOOR_LANTERN_GLASS = [2.5, 3.5, 3] as const;
/** The base sits on y=0; flames are supplied separately by the runtime. */
export const GATE_BRAZIER_MOUNT = [7, 0, 7] as const;
export const GATE_BRAZIER_FLAME = [7, 16, 7] as const;

/** A hanging lantern, with a wall plate, hook, metal cage and unlit glass. */
export function createDoorLantern(style: Style): VoxelBlueprint {
  if (!(style in STYLES)) throw new Error(`Unknown arrival light style: ${style}`);
  const boxes: Box[] = [], add = writer(boxes);
  // Wall plate and the short arm bend over the cap into a hook.
  add(2, 3, 0, 3, 8, 1, MAT.darkStone);
  add(2, 7, 1, 3, 8, 4, MAT.darkStone);
  add(2, 6, 3, 3, 7, 4, MAT.brass);
  // Stepped hood and foot, with a brass rim catching the light.
  add(1, 5, 1, 4, 6, 5, MAT.darkStone);
  add(0, 4, 1, 5, 5, 5, MAT.darkStone);
  add(1, 0, 1, 4, 1, 5, MAT.darkStone);
  add(0, 1, 1, 5, 2, 5, MAT.brass);
  // Glass fills the cage; the four corner bars give it an iron outline.
  add(1, 2, 2, 4, 4, 5, MAT.glass);
  for (const x of [0, 4]) for (const z of [1, 4]) add(x, 2, z, x + 1, 4, z + 1, MAT.darkStone);
  return { version: 1, id: `arrival-door-lantern-${style}`, styleId: STYLES[style].id,
    kind: 'prop', lattice: 'build', size: [5, 8, 5], boxes, windows: [] };
}

/** A grounded stone plinth carries an open iron fire bowl and its cold charcoal bed. */
export function createGateBrazier(style: Style): VoxelBlueprint {
  if (!(style in STYLES)) throw new Error(`Unknown arrival light style: ${style}`);
  const boxes: Box[] = [], add = writer(boxes), stone = STYLES[style].stone;
  // Chamfered layered plinth and a narrower central socket.
  add(2, 0, 1, 12, 2, 13, stone); add(1, 0, 2, 13, 2, 12, stone);
  add(3, 2, 2, 11, 3, 12, MAT.stone); add(2, 2, 3, 12, 3, 11, MAT.stone);
  add(4, 3, 4, 10, 5, 10, MAT.darkStone);
  // Four splayed legs rise in two deliberate steps to the broad bowl.
  for (const x of [3, 9]) for (const z of [3, 9]) {
    add(x, 3, z, x + 2, 7, z + 2, MAT.darkStone);
    const ox = x === 3 ? 2 : 10, oz = z === 3 ? 2 : 10;
    add(ox, 6, oz, ox + 2, 10, oz + 2, MAT.darkStone);
    add(ox, 9, oz, ox + 2, 11, oz + 2, MAT.brass);
  }
  // A stepped cradle, then four raised sides: the centre stays open above the coals.
  add(4, 9, 3, 10, 10, 11, MAT.darkStone); add(3, 9, 4, 11, 10, 10, MAT.darkStone);
  add(3, 10, 2, 11, 12, 12, MAT.darkStone); add(2, 10, 3, 12, 12, 11, MAT.darkStone);
  add(3, 12, 2, 11, 14, 4, MAT.darkStone); add(3, 12, 10, 11, 14, 12, MAT.darkStone);
  add(2, 12, 4, 4, 14, 10, MAT.darkStone); add(10, 12, 4, 12, 14, 10, MAT.darkStone);
  add(4, 12, 4, 10, 13, 10, MAT.bark);
  add(5, 13, 5, 9, 14, 9, MAT.darkStone);
  // Four corner fittings break up the rim without closing the mouth.
  for (const x of [2, 10]) for (const z of [2, 10]) {
    add(x, 13, z, x + 2, 15, z + 2, MAT.brass);
    add(x, 15, z, x + 2, 16, z + 2, MAT.darkStone);
  }
  return { version: 1, id: `arrival-gate-brazier-${style}`, styleId: STYLES[style].id,
    kind: 'prop', lattice: 'build', size: [14, 18, 14], boxes, windows: [] };
}
