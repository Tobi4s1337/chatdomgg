import { mkdtemp, readFile, readdir, rm, writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, expect, it } from 'vitest';
import type { KingdomForgeAudit } from '../../../codex/src/kingdom-forge/ports';
import { FORGE_JUDGE_POLICY_VERSION, FORGE_JUDGE_THRESHOLDS, forgeJudgeQuestions, scoreForgeQuality,
  combineForgeDetailMatch } from '../../../codex/src/providers/policy';
import { FileForgeApprovals } from './approvals';
import { createForgeProviders } from '../../../codex/src/providers';

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true }))); });
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'chatdom-forge-audits-')); directories.push(directory);
  return { directory, approvals: new FileForgeApprovals(directory) };
}
function audit(): KingdomForgeAudit {
  return { key: `forge-chat-${'a'.repeat(64)}`, runId: 'simulated-run', at: 123, judgment: 'approved',
    candidate: { draftDigest: 'd'.repeat(64), homeDigest: 'e'.repeat(64) },
    verdicts: [false, true].map(image => {
      const quality = { recognisability: 0.9, completeness: 1, cleanMarks: 1 };
      const base = { backend: 'codex-cli', status: 'complete', policy: FORGE_JUDGE_POLICY_VERSION, evidenceHash: (image ? 'b' : 'a').repeat(64),
        ...(image ? { quality, qualityStatus: 'complete', detailMatch: 'met', detailMatchStatus: 'complete' } : {}) };
      return { outcome: 'pass' as const, ...(image ? { quality: scoreForgeQuality(quality, quality), detailMatch: 'met' as const } : {}), records: [
        { ...base, judge: 'gpt-6-luna', model: 'gpt-6-luna', probabilitySource: 'model-self-estimate', thresholds: FORGE_JUDGE_THRESHOLDS,
          answers: Object.fromEntries(forgeJudgeQuestions(image).map(({ name }) => [name, 0.01])) },
        { ...base, judge: 'gpt-6.1-terra', model: 'gpt-6.1-terra', outcome: 'pass' },
      ] };
    }),
  };
}

it('persists immutable per-run judge evidence across instances with opaque receipts and private modes', async () => {
  const { directory, approvals } = await fixture(), input = audit();
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
  ];
  for (const edit of edits) {
    const invalid = structuredClone(input); edit(invalid.verdicts[1]!.records[1] as Record<string, unknown>);
    await expect(approvals.record(invalid)).rejects.toThrow('both independent');
  }
  await expect(approvals.record({ ...input, verdicts: input.verdicts.slice(0, 1) })).rejects.toThrow('both independent');
  const missing = structuredClone(input); missing.verdicts[0]!.records.shift();
  await expect(approvals.record(missing)).rejects.toThrow('both independent');
  const held = structuredClone(input); (held.verdicts[0] as { outcome: string }).outcome = 'hold';
  await expect(approvals.record(held)).rejects.toThrow('both independent');
  expect(await approvals.approved(input.key, input.runId)).toBeNull();
});

it('accepts a single confident read, but never an uncertain single read or invented second quality score', async () => {
  const { approvals } = await fixture(), input = audit();
  for (const verdict of input.verdicts) verdict.records.pop();
  const uncertain = structuredClone(input);
  ((uncertain.verdicts[1]!.records[0] as { answers: Record<string, number> }).answers).hate = 0.2;
  await expect(approvals.record(uncertain)).rejects.toThrow('both independent');
  await approvals.record(input);
  expect(await approvals.approved(input.key, input.runId)).not.toBeNull();
});

it('authorizes only the selected retry evidence and rejects failed-draft records or excess normal calls', async () => {
  const { approvals } = await fixture(), input = audit();
  const first = { ...input.verdicts[1]!, records: [], quality: scoreForgeQuality({ recognisability: 0.2, completeness: 1, cleanMarks: 1 }) };
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
    ((result.verdicts[stage]!.records[0] as Record<string, unknown>).answers as Record<string, number>)[name] = value;
    return result;
  };
  await expect(approvals.record(uncertain(0, 'hate', 0.4))).rejects.toThrow('both independent');
  await expect(approvals.record(uncertain(1, 'uncertain_language', 0.2))).rejects.toThrow('both independent');
  await expect(approvals.record(uncertain(1, 'hate', 0.99))).rejects.toThrow('both independent');
  const image = uncertain(1, 'privacy', 0.3);
  await expect(approvals.record(image)).rejects.toThrow('both independent');
  (image.verdicts[1]!.records[1] as Record<string, unknown>).imageUncertaintyCleared = true;
  await expect(approvals.record(image)).rejects.toThrow('both independent');
});

