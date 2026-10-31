/**
 * What the citizen card's projection says about a passport (spec 45 R3), in the few facts every passport surface
 * needs. Browser-safe: it reads an already projected `CitizenCardDocument` (the output of `projectCard`, never a
 * `CardSource`) and imports types only.
 *
 * - `passportDisclosure` is the gate a surface follows: travels shown or hidden, at the card's person revision.
 *   That revision moves with first sign-in, homes and the travel choice, so a surface can tell a newer answer from
 *   an older one and never let a stale "shown" undo a later "hidden".
 * - `disclosedPlaces` is the card's own kingdom and the homes it shows publicly. They let a road say where it
 *   began. Hiding travels never changes them: homes stay on the card whatever the passport does.
 */
import type { CitizenCardDocument } from '../citizen-card/contracts';

export interface PassportDisclosure {
  readonly origin: 'live' | 'simulated';
  readonly travels: 'shown' | 'hidden';
  /** The card's person revision this was projected at. */
  readonly revision: number;
}

/** The disclosure gate as the projected card states it. */
export function passportDisclosure(card: CitizenCardDocument): PassportDisclosure {
  return { origin: card.origin, travels: card.passport.hidden ? 'hidden' : 'shown', revision: card.revision.person };
}

/** Kingdom ID → name for every place the projected card shows: its own kingdom, its disclosed homes and castle. */
export function disclosedPlaces(card: CitizenCardDocument): ReadonlyMap<string, string> {
  const places = new Map<string, string>([[card.key.kingdomId, card.kingdomName]]);
  for (const home of card.homes) if (!places.has(home.kingdomId)) places.set(home.kingdomId, home.kingdomName);
  if (card.castle && !places.has(card.castle.kingdomId)) places.set(card.castle.kingdomId, card.castle.kingdomName);
  return places;
}

export function samePlaces(a: ReadonlyMap<string, string>, b: ReadonlyMap<string, string>): boolean {
  if (a.size !== b.size) return false;
  for (const [id, name] of a) if (b.get(id) !== name) return false;
  return true;
}
