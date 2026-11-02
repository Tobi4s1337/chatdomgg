import { mkdtemp, readFile, readdir, rm, writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, expect, it } from 'vitest';
import type { ForgeDraft } from '@chatdom/shared';
import type { KingdomForgeAudit } from '../../../codex/src/kingdom-forge/ports';
import { FORGE_JUDGE_POLICY_VERSION, FORGE_JUDGE_THRESHOLDS, combineForgeWishSubject, forgeJudgeQuestions,
  forgeMeasureDetailMatch, scoreForgeMeasure, type ForgeWishSubject } from '../../../codex/src/providers/policy';
import { forgeResultMeasure } from '../../../codex/src/quality';
import { FileForgeApprovals } from './approvals';
import { createForgeProviders, type ForgeProviderConfig, type JudgeVerdict } from '../../../codex/src/providers';

type Verdict = KingdomForgeAudit['verdicts'][number];
type Plan = ForgeDraft['plan'];
const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true }))); });
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'chatdom-forge-audits-')); directories.push(directory);
  return { directory, approvals: new FileForgeApprovals(directory) };
}
const dragon: ForgeWishSubject = { motif: 'sleeping-dragon', slot: 'chimney' };
const dragonPlan: Plan = { version: 2, kind: 'chimney', motif: 'sleeping-dragon', finish: 'native', accent: 'none' };
const draftOf = (plan: Plan): ForgeDraft => ({ plan, title: 'SIMULATED hearth piece', plaque: 'SIMULATED storybook plaque.' });

/** One gate's actual reads: Luna first, then Terra. Each read records its own reading of the words' subject. */
function gate(image: boolean, subjects: readonly (ForgeWishSubject | undefined)[] = [dragon, dragon]): Verdict {
  const base = { backend: 'codex-cli', status: 'complete', policy: FORGE_JUDGE_POLICY_VERSION, evidenceHash: (image ? 'b' : 'a').repeat(64) };
  const reading = (subject: ForgeWishSubject | undefined) => ({ ...(subject ? { subject } : {}), subjectStatus: subject ? 'complete' : 'invalid' });
  const records = [
    { ...base, judge: 'gpt-6-luna', model: 'gpt-6-luna', probabilitySource: 'model-self-estimate', thresholds: FORGE_JUDGE_THRESHOLDS,
      answers: Object.fromEntries(forgeJudgeQuestions(image).map(({ name }) => [name, 0.01])), ...reading(subjects[0]) },
    { ...base, judge: 'gpt-6.1-terra', model: 'gpt-6.1-terra', outcome: 'pass', ...reading(subjects[1]) },
  ].slice(0, subjects.length);
  return { outcome: 'pass', records, subject: combineForgeWishSubject(...subjects) };
}
/** The host's deterministic quality, exactly as runForge attaches it: hearth kit revision one, a chimney socket by default. */
function measured(result: Verdict, words: Verdict, plan: Plan = dragonPlan, sockets: readonly { kind: Plan['kind'] }[] = [{ kind: 'chimney' }]): Verdict {
  const measure = forgeResultMeasure({ words: words.subject, result: result.subject, draft: draftOf(plan),
    styleKit: { family: 'hearth', revision: 1 }, sockets });
  return { ...result, measure, quality: scoreForgeMeasure(measure), detailMatch: forgeMeasureDetailMatch(measure) };
}
interface Shape { words?: readonly (ForgeWishSubject | undefined)[]; result?: readonly (ForgeWishSubject | undefined)[];
  plan?: Plan; sockets?: readonly { kind: Plan['kind'] }[] }
function audit(shape: Shape = {}): KingdomForgeAudit {
  const words = gate(false, shape.words);
  return { key: `forge-chat-${'a'.repeat(64)}`, runId: 'simulated-run', at: 123, judgment: 'approved',
    candidate: { draftDigest: 'd'.repeat(64), homeDigest: 'e'.repeat(64) },
    verdicts: [words, measured(gate(true, shape.result), words, shape.plan, shape.sockets)] };
}
const record = (verdict: Verdict, index: number) => verdict.records[index] as Record<string, unknown>;

