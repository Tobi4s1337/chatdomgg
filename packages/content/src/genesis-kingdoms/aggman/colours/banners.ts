import type { Vec3 } from '@chatdom/shared';
import { MAT, STYLES } from '../../../materials';
import type { HeraldicColours } from '../../../genesis-heraldry/kit';
import type { AggmanPiece, Livery } from '../piece';
import { Cells, pieceId, smallLantern, toPiece, type Box } from './cells';
import { deepen, foldProfile, liveryColours, resampleArms, tassels, weave, type Hang } from './cloth';

/**
 * The quay banner, in build cells. A timber post 4.6 m tall on a stone footing carries a crossbar at y 33..35,
 * bound to the post with brass and capped with brass knobs. The arms hang in front of the post on a forked cloth
 * 16 cells wide and 28 deep (y 32 down to y 5), looped over the bar, with gold tassels at both tails; from each
 * knob a cord lets down a keeper's lantern beside the cloth's edge, so the device is lit from both sides at dusk.
 */
export const QUAY_BANNER = {
  size: [24, 42, 16],
  cloth: { x: 4, width: 16, top: 32, rows: 28, z: 9 },
  footprint: { from: [7, 3], to: [17, 13] },
} as const;

/** The quay banner's folds: two broad bellies either side of the post, the three columns before it held flat. */
const QUAY_FOLD = [1, 2, 2, 3, 2, 1, 1, 0, 0, 0, 1, 2, 3, 3, 2, 1] as const;

export function createQuayBanner(livery: Livery, arms: readonly string[], colours: HeraldicColours = liveryColours(livery)): AggmanPiece {
  const { size, cloth, footprint } = QUAY_BANNER;
  const c = new Cells(size[0], size[1], size[2]);
  const timber = STYLES.tide.trim;
  // The footing: a damp course, a stepped stone block and an iron collar the post is wedged into.
  c.chamfer(7, 0, 3, 17, 2, 13, 2, MAT.darkStone);
  c.chamfer(8, 2, 4, 16, 5, 12, 1, STYLES.tide.stone);
  c.chamfer(10, 5, 6, 14, 7, 10, 1, MAT.darkStone);
  c.fill(11, 5, 7, 13, 38, 9, timber);
  // The crossbar, bound in brass where it crosses the post, with brass knobs at its ends.
  c.fill(2, 33, 7, 22, 35, 9, timber);
  c.fill(10, 32, 6, 14, 36, 9, livery.brass);
  for (const x of [1, 21]) c.fill(x, 32, 6, x + 2, 36, 10, livery.brass);
  // The brass lozenge finial.
  c.fill(11, 38, 7, 13, 39, 9, livery.brass);
  c.chamfer(10, 39, 6, 14, 41, 10, 1, livery.brass);
  c.fill(11, 41, 7, 13, 42, 9, livery.brass);
  // Cords from the knobs let down two lanterns beside the cloth.
  const lanterns: Vec3[] = [];
  for (const x of [1, 21]) {
    lanterns.push(smallLantern(c, x, 24, 7, livery.brass, MAT.glass));
    c.fill(x, 30, 7, x + 1, 32, 8, MAT.thatch);
  }
  // The cloth, then the loops of field that carry it over the bar.
  const grid = resampleArms(arms, cloth.width, cloth.rows);
  const hang: Hang = { x: cloth.x, top: cloth.top, z: cloth.z, fold: deepen(QUAY_FOLD) };
  weave(c, grid, colours, hang);
  for (const x of [5, 9, 15, 19]) loop(c, x, 33, 6, cloth.z + 2, colours.field);
  tassels(c, grid, hang, livery.brass, livery.gold);
  return toPiece(pieceId('quay-banner', livery, arms, colours), 'civic', c, lanterns, footprint);
}

/** A loop of cloth two cells wide over a bar two cells tall at y..y+2, from the back face z to the front face Z. */
function loop(c: Cells, x: number, y: number, z: number, Z: number, material: number): void {
  c.fill(x, y + 2, z, x + 2, y + 3, Z, material);
  c.fill(x, y, z, x + 2, y + 2, z + 1, material);
  c.fill(x, y, Z - 2, x + 2, y + 2, Z, material);
}

/** The wall banner is between 24 and 96 cells tall (3 to 12 m). */
export const WALL_BANNER_HEIGHTS = { min: 24, max: 96 } as const;

