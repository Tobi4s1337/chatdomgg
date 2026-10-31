import type { VoxelBlueprint } from '@chatdom/shared';
import { createAnvilHeroDragon, DRAGON_EMITTER } from '../anvil-hero';
import { MAT, STYLES, type StyleKey } from '../materials';

type Box = VoxelBlueprint['boxes'][number];

/** Ground-centred placement, fire in the open mouth, and the sleeping dragon's nose.
 * Coordinates are local build cells (one cell is 0.125 m). The mouth faces +Z. */
export const FORGE_HEARTH_PIVOT = [12, 0, 9] as const;
export const FORGE_HEARTH_FLAME = [12, 6, 15] as const;
export const FORGE_HEARTH_CHIMNEY_NOSE = [DRAGON_EMITTER[0], 21 + DRAGON_EMITTER[1], DRAGON_EMITTER[2]] as const;

/** The smith's low fire and its sleeping-dragon chimney. Fire and light belong to the caller. */
export function createForgeHearth(style: StyleKey): VoxelBlueprint {
  if (!Object.hasOwn(STYLES, style)) throw new Error(`Unknown forge hearth style: ${String(style)}`);
  const boxes: Box[] = [];
  const add = (x: number, y: number, z: number, X: number, Y: number, Z: number, material: number) =>
    boxes.push({ from: [x, y, z], to: [X, Y, Z], material });
  const stone = STYLES[style].stone;

  // A broad, chamfered stone curb; the corners show the warmer worn stone beneath.
  add(2, 0, 0, 22, 2, 18, MAT.darkStone);
  add(1, 0, 2, 23, 2, 16, MAT.darkStone);
  add(3, 1, 1, 21, 3, 17, stone);
  add(2, 1, 3, 22, 3, 15, stone);
  add(2, 1, 3, 5, 2, 6, MAT.stone); add(19, 1, 12, 22, 2, 15, MAT.stone);

  // Deep brick firebox, with shoulder courses stepping toward the flue. The mouth
  // is truly hollow, with a recessed back and an open arched silhouette.
  add(3, 3, 2, 21, 13, 16, MAT.brick);
  add(4, 13, 3, 20, 15, 15, MAT.brick);
  add(6, 15, 4, 19, 17, 14, MAT.stone);
  add(8, 17, 5, 18, 19, 13, MAT.stone);
  add(10, 19, 6, 17, 21, 12, MAT.stone);
  add(7, 4, 7, 17, 10, 18, MAT.air);
  add(8, 10, 7, 16, 11, 18, MAT.air);
  add(9, 11, 7, 15, 12, 18, MAT.air);
  // Black inner lining and a bank of coals. The warm points are clay, not baked light.
  add(7, 4, 7, 17, 10, 8, MAT.darkStone);
  add(8, 4, 8, 16, 5, 15, MAT.bark);
  add(9, 5, 9, 11, 6, 11, MAT.terracotta);
  add(13, 5, 11, 15, 6, 13, MAT.forgeCopper);
  // An iron grate sits low across the open bed, not across the flame anchor.
  add(7, 4, 15, 17, 5, 16, MAT.darkStone);
  for (const x of [8, 11, 14]) add(x, 5, 15, x + 1, 7, 16, MAT.darkStone);

  // Hand-laid voussoirs frame the mouth; the keystone and ledge catch the fire.
  add(5, 4, 15, 7, 10, 17, stone); add(17, 4, 15, 19, 10, 17, stone);
  add(6, 10, 15, 8, 11, 17, MAT.stone); add(16, 10, 15, 18, 11, 17, MAT.stone);
  add(7, 11, 15, 10, 12, 17, stone); add(14, 11, 15, 17, 12, 17, stone);
  add(10, 12, 15, 14, 13, 17, MAT.forgeCopper);
  add(4, 3, 16, 20, 4, 18, MAT.stone);
  // Broken courses and a single restrained copper binding lend the masonry weight.
  add(3, 7, 15, 5, 8, 16, MAT.stone); add(19, 9, 15, 21, 10, 16, MAT.stone);
  add(4, 13, 14, 20, 14, 15, MAT.darkStone);
  add(5, 14, 14, 19, 15, 15, MAT.forgeCopper);
  // Left-hand diagonal iron brace, pinned to the curb and shoulder.
  for (let i = 0; i < 6; i++) add(3 + Math.floor(i / 2), 4 + i, 16, 4 + Math.floor(i / 2), 5 + i, 17, MAT.darkStone);
  add(3, 4, 16, 5, 5, 17, MAT.brass); add(5, 9, 16, 7, 10, 17, MAT.brass);
  // A little hanging hook and paired tongs on the right flank.
  add(20, 10, 10, 21, 11, 14, MAT.darkStone);
  add(20, 7, 13, 21, 11, 14, MAT.darkStone);
  add(20, 7, 12, 21, 8, 14, MAT.forgeCopper);
  add(20, 4, 8, 21, 9, 9, MAT.darkStone);
  add(20, 4, 10, 21, 9, 11, MAT.darkStone);
  add(20, 8, 8, 21, 9, 11, MAT.brass);

  // The original dragon is left intact. Its stack joins the stone flue at y=21;
  // every part of the sculpture retains its original material and coordinates.
  for (const box of createAnvilHeroDragon(style).boxes) {
    add(box.from[0], box.from[1] + 21, box.from[2], box.to[0], box.to[1] + 21, box.to[2], box.material);
  }
  return { version: 1, id: `civic-forge-hearth-${style}`, styleId: STYLES[style].id,
    kind: 'civic', lattice: 'build', size: [24, 37, 18], boxes, windows: [] };
}