it('persists immutable per-run judge evidence across instances with opaque receipts and private modes', async () => {
  const { directory, approvals } = await fixture(), input = audit();
  expect(input.verdicts[1]).toMatchObject({ detailMatch: 'met', quality: { recognisability: 1, score: 1 }, measure: { certificate: 'reads' } });
  expect(await approvals.approved(input.key, input.runId)).toBeNull();
  await Promise.all([approvals.record(input), approvals.record(structuredClone(input))]);
  const reader = new FileForgeApprovals(directory), receipt = await reader.approved(input.key, input.runId);
  expect(receipt).toMatch(/^forge-judges-[a-f0-9]{64}$/);
  expect(await reader.approved(input.key, 'other-run')).toBeNull();
  expect(await reader.approved('../outside', '../outside')).toBeNull();
  const files = await readdir(directory); expect(files).toHaveLength(1);
  expect(files[0]).toMatch(/^[a-f0-9]{64}\.json$/);
  expect((await stat(join(directory, files[0]!))).mode & 0o777).toBe(0o600);
  await expect(approvals.record({ ...input, at: 124 })).rejects.toThrow('immutable');
  expect(await reader.approved(input.key, input.runId)).toBe(receipt);
  expect(await reader.approved(input.key, input.runId, input.candidate!)).toBe(receipt);
  expect(await reader.approved(input.key, input.runId, { ...input.candidate!, draftDigest: 'f'.repeat(64) })).toBeNull();
  expect(await reader.approved(input.key, input.runId, { ...input.candidate!, homeDigest: 'f'.repeat(64) })).toBeNull();
});

it.each([1, 2])('binds revision %i evidence to the exact kit even for identical draft and home digests', async revision => {
  const { directory, approvals } = await fixture(), legacy = audit();
  const candidate = { ...legacy.candidate!, kitId: 'hearth-native', kitRevision: revision };
  const input = { ...legacy, candidate };
  await approvals.record(input);
  const reader = new FileForgeApprovals(directory), receipt = await reader.approved(input.key, input.runId, candidate);
  expect(receipt).toMatch(/^forge-judges-[a-f0-9]{64}$/);
  expect(await reader.approved(input.key, input.runId, { ...candidate, kitRevision: revision === 1 ? 2 : 1 })).toBeNull();
  expect(await reader.approved(input.key, input.runId, { ...candidate, kitId: 'tide-native' })).toBeNull();
  expect(await reader.approved(input.key, input.runId, legacy.candidate!)).toBeNull();
  expect(await reader.approved(input.key, input.runId)).toBeNull();
});

it('reads immutable legacy evidence against revision one without upgrading it or rewriting its bytes', async () => {
  const { directory, approvals } = await fixture(), input = audit();
  await approvals.record(input);
  const [file] = await readdir(directory), path = join(directory, file!), bytes = await readFile(path, 'utf8');
  const reader = new FileForgeApprovals(directory), expected = { ...input.candidate!, kitId: 'hearth-native', kitRevision: 1 };
  expect(await reader.approved(input.key, input.runId, expected)).toMatch(/^forge-judges-[a-f0-9]{64}$/);
  expect(await reader.approved(input.key, input.runId, { ...expected, kitRevision: 2 })).toBeNull();
  expect(await reader.approved(input.key, input.runId, { ...expected, kitId: 'unknown-native' })).toBeNull();
  expect(await readFile(path, 'utf8')).toBe(bytes);
  expect((await stat(path)).mode & 0o777).toBe(0o600);
});

