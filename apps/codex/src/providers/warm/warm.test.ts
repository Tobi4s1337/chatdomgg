import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import { lstat, mkdir, mkdtemp, readdir, readlink, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ForgeUsageLimitError, type CodexDraftCompletion, type CodexDraftRun, type CodexDraftRunner } from '../codex-cli';
import { createWarmCodexRunner, type WarmCodexRunner, type WarmCodexRunnerOptions, type WarmSpawn } from './index';

const FAKE_SERVER = fileURLToPath(new URL('./fixtures/fake-app-server.mjs', import.meta.url));
const SCHEMA = { type: 'object', additionalProperties: false, required: ['answer'], properties: { answer: { type: 'string' } } };
const PNG = `data:image/png;base64,${Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.from('SIMULATED-IHDR')]).toString('base64')}`;

interface Launch {
  command: string;
  args: string[];
  options: Parameters<WarmSpawn>[2];
  child: ChildProcessWithoutNullStreams;
}

let home: string;
let stateDirectory: string;
const runners: WarmCodexRunner[] = [];

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'chatdom-warm-test-'));
  stateDirectory = join(home, 'state');
  await writeFile(join(home, 'auth.json'), JSON.stringify({ SIMULATED: 'test fixture; no authentication value' }));
  const bin = join(home, 'fixture-bin');
  await mkdir(bin);
  await writeFile(join(bin, 'codex'), '#!/usr/bin/env node\n// SIMULATED resolver fixture; never executed.\n', { mode: 0o700 });
  vi.stubEnv('CODEX_HOME', home);
  vi.stubEnv('PATH', bin);
});

afterEach(async () => {
  await Promise.all(runners.splice(0).map(runner => runner.close()));
  vi.unstubAllEnvs();
  await rm(home, { recursive: true, force: true });
});

/** Launches the simulated server instead of the CLI; `modes` set the start-up behaviour of each launch in turn. */
function fakeSpawn(modes: string[] = []) {
  const launches: Launch[] = [];
  const launcher: WarmSpawn = (command, args, options) => {
    const child = spawn(process.execPath, [FAKE_SERVER, modes.shift() ?? 'normal'], {
      cwd: options.cwd, env: { CODEX_HOME: options.env.CODEX_HOME }, detached: options.detached, stdio: 'pipe',
    });
    launches.push({ command, args, options, child });
    return child;
  };
  return { launches, launcher };
}

function warmRunner(options: WarmCodexRunnerOptions & { modes?: string[] } = {}) {
  const { modes, ...rest } = options;
  const fake = fakeSpawn(modes);
  const fallback = vi.fn<CodexDraftRunner>(async input => {
    input.onComplete?.({ model: input.model ?? 'gpt-6.1-terra', effort: input.effort ?? 'medium', elapsedMs: 7, outcome: 'complete' });
    return 'FALLBACK';
  });
  const runner = createWarmCodexRunner({ stateDirectory, fallback, retryDelayMs: 30, idleRestartMs: 0, spawn: fake.launcher, ...rest });
  runners.push(runner);
  return { runner, fallback, ...fake };
}

async function becomes(runner: WarmCodexRunner, state: WarmCodexRunner['state']) {
  await vi.waitFor(() => expect(runner.state).toBe(state), { timeout: 5_000, interval: 5 });
}

function call(runner: WarmCodexRunner, prompt: string, extra: Partial<CodexDraftRun> = {}) {
  const completions: CodexDraftCompletion[] = [];
  const promise = runner({ prompt, schema: SCHEMA, signal: new AbortController().signal, model: 'gpt-6-luna', effort: 'low',
    onComplete: completion => completions.push(completion), ...extra });
  return { promise, completions };
}

async function stats(runner: WarmCodexRunner) {
  return JSON.parse(await call(runner, 'STATS').promise) as {
    initialized: boolean; threads: number; unsubscribes: number; interrupts: number; maxActive: number;
    threadParams: Record<string, unknown>[]; turnParams: Record<string, unknown>[];
  };
}

const alive = (pid: number | undefined) => {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
};

