import { mkdtemp, readFile, readdir, rm, writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, expect, it } from 'vitest';
import type { KingdomForgeAudit } from '../../../codex/src/kingdom-forge/ports';
import { FORGE_JUDGE_POLICY_VERSION, FORGE_JUDGE_THRESHOLDS, forgeJudgeQuestions, scoreForgeQuality } from '../../../codex/src/providers/policy';
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
    verdicts: [false, true].map(image => {
      const quality = { recognisability: 0.9, completeness: 1, cleanMarks: 1 };
      const base = { backend: 'codex-cli', status: 'complete', policy: FORGE_JUDGE_POLICY_VERSION, evidenceHash: (image ? 'b' : 'a').repeat(64),
        ...(image ? { quality, qualityStatus: 'complete' } : {}) };
      return { outcome: 'pass' as const, ...(image ? { quality: scoreForgeQuality(quality, quality) } : {}), records: [
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
});

it('requires two registered independent judges at both words and result gates', async () => {
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
  const missing = structuredClone(input); missing.verdicts[0]!.records.pop();
  await expect(approvals.record(missing)).rejects.toThrow('both independent');
  const held = structuredClone(input); (held.verdicts[0] as { outcome: string }).outcome = 'hold';
  await expect(approvals.record(held)).rejects.toThrow('both independent');
  expect(await approvals.approved(input.key, input.runId)).toBeNull();
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

it('accepts actual provider records at both gates without weakening the private receipt boundary', async () => {
  const { approvals } = await fixture(), input = audit(), quality = { recognisability: 0.1, completeness: 0.5, cleanMarks: 0.2 };
  const providers = createForgeProviders({ runCodex: async ({ model, image }) => JSON.stringify(model === 'gpt-6-luna'
    ? { answers: forgeJudgeQuestions(Boolean(image)).map(({ name }) => ({ type: 'predicate', name, probability: 0.01 })), ...(image ? { quality } : {}) }
    : { outcome: 'pass', ...(image ? { quality } : {}) }) });
  const safetyIdentifier = 'trusted-test-citizen-hash-0001';
  const words = await providers.judgeWords({ words: 'A sleepy fox on my chimney', safetyIdentifier });
  const piece = await providers.judgeResult({ wish: 'A sleepy fox on my chimney', safetyIdentifier,
    contactSheet: 'data:image/png;base64,iVBORw0KGgo=', draft: {
      title: 'The hearth companion', plaque: 'A fox curls up above the warm hearth.',
      plan: { version: 2, kind: 'chimney', motif: 'sleeping-fox', finish: 'native', accent: 'none' },
    } });
  await approvals.record({ ...input, verdicts: [words, piece].map(({ outcome, records, quality }) => ({ outcome, records, ...(quality ? { quality } : {}) })) });
  expect(await approvals.approved(input.key, input.runId)).not.toBeNull();
});

it('keeps non-approved audit outcomes private and strips arbitrary provider records', async () => {
  const quality = scoreForgeQuality({ recognisability: 0.1, completeness: 1, cleanMarks: 1 }, { recognisability: 0.1, completeness: 1, cleanMarks: 1 });
  const { directory, approvals } = await fixture(), input = { ...audit(), judgment: 'refuse', verdicts: [{ outcome: 'refuse' as const, quality, records: [{ secret: 'PRIVATE SENTINEL' }] }] };
  await approvals.record(input);
  const [file] = await readdir(directory), bytes = await readFile(join(directory, file!), 'utf8');
  expect(bytes).not.toContain('PRIVATE SENTINEL'); expect(bytes).toContain('refuse');
  expect(JSON.parse(bytes).verdicts[0].quality).toEqual(quality);
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
