import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { FORGE_JUDGE_POLICY_VERSION, combineForgeWishSubject, forgeMeasureDetailMatch, scoreForgeMeasure,
  type ForgeCertificateGrade, type ForgeQualityMeasure, type ForgeWishSubject } from '../../../../apps/codex/src/providers/policy';
import { repeatabilityPass, type RepeatabilityRead } from './repeatability-policy';
import { REPEATABILITY_FIXTURES } from './repeatability-fixtures';

const hex = (value: string) => createHash('sha256').update(value).digest('hex');
/** What both gates read from each fixed wish: the fixture's own planned motif and part. */
const asked = (id: string): ForgeWishSubject => {
  const plan = REPEATABILITY_FIXTURES.find(fixture => fixture.id === id)!.draft.plan;
  return { motif: plan.motif, slot: plan.kind };
};
const gateRecord = (hash: string, subject: ForgeWishSubject | undefined) => ({ backend: 'codex-cli', status: 'complete',
  policy: FORGE_JUDGE_POLICY_VERSION, evidenceHash: hash, ...(subject ? { subject } : {}), subjectStatus: subject ? 'complete' : 'invalid' });

interface Shape { words?: (ForgeWishSubject | undefined)[]; result?: (ForgeWishSubject | undefined)[];
  certificate?: ForgeCertificateGrade; slotAvailable?: boolean }
/** One round as the runner stores it: both gates' actual reads, then the host's recomputable measure. */
function round(fixture: string, repeat: number, shape: Shape = {}): RepeatabilityRead {
  const plan = REPEATABILITY_FIXTURES.find(entry => entry.id === fixture)!.draft.plan;
  const wordSubjects = shape.words ?? [asked(fixture)], resultSubjects = shape.result ?? [asked(fixture)];
  const words = { outcome: 'pass' as const, subject: combineForgeWishSubject(...wordSubjects),
    records: wordSubjects.map(subject => gateRecord(hex(`words:${fixture}`), subject)) };
  const subject = combineForgeWishSubject(...resultSubjects);
  const measure: ForgeQualityMeasure = { words: words.subject, result: subject, plan: { motif: plan.motif, kind: plan.kind },
    certificate: shape.certificate ?? 'reads', slotAvailable: shape.slotAvailable ?? true };
  return { fixture, repeat, words, outcome: 'pass', subject, records: resultSubjects.map(read => gateRecord(hex(`sheet:${fixture}`), read)),
    measure, quality: scoreForgeMeasure(measure), detailMatch: forgeMeasureDetailMatch(measure), calls: wordSubjects.length + resultSubjects.length };
}
const reads = (shapes: Record<string, Shape | ((repeat: number) => Shape)> = {}): RepeatabilityRead[] =>
  REPEATABILITY_FIXTURES.flatMap(({ id }) => [1, 2, 3].map(repeat => {
    const shape = shapes[id];
    return round(id, repeat, typeof shape === 'function' ? shape(repeat) : shape);
  }));
const of = (sample: RepeatabilityRead[], fixture: string) => sample.filter(read => read.fixture === fixture);
const rescore = (read: RepeatabilityRead) => {
  read.quality = scoreForgeMeasure(read.measure!); read.detailMatch = forgeMeasureDetailMatch(read.measure!);
};

