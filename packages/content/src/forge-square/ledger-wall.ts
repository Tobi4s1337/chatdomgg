import type { VoxelBlueprint } from '@chatdom/shared';
import { MAT, STYLES, type StyleKey } from '../materials';

type Box = VoxelBlueprint['boxes'][number];

/** One display niche. All coordinates are local build cells (0.125 m) before the caller's transform; +Z is the read face. */
export interface ForgeLedgerWallNiche {
  readonly index: number;
  /** Centre of the shelf's top surface, at the front-to-back middle of the usable space. */
  readonly floor: readonly [number, number, number];
  /** Empty usable space [w, h, d] standing on `floor`. */
  readonly size: readonly [number, number, number];
  /** Front-facing raised plank just below the niche: centre on its front plane, and [w, h]. */
  readonly plaque: { readonly centre: readonly [number, number, number]; readonly size: readonly [number, number] };
}

export const FORGE_LEDGER_WALL_SIZE: readonly [number, number, number] = [40, 36, 9];
/** Ground centre of the stone footing (the roof overhangs it by one cell front and back). */
export const FORGE_LEDGER_WALL_PIVOT = [20, 0, 4.5] as const;

const NICHE_LEFT = [3, 12, 21, 30] as const;
/** Shelf tops, top row first. Each shelf is a two-cell rail whose raised front is the plaque. */
const NICHE_FLOOR = [22, 13, 4] as const;
const NICHE_W = 7, NICHE_H = 7, NICHE_BACK = 3, NICHE_FRONT = 7, FRONT = 8;

/** Twelve niches in reading order: rows top to bottom, columns left to right as seen from +Z. */
export const FORGE_LEDGER_WALL_NICHES: readonly ForgeLedgerWallNiche[] = NICHE_FLOOR.flatMap((floorY, row) =>
  NICHE_LEFT.map((left, column): ForgeLedgerWallNiche => ({
    index: row * NICHE_LEFT.length + column,
    floor: [left + NICHE_W / 2, floorY, (NICHE_BACK + NICHE_FRONT) / 2],
    size: [NICHE_W, NICHE_H, NICHE_FRONT - NICHE_BACK],
    plaque: { centre: [left + NICHE_W / 2, floorY - 1, FRONT], size: [NICHE_W, 2] },
  })));

/** The carved title board under the roof: the caller draws "The forge remembers" on this face. */
export const FORGE_LEDGER_WALL_HEADER: {
  readonly centre: readonly [number, number, number];
  readonly size: readonly [number, number];
} = { centre: [20, 31, FRONT], size: [28, 4] };

