import { describe, expect, it } from 'vitest';
import { MAT } from '@chatdom/content/materials';
import { AVATAR_STYLE_IDS, STYLE_STUDY_FIXTURES, convertLook } from '../../../../../packages/content/src/avatar-style';
import { createLegacyCitizenLooks } from '../legacy-look';
import { checkFixture, readStyleSource } from './identity';

describe('style study fixtures', () => {
  const looks = createLegacyCitizenLooks();
  const find = (id: string) => looks.find(look => look.id === id)!;

  it('shows five real everyday looks, each read from its own parts', () => {
    expect(STYLE_STUDY_FIXTURES.map(f => f.look)).toEqual(['hearth', 'tide', 'grove', 'clay', 'dusk']);
    for (const fixture of STYLE_STUDY_FIXTURES) checkFixture(fixture, readStyleSource(find(fixture.look)));
  });

  it('reads skin and dyed garb exactly as the wardrobe made them', () => {
    const hearth = readStyleSource(find('hearth'));
    expect([hearth.skin, hearth.shirt, hearth.trousers]).toEqual([MAT.skin3, MAT.cream, MAT.fabricMutedBlue]);
    const tide = readStyleSource(find('tide'));
    expect([tide.skin, tide.shirt, tide.trousers]).toEqual([MAT.skin7, MAT.fabricMutedBlue, MAT.earth]);
  });

  it('converts every fixture into every option', () => {
    for (const style of AVATAR_STYLE_IDS) for (const fixture of STYLE_STUDY_FIXTURES) {
      const look = convertLook(style, readStyleSource(find(fixture.look)));
      expect(look.parts.some(p => p.layer === 'hair')).toBe(true);
      expect(Boolean(look.cape)).toBe(fixture.expect.cloak);
    }
  });

  it('refuses a fixture that no longer matches what the study labels it', () => {
    expect(() => checkFixture(STYLE_STUDY_FIXTURES[0]!, readStyleSource(find('tide')))).toThrow(/Study fixture hearth/);
  });
});