describe('repeatability evidence', () => {
  it('accepts all five fixed fixtures with three complete, recomputable rounds', () => {
    const sample = reads();
    expect(sample).toHaveLength(15);
    expect(sample.every(read => read.detailMatch === 'met' && read.quality!.score === 1)).toBe(true);
    expect(repeatabilityPass(sample)).toBe(true);
  });

  it('accepts a stable adapted owl: the copper owl only has to pass both safety gates every round', () => {
    const sample = reads({ owl: { certificate: 'unread' } });
    expect(of(sample, 'owl').map(read => read.detailMatch)).toEqual(['adapted', 'adapted', 'adapted']);
    expect(repeatabilityPass(sample)).toBe(true);
  });

  it.each(['owl', 'dragon'])('rejects a %s whose delivery decision changes between rounds', fixture => {
    const sample = reads({ [fixture]: (repeat: number) => ({ certificate: repeat === 2 ? 'unread' : 'reads' }) });
    expect(new Set(of(sample, fixture).map(read => read.detailMatch))).toEqual(new Set(['met', 'adapted']));
    expect(repeatabilityPass(sample)).toBe(false);
  });

  it.each([
    ...(['hold', 'refuse'] as const).flatMap(outcome => (['words', 'result'] as const).flatMap(gate =>
      ['owl', 'fox'].map(fixture => [outcome, gate, fixture] as const))),
  ])('rejects a safety %s at the %s gate for the %s', (outcome, gate, fixture) => {
    const sample = reads(), read = of(sample, fixture)[1]!;
    if (gate === 'words') read.words.outcome = outcome; else read.outcome = outcome;
    expect(repeatabilityPass(sample)).toBe(false);
  });

  it('rejects quality or detail that does not recompute from the stored measure', () => {
    const edits: ((read: RepeatabilityRead) => void)[] = [
      read => { read.quality = { ...read.quality!, score: 0.99 }; },
      read => { read.quality = { ...read.quality!, recognisability: 0.85 }; },
      read => { read.detailMatch = 'adapted'; },
      read => { delete read.detailMatch; },
      read => { read.quality = undefined; },
      read => { read.measure = undefined; },
      // The certificate changed but the score was not recomputed.
      read => { read.measure = { ...read.measure!, certificate: 'weak' }; },
    ];
    for (const edit of edits) {
      const sample = reads(); edit(sample[0]!);
      expect(repeatabilityPass(sample)).toBe(false);
    }
  });

  it('rejects a measure whose readings are not the gates’ own readings, even when rescored', () => {
    const edits: ((read: RepeatabilityRead) => void)[] = [
      read => { read.measure = { ...read.measure!, words: { motif: 'sleeping-fox', slot: 'chimney' } }; },
      read => { read.measure = { ...read.measure!, result: { motif: 'unclear', slot: 'unclear' } }; },
      read => { read.subject = { motif: 'sleeping-fox', slot: 'chimney' }; read.measure = { ...read.measure!, result: read.subject }; },
      read => { read.words.subject = { motif: 'sleeping-fox', slot: 'chimney' }; read.measure = { ...read.measure!, words: read.words.subject }; },
    ];
    for (const edit of edits) {
      const sample = reads(); edit(sample[0]!); rescore(sample[0]!);
      expect(repeatabilityPass(sample)).toBe(false);
    }
  });

  it.each(['words', 'result'] as const)('requires complete, versioned %s gate records with a readable subject', gate => {
    const changes: Record<string, unknown>[] = [{ status: 'invalid' }, { subjectStatus: 'invalid' }, { policy: 'old' },
      { evidenceHash: 'invalid' }, { subject: undefined }, { subject: { motif: 'griffin', slot: 'chimney' } },
      { subject: { motif: 'sleeping-dragon', slot: 'chimney', detailMatch: 'met' } }];
    for (const change of changes) {
      const sample = reads(), read = sample[0]!, records = gate === 'words' ? read.words.records : read.records;
      records[0] = { ...(records[0] as object), ...change };
      expect(repeatabilityPass(sample)).toBe(false);
    }
    const empty = reads(); if (gate === 'words') empty[0]!.words.records = []; else empty[0]!.records = [];
    empty[0]!.calls = 1;
    expect(repeatabilityPass(empty)).toBe(false);
  });

  it('rejects an invalid subject read even when the stored combination follows it', () => {
    const sample = reads({ dragon: { result: [undefined] } });
    expect(of(sample, 'dragon')[0]!.subject).toEqual({ motif: 'unclear', slot: 'unclear' });
    expect(repeatabilityPass(sample)).toBe(false);
  });

  it.each(['words', 'result'] as const)('requires one identical %s evidence hash in every round of a fixture', gate => {
    const sample = reads(), read = of(sample, 'moon')[2]!, records = gate === 'words' ? read.words.records : read.records;
    records[0] = { ...(records[0] as object), evidenceHash: hex('other evidence') };
    expect(repeatabilityPass(sample)).toBe(false);
  });

  it('accepts two independent reads per gate only when calls and evidence agree', () => {
    const dragon = asked('dragon'), sample = reads({ dragon: { words: [dragon, dragon], result: [dragon, dragon] } });
    expect(of(sample, 'dragon')[0]!.calls).toBe(4);
    expect(repeatabilityPass(sample)).toBe(true);
    of(sample, 'dragon')[0]!.calls = 3;
    expect(repeatabilityPass(sample)).toBe(false);
    const split = reads({ dragon: { words: [dragon, dragon], result: [dragon, dragon] } }), read = of(split, 'dragon')[0]!;
    read.records[1] = { ...(read.records[1] as object), evidenceHash: hex('other sheet') };
    expect(repeatabilityPass(split)).toBe(false);
  });

  it('accepts a stable disputed reading as unclear, but never a summary that hides the dispute', () => {
    const dragon = asked('dragon'), moon = { motif: 'crescent-moon', slot: 'chimney' } as const;
    const sample = reads({ dragon: { result: [dragon, moon] } }), read = of(sample, 'dragon')[0]!;
    expect(read).toMatchObject({ subject: { motif: 'unclear', slot: 'chimney' }, detailMatch: 'unclear' });
    expect(repeatabilityPass(sample)).toBe(true);
    read.subject = dragon; read.measure = { ...read.measure!, result: dragon }; rescore(read);
    expect(repeatabilityPass(sample)).toBe(false);
  });

  it('requires repeats 1, 2 and 3 exactly once for every fixture', () => {
    const missing = reads();
    missing.pop();
    expect(repeatabilityPass(missing)).toBe(false);
    const duplicate = reads();
    duplicate[2]!.repeat = 2;
    expect(repeatabilityPass(duplicate)).toBe(false);
    const extra = reads(); extra.push(round('dragon', 4));
    expect(repeatabilityPass(extra)).toBe(false);
  });

  it('allows a score spread within 0.15 for one decision and rejects a larger spread', () => {
    // Both adapted: an unread certificate (0.76) and an available slot missed (0.875) differ by 0.115.
    const slotMissed = { words: [{ ...asked('dragon'), slot: 'lantern' as const }], result: [{ ...asked('dragon'), slot: 'lantern' as const }] };
    const close = reads({ dragon: (repeat: number) => repeat === 2 ? slotMissed : { certificate: 'unread' } });
    expect(of(close, 'dragon').map(read => read.detailMatch)).toEqual(['adapted', 'adapted', 'adapted']);
    expect(repeatabilityPass(close)).toBe(true);
    // Both adapted: another catalogue motif (0.4) and an unsupported subject (0.58) differ by 0.18.
    const fox = { motif: 'sleeping-fox', slot: 'chimney' } as const, none = { motif: 'none', slot: 'chimney' } as const;
    const wide = reads({ dragon: (repeat: number) => repeat === 2 ? { words: [none], result: [none] } : { words: [fox], result: [fox] } });
    expect(of(wide, 'dragon').map(read => read.detailMatch)).toEqual(['adapted', 'adapted', 'adapted']);
    const scores = of(wide, 'dragon').map(read => read.quality!.score);
    expect(Math.max(...scores) - Math.min(...scores)).toBeCloseTo(0.18);
    expect(repeatabilityPass(wide)).toBe(false);
  });
});
