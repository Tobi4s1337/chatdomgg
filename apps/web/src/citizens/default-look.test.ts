import { describe, expect, it } from 'vitest';
import { createDefaultCitizenLooks, defaultCitizenRecipe } from './default-look';

describe('default citizen wardrobe', () => {
  it('keeps presence look IDs and cloth capes while sharing the chosen painted recipes', () => {
    const looks = createDefaultCitizenLooks();
    expect(looks.map(look => look.id)).toEqual(['hearth', 'tide', 'grove', 'clay', 'sun', 'dusk']);
    expect(looks.filter(look => look.cape).map(look => look.id)).toEqual(['hearth', 'sun']);
    expect(looks.every(look => look.kind === 'paint-grid')).toBe(true);
    for (const look of looks) expect(look.recipe).toEqual(defaultCitizenRecipe(look.id));
    expect(new Set(looks.map(look => look.recipe.skin)).size).toBe(6);
    expect(new Set(looks.map(look => look.recipe.hair.style)).size).toBeGreaterThanOrEqual(5);
    expect(() => defaultCitizenRecipe('missing')).toThrow('Unknown citizen look');
  });
});
