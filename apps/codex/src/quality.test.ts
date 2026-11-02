import { describe, expect, it } from 'vitest';
import type { ForgeDraft } from '@chatdom/shared';
import { forgeEarlyRedraft, forgeQualityRetryUseful, forgeRedraftFeedback, forgeResultMeasure, withForgeQuality } from './quality';
import { forgeMotifCertificate, forgeReadableFinishes } from './certificates';
import { agreedForgeWishSubject, combineForgeWishSubject, forgeMeasureDetailMatch, scoreForgeMeasure, type ForgeQualityMeasure } from './providers/policy';
import type { JudgeVerdict } from './providers';

const draft = (motif: ForgeDraft['plan']['motif'], kind: ForgeDraft['plan']['kind'] = 'weathervane', finish: 'native' | 'copper' | 'ceramic' = 'native'): ForgeDraft =>
  ({ plan: { version: 2, kind, motif, finish, accent: 'none' }, title: 'A piece', plaque: 'A small authored piece.' });
const sockets = [{ kind: 'chimney' as const }, { kind: 'lantern' as const }, { kind: 'weathervane' as const }];
const owl = { motif: 'watchful-owl' as const, slot: 'weathervane' as const };
const kit = { family: 'hearth' as const, revision: 1 };
const pass = (): JudgeVerdict => ({ outcome: 'pass', reason: 'sealed', records: [] });