it('rejects partial, malformed and unknown kit metadata on writes, reads and caller expectations', async () => {
  const { directory, approvals } = await fixture(), input = audit();
  await approvals.record(input);
  const [file] = await readdir(directory), path = join(directory, file!), bytes = await readFile(path, 'utf8');
  const metadata: Record<string, unknown>[] = [
    { kitId: 'hearth-native' }, { kitRevision: 1 }, { kitId: undefined, kitRevision: undefined },
    { kitId: 'hearth-native', kitRevision: undefined }, { kitId: null, kitRevision: 1 },
    { kitId: 'unknown-native', kitRevision: 1 }, { kitId: 'hearth-native', kitRevision: 3 },
    { kitId: 'hearth-native', kitRevision: 0 }, { kitId: 'hearth-native', kitRevision: '1' },
    { kitId: 'hearth-native', kitRevision: 1.5 }, { kitId: 'hearth-native', kitRevision: 1, untrusted: true },
  ];
  const expected = { ...input.candidate!, kitId: 'hearth-native', kitRevision: 1 };
  for (const [index, fields] of metadata.entries()) {
    await writeFile(path, bytes);
    const candidate = { ...input.candidate!, ...fields } as NonNullable<KingdomForgeAudit['candidate']>;
    await expect(approvals.record({ ...input, runId: `invalid-kit-${index}`, candidate })).rejects.toThrow();
    expect(await approvals.approved(input.key, input.runId, candidate)).toBeNull();
    // JSON omits undefined fields: that disk representation is genuinely legacy, not a partial pair.
    if (fields.kitId === undefined && fields.kitRevision === undefined) continue;
    await writeFile(path, JSON.stringify({ ...input, candidate }));
    expect(await approvals.approved(input.key, input.runId, expected)).toBeNull();
  }
});

it('requires complete registered evidence at the independent words and result gates', async () => {
  const { approvals } = await fixture(), input = audit();
  const edits: ((value: Record<string, unknown>) => void)[] = [
    record => { record.status = 'unavailable'; }, record => { record.judge = 'unknown'; },
    record => { record.model = 'unknown'; }, record => { record.policy = 'old-policy'; },
    record => { record.evidenceHash = 'c'.repeat(64); }, record => { record.privateWords = 'PRIVATE SENTINEL'; },
    record => { delete record.subjectStatus; },
    // A v6 read's own likeness rating is no longer evidence; it makes the record malformed.
    record => { record.quality = { recognisability: 1, completeness: 1, cleanMarks: 1 }; },
  ];
  for (const stage of [0, 1]) for (const edit of edits) {
    const invalid = structuredClone(input); edit(record(invalid.verdicts[stage]!, 1));
    await expect(approvals.record(invalid)).rejects.toThrow('both independent');
  }
  await expect(approvals.record({ ...input, verdicts: input.verdicts.slice(0, 1) })).rejects.toThrow('both independent');
  const missing = structuredClone(input); missing.verdicts[0]!.records.shift();
  await expect(approvals.record(missing)).rejects.toThrow('both independent');
  const held = structuredClone(input); (held.verdicts[0] as { outcome: string }).outcome = 'hold';
  await expect(approvals.record(held)).rejects.toThrow('both independent');
  expect(await approvals.approved(input.key, input.runId)).toBeNull();
});

it('accepts a single confident read, but never an uncertain single read or an invented second reading', async () => {
  const { approvals } = await fixture(), input = audit({ words: [dragon], result: [dragon] });
  expect(input.verdicts.map(verdict => verdict.records.length)).toEqual([1, 1]);
  const uncertain = structuredClone(input);
  record(uncertain.verdicts[1]!, 0).answers = { ...record(uncertain.verdicts[1]!, 0).answers as object, hate: 0.2 };
  await expect(approvals.record(uncertain)).rejects.toThrow('both independent');
  // A summary that claims a reading no actual read made cannot stand in for the missing second gate read.
  const invented = structuredClone(input); invented.verdicts[1]!.subject = { motif: 'sleeping-dragon', slot: 'unclear' };
  await expect(approvals.record(invented)).rejects.toThrow('both independent');
  await approvals.record(input);
  expect(await approvals.approved(input.key, input.runId)).not.toBeNull();
});