/** Its cloth width grows with its height, from 10 to 20 cells, and its rows fill the height below the bar. */
function wallCloth(heightCells: number): { width: number; rows: number } {
  if (!Number.isInteger(heightCells) || heightCells < WALL_BANNER_HEIGHTS.min || heightCells > WALL_BANNER_HEIGHTS.max) {
    throw new Error(`Wall banner height ${heightCells} must be a whole number of cells from ${WALL_BANNER_HEIGHTS.min} to ${WALL_BANNER_HEIGHTS.max}.`);
  }
  return { width: Math.min(20, Math.max(10, 2 * Math.round(heightCells * 0.15))), rows: heightCells - 9 };
}

/**
 * The extent of `wallBannerBoxes`, in build cells: the bracket plate lies on z = 0 against the wall, the cloth
 * hangs in front of it, and the lowest tassel touches y = 0.
 */
export function wallBannerExtent(heightCells: number): [number, number, number] {
  const { width } = wallCloth(heightCells);
  return [width + 4, heightCells, 12];
}

/**
 * Writes the bracket banner into a canvas at (ox, oy, oz). An iron wall plate (z 0) carries a forged arm with a
 * curled tail and a diagonal strut; an iron hook at its end holds a timber crossbar with brass caps, and the arms
 * hang from the bar on a two-cell cloth that bellies forward in soft folds, with gold tassels at the tails.
 */
function bracketBanner(c: Cells, livery: Livery, arms: readonly string[], colours: HeraldicColours, ox: number, oy: number, oz: number, heightCells: number): void {
  const { width, rows } = wallCloth(heightCells);
  const [sx] = wallBannerExtent(heightCells), H = heightCells, cx = ox + sx / 2;
  const at = (y: number) => oy + y;
  // The wall plate, the arm with its curl, and the strut.
  c.fill(cx - 2, at(H - 7), oz, cx + 2, at(H), oz + 1, MAT.darkStone);
  c.fill(cx - 1, at(H - 3), oz + 1, cx + 1, at(H - 2), oz + 7, MAT.darkStone);
  c.fill(cx - 1, at(H - 2), oz + 2, cx + 1, at(H - 1), oz + 3, MAT.darkStone);
  c.fill(cx - 1, at(H - 1), oz + 2, cx + 1, at(H), oz + 5, MAT.darkStone);
  c.fill(cx - 1, at(H - 2), oz + 4, cx + 1, at(H - 1), oz + 5, MAT.darkStone);
  c.fill(cx - 1, at(H - 4), oz + 7, cx + 1, at(H - 1), oz + 8, livery.brass);
  for (let step = 0; step < 4; step++) c.fill(cx - 1, at(H - 7 + step), oz + 1 + step, cx + 1, at(H - 5 + step), oz + 2 + step, MAT.darkStone);
  // The hook and the crossbar it holds, with brass caps.
  c.fill(cx - 1, at(H - 4), oz + 5, cx + 1, at(H - 3), oz + 7, MAT.darkStone);
  c.fill(ox + 1, at(H - 5), oz + 5, ox + sx - 1, at(H - 4), oz + 7, STYLES.tide.trim);
  for (const x of [ox, ox + sx - 1]) c.fill(x, at(H - 6), oz + 5, x + 1, at(H - 3), oz + 7, livery.brass);
  // The cloth and its loops over the bar, clear of the hook.
  const grid = resampleArms(arms, width, rows);
  const hang: Hang = { x: ox + 2, top: at(H - 6), z: oz + 7, fold: deepen(foldProfile(width, 0.7)) };
  weave(c, grid, colours, hang);
  const loops = [1, width - 3, ...(width >= 14 ? [Math.floor(width / 2) - 5, Math.floor(width / 2) + 3] : [])];
  for (const col of loops) {
    const x = ox + 2 + col;
    c.fill(x, at(H - 4), oz + 4, x + 2, at(H - 3), oz + 9, colours.field);
    c.fill(x, at(H - 5), oz + 4, x + 2, at(H - 4), oz + 5, colours.field);
    c.fill(x, at(H - 5), oz + 7, x + 2, at(H - 4), oz + 9, colours.field);
  }
  tassels(c, grid, hang, livery.brass, livery.gold);
}

/**
 * The bracket banner alone, as boxes in its own frame (see `wallBannerExtent`), for a host to merge into a tower
 * or gable blueprint: place z = 0 on the wall face, the banner hanging out over +Z. It is held by its plate, so
 * it is only grounded once it is merged onto a wall.
 */
export function wallBannerBoxes(livery: Livery, arms: readonly string[], heightCells: number, colours: HeraldicColours = liveryColours(livery)): Box[] {
  const [sx, sy, sz] = wallBannerExtent(heightCells);
  const c = new Cells(sx, sy, sz);
  bracketBanner(c, livery, arms, colours, 0, 0, 0, heightCells);
  return c.boxes();
}