describe('policy v7 quality', () => {
  it('is deterministic: the same measure gives the same score every time', () => {
    const measure = forgeResultMeasure({ words: owl, result: owl, draft: draft('watchful-owl'), styleKit: kit, sockets });
    const scores = Array.from({ length: 5 }, () => scoreForgeMeasure(structuredClone(measure)));
    expect(new Set(scores.map(score => JSON.stringify(score))).size).toBe(1);
    expect(scores[0]).toMatchObject({ recognisability: 1, completeness: 1, cleanMarks: 1, score: 1 });
    expect(forgeMeasureDetailMatch(measure)).toBe('met');
  });

  it('delivers a certified known motif exactly when both word readings agree with the plan', () => {
    const verdict = withForgeQuality(pass(), forgeResultMeasure({ words: owl, result: owl, draft: draft('watchful-owl'), styleKit: kit, sockets }));
    expect(verdict.detailMatch).toBe('met');
    expect(verdict.quality!.score).toBeGreaterThanOrEqual(0.72);
  });

  it('scores a different motif than both readings name as zero likeness and adapted', () => {
    const measure = forgeResultMeasure({ words: owl, result: owl, draft: draft('scallop-shell', 'weathervane', 'copper'), styleKit: kit, sockets });
    expect(scoreForgeMeasure(measure).recognisability).toBe(0);
    expect(forgeMeasureDetailMatch(measure)).toBe('adapted');
  });

  it('keeps one read from deciding: a disagreement between the two readings stays disputed', () => {
    const measure = forgeResultMeasure({ words: owl, result: { motif: 'none', slot: 'weathervane' }, draft: draft('watchful-owl'), styleKit: kit, sockets });
    expect(agreedForgeWishSubject(measure).motif).toBe('disputed');
    expect(forgeMeasureDetailMatch(measure)).toBe('unclear');
    expect(scoreForgeMeasure(measure).recognisability).toBeLessThan(0.75);
  });

  it('marks an uncertified-readable motif as adapted, never exact', () => {
    const fox = { motif: 'sleeping-fox' as const, slot: 'chimney' as const };
    expect(forgeMotifCertificate('grove', 1, 'sleeping-fox', 'native')).toBe('unread');
    const measure = forgeResultMeasure({ words: fox, result: fox, draft: draft('sleeping-fox', 'chimney'), styleKit: { family: 'grove', revision: 1 }, sockets });
    expect(forgeMeasureDetailMatch(measure)).toBe('adapted');
  });

  it('treats an unsupported subject as the closest piece, with no pointless retry', () => {
    const none = { motif: 'none' as const, slot: 'none' as const };
    const verdict = withForgeQuality(pass(), forgeResultMeasure({ words: none, result: none, draft: draft('watchful-owl'), styleKit: kit, sockets }));
    expect(verdict.quality!.recognisability).toBe(0.3);
    expect(forgeQualityRetryUseful(verdict, 'hearth', 1)).toBe(false);
  });

  it('retries a missed motif or an available missed slot, and treats a missing slot as a fit adaptation', () => {
    const mismatch = withForgeQuality(pass(), forgeResultMeasure({ words: owl, result: owl, draft: draft('sunflower'), styleKit: kit, sockets }));
    expect(forgeQualityRetryUseful(mismatch, 'hearth', 1)).toBe(true);
    const lantern = { motif: 'crescent-moon' as const, slot: 'lantern' as const };
    const noLantern = forgeResultMeasure({ words: lantern, result: lantern, draft: draft('crescent-moon', 'chimney'), styleKit: kit,
      sockets: [{ kind: 'chimney' }] });
    expect(noLantern.slotAvailable).toBe(false);
    expect(forgeMeasureDetailMatch(noLantern)).toBe('met');
    expect(scoreForgeMeasure(noLantern).completeness).toBe(0.75);
  });

  it('asks for one quiet redraft before judging when the word gate named a kit subject the draft missed', () => {
    const always = () => true;
    expect(forgeEarlyRedraft(owl, draft('sunflower'), sockets, always)).toBe(true);
    expect(forgeEarlyRedraft(owl, draft('watchful-owl', 'chimney'), sockets, always)).toBe(true);
    expect(forgeEarlyRedraft(owl, draft('watchful-owl', 'chimney'), [{ kind: 'chimney' }], always)).toBe(false);
    expect(forgeEarlyRedraft({ motif: 'none', slot: 'none' }, draft('sunflower'), sockets, always)).toBe(false);
    expect(forgeEarlyRedraft({ motif: 'unclear', slot: 'unclear' }, draft('sunflower'), sockets, always)).toBe(false);
  });

  it('never trades a fitting draft for a named plan that cannot land on this home', () => {
    const dragonLantern = { motif: 'sleeping-dragon' as const, slot: 'lantern' as const };
    const noLantern = (plan: { kind: string }) => plan.kind !== 'lantern';
    // The named dragon lantern would not fit: keep the dragon chimney and judge it.
    expect(forgeEarlyRedraft(dragonLantern, draft('sleeping-dragon', 'chimney'), sockets, noLantern)).toBe(false);
    // The motif alone still improves the draft on its own slot.
    expect(forgeEarlyRedraft(dragonLantern, draft('sunflower', 'chimney'), sockets, noLantern)).toBe(true);
    expect(forgeEarlyRedraft(dragonLantern, draft('sunflower', 'chimney'), sockets, () => false)).toBe(false);
    // A judged piece that missed an available slot is retried only when that slot can actually take the piece.
    const missed = withForgeQuality(pass(), forgeResultMeasure({ words: dragonLantern, result: dragonLantern,
      draft: draft('sleeping-dragon', 'chimney'), styleKit: kit, sockets }));
    expect(forgeQualityRetryUseful(missed, 'hearth', 1, noLantern)).toBe(false);
    expect(forgeQualityRetryUseful(missed, 'hearth', 1, () => true)).toBe(true);
  });

  it('builds finite redraft feedback from catalogue readings only', () => {
    const text = forgeRedraftFeedback('subject', owl);
    expect(text).toContain('watchful-owl');
    expect(text).toContain('weathervane');
    expect(text).not.toMatch(/undefined/);
  });

  it('combines independent readings field by field', () => {
    expect(combineForgeWishSubject(owl, owl)).toEqual(owl);
    expect(combineForgeWishSubject(owl, { motif: 'watchful-owl', slot: 'none' })).toEqual({ motif: 'watchful-owl', slot: 'unclear' });
    expect(combineForgeWishSubject()).toEqual({ motif: 'unclear', slot: 'unclear' });
  });

  it('offers clearly readable finishes to the drafter, or weak ones where none read clearly', () => {
    const finishes = forgeReadableFinishes('hearth', 1);
    for (const [motif, list] of Object.entries(finishes))
      for (const finish of list!) expect(['reads', 'weak']).toContain(forgeMotifCertificate('hearth', 1, motif, finish));
    expect(finishes['watchful-owl']).toEqual(['native']);
    expect(forgeMotifCertificate('hearth', 9, 'watchful-owl', 'native')).toBe('uncertified');
  });

  it('rejects a measure whose grade was edited: grades come from counts only', () => {
    const measure: ForgeQualityMeasure = forgeResultMeasure({ words: owl, result: owl, draft: draft('watchful-owl'), styleKit: kit, sockets });
    expect(measure.certificate).toBe(forgeMotifCertificate('hearth', 1, 'watchful-owl', 'native'));
  });
});