it('authorizes only the selected retry evidence and rejects failed-draft records or excess normal calls', async () => {
  const { approvals } = await fixture(), input = audit();
  // The first draft missed the agreed subject: its private summary keeps only the bounded quality outcome.
  const missed = measured(gate(true), input.verdicts[0]!, { ...dragonPlan, motif: 'crescent-moon' });
  expect(missed).toMatchObject({ detailMatch: 'adapted', quality: { recognisability: 0 } });
  const first = { outcome: missed.outcome, records: [], quality: missed.quality!, detailMatch: missed.detailMatch! };
  const retried: KingdomForgeAudit = { ...input, verdicts: [input.verdicts[0]!, first, input.verdicts[1]!], attempts: 2, modelCalls: 5,
    selection: { verdict: 2, attempt: 2, delivery: 'retried', shared: 'subject' } };
  await expect(approvals.record({ ...retried, modelCalls: 6 })).rejects.toThrow('both independent');
  const leaked = structuredClone(retried); leaked.verdicts[1]!.records.push({ privateWords: 'PRIVATE SENTINEL' });
  await expect(approvals.record(leaked)).rejects.toThrow('both independent');
  await expect(approvals.record({ ...retried, selection: { ...retried.selection!, verdict: 1 } })).rejects.toThrow('both independent');
  await approvals.record(retried);
  expect(await approvals.approved(input.key, input.runId)).not.toBeNull();
});

it('holds uncertain words, unknown language and image safety disagreements without an override', async () => {
  const { approvals } = await fixture(), input = audit();
  const uncertain = (stage: number, name: string, value: number) => {
    const result = structuredClone(input);
    (record(result.verdicts[stage]!, 0).answers as Record<string, number>)[name] = value;
    return result;
  };
  await expect(approvals.record(uncertain(0, 'hate', 0.4))).rejects.toThrow('both independent');
  await expect(approvals.record(uncertain(1, 'uncertain_language', 0.2))).rejects.toThrow('both independent');
  await expect(approvals.record(uncertain(1, 'hate', 0.99))).rejects.toThrow('both independent');
  const image = uncertain(1, 'privacy', 0.3);
  await expect(approvals.record(image)).rejects.toThrow('both independent');
  record(image.verdicts[1]!, 1).imageUncertaintyCleared = true;
  await expect(approvals.record(image)).rejects.toThrow('both independent');
  // A complete subject reading never overrides the safety floor.
  for (const stage of [0, 1]) {
    const refused = structuredClone(input); record(refused.verdicts[stage]!, 1).outcome = 'refuse';
    record(refused.verdicts[stage]!, 1).concerns = ['hate'];
    await expect(approvals.record(refused)).rejects.toThrow('both independent');
  }
});

it.each([
  ['an unsupported subject softened for vocabulary', { words: [{ motif: 'none', slot: 'chimney' }], result: [{ motif: 'none', slot: 'chimney' }] } as Shape,
    { verdict: 1, attempt: 1, delivery: 'softened', reason: 'vocabulary', shared: 'family' } as const],
  ['a missed catalogue subject softened for quality', { words: [{ motif: 'sleeping-fox', slot: 'chimney' }], result: [{ motif: 'sleeping-fox', slot: 'chimney' }] } as Shape,
    { verdict: 1, attempt: 1, delivery: 'softened', reason: 'quality', shared: 'slot' } as const],
])('persists %s without vetoing a safe piece, and checks the recorded score calculation', async (_name, shape, selection) => {
  const { approvals } = await fixture(), input = { ...audit(shape), selection, attempts: 1, modelCalls: 4 };
  const result = input.verdicts[1]!;
  expect(result.detailMatch).toBe('adapted');
  expect(result.quality!.score).toBeLessThan(0.72);
  const forged = structuredClone(input); forged.verdicts[1]!.quality!.score = 1;
  await expect(approvals.record(forged)).rejects.toThrow('both independent');
  const relabelled = structuredClone(input); relabelled.verdicts[1]!.detailMatch = 'met';
  await expect(approvals.record(relabelled)).rejects.toThrow('both independent');
  await approvals.record(input);
  expect(await approvals.approved(input.key, input.runId)).not.toBeNull();
});

