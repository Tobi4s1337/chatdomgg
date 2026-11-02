import { describe, expect, it } from 'vitest';
import { dissolveStep } from './dissolve';

const first = { url: 'blob:first' }, second = { url: 'blob:second' };
const seen = { active: true, calm: false };

describe('dissolveStep', () => {
  it('moves nothing while the picture stays the same', () => {
    expect(dissolveStep(first, { url: 'blob:first' }, seen)).toEqual({ kind: 'keep' });
    expect(dissolveStep(null, null, seen)).toEqual({ kind: 'keep' });
  });

  it('dissolves a replaced painting over the one before it', () => {
    expect(dissolveStep(first, second, seen)).toEqual({ kind: 'dissolve', under: first });
  });

  it('cuts when nobody can see the fade or the viewer asked for calm', () => {
    expect(dissolveStep(first, second, { active: false, calm: false })).toEqual({ kind: 'cut' });
    expect(dissolveStep(first, second, { active: true, calm: true })).toEqual({ kind: 'cut' });
  });

  it('cuts to an absence at once', () => {
    expect(dissolveStep(first, null, seen)).toEqual({ kind: 'cut' });
  });

  it('fades a first painting in only where the view asks for it', () => {
    expect(dissolveStep(null, first, seen)).toEqual({ kind: 'cut' });
    expect(dissolveStep(null, first, { ...seen, fromNothing: true })).toEqual({ kind: 'dissolve', under: null });
    expect(dissolveStep(null, first, { ...seen, fromNothing: true, calm: true })).toEqual({ kind: 'cut' });
  });
});
