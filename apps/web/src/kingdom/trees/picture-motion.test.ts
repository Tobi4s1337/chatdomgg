import { expect, it } from 'vitest';
import { createPictureTree } from '@chatdom/content/trees';
import { growPictureMotions, pictureTreeOf, preparePictureMotions } from './picture-motion';

it('reads the same wind motion a tree grown on this thread has, from a structured clone', async () => {
  const refs = [{ species: 'oak', style: 'hearth', variant: 0 }, { species: 'pine', style: 'grove', variant: 1 }, { species: 'oak', style: 'hearth', variant: 0 }] as const;
  const motions = await preparePictureMotions(refs);
  expect(motions.size).toBe(2);
  for (const ref of refs) {
    const tree = createPictureTree(ref.species, ref.style, ref.variant), motion = motions.get(tree.id)!;
    expect(structuredClone(motion)).toEqual({ id: tree.id, canopy: tree.canopy, root: tree.root });
    expect(pictureTreeOf(tree.blueprint)).toEqual(ref);
  }
  expect(growPictureMotions([refs[1]])[0]!.id).toBe('tree-pine-grove-1');
  const oak = createPictureTree('oak', 'hearth', 0).blueprint;
  expect(pictureTreeOf({ ...oak, kind: 'home' })).toBeUndefined();
  expect(pictureTreeOf({ ...oak, styleId: 'tide' as typeof oak.styleId })).toBeUndefined();
  expect(pictureTreeOf({ ...oak, id: 'tree-oak-hearth-99' })).toBeUndefined();
});