const moon: ForgeWishSubject = { motif: 'crescent-moon', slot: 'chimney' }, fox: ForgeWishSubject = { motif: 'sleeping-fox', slot: 'chimney' };
const lantern: ForgeWishSubject = { motif: 'sleeping-dragon', slot: 'lantern' };
const subjectCases: [string, Shape, 'met' | 'adapted' | 'unclear', number][] = [
  ['both gates name the planned readable motif', {}, 'met', 1],
  ['the result gate reads disagree', { result: [dragon, moon] }, 'unclear', 0.7],
  ['the word gate and result gate disagree', { words: [moon], result: [dragon] }, 'unclear', 0.7],
  ['the gates disagree and neither names the plan', { words: [moon], result: [fox] }, 'unclear', 0.3],
  ['both agree on another catalogue motif', { words: [fox], result: [fox] }, 'adapted', 0],
  ['both agree the subject is outside the catalogue', { words: [{ motif: 'none', slot: 'none' }], result: [{ motif: 'none', slot: 'none' }] }, 'adapted', 0.3],
  ['the planned motif is certified unreadable', { words: [fox], result: [fox], plan: { ...dragonPlan, motif: 'sleeping-fox' } }, 'adapted', 0.6],
  ['an available named slot is missed', { words: [lantern], result: [lantern], sockets: [{ kind: 'chimney' }, { kind: 'lantern' }] }, 'adapted', 1],
  ['a named slot the home lacks is missed', { words: [lantern], result: [lantern] }, 'met', 1],
  ['the slot readings disagree', { words: [lantern], result: [dragon] }, 'unclear', 1],
];
it.each(subjectCases)('binds detail match and quality to the measured readings when %s', async (_name, shape, detailMatch, recognisability) => {
  const { approvals } = await fixture(), input = audit(shape), result = input.verdicts[1]!;
  expect(result).toMatchObject({ detailMatch, quality: { recognisability } });
  const changed = structuredClone(input);
  changed.verdicts[1]!.detailMatch = detailMatch === 'met' ? 'adapted' : 'met';
  await expect(approvals.record(changed)).rejects.toThrow('both independent');
  const rescored = structuredClone(input);
  rescored.verdicts[1]!.quality!.recognisability = recognisability === 1 ? 0.5 : 1;
  await expect(approvals.record(rescored)).rejects.toThrow('both independent');
  await approvals.record(input);
  expect(await approvals.approved(input.key, input.runId)).not.toBeNull();
});

it('rejects a tampered measure even when its score is recomputed to match', async () => {
  const { approvals } = await fixture(), input = audit({ words: [fox], result: [fox], plan: { ...dragonPlan, motif: 'sleeping-fox' } });
  const rescore = (verdict: Verdict) => {
    verdict.quality = scoreForgeMeasure(verdict.measure!); verdict.detailMatch = forgeMeasureDetailMatch(verdict.measure!);
  };
  const tampers: ((verdict: Verdict) => void)[] = [
    // The measured result reading must be the result gate's own combined reading.
    verdict => { verdict.measure!.result = { ...fox, slot: 'lantern' }; rescore(verdict); },
    verdict => { verdict.measure!.result = { motif: 'unclear', slot: 'unclear' }; rescore(verdict); },
    // The measured word reading must be the word gate's own recorded reading.
    verdict => { verdict.measure!.words = { ...dragon }; rescore(verdict); },
    verdict => { verdict.measure = { ...verdict.measure!, extra: true } as unknown as NonNullable<Verdict['measure']>; },
    verdict => { delete verdict.measure; },
    verdict => { delete verdict.quality; },
    verdict => { delete verdict.detailMatch; },
  ];
  for (const tamper of tampers) {
    const invalid = structuredClone(input); tamper(invalid.verdicts[1]!);
    await expect(approvals.record(invalid)).rejects.toThrow();
  }
  // Changing only the certificate without rescoring is caught by recomputation.
  const regraded = structuredClone(input); regraded.verdicts[1]!.measure!.certificate = 'reads';
  await expect(approvals.record(regraded)).rejects.toThrow('both independent');
  await approvals.record(input);
  expect(await approvals.approved(input.key, input.runId)).not.toBeNull();
});

