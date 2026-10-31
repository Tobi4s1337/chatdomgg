import { PORTRAIT_FIXTURES, type CitizenLook as Recipe } from '@chatdom/content/avatar-style';
import { createCape } from '@chatdom/content/avatars';
import { createStyledCitizenLook, type StyledCitizenLook } from './style-adapter';

// Stable appearance IDs belong to the existing presence protocol. Their recipes
// are shared by the street, stream and portrait painter, never reseeded per view.
const recipes = [
  ['hearth', 0], ['tide', 13], ['grove', 3], ['clay', 4], ['sun', 12], ['dusk', 18],
] as const;

export function defaultCitizenRecipe(id: string): Recipe {
  const entry = recipes.find(([name]) => name === id);
  if (!entry) throw new Error(`Unknown citizen look: ${id}`);
  return PORTRAIT_FIXTURES[entry[1]]!.look;
}

export function createDefaultCitizenLooks(): readonly StyledCitizenLook[] {
  return recipes.map(([id]) => {
    const style = id === 'hearth' ? 'hearth' : id === 'sun' ? 'tide' : undefined;
    const cape = style ? createCape('shortCloak', { body: 'balanced', style }) : undefined;
    return createStyledCitizenLook(id, defaultCitizenRecipe(id), cape ? { cape } : {});
  });
}
