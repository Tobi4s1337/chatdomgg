import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import { access, lstat, mkdir, mkdtemp, readFile, readdir, readlink, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { PassThrough } from 'node:stream';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ForgeUsageLimitError, resolveCodexExecutable, runCodexDraft, type CodexDraftCompletion } from './codex-cli';

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));
function fakeChild() {
  const child = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(), stderr: new PassThrough(), stdin: new PassThrough(),
    kill: vi.fn(), pid: undefined,
  });
  vi.mocked(spawn).mockReturnValue(child as unknown as ChildProcessWithoutNullStreams);
  return child;
}
async function childStarted() {
  await vi.waitFor(() => expect(spawn).toHaveBeenCalled(), { interval: 1 });
}
let testAuthHome: string;
beforeEach(async () => {
  testAuthHome = await mkdtemp(join(tmpdir(), 'chatdom-provider-test-'));
  await writeFile(join(testAuthHome, 'auth.json'), JSON.stringify({ SIMULATED: 'test fixture; no authentication value' }));
  vi.stubEnv('CODEX_HOME', testAuthHome);
  await writeExecutableFixture(join(testAuthHome, 'fixture-bin'));
  vi.stubEnv('PATH', join(testAuthHome, 'fixture-bin'));
});
afterEach(async () => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  await rm(testAuthHome, { recursive: true, force: true });
});

async function writeExecutableFixture(directory: string, executable = true) {
  await mkdir(directory, { recursive: true });
  const file = join(directory, 'codex');
  await writeFile(file, '#!/usr/bin/env node\n// SIMULATED resolver fixture; never executed.\n', { mode: executable ? 0o700 : 0o600 });
  return file;
}

describe('Codex executable resolution', () => {
  it('preserves absolute PATH priority and skips non-executable files before considering the Node directory', async () => {
    const denied = join(testAuthHome, 'non-executable');
    const first = join(testAuthHome, 'first');
    const second = join(testAuthHome, 'second');
    const nodeBin = join(testAuthHome, 'node-bin');
    await writeExecutableFixture(denied, false);
    const firstExecutable = await writeExecutableFixture(first);
    await writeExecutableFixture(second);
    await writeExecutableFixture(nodeBin);
    const pathValue = [denied, first, second].join(delimiter);
    await expect(resolveCodexExecutable(pathValue, join(nodeBin, 'node'))).resolves.toEqual({
      command: firstExecutable, path: pathValue, source: 'path',
    });
  });

  it.each([undefined, '', '/missing/fixture-bin'])('falls back beside Node and prefixes only the child PATH when PATH is %s', async pathValue => {
    const parentPath = process.env.PATH;
    const nodeBin = join(testAuthHome, 'node-bin');
    const command = await writeExecutableFixture(nodeBin);
    await expect(resolveCodexExecutable(pathValue, join(nodeBin, 'node'))).resolves.toEqual({
      command, path: `${nodeBin}${pathValue === undefined ? '' : `${delimiter}${pathValue}`}`, source: 'node-adjacent',
    });
    expect(process.env.PATH).toBe(parentPath);
  });

  it('rejects relative PATH entries and executable directories', async () => {
    const directoryBin = join(testAuthHome, 'directory-bin');
    await mkdir(join(directoryBin, 'codex'), { recursive: true });
    const nodeBin = join(testAuthHome, 'node-bin');
    const command = await writeExecutableFixture(nodeBin);
    const pathValue = ['', '.', 'relative/bin', directoryBin].join(delimiter);
    await expect(resolveCodexExecutable(pathValue, join(nodeBin, 'node'))).resolves.toEqual({
      command, path: `${nodeBin}${delimiter}${pathValue}`, source: 'node-adjacent',
    });
  });

  it('leaves a missing executable to the sanitized spawn failure path without adding search directories', async () => {
    const nodeBin = join(testAuthHome, 'node-bin');
    await writeExecutableFixture(nodeBin, false);
    const pathValue = join(testAuthHome, 'missing-bin');
    await expect(resolveCodexExecutable(pathValue, join(nodeBin, 'node'))).resolves.toEqual({
      command: 'codex', path: pathValue, source: 'missing',
    });
    await expect(resolveCodexExecutable(undefined, join(testAuthHome, 'missing-node-bin', 'node'))).resolves.toEqual({
      command: 'codex', path: undefined, source: 'missing',
    });
    expect(spawn).not.toHaveBeenCalled();
  });
});