it.each([1, 2])('accepts invalid subject reads without inventing a reading or vetoing safety (%i reads)', async count => {
  const { approvals } = await fixture();
  const absent = Array.from({ length: count }, () => undefined);
  for (const shape of [{ words: absent, result: [dragon, dragon].slice(0, count) }, { result: absent }] as Shape[]) {
    const input = audit(shape), stage = shape.words ? 0 : 1, gateVerdict = input.verdicts[stage]!;
    expect(gateVerdict.subject).toEqual({ motif: 'unclear', slot: 'unclear' });
    expect(input.verdicts[1]!.detailMatch).toBe('unclear');
    const invented = structuredClone(input); invented.verdicts[stage]!.subject = { ...dragon };
    if (stage === 1) invented.verdicts[1]!.measure!.result = { ...dragon };
    else invented.verdicts[1]!.measure!.words = { ...dragon };
    invented.verdicts[1]!.quality = scoreForgeMeasure(invented.verdicts[1]!.measure!);
    invented.verdicts[1]!.detailMatch = forgeMeasureDetailMatch(invented.verdicts[1]!.measure!);
    await expect(approvals.record(invented)).rejects.toThrow('both independent');
    const smuggled = structuredClone(input); record(smuggled.verdicts[stage]!, 0).subject = { ...dragon };
    await expect(approvals.record(smuggled)).rejects.toThrow('both independent');
    const claimed = structuredClone(input); record(claimed.verdicts[stage]!, 0).subjectStatus = 'complete';
    await expect(approvals.record(claimed)).rejects.toThrow('both independent');
    const missing = structuredClone(input); delete record(missing.verdicts[stage]!, 0).subjectStatus;
    await expect(approvals.record(missing)).rejects.toThrow('both independent');
    const summary = structuredClone(input); delete summary.verdicts[stage]!.subject;
    await expect(approvals.record(summary)).rejects.toThrow();
    await approvals.record({ ...input, runId: `invalid-subject-${stage}` });
    expect(await approvals.approved(input.key, `invalid-subject-${stage}`)).not.toBeNull();
  }
});

it('rejects a measure, quality or detail match at the words gate in either a summary or an actual read', async () => {
  const { approvals } = await fixture(), base = audit(), result = base.verdicts[1]!;
  const values = { measure: result.measure, quality: result.quality, detailMatch: result.detailMatch,
    qualityStatus: 'complete', detailMatchStatus: 'complete' } as Record<string, unknown>;
  for (const target of ['summary', 'primary', 'secondary'] as const) for (const [field, value] of Object.entries(values)) {
    if (target === 'summary' && field.endsWith('Status')) continue;
    const input = audit(), words = input.verdicts[0]!;
    Object.assign(target === 'summary' ? words : record(words, target === 'primary' ? 0 : 1), { [field]: structuredClone(value) });
    await expect(approvals.record(input)).rejects.toThrow();
  }
  for (const target of ['primary', 'secondary'] as const) for (const field of ['measure', 'quality', 'detailMatch', 'detailMatchStatus']) {
    const input = audit(); Object.assign(record(input.verdicts[1]!, target === 'primary' ? 0 : 1), { [field]: structuredClone(values[field]) });
    await expect(approvals.record(input)).rejects.toThrow('both independent');
  }
});

it('checks details on the selected retry instead of borrowing the previous candidate measure', async () => {
  const { approvals } = await fixture(), input = audit({ words: [moon], result: [moon] });
  // The first draft kept a dragon for a moon wish; the retry drew the moon the gates agree on.
  const first = input.verdicts[1]!, retryPlan: Plan = { ...dragonPlan, motif: 'crescent-moon' };
  const selected = measured(gate(true, [moon, moon]), input.verdicts[0]!, retryPlan);
  expect([first.detailMatch, selected.detailMatch]).toEqual(['adapted', 'met']);
  const retried: KingdomForgeAudit = { ...input, verdicts: [input.verdicts[0]!,
    { outcome: first.outcome, records: [], quality: first.quality!, detailMatch: first.detailMatch! }, selected],
  attempts: 2, modelCalls: 5, selection: { verdict: 2, attempt: 2, delivery: 'retried', shared: 'subject' } };
  const borrowed = structuredClone(retried);
  Object.assign(borrowed.verdicts[2]!, { measure: first.measure, quality: first.quality, detailMatch: 'met' });
  await expect(approvals.record(borrowed)).rejects.toThrow('both independent');
  const unscored = structuredClone(retried);
  Object.assign(unscored.verdicts[2]!, { quality: first.quality, detailMatch: first.detailMatch });
  await expect(approvals.record(unscored)).rejects.toThrow('both independent');
  // A selected verdict judged against another word reading cannot be paired with this word gate.
  const otherWords = structuredClone(retried);
  Object.assign(otherWords.verdicts[2]!, measured(gate(true, [moon, moon]), gate(false, [dragon, dragon]), retryPlan));
  await expect(approvals.record(otherWords)).rejects.toThrow('both independent');
  await approvals.record(retried);
  expect(await approvals.approved(input.key, input.runId)).not.toBeNull();
});

