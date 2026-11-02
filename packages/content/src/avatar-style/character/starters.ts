import { PORTRAIT_FIXTURES } from './fixtures';
import type { CitizenLook } from './recipe';

/*
 * The six free starter looks a person wears before they save their own (`CITIZEN_STARTER_LOOKS` in
 * `@chatdom/shared`). Their ids belong to the room protocol, so the realm, the street, the stream, the card and the
 * panel all resolve the same id to the same recipe from here.
 */
export const STARTER_LOOK_FIXTURES = { hearth: 0, tide: 13, grove: 3, clay: 4, sun: 12, dusk: 18 } as const;
export type StarterLookId = keyof typeof STARTER_LOOK_FIXTURES;

export function isStarterLook(id: string): id is StarterLookId {
  return Object.prototype.hasOwnProperty.call(STARTER_LOOK_FIXTURES, id);
}

/** The recipe a starter id stands for, or null for any other id. */
export function starterLookRecipe(id: string): CitizenLook | null {
  return isStarterLook(id) ? PORTRAIT_FIXTURES[STARTER_LOOK_FIXTURES[id]]!.look : null;
}
