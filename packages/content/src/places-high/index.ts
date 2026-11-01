import type { VoxelBlueprint } from '@chatdom/shared';
import type { StyleKey } from '../materials';
import { createCourtFloor } from './court/floor';
import { createCourtWell } from './court/well';

export type * from './types';
export { COURT_FLOOR_HEIGHT, COURT_FLOOR_SIZE, COURT_WAY, createCourtFloor, type CourtHalf } from './court/floor';
export { COURT_WELL, COURT_WELL_SIZE, createCourtWell } from './court/well';
export { COURT_LAYOUT, createCastleCourtPlace, type CastleCourtPlace, type CourtSite } from './court/place';

const STYLE_ORDER: readonly StyleKey[] = ['hearth', 'tide', 'grove'];

/**
 * Finished places-high models, per kit: both halves of the founded 40 × 24 m court floor, then the well-head.
 * Later tasks append their pieces; nothing unfinished is listed.
 */
export const BLUEPRINTS: readonly VoxelBlueprint[] = STYLE_ORDER.flatMap(style => [
  createCourtFloor('west', style).blueprint,
  createCourtFloor('east', style).blueprint,
  createCourtWell(style).blueprint,
]);
