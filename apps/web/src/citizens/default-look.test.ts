import { describe, expect, it } from 'vitest';
import { starterLookRecipe, PORTRAIT_FIXTURES } from '@chatdom/content/avatar-style';
import { citizenLookFor, createDefaultCitizenLooks, defaultCitizenRecipe } from './default-look';

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
    for (const look of looks) expect(look.recipe).toEqual(starterLookRecipe(look.id));
  });

  it('draws a starter token in its cloak and a saved token in the cape it earned', () => {
    expect(citizenLookFor('sun', defaultCitizenRecipe('sun')).cape).toEqual(createDefaultCitizenLooks()[4]!.cape);
    const base = PORTRAIT_FIXTURES[1]!.look;
    expect(citizenLookFor(`lk.${'0'.repeat(40)}`, { ...base, earned: { ...base.earned, cape: null } }).cape).toBeUndefined();
    const caped = citizenLookFor(`lk.${'0'.repeat(40)}`, { ...base, earned: { ...base.earned, cape: { kind: 'tier-cloak', id: 'x', cloth: '#963411', lining: '#78baf1', trim: '#e7d12b' } } });
    expect(caped.cape?.id).toBe('cape.worn');
    expect(caped.capePaint).toBeDefined();
  });
});