it('persists low quality without vetoing a safe piece, and checks the recorded score calculation', async () => {
  const { approvals } = await fixture(), input = audit(), low = { recognisability: 0, completeness: 0.2, cleanMarks: 0.1 };
  for (const record of input.verdicts[1]!.records) (record as Record<string, unknown>).quality = low;
  const result = input.verdicts[1]! as { quality: ReturnType<typeof scoreForgeQuality> };
  result.quality = scoreForgeQuality(low, low);
  const forged = structuredClone(input);
  (forged.verdicts[1]! as typeof result).quality.score = 1;
  await expect(approvals.record(forged)).rejects.toThrow('both independent');
  await approvals.record(input);
  expect(await approvals.approved(input.key, input.runId)).not.toBeNull();
});

const detailCases = (['met', 'adapted', 'unclear'] as const).flatMap(primary =>
  ([undefined, 'met', 'adapted', 'unclear'] as const).map(secondary => [primary, secondary] as const));
it.each(detailCases)('binds the aggregate detail match to the actual %s / %s reads', async (primary, secondary) => {
  const { approvals } = await fixture(), input = audit(), result = input.verdicts[1]!;
  (result.records[0] as Record<string, unknown>).detailMatch = primary;
  if (secondary === undefined) result.records.pop();
  else (result.records[1] as Record<string, unknown>).detailMatch = secondary;
  result.detailMatch = combineForgeDetailMatch(primary, secondary);
  const changed = structuredClone(input);
  changed.verdicts[1]!.detailMatch = result.detailMatch === 'met' ? 'adapted' : 'met';
  await expect(approvals.record(changed)).rejects.toThrow('both independent');
  await approvals.record(input);
  expect(await approvals.approved(input.key, input.runId)).not.toBeNull();
});

it.each([1, 2])('accepts coerced invalid detail reads without inventing a match or vetoing safety (%i reads)', async count => {
  const { approvals } = await fixture(), input = audit(), result = input.verdicts[1]!;
  if (count === 1) result.records.pop();
  for (const record of result.records) Object.assign(record as object, { detailMatch: 'unclear', detailMatchStatus: 'invalid' });
  result.detailMatch = 'unclear';
  for (const match of ['met', 'adapted'] as const) {
    const invented = structuredClone(input);
    (invented.verdicts[1]!.records[0] as Record<string, unknown>).detailMatch = match;
    invented.verdicts[1]!.detailMatch = match;
    await expect(approvals.record(invented)).rejects.toThrow('both independent');
  }
  for (const field of ['detailMatch', 'detailMatchStatus']) {
    const missing = structuredClone(input);
    delete (missing.verdicts[1]!.records[0] as Record<string, unknown>)[field];
    await expect(approvals.record(missing)).rejects.toThrow('both independent');
  }
  await approvals.record(input);
  expect(await approvals.approved(input.key, input.runId)).not.toBeNull();
});

it('rejects detail fields at the words gate in either a summary or an actual read', async () => {
  const { approvals } = await fixture();
  for (const target of ['summary', 'primary', 'secondary'] as const) for (const field of ['detailMatch', 'detailMatchStatus']) {
    const input = audit(), words = input.verdicts[0]!;
    const read = target === 'summary' ? words : words.records[target === 'primary' ? 0 : 1];
    for (const value of [field === 'detailMatch' ? 'met' : 'complete', undefined]) {
      Object.assign(read as object, { [field]: value });
      await expect(approvals.record(input)).rejects.toThrow();
    }
  }
});

it('checks details on the selected retry instead of borrowing the previous candidate match', async () => {
  const { approvals } = await fixture(), input = audit();
  const selected = structuredClone(input.verdicts[1]!);
  for (const record of selected.records) (record as Record<string, unknown>).detailMatch = 'adapted';
  const retried: KingdomForgeAudit = { ...input, verdicts: [input.verdicts[0]!, { ...input.verdicts[1]!, records: [] }, selected],
    attempts: 2, modelCalls: 5, selection: { verdict: 2, attempt: 2, delivery: 'softened', reason: 'quality', shared: 'subject' } };
  await expect(approvals.record(retried)).rejects.toThrow('both independent');
  selected.detailMatch = 'adapted';
  await approvals.record(retried);
  expect(await approvals.approved(input.key, input.runId)).not.toBeNull();
});

it('rejects stale v5 verification evidence without relabelling or rewriting the immutable file', async () => {
  const { directory, approvals } = await fixture(), input = audit();
  await approvals.record(input);
  const [file] = await readdir(directory), path = join(directory, file!);
  const stale = structuredClone(input), version = 'house-part-safety-quality-2026-11-01-v5';
  for (const verdict of stale.verdicts) {
    if (verdict.quality) verdict.quality.policy = version;
    delete verdict.detailMatch;
    for (const raw of verdict.records) {
      const record = raw as Record<string, unknown>;
      record.policy = version; delete record.detailMatch; delete record.detailMatchStatus;
    }
  }
  const bytes = JSON.stringify(stale);
  await writeFile(path, bytes);
  expect(await approvals.approved(input.key, input.runId)).toBeNull();
  await expect(approvals.record(stale)).rejects.toThrow();
  await expect(approvals.record(input)).rejects.toThrow('immutable');
  expect(await readFile(path, 'utf8')).toBe(bytes);
});