/** How far the standalone wall banner's tassels hang above the ground: 1.75 m, above a passer-by's reach. */
const MAST_LIFT = 14;

/**
 * The wall banner standing on its own: the same bracket banner fixed to a square timber mast on a stone footing,
 * the mast standing in for the tower wall, so it can be placed on a quay or square. The mast is at z 3..7, the
 * banner hangs over +Z, and the mast rises past the plate to a brass-capped head.
 */
export function createWallBanner(livery: Livery, arms: readonly string[], heightCells: number, colours: HeraldicColours = liveryColours(livery)): AggmanPiece {
  const [bx, , bz] = wallBannerExtent(heightCells);
  const sx = Math.max(bx, 14), sy = MAST_LIFT + heightCells + 5, sz = 7 + bz, cx = sx / 2;
  const c = new Cells(sx, sy, sz);
  c.chamfer(cx - 6, 0, 0, cx + 6, 2, 11, 2, MAT.darkStone);
  c.chamfer(cx - 5, 2, 1, cx + 5, 4, 10, 1, STYLES.tide.stone);
  c.chamfer(cx - 3, 4, 2, cx + 3, 6, 8, 1, MAT.darkStone);
  c.chamfer(cx - 2, 6, 3, cx + 2, sy - 3, 7, 1, STYLES.tide.trim);
  for (const y of [9, 11]) c.chamfer(cx - 3, y, 2, cx + 3, y + 1, 8, 1, MAT.thatch);
  c.chamfer(cx - 3, sy - 3, 2, cx + 3, sy - 2, 8, 1, STYLES.tide.trim);
  c.chamfer(cx - 2, sy - 2, 3, cx + 2, sy - 1, 7, 1, livery.brass);
  c.fill(cx - 1, sy - 1, 4, cx + 1, sy, 6, livery.brass);
  bracketBanner(c, livery, arms, colours, (sx - bx) / 2, MAST_LIFT, 7, heightCells);
  return toPiece(pieceId(`wall-banner-${heightCells}`, livery, arms, colours), 'prop', c, [], { from: [cx - 6, 0], to: [cx + 6, 11] });
}

/**
 * The banner frame, in build cells: two square timber posts on stone feet and a lintel 5 m up, from which two
 * iron chains hang a crossbar carrying the arms on a forked cloth 16 cells wide and 28 deep. It dresses a quay
 * head or a market entrance where there is no wall to hang a banner from.
 */
export const BANNER_FRAME = {
  size: [30, 41, 12],
  cloth: { x: 7, width: 16, top: 32, rows: 28, z: 4 },
  footprint: { from: [0, 0], to: [30, 5] },
} as const;

export function createBannerFrame(livery: Livery, arms: readonly string[], colours: HeraldicColours = liveryColours(livery)): AggmanPiece {
  const { size, cloth, footprint } = BANNER_FRAME;
  const c = new Cells(size[0], size[1], size[2]);
  const timber = STYLES.tide.trim;
  for (const px of [0, 25]) {
    c.chamfer(px, 0, 0, px + 5, 2, 5, 1, MAT.darkStone);
    c.fill(px + 1, 2, 1, px + 4, 38, 4, timber);
    c.fill(px + 1, 6, 1, px + 4, 7, 4, MAT.thatch);
    // Iron straps tie each post to the lintel on the front face.
    c.fill(px + 1, 34, 4, px + 4, 38, 5, MAT.darkStone);
  }
  c.fill(0, 38, 1, 30, 41, 4, timber);
  // The straps turn the corner along the lintel for a short way on both sides.
  c.fill(1, 39, 4, 7, 40, 5, MAT.darkStone);
  c.fill(23, 39, 4, 29, 40, 5, MAT.darkStone);
  // The chains, the crossbar and its brass caps.
  for (const x of [6, 23]) c.fill(x, 35, 2, x + 1, 38, 3, MAT.darkStone);
  c.fill(5, 33, 2, 25, 35, 4, timber);
  for (const x of [4, 25]) c.fill(x, 32, 1, x + 1, 36, 5, livery.brass);
  const grid = resampleArms(arms, cloth.width, cloth.rows);
  const hang: Hang = { x: cloth.x, top: cloth.top, z: cloth.z, fold: deepen(foldProfile(cloth.width, 2.1)) };
  weave(c, grid, colours, hang);
  for (const x of [8, 12, 16, 20]) loop(c, x, 33, 1, cloth.z + 2, colours.field);
  tassels(c, grid, hang, livery.brass, livery.gold);
  return toPiece(pieceId('banner-frame', livery, arms, colours), 'civic', c, [], footprint);
}
