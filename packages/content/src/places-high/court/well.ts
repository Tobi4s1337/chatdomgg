import { MAT, STYLES, type StyleKey } from '../../materials';
import { Shape } from '../shape';
import type { PlacePiece } from '../types';

/** 3.5 × 3.75 × 3 m. The drum stands on a round step; the canopy's ridge runs east–west over the windlass. */
export const COURT_WELL_SIZE = [28, 30, 24] as const;
/**
 * Cell-corner centre of the shaft, the step top and the coping top: the coping stands 0.875 m above the step,
 * a height to lean on, never to climb.
 */
export const COURT_WELL = { centre: [14, 12], stepTop: 1, copingTop: 8, shaft: 4.4 } as const;

/**
 * The court well-head: a coursed stone drum on a round step, a pale coping worn smooth, oak posts on stone
 * bases carrying a windlass with a rope drum and an iron-dark crank, and a terracotta canopy between timber
 * bargeboards. A bucket hangs just drawn above the dark shaft; another waits on the step. The draw point is a
 * real place to stand; the host decides whether anything happens there.
 */
export function createCourtWell(style: StyleKey): PlacePiece {
  const kit = STYLES[style], s = new Shape();
  const [cx, cz] = COURT_WELL.centre;
  // The round step, mossed along its shaded north edge.
  s.disc(cx, cz, 11.6, 0, 1, kit.stone);
  for (const [x, z, X] of [[8, 1, 11], [14, 0, 16], [18, 1, 20], [5, 3, 7], [22, 4, 23]] as const) s.box(x, 0, z, X, 1, z + 1, MAT.moss);
  // The drum: two coursed lifts either side of a projecting band, then the coping that oversails them.
  s.disc(cx, cz, 7.6, 1, 4, kit.stone, 4.6);
  s.disc(cx, cz, 8.1, 4, 5, MAT.cream, 4.6);
  s.disc(cx, cz, 7.6, 5, 7, kit.stone, 4.6);
  s.disc(cx, cz, 8.6, 7, 8, MAT.cream, 4.4);
  // Vertical joints, staggered between lifts, so the drum reads as dressed blocks rather than a pipe.
  const joint = (angle: number, y: number, Y: number) => {
    const x = Math.floor(cx + Math.cos(angle) * 7.1), z = Math.floor(cz + Math.sin(angle) * 7.1);
    s.box(x, y, z, x + 1, Y, z + 1, MAT.darkStone);
  };
  for (let k = 0; k < 7; k++) { joint(k * Math.PI * 2 / 7 + .2, 1, 4); joint(k * Math.PI * 2 / 7 + .65, 5, 7); }
  // Moss at the foot of the drum, on its shaded side.
  for (const [x, z] of [[9, 6], [12, 4], [17, 5]] as const) s.box(x, 1, z, x + 2, 2, z + 1, MAT.moss);
  // Dark water seen deep in the shaft.
  s.disc(cx, cz, 4.6, 1, 2, MAT.darkStone);
  // Stone post bases, oak posts and the tie beam under the canopy.
  for (const [base, post] of [[2, 3], [22, 23]] as const) {
    s.box(base, 1, 10, base + 4, 3, 14, kit.stone);
    s.box(post, 3, 11, post + 2, 22, 13, kit.trim);
  }
  s.box(3, 20, 11, 25, 22, 13, kit.trim);
  // Knee braces step down from the beam to each post.
  for (const [foot, reach] of [[5, 6], [22, 21]] as const) {
    s.box(foot, 17, 11, foot + 1, 20, 13, kit.trim);
    s.box(reach, 19, 11, reach + 1, 20, 13, kit.trim);
  }
  // The windlass: an axle through both posts, a slim rounded rope drum between flanges, an iron crank beyond the
  // east post.
  s.box(3, 14, 11, 26, 15, 13, kit.trim);
  s.box(11, 13, 11, 17, 16, 13, MAT.thatch);
  s.box(11, 14, 10, 17, 15, 14, MAT.thatch);
  for (const x of [10, 17]) { s.box(x, 12, 11, x + 1, 17, 13, kit.trim); s.box(x, 13, 10, x + 1, 16, 14, kit.trim); }
  s.box(26, 11, 12, 27, 15, 13, MAT.darkStone);
  s.box(26, 11, 13, 28, 12, 15, MAT.darkStone);
  // The rope runs down from the drum to the bucket's bale.
  s.box(14, 12, 12, 15, 13, 13, MAT.thatch);
  // The bucket just drawn: brass-banded staves, hollow, its iron bale under the rope.
  s.box(12, 8, 11, 16, 11, 14, MAT.bark);
  s.box(12, 9, 11, 16, 10, 14, MAT.brass);
  s.box(13, 9, 12, 15, 11, 13, MAT.air);
  s.box(12, 11, 12, 16, 12, 13, MAT.darkStone);
  // The bucket waiting on the step.
  s.box(19, 1, 16, 23, 4, 20, MAT.bark);
  s.box(19, 2, 16, 23, 3, 20, MAT.brass);
  s.box(20, 3, 17, 22, 4, 19, MAT.air);
  // The canopy: a shell of terracotta courses, each lapping the one below, open underneath so its rafters read
  // in shade; the eave course is notched like tile ends. The timber gables stand back under the verges.
  for (let i = 0; i < 6; i++) {
    s.box(1, 22 + i, 2 * i, 27, 23 + i, 2 * i + 3, MAT.terracotta);
    s.box(1, 22 + i, 21 - 2 * i, 27, 23 + i, 24 - 2 * i, MAT.terracotta);
  }
  for (let x = 2; x < 27; x += 3) {
    s.box(x, 22, 0, x + 1, 23, 1, MAT.air);
    s.box(x, 22, 23, x + 1, 23, 24, MAT.air);
  }
  for (let i = 0; i < 6; i++) for (const x of [3, 24]) s.box(x, 22 + i, 2 * i + 2, x + 1, 23 + i, 22 - 2 * i, kit.trim);
  // Rafters every course of the underside, and the ridge capping the shell.
  for (const x of [8, 14, 20]) for (let i = 0; i < 6; i++) s.box(x, 22 + i, 2 * i + 2, x + 1, 23 + i, 2 * i + 3, kit.trim);
  for (const x of [8, 14, 20]) for (let i = 0; i < 6; i++) s.box(x, 22 + i, 21 - 2 * i, x + 1, 23 + i, 22 - 2 * i, kit.trim);
  s.box(1, 28, 10, 27, 30, 14, kit.trim);
  return {
    blueprint: { version: 1, id: `court-well-${style}`, styleId: kit.id, kind: 'civic', lattice: 'build',
      size: [...COURT_WELL_SIZE], boxes: s.list, windows: [] },
    footings: [{ id: 'step', box: { from: [3, 0, 1], to: [25, 1, 23] } }],
    walks: [],
    seats: [],
    // Stand on the court just south of the step, facing the coping.
    interactions: [{ id: 'draw-water', kind: 'draw-water', stand: [cx, 0, 26], look: [cx, COURT_WELL.copingTop, cz] }],
    texts: [],
  };
}
