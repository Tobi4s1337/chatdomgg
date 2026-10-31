import type { VoxelBlueprint } from '@chatdom/shared';
import { MAT, STYLES, type StyleKey } from '../materials';

type Box = VoxelBlueprint['boxes'][number];

/** The existing hearth pivot belongs here. +Z is the open street-facing side. */
export const FORGE_WORKSHOP_HEARTH_PIVOT = [24, 0, 12] as const;
export const FORGE_WORKSHOP_SIZE = [48, 37, 44] as const;

/** An open, timber-framed smithy around the separately placed hearth and dragon. */
export function createForgeWorkshop(style: StyleKey): VoxelBlueprint {
  if (!Object.hasOwn(STYLES, style)) throw new Error(`Unknown forge workshop style: ${String(style)}`);
  const kit = STYLES[style];
  const boxes: Box[] = [];
  const add = (x: number, y: number, z: number, X: number, Y: number, Z: number, material: number) =>
    boxes.push({ from: [x, y, z], to: [X, Y, Z], material });
  const wood = kit.trim;
  const iron = MAT.darkStone;
  const banner = style === 'tide' ? MAT.fabricMutedBlue : style === 'grove' ? MAT.fabricMutedGreen : MAT.fabricMutedRed;

  // Four square shoes and heavy posts. Open between the posts: the hearth and
  // the working floor are visible from the street and through the sides.
  for (const x of [2, 43]) for (const z of [1, 36]) {
    add(x - 1, 0, z, x + 4, 2, z + 5, kit.stone);
    add(x, 2, z + 1, x + 3, 25, z + 4, wood);
    add(x - 1, 20, z, x + 4, 23, z + 5, wood);
    add(x - 1, 19, z + 1, x + 4, 20, z + 4, iron);
    add(x, 20, z, x + 1, 21, z + 1, MAT.brass);
  }
  // Long side plates and a broad front tie frame the work rather than enclosing it.
  add(2, 23, 2, 5, 26, 41, wood); add(43, 23, 2, 46, 26, 41, wood);
  add(3, 24, 36, 12, 27, 39, wood); add(36, 24, 36, 45, 27, 39, wood);
  add(3, 24, 1, 10, 27, 4, wood); add(38, 24, 1, 45, 27, 4, wood);
  // Knees make the joints read as joinery at street scale.
  for (const x of [2, 43]) for (const z of [2, 37]) {
    for (let i = 0; i < 5; i++) {
      const toward = z === 2 ? z + i : z - i;
      add(x, 20 + i, toward, x + 3, 21 + i, toward + 2, wood);
    }
  }

  // Twin sloping wings deliberately frame the dragon all the way to the
  // street. The open central bay gives the chimney and its face room to read.
  for (let i = 0; i < 6; i++) {
    const y = 26 + Math.floor(i * 0.75);
    const left = i * 2;
    const right = 46 - i * 2;
    add(left, y, 0, left + 2, y + 2, 43, kit.roof);
    add(right, y, 0, right + 2, y + 2, 43, kit.roof);
  }
  // Light-catching inner verge and split fascia make the opening intentional.
  add(10, 30, 0, 12, 31, 43, MAT.brass);
  add(36, 30, 0, 38, 31, 43, MAT.brass);
  add(0, 25, 39, 12, 27, 43, wood); add(36, 25, 39, 48, 27, 43, wood);
  for (const x of [1, 5, 9, 37, 41, 45]) {
    add(x, 23, 42, x + 3, 25, 44, banner);
    add(x + 1, 22, 42, x + 2, 23, 44, banner);
  }
  // Roof edge pegs and small restrained strips of kit-coloured cloth.
  for (const x of [4, 43]) {
    add(x, 18, 39, x + 2, 23, 40, banner);
    add(x, 17, 39, x + 1, 18, 40, banner);
  }

  // Low side rail with a hung hammer and tongs, all in reach of the smith.
  add(4, 9, 23, 6, 11, 36, wood);
  add(4, 0, 24, 6, 10, 26, wood); add(4, 0, 33, 6, 10, 35, wood);
  add(6, 10, 26, 7, 12, 27, iron); add(6, 6, 26, 7, 11, 27, iron);
  add(6, 5, 25, 8, 7, 28, iron);
  add(6, 10, 30, 7, 12, 31, iron);
  add(6, 6, 29, 7, 11, 30, iron); add(6, 6, 31, 7, 11, 32, iron);
  add(6, 5, 28, 7, 7, 30, iron); add(6, 5, 31, 7, 7, 33, iron);
  // Billets on a low rack and a banded barrel: a few legible marks of work.
  add(35, 0, 27, 41, 2, 35, wood);
  for (const z of [28, 30, 32]) add(35, 2, z, 41, 3, z + 1, iron);
  add(37, 3, 28, 42, 4, 29, iron); add(36, 3, 30, 41, 4, 31, iron);
  add(38, 0, 18, 43, 1, 23, wood); add(37, 1, 19, 44, 7, 22, wood);
  add(38, 1, 18, 43, 7, 23, wood); add(38, 7, 19, 43, 8, 22, wood);
  add(37, 2, 19, 44, 3, 22, iron); add(37, 5, 19, 44, 6, 22, iron);
  add(38, 2, 18, 43, 3, 23, iron); add(38, 5, 18, 43, 6, 23, iron);

  return { version: 1, id: `civic-forge-workshop-${style}`, styleId: kit.id,
    kind: 'civic', lattice: 'build', size: [...FORGE_WORKSHOP_SIZE], boxes, windows: [] };
}
