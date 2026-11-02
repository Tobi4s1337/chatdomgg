import type { PlaceSite } from '../land-interface';

/**
 * Accepted place sites, pinned per kingdom so they never reroll as the town grows. Each was found by
 * `planPlaceSites` on that kingdom's installed founded scene (flat continuous collision support under the whole
 * square, clear of every reserved lot, planned road, civic square and installed solid). On a later scene the pin is
 * validated again and never replaced: an invalid pin is reported (`pinned-invalid`), not relocated.
 *
 * Kept apart from the land recipe on purpose: a place is not land, so pinning one leaves the recipe hash and the
 * baked land untouched.
 */
const CAMPFIRES: Readonly<Record<string, PlaceSite>> = Object.freeze({
  // Willowmere: the first Wilds-edge clearing from the market on scene af5df495 (layout and collision as published
  // 2026-11-02), on the town's east edge; hearth centre [244.2, 2, -1].
  '129634568': Object.freeze({ origin: Object.freeze([253.2, 2, -10]) as PlaceSite['origin'], turn: 3, footprint: Object.freeze([18, 18]) as PlaceSite['footprint'] }),
});

/** The pinned campfire clearing for a kingdom, if one was accepted. Pass it as `placeSites.pinned`. */
export function pinnedCampfireSite(kingdomId: string): PlaceSite | undefined {
  return Object.hasOwn(CAMPFIRES, kingdomId) ? CAMPFIRES[kingdomId] : undefined;
}
