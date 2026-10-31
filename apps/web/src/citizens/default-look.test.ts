import { describe, expect, it } from 'vitest';
import { MAT } from '@chatdom/content/materials';
import { createDefaultCitizenLooks } from './default-look';

describe('default citizen wardrobe', () => {
  it('compiles distinct everyday garb while keeping the body and cape optional', () => {
    const looks = createDefaultCitizenLooks();
    expect(looks).toHaveLength(6);
    expect(new Set(looks.map(look => look.id)).size).toBe(looks.length);
    expect(looks.filter(look => look.cape)).toHaveLength(2);
    expect(looks.map(look => look.parts.find(part => part.blueprint.attachment === 'chest')!.blueprint.id.split('.')[1]))
      .toEqual(['balanced', 'broad', 'slender', 'round', 'broad', 'slender']);
    expect(looks.map(look => look.parts.find(part => part.blueprint.layer === 'hair')!.blueprint.id.split('.')[1]))
      .toEqual(['sidePart', 'coiledHighCrown', 'bob', 'roundedCurls', 'longBraid', 'pairedTwists']);
    const materials = (attachment: string) => looks.map(look => {
      const part = look.parts.find(item => item.blueprint.attachment === attachment && item.blueprint.layer === 'body')!;
      expect(part.asset.id).toBe(part.blueprint.id);
      return new Set(part.blueprint.boxes.map(box => box.material));
    });
    const shirts = materials('chest');
    expect(new Set(shirts.flatMap(set => [...set])).size).toBeGreaterThanOrEqual(6);
    const trousers = materials('thighLeft');
    expect(new Set(trousers.flatMap(set => [...set])).size).toBeGreaterThanOrEqual(3);
    expect(materials('head').every(set => set.has(MAT.hairBlack) && set.has(MAT.cream))).toBe(true);
  });
});