it('rejects stale v6 verification evidence without relabelling or rewriting the immutable file', async () => {
  const { directory, approvals } = await fixture(), input = audit();
  await approvals.record(input);
  const [file] = await readdir(directory), path = join(directory, file!);
  const stale = structuredClone(input), version = 'house-part-safety-quality-2026-11-02-v6';
  for (const [index, verdict] of stale.verdicts.entries()) {
    delete verdict.subject; delete verdict.measure;
    if (verdict.quality) verdict.quality.policy = version;
    for (const raw of verdict.records) {
      const read = raw as Record<string, unknown>;
      read.policy = version; delete read.subject; delete read.subjectStatus;
      if (index === 1) Object.assign(read, { quality: { recognisability: 1, completeness: 1, cleanMarks: 1 }, qualityStatus: 'complete',
        detailMatch: 'met', detailMatchStatus: 'complete' });
    }
  }
  const bytes = JSON.stringify(stale);
  await writeFile(path, bytes);
  expect(await approvals.approved(input.key, input.runId)).toBeNull();
  await expect(approvals.record(stale)).rejects.toThrow();
  await expect(approvals.record(input)).rejects.toThrow('immutable');
  expect(await readFile(path, 'utf8')).toBe(bytes);
});

const wish = 'SIMULATED a sleepy fox on my chimney', safetyIdentifier = 'trusted-test-citizen-hash-0001';
const foxDraft = draftOf({ ...dragonPlan, motif: 'sleeping-fox' });
async function judged(runCodex: NonNullable<ForgeProviderConfig['runCodex']>) {
  const providers = createForgeProviders({ runCodex });
  const words = await providers.judgeWords({ words: wish, safetyIdentifier });
  const read = await providers.judgeResult({ wish, safetyIdentifier, contactSheet: 'data:image/png;base64,iVBORw0KGgo=', draft: foxDraft });
  return { words, read };
}
const asAudit = (verdicts: readonly JudgeVerdict[]): Verdict[] => verdicts.map(({ outcome, records, subject, measure, quality, detailMatch }) => ({
  outcome, records, ...(subject ? { subject } : {}), ...(measure ? { measure } : {}), ...(quality ? { quality } : {}), ...(detailMatch ? { detailMatch } : {}) }));
const hostMeasure = (words: JudgeVerdict, read: JudgeVerdict): JudgeVerdict => {
  const measure = forgeResultMeasure({ words: words.subject, result: read.subject, draft: foxDraft, styleKit: { family: 'hearth', revision: 1 }, sockets: [{ kind: 'chimney' }] });
  return { ...read, measure, quality: scoreForgeMeasure(measure), detailMatch: forgeMeasureDetailMatch(measure) };
};

it.each([undefined, { unexpected: 'met' }, { motif: 'griffin', slot: 'chimney' }])('accepts actual provider coercion of a missing or malformed subject (%j)', async subject => {
  const { approvals } = await fixture(), input = audit();
  const { words, read } = await judged(async ({ image }) => JSON.stringify({
    answers: forgeJudgeQuestions(Boolean(image)).map(({ name }) => ({ type: 'predicate', name, probability: 0.01 })),
    ...(image ? { subject } : { subject: fox }),
  }));
  expect(read).toMatchObject({ outcome: 'pass', subject: { motif: 'unclear', slot: 'unclear' },
    records: [{ status: 'complete', subjectStatus: 'invalid' }] });
  expect(read.records[0]).not.toHaveProperty('subject');
  const piece = hostMeasure(words, read);
  expect(piece).toMatchObject({ detailMatch: 'unclear', quality: { score: expect.any(Number) } });
  await approvals.record({ ...input, verdicts: asAudit([words, piece]) });
  expect(await approvals.approved(input.key, input.runId)).not.toBeNull();
});

