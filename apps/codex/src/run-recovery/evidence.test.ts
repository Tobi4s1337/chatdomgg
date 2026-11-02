import { describe, expect, it } from 'vitest';
import { FORGE_JUDGE_MESSAGES } from '../providers';
import { FORGE_JUDGE_POLICY_VERSION, FORGE_JUDGE_THRESHOLDS, forgeJudgeQuestions, scoreForgeQuality } from '../providers/policy';
import { recoverForgeVerdict } from './evidence';

const evidenceHash = 'a'.repeat(64);
function fixture(image = false) {
  const quality = { recognisability: 0.8, completeness: 0.9, cleanMarks: 1 };
  const primary = { backend: 'codex-cli', judge: 'gpt-6-luna', model: 'gpt-6-luna', policy: FORGE_JUDGE_POLICY_VERSION,
    evidenceHash, status: 'complete', probabilitySource: 'model-self-estimate', thresholds: FORGE_JUDGE_THRESHOLDS,
    answers: Object.fromEntries(forgeJudgeQuestions(image).map(({ name }) => [name, 0.01])),
    ...(image ? { quality, qualityStatus: 'complete', detailMatch: 'met', detailMatchStatus: 'complete' } : {}) };
  return { outcome: 'pass', reason: 'Private original provider prose is discarded', records: [primary],
    ...(image ? { quality: scoreForgeQuality(quality), detailMatch: 'met' } : {}) };
}

describe('saved Forge evidence', () => {
  it('retains exact bounded evidence while replacing arbitrary reason prose', () => {
    const input = fixture(true), result = recoverForgeVerdict(input, true, evidenceHash);
    expect(result).toMatchObject({ outcome: 'pass', reason: FORGE_JUDGE_MESSAGES.pass,
      quality: input.quality, detailMatch: 'met' });
    expect(result.records).toEqual(input.records);
    expect(JSON.stringify(result)).not.toContain(input.reason);
  });
  it.each(['aggregate', 'details', 'policy', 'hash', 'extra'] as const)('refuses %s changes to a saved result', kind => {
    const input = fixture(true);
    if (kind === 'aggregate') input.quality!.score = 1;
    if (kind === 'details') input.detailMatch = 'adapted';
    if (kind === 'policy') input.records[0]!.policy = 'older-policy';
    if (kind === 'hash') input.records[0]!.evidenceHash = 'b'.repeat(64);
    if (kind === 'extra') Object.assign(input.records[0]!, { rawProviderText: 'Never retain this private body' });
    expect(() => recoverForgeVerdict(input, true, evidenceHash)).toThrow(expect.objectContaining({ code: 'corrupt' }));
  });
  it('recomputes a matching two-read safety refusal instead of believing a forged pass', () => {
    const input = fixture(); input.records[0]!.answers.hate = 0.99;
    const secondary = { backend: 'codex-cli', judge: 'gpt-6.1-terra', model: 'gpt-6.1-terra', policy: FORGE_JUDGE_POLICY_VERSION,
      evidenceHash, status: 'complete', outcome: 'refuse', concerns: ['hate'] };
    const value = { ...input, records: [input.records[0], secondary] };
    expect(() => recoverForgeVerdict(value, false, evidenceHash)).toThrow(expect.objectContaining({ code: 'corrupt' }));
    expect(recoverForgeVerdict({ ...value, outcome: 'refuse' }, false, evidenceHash).outcome).toBe('refuse');
  });
  it('keeps uncertain primary evidence held even when the second read passes', () => {
    const input = fixture(); input.records[0]!.answers.uncertain_language = 0.2;
    const secondary = { backend: 'codex-cli', judge: 'gpt-6.1-terra', model: 'gpt-6.1-terra', policy: FORGE_JUDGE_POLICY_VERSION,
      evidenceHash, status: 'complete', outcome: 'pass', concerns: [] };
    const value = { ...input, outcome: 'hold', records: [input.records[0], secondary] };
    expect(recoverForgeVerdict(value, false, evidenceHash).outcome).toBe('hold');
    expect(() => recoverForgeVerdict({ ...value, outcome: 'pass' }, false, evidenceHash)).toThrow();
  });
  it('does not turn one concerning read into a persisted safety refusal', () => {
    const input = fixture(); input.records[0]!.answers.hate = 0.99; input.outcome = 'refuse';
    expect(() => recoverForgeVerdict(input, false, evidenceHash)).toThrow();
  });
});
