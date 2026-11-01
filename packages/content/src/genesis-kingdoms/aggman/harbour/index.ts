import type { AggmanPiece, Livery } from '../piece';
import { createHarbourCoble } from './coble';
import { createDrawnUpBoat } from './drawn-up';
import { createMooringBollard, createHarbourLantern, createSlipwayCapstan } from './quay';
import { createFishCrates, createNetRack, createPotStack } from './shore';

export { COBLE, COBLE_FORM, createHarbourCoble, type CobleVariant } from './coble';
export { SKIFF_FORM, createDrawnUpBoat, type DrawnUpVariant } from './drawn-up';
export { HARBOUR_LANTERN, createHarbourLantern, createMooringBollard, createSlipwayCapstan, type BollardVariant } from './quay';
export { createShingleStrand, type ShingleSite, type ShingleStrand } from './shingle';
export { NET_RACK, createFishCrates, createNetRack, createPotStack, type PotStackVariant } from './shore';

/** Every piece of the working harbour, each factory in each of its variants, in a stable order. */
export function HARBOUR_PIECES(livery: Livery): AggmanPiece[] {
  return [
    createHarbourCoble(livery, 0),
    createHarbourCoble(livery, 1),
    createDrawnUpBoat(livery, 0),
    createDrawnUpBoat(livery, 1),
    createDrawnUpBoat(livery, 2),
    createMooringBollard(0),
    createMooringBollard(1),
    createNetRack(livery),
    createPotStack(livery, 0),
    createPotStack(livery, 1),
    createFishCrates(livery),
    createHarbourLantern(livery),
    createSlipwayCapstan(),
  ];
}