it.each([undefined, { unexpected: 'met' }])('accepts actual provider coercion of missing or malformed image details (%j)', async detailMatch => {
  const { approvals } = await fixture(), input = audit(), quality = { recognisability: 0.95, completeness: 1, cleanMarks: 1 };
  const providers = createForgeProviders({ runCodex: async ({ image }) => JSON.stringify({
    answers: forgeJudgeQuestions(Boolean(image)).map(({ name }) => ({ type: 'predicate', name, probability: 0.01 })),
    ...(image ? { quality, detailMatch } : {}),
  }) });
  const safetyIdentifier = 'trusted-test-citizen-hash-0001';
  const words = await providers.judgeWords({ words: 'A sleepy fox on my chimney', safetyIdentifier });
  const piece = await providers.judgeResult({ wish: 'A sleepy fox on my chimney', safetyIdentifier,
    contactSheet: 'data:image/png;base64,iVBORw0KGgo=', draft: {
      title: 'The hearth companion', plaque: 'A fox curls up above the warm hearth.',
      plan: { version: 2, kind: 'chimney', motif: 'sleeping-fox', finish: 'native', accent: 'none' },
    } });
  expect(piece).toMatchObject({ outcome: 'pass', detailMatch: 'unclear', quality: { score: expect.any(Number) },
    records: [{ status: 'complete', detailMatch: 'unclear', detailMatchStatus: 'invalid' }] });
  await approvals.record({ ...input, verdicts: [words, piece].map(({ outcome, records, quality: score, detailMatch: match }) => ({
    outcome, records, ...(score ? { quality: score } : {}), ...(match ? { detailMatch: match } : {}),
  })) });
  expect(await approvals.approved(input.key, input.runId)).not.toBeNull();
});

it('accepts actual provider records at both gates without weakening the private receipt boundary', async () => {
  const { approvals } = await fixture(), input = audit(), quality = { recognisability: 0.1, completeness: 0.5, cleanMarks: 0.2 };
  const providers = createForgeProviders({ runCodex: async ({ model, image }) => JSON.stringify(model === 'gpt-6-luna'
    ? { answers: forgeJudgeQuestions(Boolean(image)).map(({ name }) => ({ type: 'predicate', name, probability: 0.01 })), ...(image ? { quality, detailMatch: 'met' } : {}) }
    : { outcome: 'pass', ...(image ? { quality, detailMatch: 'met' } : {}) }) });
  const safetyIdentifier = 'trusted-test-citizen-hash-0001';
  const words = await providers.judgeWords({ words: 'A sleepy fox on my chimney', safetyIdentifier });
  const piece = await providers.judgeResult({ wish: 'A sleepy fox on my chimney', safetyIdentifier,
    contactSheet: 'data:image/png;base64,iVBORw0KGgo=', draft: {
      title: 'The hearth companion', plaque: 'A fox curls up above the warm hearth.',
      plan: { version: 2, kind: 'chimney', motif: 'sleeping-fox', finish: 'native', accent: 'none' },
    } });
  await approvals.record({ ...input, verdicts: [words, piece].map(({ outcome, records, quality, detailMatch }) => ({ outcome, records,
    ...(quality ? { quality } : {}), ...(detailMatch ? { detailMatch } : {}) })) });
  expect(await approvals.approved(input.key, input.runId)).not.toBeNull();
});

it('keeps non-approved audit outcomes private and strips arbitrary provider records', async () => {
  const quality = scoreForgeQuality({ recognisability: 0.1, completeness: 1, cleanMarks: 1 }, { recognisability: 0.1, completeness: 1, cleanMarks: 1 });
  const { directory, approvals } = await fixture(), input = { ...audit(), judgment: 'refuse', verdicts: [
    { outcome: 'refuse' as const, quality, detailMatch: 'unclear' as const, records: [{ secret: 'PRIVATE SENTINEL' }] },
  ] };
  await approvals.record(input);
  const [file] = await readdir(directory), bytes = await readFile(join(directory, file!), 'utf8');
  expect(bytes).not.toContain('PRIVATE SENTINEL'); expect(bytes).toContain('refuse');
  expect(JSON.parse(bytes).verdicts[0].quality).toEqual(quality);
  expect(JSON.parse(bytes).verdicts[0].detailMatch).toBe('unclear');
  expect(await approvals.approved(input.key, input.runId)).toBeNull();
  await expect(approvals.record({ ...audit(), judgment: 'PRIVATE SENTINEL' })).rejects.toThrow();
});

it('returns no receipt for corrupt, changed or oversized stored evidence', async () => {
  const { directory, approvals } = await fixture(), input = audit(); await approvals.record(input);
  const [file] = await readdir(directory), path = join(directory, file!);
  for (const bytes of ['{broken', JSON.stringify({ ...input, key: `forge-chat-${'d'.repeat(64)}` }), ' '.repeat(32_769)]) {
    await writeFile(path, bytes); expect(await approvals.approved(input.key, input.runId)).toBeNull();
  }
});
