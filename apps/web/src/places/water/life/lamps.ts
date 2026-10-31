import type { PlacedEmitter } from '../../../../../../packages/world/src/places/water/anchors';
import type { PeopleLightOptions } from '../../../kingdom/lights/types';

/** An empty pier or bridge lamp keeps only this ember: well under the 15% the spec allows. */
export const PLACE_LAMP_PILOT = 0.12;
/** A lamp is fully warm with this many people under it. */
const PLACE_LAMP_CAPACITY = 2;

/**
 * The shared people-light helper's options for one of the place's physical lamps: its glass, the reach its piece
 * declares, a low pilot and the common rise/fade. The host creates the helper (`createPeopleLight`) with these,
 * feeds it the accepted public people and its activity history, applies the kingdom's hour curve and hands the
 * resulting strength to `WaterLife.update` by emitter id. This module never decides who is present.
 */
export function placeLampLight(emitter: PlacedEmitter): PeopleLightOptions {
  return { position: emitter.position, reach: emitter.reach, pilot: PLACE_LAMP_PILOT, full: 1, capacity: PLACE_LAMP_CAPACITY };
}
