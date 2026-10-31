import type { WaterPieceSpecs } from '../../../../../../packages/world/src/places/water/index';
import { BRIDGE, humpbackDeckTop } from '../../../../../../packages/content/src/places/water/bridge/index';
import { FINGERPOST } from '../../../../../../packages/content/src/places/water/fingerpost/index';
import { MILL } from '../../../../../../packages/content/src/places/water/mill/index';
import { WEIR, WHEEL, WHEEL_PIT, weirFrame, wheelPitFrame } from '../../../../../../packages/content/src/places/water/millrace/index';
import { fishingRockTop } from '../../../../../../packages/content/src/places/water/shore/index';

/**
 * The real piece dimensions and frame functions the water-place planner fits to the land. Every value is the
 * content module's own export, so a change to a piece changes the plan (and its revision) with it.
 */
export const WATER_PIECE_SPECS: WaterPieceSpecs = {
  mill: { size: MILL.size, shaft: MILL.shaft },
  wheel: { size: WHEEL.size, radius: WHEEL.radius },
  wheelPit: { ...WHEEL_PIT, frame: wheelPitFrame },
  weir: { cap: WEIR.cap, frame: weirFrame },
  bridge: { size: BRIDGE.size, centre: BRIDGE.centre, radius: BRIDGE.radius, walk: BRIDGE.walk, deckTop: humpbackDeckTop },
  rock: { top: fishingRockTop },
  fingerpost: { plan: FINGERPOST.plan },
};