describe('isolated Codex CLI process', () => {
  it('fails before spawning when no trusted executable exists and cleans temporary state', async () => {
    const originalNodeExecutable = process.execPath;
    Object.defineProperty(process, 'execPath', { value: join(testAuthHome, 'missing-node-bin', 'node') });
    vi.stubEnv('PATH', ['', '.', 'relative/bin', join(testAuthHome, 'missing-bin')].join(delimiter));
    vi.stubEnv('TMPDIR', testAuthHome);
    try {
      const onComplete = vi.fn();
      await expect(runCodexDraft({ prompt: 'a dragon', schema: {}, signal: new AbortController().signal, onComplete })).rejects.toThrow('Codex is unavailable.');
      expect(spawn).not.toHaveBeenCalled();
      expect(onComplete).toHaveBeenCalledOnce();
      expect(onComplete).toHaveBeenCalledWith({ model: 'gpt-6.1-terra', effort: 'medium',
        elapsedMs: expect.any(Number), outcome: 'failed', failure: 'spawn' });
      expect((await readdir(testAuthHome)).sort()).toEqual(['auth.json', 'fixture-bin']);
    } finally {
      Object.defineProperty(process, 'execPath', { value: originalNodeExecutable });
    }
  });

  it('spawns the resolved PATH executable with a private environment without changing the parent PATH', async () => {
    const pathValue = join(testAuthHome, 'path-bin');
    const command = await writeExecutableFixture(pathValue);
    vi.stubEnv('PATH', pathValue);
    const child = fakeChild();
    const pending = runCodexDraft({ prompt: 'a dragon', schema: {}, signal: new AbortController().signal });
    await childStarted();
    const [selected, , options] = vi.mocked(spawn).mock.calls[0]!;
    expect(selected).toBe(command);
    expect(options!.env!.PATH).toBe(pathValue);
    expect(options!.env).not.toBe(process.env);
    expect(process.env.PATH).toBe(pathValue);
    child.stdout.write('{}');
    child.emit('close', 0);
    await expect(pending).resolves.toBe('{}');
    expect(spawn).toHaveBeenCalledOnce();
    expect(process.env.PATH).toBe(pathValue);
  });

  it('uses stdin, strict output schema, read-only isolation and disabled tools, then cleans its scratch directory', async () => {
    const child = fakeChild();
    let stdin = '';
    child.stdin.on('data', chunk => { stdin += String(chunk); });
    const prompt = 'A dragon `touch /tmp/never` $(echo never)\nwith a warm hearth';
    const pending = runCodexDraft({ prompt, schema: { type: 'object', additionalProperties: false }, signal: new AbortController().signal });
    await childStarted();
    const [command, args, options] = vi.mocked(spawn).mock.calls[0]!;
    expect(command).toBe((await resolveCodexExecutable(process.env.PATH)).command);
    expect(args).toEqual(expect.arrayContaining(['exec', '--no-daemon', '--ignore-user-config', '--ignore-rules', '--ephemeral', '--output-schema', 'read-only', 'gpt-6.1-terra', 'shell_tool', 'unified_exec', 'apps', 'plugins', 'code_mode_host', 'model_reasoning_effort="medium"']));
    expect(args).not.toContain(prompt);
    expect(options).toMatchObject({ detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
    expect(options).not.toHaveProperty('shell');
    expect(stdin).toBe(prompt);
    const cwd = options!.cwd as string;
    const authHome = options!.env!.CODEX_HOME!;
    expect(authHome).not.toBe(process.env.CODEX_HOME);
    const authFile = `${authHome}/auth.json`;
    expect((await lstat(authFile)).isSymbolicLink()).toBe(true);
    expect(await readlink(authFile)).toMatch(/\/auth\.json$/);
    await expect(access(cwd)).resolves.toBeUndefined();
    child.stderr.write('private diagnostic detail');
    child.stdout.write('{"plan":{}}');
    child.emit('close', 0);
    await expect(pending).resolves.toBe('{"plan":{}}');
    await expect(access(cwd)).rejects.toThrow();
    await expect(access(authHome)).rejects.toThrow();
  });

  it('attaches private PNG evidence to a separate judge model without granting image or filesystem tools', async () => {
    const child = fakeChild();
    const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]);
    const pending = runCodexDraft({ prompt: 'Review only this evidence.', schema: {},
      signal: new AbortController().signal, model: 'gpt-6-luna', effort: 'low',
      image: `data:image/png;base64,${bytes.toString('base64')}` });
    await childStarted();
    const [, args] = vi.mocked(spawn).mock.calls[0]!;
    expect(args).toEqual(expect.arrayContaining(['gpt-6-luna', 'model_reasoning_effort="low"', 'tools.view_image=false']));
    const imagePath = args![args!.indexOf('--image') + 1]!;
    expect(await readFile(imagePath)).toEqual(bytes);
    expect((await lstat(imagePath)).mode & 0o777).toBe(0o600);
    expect(args![args!.indexOf('--image') + 2]).toBe('--output-schema');
    child.stdout.write('{"outcome":"hold"}'); child.emit('close', 0);
    await expect(pending).resolves.toBe('{"outcome":"hold"}');
    await expect(access(imagePath)).rejects.toThrow();
  });

  it('refuses file paths and non-PNG evidence before spawning', async () => {
    await expect(runCodexDraft({ prompt: 'judge', schema: {}, signal: new AbortController().signal,
      image: '/etc/passwd' })).rejects.toThrow('bounded PNG');
    await expect(runCodexDraft({ prompt: 'judge', schema: {}, signal: new AbortController().signal,
      image: 'data:image/png;base64,bm90LWEtcG5n' })).rejects.toThrow('Invalid PNG');
    expect(spawn).not.toHaveBeenCalled();
  });

  it('kills an interrupted child and never returns its diagnostics', async () => {
    const child = fakeChild();
    const controller = new AbortController();
    child.kill.mockImplementation(() => { child.emit('close', null); });
    const pending = runCodexDraft({ prompt: 'a dragon', schema: {}, signal: controller.signal });
    await childStarted();
    child.stderr.write('account secret diagnostic');
    controller.abort();
    await expect(pending).rejects.toThrow('interrupted');
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
  });

  it('kills a child that exceeds the combined stdout/stderr budget', async () => {
    const child = fakeChild();
    child.kill.mockImplementation(() => { child.emit('close', null); });
    const onComplete = vi.fn();
    const pending = runCodexDraft({ prompt: 'a dragon', schema: {}, signal: new AbortController().signal, onComplete });
    await childStarted();
    child.stderr.write('x'.repeat(256 * 1024 + 1));
    await expect(pending).rejects.toThrow('output budget');
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
    expect(onComplete).toHaveBeenCalledWith({ model: 'gpt-6.1-terra', effort: 'medium',
      elapsedMs: expect.any(Number), outcome: 'failed', failure: 'output-budget' });
  });

  it('rejects failed CLI runs without exposing stderr', async () => {
    const child = fakeChild();
    const pending = runCodexDraft({ prompt: 'a dragon', schema: {}, signal: new AbortController().signal });
    await childStarted();
    child.stderr.write('secret diagnostic');
    child.emit('close', 1);
    await expect(pending).rejects.toThrow('could not complete');
  });

  it('reports only finite numeric accounting and explicit CLI token counts after cleanup', async () => {
    const child = fakeChild();
    const onComplete = vi.fn<(completion: CodexDraftCompletion) => void>();
    const pending = runCodexDraft({ prompt: 'Private wish words.', schema: {},
      signal: new AbortController().signal, model: 'gpt-6-luna', effort: 'low', onComplete });
    await childStarted();
    const cwd = vi.mocked(spawn).mock.calls[0]![2]!.cwd as string;
    child.stderr.write('Private account diagnostic.\ntokens us');
    child.stderr.write('ed\n1,');
    child.stderr.write('234\ninput tokens: 900\noutput tokens: 334\n');
    child.stdout.write('{"outcome":"pass"}');
    child.emit('close', 0);
    await expect(pending).resolves.toBe('{"outcome":"pass"}');
    expect(onComplete).toHaveBeenCalledOnce();
    const completion = onComplete.mock.calls[0]![0];
    expect(completion).toEqual({ model: 'gpt-6-luna', effort: 'low', elapsedMs: expect.any(Number),
      outcome: 'complete', usage: { totalTokens: 1234, inputTokens: 900, outputTokens: 334 } });
    expect(Number.isFinite(completion.elapsedMs)).toBe(true);
    expect(completion.elapsedMs).toBeGreaterThanOrEqual(0);
    await expect(access(cwd)).rejects.toThrow();
  });

  it.each([
    "ERROR: You've hit your usage limit. Private account upgrade details.",
    'ERROR: Rate limit reached for private account.',
    'ERROR: unexpected status 429 Too Many Requests: private diagnostic',
    'ERROR: request failed: {"code":"usage_limit_reached","detail":"private"}',
  ])('immediately kills a usage-limited CLI and returns a sanitized typed failure: %s', async diagnostic => {
    const child = fakeChild();
    child.kill.mockImplementation(() => { child.emit('close', null); });
    const onComplete = vi.fn();
    const pending = runCodexDraft({ prompt: 'a dragon', schema: {}, signal: new AbortController().signal, onComplete });
    await childStarted();
    const cwd = vi.mocked(spawn).mock.calls[0]![2]!.cwd as string;
    child.stderr.write(diagnostic.slice(0, 12));
    child.stderr.write(diagnostic.slice(12));
    const failure = await pending.catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ForgeUsageLimitError);
    expect(failure).toMatchObject({ code: 'FORGE_USAGE_LIMIT', message: 'The Forge is waiting for its Codex usage limit to reset.' });
    expect(String(failure)).not.toContain('private');
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
    expect(onComplete).toHaveBeenCalledWith({ model: 'gpt-6.1-terra', effort: 'medium',
      elapsedMs: expect.any(Number), outcome: 'usage-limit' });
    await expect(access(cwd)).rejects.toThrow();
  });

  it.each([
    { diagnostic: 'Private diagnostic about rate limits, account 1234 and tokens.', category: 'unknown' },
    { diagnostic: 'ERROR: Authentication failed for private account.', category: 'authentication' },
  ])('never exposes failure diagnostics or invents usage from unrelated or nonfinite numbers: $category', async ({ diagnostic, category }) => {
    const child = fakeChild();
    const onComplete = vi.fn();
    const pending = runCodexDraft({ prompt: 'a dragon', schema: {}, signal: new AbortController().signal, onComplete });
    await childStarted();
    child.stderr.write(`${diagnostic}\ntokens used\nInfinity\ninput tokens: -12\noutput tokens: 99999999999999999999999\n`);
    child.emit('close', 1);
    const failure = await pending.catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(ForgeUsageLimitError);
    expect(String(failure)).toBe('Error: Codex could not complete the Forge draft.');
    expect(onComplete).toHaveBeenCalledWith({ model: 'gpt-6.1-terra', effort: 'medium',
      elapsedMs: expect.any(Number), outcome: 'failed', failure: category });
  });

  it('ignores a throwing accounting callback after cleanup and preserves the successful result', async () => {
    const child = fakeChild();
    let cwd = '';
    let scratchExistedAtCompletion = true;
    const onComplete = vi.fn(() => {
      scratchExistedAtCompletion = existsSync(cwd);
      throw new Error('Private accounting failure.');
    });
    const pending = runCodexDraft({ prompt: 'a dragon', schema: {}, signal: new AbortController().signal, onComplete });
    await childStarted();
    cwd = vi.mocked(spawn).mock.calls[0]![2]!.cwd as string;
    child.stdout.write('{}');
    child.emit('close', 0);
    await expect(pending).resolves.toBe('{}');
    expect(onComplete).toHaveBeenCalledOnce();
    expect(scratchExistedAtCompletion).toBe(false);
    await expect(access(cwd)).rejects.toThrow();
  });

  it('reports cancellation and kills the detached process group before cleanup', async () => {
    const child = fakeChild();
    Object.assign(child, { pid: 12345 });
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => { child.emit('close', null); return true; });
    try {
      const controller = new AbortController();
      const onComplete = vi.fn();
      const pending = runCodexDraft({ prompt: 'a dragon', schema: {}, signal: controller.signal, onComplete });
      await childStarted();
      const cwd = vi.mocked(spawn).mock.calls[0]![2]!.cwd as string;
      controller.abort();
      await expect(pending).rejects.toThrow('interrupted');
      expect(kill).toHaveBeenCalledWith(-12345, 'SIGKILL');
      expect(onComplete).toHaveBeenCalledWith({ model: 'gpt-6.1-terra', effort: 'medium',
        elapsedMs: expect.any(Number), outcome: 'canceled' });
      await expect(access(cwd)).rejects.toThrow();
    } finally {
      kill.mockRestore();
    }
  });

  it('accounts for cancellation before spawning and keeps the abort reason out of accounting', async () => {
    const controller = new AbortController();
    controller.abort(new Error('Private abort reason.'));
    const onComplete = vi.fn();
    await expect(runCodexDraft({ prompt: 'a dragon', schema: {}, signal: controller.signal, onComplete })).rejects.toThrow('Private abort reason.');
    expect(spawn).not.toHaveBeenCalled();
    expect(onComplete).toHaveBeenCalledWith({ model: 'gpt-6.1-terra', effort: 'medium',
      elapsedMs: expect.any(Number), outcome: 'canceled' });
  });

  it('accounts for a failed spawn and removes temporary state', async () => {
    const child = fakeChild();
    const onComplete = vi.fn();
    const pending = runCodexDraft({ prompt: 'a dragon', schema: {}, signal: new AbortController().signal, onComplete });
    await childStarted();
    const cwd = vi.mocked(spawn).mock.calls[0]![2]!.cwd as string;
    child.emit('error', new Error('Private executable path.'));
    child.emit('close', -2);
    await expect(pending).rejects.toThrow('Codex is unavailable.');
    expect(onComplete).toHaveBeenCalledWith({ model: 'gpt-6.1-terra', effort: 'medium',
      elapsedMs: expect.any(Number), outcome: 'failed', failure: 'spawn' });
    await expect(access(cwd)).rejects.toThrow();
  });

  it.each([
    { diagnostic: "error: unexpected argument '--unsupported-private-flag' found", category: 'configuration' },
    { diagnostic: 'Error loading configuration: TOML parse error in private config.', category: 'configuration' },
    { diagnostic: 'ERROR: unknown feature: private_feature', category: 'configuration' },
    { diagnostic: 'ERROR: Token refresh failed: private authentication detail.', category: 'authentication' },
    { diagnostic: 'ERROR: unexpected status 401 Unauthorized: private account.', category: 'authentication' },
    { diagnostic: 'ERROR: The private model is not supported for this account.', category: 'model-unavailable' },
    { diagnostic: 'ERROR: {"code":"model_not_found","detail":"private"}', category: 'model-unavailable' },
    { diagnostic: 'ERROR: error sending request for url (https://private.invalid)', category: 'transport' },
    { diagnostic: '2026-11-02T10:00:00Z ERROR transport: stream disconnected before completion: private detail.', category: 'transport' },
    { diagnostic: 'ERROR: unexpected status 503: private service detail.', category: 'transport' },
    { diagnostic: 'WARNING: failed to update PATH aliases: Read-only file system.', category: 'unknown' },
  ])('reports only a finite failure enum for $category diagnostics', async ({ diagnostic, category }) => {
    const child = fakeChild();
    const onComplete = vi.fn<(completion: CodexDraftCompletion) => void>();
    const pending = runCodexDraft({ prompt: 'Private wish.', schema: {}, signal: new AbortController().signal, onComplete });
    await childStarted();
    child.stderr.write(`${'private diagnostic padding\n'.repeat(700)}${diagnostic.slice(0, 9)}`);
    child.stderr.write(`${diagnostic.slice(9)}\n${'private diagnostic padding\n'.repeat(700)}`);
    child.emit('close', 1);
    await expect(pending).rejects.toThrow('Codex could not complete the Forge draft.');
    expect(onComplete).toHaveBeenCalledOnce();
    const completion = onComplete.mock.calls[0]![0];
    expect(completion).toEqual({ model: 'gpt-6.1-terra', effort: 'medium', elapsedMs: expect.any(Number),
      outcome: 'failed', failure: category });
    expect(Number.isFinite(completion.elapsedMs)).toBe(true);
    expect(completion.elapsedMs).toBeGreaterThanOrEqual(0);
    expect(JSON.stringify(completion)).not.toContain('private');
  });

  it('ignores warnings and even error diagnostics when the CLI completes successfully', async () => {
    const child = fakeChild();
    const onComplete = vi.fn();
    const pending = runCodexDraft({ prompt: 'a dragon', schema: {}, signal: new AbortController().signal, onComplete });
    await childStarted();
    child.stderr.write('WARNING: failed to update PATH aliases: Read-only file system.\nERROR: network retry failed.\n');
    child.stdout.write('{}');
    child.emit('close', 0);
    await expect(pending).resolves.toBe('{}');
    expect(onComplete).toHaveBeenCalledWith({ model: 'gpt-6.1-terra', effort: 'medium',
      elapsedMs: expect.any(Number), outcome: 'complete' });
    expect(child.kill).not.toHaveBeenCalled();
  });

  it('sanitizes a synchronous spawn failure and reports its category', async () => {
    vi.mocked(spawn).mockImplementation(() => { throw new Error('Private executable path.'); });
    const onComplete = vi.fn();
    await expect(runCodexDraft({ prompt: 'a dragon', schema: {}, signal: new AbortController().signal, onComplete })).rejects.toThrow('Codex is unavailable.');
    expect(onComplete).toHaveBeenCalledWith({ model: 'gpt-6.1-terra', effort: 'medium',
      elapsedMs: expect.any(Number), outcome: 'failed', failure: 'spawn' });
  });
});