describe('warm Codex runner', () => {
  it('starts an owned app-server with private state, minimal environment and the cold provider hardening', async () => {
    vi.stubEnv('FORGE_UNRELATED_SERVICE_TOKEN', 'SIMULATED');
    const { runner, launches } = warmRunner();
    expect(runner.state).toBe('starting');
    await becomes(runner, 'warm');
    expect(launches).toHaveLength(1);
    const [launch] = launches;
    expect(launch!.args.slice(0, 4)).toEqual(['--no-daemon', 'app-server', '--listen', 'stdio://']);
    for (const feature of ['shell_tool', 'unified_exec', 'apps', 'plugins', 'multi_agent', 'browser_use', 'computer_use', 'memories', 'hooks']) {
      expect(launch!.args.join(' ')).toContain(`--disable ${feature}`);
    }
    expect(launch!.args).toEqual(expect.arrayContaining(['approval_policy="never"', 'sandbox_mode="read-only"', 'web_search="disabled"', 'mcp_servers={}', 'project_doc_max_bytes=0']));
    expect(launch!.options.detached).toBe(true);
    expect(Object.keys(launch!.options.env).every(key => ['PATH', 'HOME', 'LANG', 'LC_ALL', 'TMPDIR', 'SSL_CERT_FILE', 'SSL_CERT_DIR', 'CODEX_HOME'].includes(key))).toBe(true);
    const codexHome = launch!.options.env.CODEX_HOME!;
    expect(codexHome.startsWith(stateDirectory)).toBe(true);
    expect((await stat(codexHome)).mode & 0o777).toBe(0o700);
    expect((await lstat(join(codexHome, 'auth.json'))).isSymbolicLink()).toBe(true);
    expect(await readlink(join(codexHome, 'auth.json'))).toBe(join(home, 'auth.json'));
    expect(await readdir(codexHome)).toEqual(['auth.json']);
    expect((await stats(runner)).initialized).toBe(true);
  });

  it('serves each call as a fresh ephemeral read-only thread with one strict-schema turn and reports usage once', async () => {
    const { runner, fallback } = warmRunner();
    await becomes(runner, 'warm');
    const first = call(runner, 'ANSWER:hello');
    await expect(first.promise).resolves.toBe('{"answer":"hello"}');
    expect(first.completions).toHaveLength(1);
    expect(first.completions[0]).toMatchObject({ model: 'gpt-6-luna', effort: 'low', outcome: 'complete', usage: { totalTokens: 120, inputTokens: 100, outputTokens: 20 } });
    expect(first.completions[0]!.failure).toBeUndefined();
    await expect(call(runner, 'ANSWER:again').promise).resolves.toBe('{"answer":"again"}');
    const seen = await stats(runner);
    expect(seen.threads).toBe(3);
    expect(seen.unsubscribes).toBeGreaterThanOrEqual(2);
    expect(seen.threadParams[0]).toMatchObject({ model: 'gpt-6-luna', ephemeral: true, sandbox: 'read-only', approvalPolicy: 'never' });
    expect(seen.threadParams[0]!.cwd).not.toBe(seen.threadParams[1]!.cwd);
    expect(String(seen.threadParams[0]!.cwd).startsWith(stateDirectory)).toBe(true);
    expect(seen.turnParams[0]).toMatchObject({ threadId: 'thread-1', outputSchema: SCHEMA, effort: 'low', model: 'gpt-6-luna', approvalPolicy: 'never',
      sandboxPolicy: { type: 'readOnly', networkAccess: false }, input: ['text'] });
    expect(fallback).not.toHaveBeenCalled();
  });

  it('denies every tool, approval, credential and input request the server makes', async () => {
    const { runner } = warmRunner();
    await becomes(runner, 'warm');
    const replies = JSON.parse(await call(runner, 'TOOL').promise) as Record<string, unknown>;
    expect(replies['item/commandExecution/requestApproval']).toEqual({ decision: 'decline' });
    expect(replies['item/fileChange/requestApproval']).toEqual({ decision: 'decline' });
    expect(replies['execCommandApproval']).toEqual({ decision: { denied: { rejection: expect.any(String) } } });
    expect(replies['applyPatchApproval']).toEqual({ decision: { denied: { rejection: expect.any(String) } } });
    expect(replies['item/permissions/requestApproval']).toEqual({ permissions: {}, scope: 'turn' });
    expect(replies['mcpServer/elicitation/request']).toEqual({ action: 'decline', content: null, _meta: null });
    expect(replies['item/tool/call']).toEqual({ contentItems: [], success: false });
    expect(replies['item/tool/requestUserInput']).toEqual({ error: true });
    expect(replies['account/chatgptAuthTokens/refresh']).toEqual({ error: true });
  });

  it('interrupts the turn on cancellation and accounts the call as canceled', async () => {
    const { runner, fallback } = warmRunner();
    await becomes(runner, 'warm');
    const controller = new AbortController();
    const waiting = call(runner, 'WAIT', { signal: controller.signal });
    setTimeout(() => controller.abort(), 50);
    await expect(waiting.promise).rejects.toThrow('Forge drafting was interrupted.');
    expect(waiting.completions).toEqual([expect.objectContaining({ outcome: 'canceled' })]);
    expect((await stats(runner)).interrupts).toBe(1);
    expect(runner.state).toBe('warm');
    expect(fallback).not.toHaveBeenCalled();
  });

  it('stops on a reported usage limit and classifies provider failures', async () => {
    const { runner } = warmRunner();
    await becomes(runner, 'warm');
    const limited = call(runner, 'LIMIT');
    await expect(limited.promise).rejects.toBeInstanceOf(ForgeUsageLimitError);
    expect(limited.completions).toEqual([expect.objectContaining({ outcome: 'usage-limit' })]);
    expect((await stats(runner)).interrupts).toBe(1);
    const denied = call(runner, 'FAIL401');
    await expect(denied.promise).rejects.toThrow('Codex could not complete the Forge draft.');
    expect(denied.completions).toEqual([expect.objectContaining({ outcome: 'failed', failure: 'authentication' })]);
    const big = call(runner, 'BIG');
    await expect(big.promise).rejects.toThrow('Forge draft exceeded its output budget.');
    expect(big.completions).toEqual([expect.objectContaining({ outcome: 'failed', failure: 'output-budget' })]);
  });

  it('passes PNG evidence as a private local image and removes it after the turn', async () => {
    const { runner, fallback } = warmRunner();
    await becomes(runner, 'warm');
    const seen = JSON.parse(await call(runner, 'IMAGE', { image: PNG }).promise) as { path: string; mode: string };
    expect(seen.mode).toBe('600');
    expect(seen.path.startsWith(stateDirectory)).toBe(true);
    expect(existsSync(seen.path)).toBe(false);
    const invalid = call(runner, 'IMAGE', { image: 'data:image/png;base64,AAAA' });
    await expect(invalid.promise).rejects.toThrow('Invalid PNG evidence.');
    expect(invalid.completions).toEqual([expect.objectContaining({ outcome: 'failed' })]);
    expect(fallback).not.toHaveBeenCalled();
  });

  it('runs a call through the fallback when the server dies before its turn, then warms up again', async () => {
    const { runner, fallback, launches } = warmRunner({ modes: ['exit-at-thread'], retryDelayMs: 300 });
    await becomes(runner, 'warm');
    const first = call(runner, 'ANSWER:x');
    await expect(first.promise).resolves.toBe('FALLBACK');
    expect(fallback).toHaveBeenCalledTimes(1);
    expect(fallback.mock.calls[0]![0]).toMatchObject({ prompt: 'ANSWER:x', schema: SCHEMA, model: 'gpt-6-luna', effort: 'low' });
    expect(first.completions).toHaveLength(1);
    expect(first.completions[0]!.elapsedMs).toBeGreaterThanOrEqual(7);
    expect(runner.state).toBe('cold');
    // While cold, calls go straight to the fallback.
    await expect(call(runner, 'ANSWER:y').promise).resolves.toBe('FALLBACK');
    await becomes(runner, 'warm');
    expect(launches).toHaveLength(2);
    await expect(call(runner, 'ANSWER:z').promise).resolves.toBe('{"answer":"z"}');
    expect(fallback).toHaveBeenCalledTimes(2);
  });

  it.each(['exit-at-start', 'garbage'])('falls back while a %s server cannot start and keeps retrying', async mode => {
    const { runner, fallback, launches } = warmRunner({ modes: [mode, mode] });
    await expect(call(runner, 'ANSWER:x').promise).resolves.toBe('FALLBACK');
    expect(fallback).toHaveBeenCalledTimes(1);
    await becomes(runner, 'warm');
    expect(launches.length).toBe(3);
    await expect(call(runner, 'ANSWER:x').promise).resolves.toBe('{"answer":"x"}');
  });

  it('falls back for a declined thread without discarding a healthy server', async () => {
    const { runner, fallback, launches } = warmRunner({ modes: ['reject-thread'] });
    await becomes(runner, 'warm');
    await expect(call(runner, 'ANSWER:x').promise).resolves.toBe('FALLBACK');
    expect(fallback).toHaveBeenCalledTimes(1);
    expect(runner.state).toBe('warm');
    expect(launches).toHaveLength(1);
  });

  it('counts a call as spent when the server dies after its turn started', async () => {
    const { runner, fallback } = warmRunner({ retryDelayMs: 300 });
    await becomes(runner, 'warm');
    const crashed = call(runner, 'CRASH');
    await expect(crashed.promise).rejects.toThrow('The Forge drafting connection was lost.');
    expect(crashed.completions).toEqual([expect.objectContaining({ outcome: 'failed', failure: 'transport' })]);
    expect(fallback).not.toHaveBeenCalled();
    expect(runner.state).toBe('cold');
    await becomes(runner, 'warm');
  });

  it('bounds concurrent turns and queues the rest', async () => {
    const { runner } = warmRunner({ maxConcurrent: 2 });
    await becomes(runner, 'warm');
    const results = await Promise.all([1, 2, 3, 4].map(() => call(runner, 'SLOW:80').promise));
    const peaks = results.map(result => (JSON.parse(result) as { maxActive: number }).maxActive);
    expect(Math.max(...peaks)).toBe(2);
  });

  it('replaces an idle server', async () => {
    const { runner, launches } = warmRunner({ idleRestartMs: 60 });
    await becomes(runner, 'warm');
    await vi.waitFor(() => expect(launches.length).toBeGreaterThanOrEqual(2), { timeout: 5_000, interval: 10 });
    await becomes(runner, 'warm');
    expect(alive(launches[0]!.child.pid)).toBe(false);
    await expect(call(runner, 'ANSWER:fresh').promise).resolves.toBe('{"answer":"fresh"}');
  });

  it('kills the child and removes its state on close; later calls fail without running', async () => {
    const { runner, fallback, launches } = warmRunner();
    await becomes(runner, 'warm');
    const pid = launches[0]!.child.pid;
    expect(alive(pid)).toBe(true);
    const inFlight = call(runner, 'WAIT');
    const outcome = inFlight.promise.catch((error: unknown) => error);
    const [root] = await readdir(stateDirectory);
    // The turn is under way once its private call folder exists and the server has had a moment to start it.
    await vi.waitFor(() => expect(readdir(join(stateDirectory, root!, 'scratch'))).resolves.toHaveLength(1), { interval: 5 });
    await new Promise(resolve => setTimeout(resolve, 100));
    await runner.close();
    expect(runner.state).toBe('closed');
    expect(alive(pid)).toBe(false);
    expect(await readdir(stateDirectory)).toEqual([]);
    expect(await outcome).toEqual(new Error('The Forge drafting connection was lost.'));
    expect(inFlight.completions).toEqual([expect.objectContaining({ outcome: 'failed', failure: 'transport' })]);
    const late = call(runner, 'ANSWER:x');
    await expect(late.promise).rejects.toThrow('Codex is unavailable.');
    expect(late.completions).toEqual([expect.objectContaining({ outcome: 'failed', failure: 'spawn' })]);
    expect(fallback).not.toHaveBeenCalled();
  });
});
