import { CITIZEN_STARTER_LOOKS } from '@chatdom/shared';
import { isStarterLook, starterLookRecipe, type CitizenLook as Recipe } from '@chatdom/content/avatar-style';
import { createCape } from '@chatdom/content/avatars';
import { createStyledCitizenLook, createWornCitizenLook, type StyledCitizenLook } from './style-adapter';

// Stable appearance IDs belong to the existing presence protocol. Their recipes come from the content package's
// starter table, shared by the street, stream, card and portrait painter, never reseeded per view.
export function defaultCitizenRecipe(id: string): Recipe {
  const recipe = starterLookRecipe(id);
  if (!recipe) throw new Error(`Unknown citizen look: ${id}`);
  return recipe;
}

/** One starter as drawn: hearth and sun wear their short cloaks. */
export function createDefaultCitizenLook(id: string): StyledCitizenLook {
  const style = id === 'hearth' ? 'hearth' : id === 'sun' ? 'tide' : undefined;
  const cape = style ? createCape('shortCloak', { body: 'balanced', style }) : undefined;
  return createStyledCitizenLook(id, defaultCitizenRecipe(id), cape ? { cape } : {});
}

export function createDefaultCitizenLooks(): readonly StyledCitizenLook[] {
  return CITIZEN_STARTER_LOOKS.map(createDefaultCitizenLook);
}

/** The drawn look for any ready token: a starter wears its own cloak, a saved look the cape it earned. */
export function citizenLookFor(token: string, recipe: Recipe): StyledCitizenLook {
  return isStarterLook(token) ? createDefaultCitizenLook(token) : createWornCitizenLook(token, recipe);
}
