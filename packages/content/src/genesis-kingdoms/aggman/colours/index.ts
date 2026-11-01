import type { AggmanPiece, Livery } from '../piece';
import { createAwning, createFishStall } from './awning';
import { createBannerFrame, createQuayBanner, createWallBanner } from './banners';
import { createBuntingRun } from './bunting';
import { createHarbourPennant } from './pennant';

export { AWNING, FISH_STALL, createAwning, createFishStall } from './awning';
export { BANNER_FRAME, QUAY_BANNER, WALL_BANNER_HEIGHTS, createBannerFrame, createQuayBanner, createWallBanner, wallBannerBoxes, wallBannerExtent } from './banners';
export { BUNTING, createBuntingRun } from './bunting';
export { HARBOUR_PENNANT, createHarbourPennant } from './pennant';
export { chargeBand, liveryColours, resampleArms } from './cloth';
export type { Box } from './cells';

/**
 * The kingdom's cloth, the colours seen from 100 m: both harbour pennants, the quay banner, a 12 m bunting run,
 * a 6 m wall banner on its mast, the banner frame, a market awning and the fish stall. `arms` is the heraldry's
 * cloth grid (`clothArms(cut, charge)`, or `composeGenesisHeraldry(...).standard.arms`), so every small cloth
 * carries the same device as the founding standard.
 */
export function COLOUR_PIECES(livery: Livery, arms: readonly string[]): AggmanPiece[] {
  return [
    createHarbourPennant(livery, arms, 0),
    createHarbourPennant(livery, arms, 1),
    createQuayBanner(livery, arms),
    createBuntingRun(livery, 96, 8),
    createWallBanner(livery, arms, 48),
    createBannerFrame(livery, arms),
    createAwning(livery, 32),
    createFishStall(livery),
  ];
}