it('holds a v6-shaped read that still rates its own likeness, and that hold cannot approve', async () => {
  const { approvals } = await fixture(), input = audit();
  const { words, read } = await judged(async ({ image }) => JSON.stringify({
    answers: forgeJudgeQuestions(Boolean(image)).map(({ name }) => ({ type: 'predicate', name, probability: 0.01 })), subject: fox,
    ...(image ? { quality: { recognisability: 1, completeness: 1, cleanMarks: 1 }, detailMatch: 'met' } : {}),
  }));
  expect(words.outcome).toBe('pass');
  expect(read).toMatchObject({ outcome: 'hold', subject: { motif: 'unclear', slot: 'unclear' },
    records: [{ status: 'invalid', subjectStatus: 'invalid' }, { status: 'invalid', subjectStatus: 'invalid' }] });
  const piece = hostMeasure(words, read);
  await expect(approvals.record({ ...input, verdicts: asAudit([words, piece]) })).rejects.toThrow('both independent');
  await expect(approvals.record({ ...input, verdicts: asAudit([words, { ...piece, outcome: 'pass' }]) })).rejects.toThrow('both independent');
});

it('accepts actual provider records at both gates, scoring an unreadable certified motif honestly', async () => {
  const { approvals } = await fixture(), input = audit();
  const { words, read } = await judged(async ({ model, image }) => JSON.stringify(model === 'gpt-6-luna'
    ? { answers: forgeJudgeQuestions(Boolean(image)).map(({ name }) => ({ type: 'predicate', name, probability: 0.01 })), subject: fox }
    : { outcome: 'pass', concerns: [], subject: fox }));
  expect([words.subject, read.subject]).toEqual([fox, fox]);
  const piece = hostMeasure(words, read);
  expect(piece).toMatchObject({ detailMatch: 'adapted', measure: { certificate: 'unread', words: fox, result: fox },
    quality: scoreForgeMeasure(piece.measure!) });
  await approvals.record({ ...input, verdicts: asAudit([words, piece]) });
  expect(await approvals.approved(input.key, input.runId)).not.toBeNull();
});

it('keeps non-approved audit outcomes private and strips arbitrary provider records', async () => {
  const result = audit({ words: [fox], result: [fox] }).verdicts[1]!;
  const { directory, approvals } = await fixture(), input = { ...audit(), judgment: 'refuse', verdicts: [
    { outcome: 'refuse' as const, subject: result.subject!, measure: result.measure!, quality: result.quality!, detailMatch: result.detailMatch!,
      records: [{ secret: 'PRIVATE SENTINEL' }] },
  ] };
  await approvals.record(input);
  const [file] = await readdir(directory), bytes = await readFile(join(directory, file!), 'utf8');
  expect(bytes).not.toContain('PRIVATE SENTINEL'); expect(bytes).toContain('refuse');
  const stored = JSON.parse(bytes).verdicts[0];
  expect(stored).toEqual({ outcome: 'refuse', records: [], measure: result.measure, quality: result.quality, detailMatch: 'adapted' });
  expect(await approvals.approved(input.key, input.runId)).toBeNull();
  await expect(approvals.record({ ...audit(), judgment: 'PRIVATE SENTINEL' })).rejects.toThrow();
});

it('returns no receipt for corrupt, changed or oversized stored evidence', async () => {
  const { directory, approvals } = await fixture(), input = audit(); await approvals.record(input);
  const [file] = await readdir(directory), path = join(directory, file!);
  const regraded = structuredClone(input); regraded.verdicts[1]!.measure!.certificate = 'unread';
  const unmeasured = structuredClone(input); delete unmeasured.verdicts[1]!.measure;
  for (const bytes of ['{broken', JSON.stringify({ ...input, key: `forge-chat-${'d'.repeat(64)}` }), ' '.repeat(32_769),
    JSON.stringify(regraded), JSON.stringify(unmeasured)]) {
    await writeFile(path, bytes); expect(await approvals.approved(input.key, input.runId)).toBeNull();
  }
});
