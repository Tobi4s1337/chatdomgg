import type { Box } from './camera';

/**
 * The land tile pyramid. Level 0 is one tile holding the whole (square) world; each level halves the tile's world
 * size. Tiles are TILE_PX CSS-px squares baked at the device density, so the deepest laptop zoom is about level 9.
 */
export const TILE_PX = 256;
export const MAX_LEVEL = 11;

export interface Pyramid {
  originX: number;
  originY: number;
  /** World units covered by the level-0 tile. */
  size: number;
}

export interface TileKey { level: number; tx: number; ty: number }

export function pyramidFor(bounds: Box): Pyramid {
  const size = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
  return { originX: bounds.minX, originY: bounds.minY, size };
}

export const tileWorldSize = (pyramid: Pyramid, level: number) => pyramid.size / 2 ** level;
/** CSS px per world unit at which a level's tiles are drawn one-to-one. */
export const levelScale = (pyramid: Pyramid, level: number) => (TILE_PX * 2 ** level) / pyramid.size;

/** The level whose texels best match the screen: never blurrier than ~0.8 texel per device pixel. */
export function levelFor(pyramid: Pyramid, scale: number, devicePixelRatio: number): number {
  const ideal = Math.log2((scale * devicePixelRatio * pyramid.size) / TILE_PX);
  return Math.max(0, Math.min(MAX_LEVEL, Math.ceil(ideal - 0.32)));
}

export function tileKey(key: TileKey): string {
  return `${key.level}/${key.tx}/${key.ty}`;
}

export function tileBox(pyramid: Pyramid, key: TileKey): Box {
  const size = tileWorldSize(pyramid, key.level);
  const minX = pyramid.originX + key.tx * size;
  const minY = pyramid.originY + key.ty * size;
  return { minX, minY, maxX: minX + size, maxY: minY + size };
}

/** Tiles of one level covering a world box, nearest the centre first so the middle of the screen inks first. */
export function tilesFor(pyramid: Pyramid, level: number, view: Box): TileKey[] {
  const size = tileWorldSize(pyramid, level);
  const count = 2 ** level;
  const tx0 = Math.max(0, Math.floor((view.minX - pyramid.originX) / size));
  const ty0 = Math.max(0, Math.floor((view.minY - pyramid.originY) / size));
  const tx1 = Math.min(count - 1, Math.floor((view.maxX - pyramid.originX) / size));
  const ty1 = Math.min(count - 1, Math.floor((view.maxY - pyramid.originY) / size));
  const cx = (view.minX + view.maxX) / 2;
  const cy = (view.minY + view.maxY) / 2;
  const keys: TileKey[] = [];
  for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) keys.push({ level, tx, ty });
  const distance = (key: TileKey) => {
    const box = tileBox(pyramid, key);
    return Math.hypot((box.minX + box.maxX) / 2 - cx, (box.minY + box.maxY) / 2 - cy);
  };
  return keys.sort((a, b) => distance(a) - distance(b));
}

export function parentOf(key: TileKey): TileKey | null {
  return key.level === 0 ? null : { level: key.level - 1, tx: key.tx >> 1, ty: key.ty >> 1 };
}

/** The four tiles one level down that exactly fill a tile, row by row. */
export function childrenOf(key: TileKey): TileKey[] {
  const level = key.level + 1;
  const tx = key.tx * 2;
  const ty = key.ty * 2;
  return [{ level, tx, ty }, { level, tx: tx + 1, ty }, { level, tx, ty: ty + 1 }, { level, tx: tx + 1, ty: ty + 1 }];
}

/** Decor bands (see the survey preview) step with the zoom so stamps keep a steady size on screen. */
export const DECOR_SPACING = [96, 48, 24, 12, 6] as const;
export function decorBand(scale: number): number {
  return Math.max(0, Math.min(DECOR_SPACING.length - 1, Math.round(Math.log2((DECOR_SPACING[0] * scale) / 50))));
}
