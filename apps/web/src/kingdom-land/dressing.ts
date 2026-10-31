import { CIVIC_FORMS, createCivicProp, createStreetProp, STREET_PROP_FORMS, type CivicForm, type StreetPropForm } from '@chatdom/content';
import type { LandDressing } from '@chatdom/world';
import type { Dressing } from '../kingdom/settlement-content';

/** Civic forms whose models exist today; the bench and fingerpost wait for theirs (spec 10). */
const BUILT_CIVIC: ReadonlySet<CivicForm> = new Set(['footbridge']);

export interface LandContent {
  /** Ready to mount: blueprint origin in world metres, yaw from the cardinal turn (local +Z forward). */
  placed: Dressing[];
  /** Reserved furniture whose civic model is not finished. Its lay-by and footprint stay held for it. */
  pending: LandDressing[];
}

/**
 * Turns the land's pacing furniture into mountable content. Positions are already seated on the graded
 * trail ground by routing, so nothing is resampled here. Furniture without a finished model is listed as
 * pending, never drawn as a stand-in.
 */
export function placeLandContent(dressings: readonly LandDressing[]): LandContent {
  const placed: Dressing[] = [], pending: LandDressing[] = [];
  for (const item of dressings) {
    const yaw = item.turn * Math.PI / 2, position = [...item.position] as Dressing['position'];
    if ((STREET_PROP_FORMS as readonly string[]).includes(item.form)) {
      placed.push({ blueprint: createStreetProp(item.form as StreetPropForm, item.style), position, yaw });
    } else if ((CIVIC_FORMS as readonly string[]).includes(item.form) && BUILT_CIVIC.has(item.form as CivicForm)) {
      placed.push({ blueprint: createCivicProp(item.form as CivicForm, item.style), position, yaw });
    } else pending.push(item);
  }
  return { placed, pending };
}
