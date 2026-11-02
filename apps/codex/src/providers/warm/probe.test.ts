import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { describe, expect, it, vi } from 'vitest';
import { ForgeUsageLimitError, runCodexDraft, type CodexDraftCompletion, type CodexDraftRunner } from '../codex-cli';
import { createWarmCodexRunner } from './index';

/**
 * Real-model latency probe, off by default. FORGE_WARM_PROBE=1 makes at most five tiny calls
 * (three warm, two cold) on gpt-6-luna at low effort and stops at the first usage-limit report.
 * Only timings, token counts and outcomes are printed; no prompt, answer or environment value is.
 */
const enabled = process.env.FORGE_WARM_PROBE === '1';
const PROBE_ROOT = '/tmp/chatdom-forge-wish';
const SCHEMA = { type: 'object', additionalProperties: false, required: ['answer'], properties: { answer: { type: 'string' } } };
const PROMPTS = ['Name the colour of a clear daytime sky in one lowercase word.', 'Name the colour of fresh grass in one lowercase word.',
  'Name the colour of fresh snow in one lowercase word.', 'Name the colour of a ripe lemon in one lowercase word.',
  'Name the colour of coal in one lowercase word.'];

interface Row { path: 'warm' | 'cold'; index: number; outcome: string; elapsedMs: number; wallMs: number; usage?: CodexDraftCompletion['usage']; validJson: boolean }

describe.skipIf(!enabled)('warm runner real probe', () => {
  it('measures warm and cold structured calls', { timeout: 600_000 }, async () => {
    await mkdir(PROBE_ROOT, { recursive: true });
    const root = await mkdtemp(join(PROBE_ROOT, 'warm-probe-'));
    vi.stubEnv('TMPDIR', join(root, 'cold'));
    await mkdir(join(root, 'cold'), { mode: 0o700 });
    const rows: Row[] = [];
    let fallbackUsed = 0;
    let limited = false;
    const fallback: CodexDraftRunner = async () => { fallbackUsed++; throw new Error('Probe: the warm path was unavailable.'); };
    const created = performance.now();
    const runner = createWarmCodexRunner({ stateDirectory: join(root, 'warm'), fallback, maxConcurrent: 1 });
    let startupMs: number | undefined;
    try {
      await vi.waitFor(() => expect(runner.state).not.toBe('starting'), { timeout: 30_000, interval: 10 });
      startupMs = performance.now() - created;
      expect(runner.state).toBe('warm');

      const measure = async (path: Row['path'], index: number, run: CodexDraftRunner) => {
        if (limited) return;
        let completion: CodexDraftCompletion | undefined;
        const wall = performance.now();
        let validJson = false;
        try {
          const text = await run({ prompt: PROMPTS[index]!, schema: SCHEMA, signal: AbortSignal.timeout(120_000), model: 'gpt-6-luna', effort: 'low',
            onComplete: value => { completion = value; } });
          const parsed = JSON.parse(text) as unknown;
          validJson = typeof parsed === 'object' && parsed !== null && typeof (parsed as { answer?: unknown }).answer === 'string';
        } catch (error) {
          if (error instanceof ForgeUsageLimitError) limited = true;
        }
        rows.push({ path, index, outcome: completion?.outcome ?? 'none', elapsedMs: Math.round(completion?.elapsedMs ?? Number.NaN),
          wallMs: Math.round(performance.now() - wall), ...(completion?.usage ? { usage: completion.usage } : {}), validJson });
      };
      for (const index of [0, 1, 2]) await measure('warm', index, runner);
      for (const index of [3, 4]) await measure('cold', index, runCodexDraft);
    } finally {
      await runner.close();
      vi.unstubAllEnvs();
    }
    const summary = { cli: '0.166.0', startupMs: startupMs === undefined ? null : Math.round(startupMs), fallbackUsed, limited, rows };
    console.log(JSON.stringify(summary, null, 2));
    await writeFile(join(root, 'summary.json'), JSON.stringify(summary, null, 2), { mode: 0o600 });
    await rm(join(root, 'cold'), { recursive: true, force: true });
    expect(limited).toBe(false);
    expect(fallbackUsed).toBe(0);
  });
});