/** "The forge remembers": a roofed, timber-framed trophy wall of twelve shelved niches for the forge square. */
export function createForgeLedgerWall(style: StyleKey): VoxelBlueprint {
  if (!Object.hasOwn(STYLES, style)) throw new Error(`Unknown forge ledger wall style: ${String(style)}`);
  const kit = STYLES[style];
  const boxes: Box[] = [];
  const add = (x: number, y: number, z: number, X: number, Y: number, Z: number, material: number) =>
    boxes.push({ from: [x, y, z], to: [X, Y, Z], material });
  const wood = kit.trim;
  const iron = MAT.darkStone;
  // Niche backs are darker than the frame so small bright pieces stand out: bark behind timber,
  // and iron-dark stone behind the Grove kit's bark.
  const lining = wood === MAT.bark ? MAT.darkStone : MAT.bark;
  const banner = style === 'tide' ? MAT.fabricMutedBlue : style === 'grove' ? MAT.fabricMutedGreen : MAT.fabricMutedRed;

  // Stone footing: an iron-dark base course under the kit's own stone.
  add(0, 0, 1, 40, 1, 8, iron);
  add(0, 1, 1, 40, 2, 8, kit.stone);

  // The board, back to front: back framing, dark planks that line every niche, then the
  // shelving body whose face sits one cell behind the plaques, header and posts.
  add(3, 2, 2, 37, 33, 3, lining);
  add(3, 2, 3, 37, 33, NICHE_FRONT, wood);
  for (const niche of FORGE_LEDGER_WALL_NICHES) {
    const left = niche.floor[0] - NICHE_W / 2, floorY = niche.floor[1];
    add(left, floorY, NICHE_BACK, left + NICHE_W, floorY + NICHE_H, NICHE_FRONT, MAT.air);
    // The raised name plank is the front of the shelf the piece stands on.
    add(left, floorY - 2, NICHE_FRONT, left + NICHE_W, floorY, FRONT, wood);
  }
  // Brass bosses where the dividers cross the shelf rails edge every name plank.
  // Brass caps at the head of each divider mark the corners of the openings.
  for (const x of [10, 19, 28]) for (const floorY of NICHE_FLOOR) {
    add(x, floorY - 2, NICHE_FRONT, x + 2, floorY, FRONT, MAT.brass);
    add(x, floorY + NICHE_H - 1, NICHE_FRONT - 1, x + 2, floorY + NICHE_H, NICHE_FRONT, MAT.brass);
  }

  // Header: the broad raised title board under the raised centre roof.
  add(6, 29, NICHE_FRONT, 34, 33, FRONT, wood);

  // Back: plank back with rails, a centre stud and a cross brace in each half.
  add(3, 2, 1, 37, 33, 2, lining);
  for (const y of [2, 31]) add(3, y, 0, 37, y + 2, 1, wood);
  add(19, 4, 0, 21, 31, 1, wood);
  for (const [x0, dir] of [[3, 1], [17, -1], [21, 1], [35, -1]] as const) {
    for (let i = 0; i < 14; i++) {
      const y = 4 + Math.round((i * 25) / 13);
      add(x0 + dir * i, y, 0, x0 + dir * i + 2, Math.min(y + 3, 31), 1, wood);
    }
  }
  add(19, 16, 0, 21, 18, 1, MAT.brass);

  // End piers stand proud of the footing; the posts rise from them to a bolster under the roof.
  for (const [post, pier] of [[1, 0], [37, 37]] as const) {
    add(pier, 0, 0, pier + 3, 1, 9, iron);
    add(pier, 1, 0, pier + 3, 4, 9, kit.stone);
    add(pier, 4, 1, pier + 3, 5, 8, kit.stone);
    add(post, 5, 0, post + 2, 28, FRONT, wood);
    add(pier, 27, 1, pier + 3, 28, 8, iron);
    add(pier, 28, 0, pier + 3, 30, 9, wood);
    // A kit-coloured pennant hangs on the post face from a brass rod under the bolster.
    add(pier, 26, 8, pier + 3, 27, 9, MAT.brass);
    add(pier, 19, 8, pier + 3, 26, 9, banner);
    add(pier, 17, 8, pier + 1, 19, 9, banner);
    add(pier + 2, 17, 8, pier + 3, 19, 9, banner);
  }

  // Stepped roofline: low shoulders over the posts, and a raised centre roof over the title board.
  // Each roof overhangs front and back, with brass verges and kicked corners on its gable ends.
  const roof = (x0: number, x1: number, y: number) => {
    add(x0, y, 0, x1, y + 1, 9, kit.roof);
    add(x0, y + 1, 1, x1, y + 2, 8, kit.roof);
    add(x0, y + 2, 2, x1, y + 3, 7, kit.roof);
    add(x0 + 1, y + 2, 4, x1 - 1, y + 3, 5, wood);
    for (const x of [x0, x1 - 1]) {
      add(x, y, 0, x + 1, y + 2, 1, MAT.brass); add(x, y, 8, x + 1, y + 2, 9, MAT.brass);
      add(x, y + 1, 1, x + 1, y + 2, 2, MAT.brass); add(x, y + 1, 7, x + 1, y + 2, 8, MAT.brass);
      add(x, y + 2, 2, x + 1, y + 3, 7, MAT.brass);
    }
  };
  roof(0, 6, 30);
  roof(34, 40, 30);
  roof(5, 35, 33);

  // A hammer on the left post and tongs on the right, hung where the smith would reach.
  add(0, 23, 4, 1, 24, 5, iron);
  add(0, 15, 4, 1, 23, 5, wood);
  add(0, 13, 3, 1, 15, 7, iron);
  add(39, 25, 4, 40, 26, 5, iron);
  add(39, 22, 3, 40, 25, 4, iron); add(39, 22, 5, 40, 25, 6, iron);
  add(39, 21, 3, 40, 22, 6, MAT.brass);
  add(39, 13, 3, 40, 21, 4, iron); add(39, 13, 5, 40, 21, 6, iron);

  return { version: 1, id: `civic-forge-ledger-wall-${style}`, styleId: kit.id,
    kind: 'prop', lattice: 'build', size: [...FORGE_LEDGER_WALL_SIZE], boxes, windows: [] };
}
