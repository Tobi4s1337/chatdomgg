import { expect, it } from 'vitest';
import { createHome } from '@chatdom/content';
import { forgeStyleKit } from '@chatdom/forge';
import type { ForgeDraft } from '@chatdom/shared';
import { bindForgeCandidate } from './candidate';

const draft: ForgeDraft = {
  plan: { version: 2, kind: 'lantern', motif: 'crescent-moon', finish: 'native', accent: 'none' },
  title: 'The little moon', plaque: 'A light beside the door.',
};

it('preserves legacy digests while distinguishing registered assembly revisions', () => {
  const home = createHome('house', 'hearth', 0), legacy = bindForgeCandidate(draft, home);
  const first = bindForgeCandidate(draft, home, forgeStyleKit('hearth', 1));
  const second = bindForgeCandidate(draft, home, forgeStyleKit('hearth', 2));
  expect(first).toEqual({ ...legacy, kitId: 'hearth-native', kitRevision: 1 });
  expect(second).toEqual({ ...legacy, kitId: 'hearth-native', kitRevision: 2 });
});

it('cannot mint an exact binding from a forged registry identity, palette or revision', () => {
  const home = createHome('house', 'hearth', 0), kit = forgeStyleKit('hearth');
  for (const invalid of [
    { ...kit, id: 'tide-native' }, { ...kit, id: 'unregistered-kit' },
    { ...kit, styleId: forgeStyleKit('tide').styleId }, { ...kit, revision: 3 },
  ]) expect(() => bindForgeCandidate(draft, home, invalid)).toThrow();
});
