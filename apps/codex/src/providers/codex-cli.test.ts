import { EventEmitter } from 'node:events';
import { access, lstat, mkdtemp, readFile, readlink, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runCodexDraft } from './codex-cli';

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
});
afterEach(async () => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  await rm(testAuthHome, { recursive: true, force: true });
});

describe('isolated Codex CLI process', () => {
  it('uses stdin, strict output schema, read-only isolation and disabled tools, then cleans its scratch directory', async () => {
    const child = fakeChild();
    let stdin = '';
    child.stdin.on('data', chunk => { stdin += String(chunk); });
    const prompt = 'A dragon `touch /tmp/never` $(echo never)\nwith a warm hearth';
    const pending = runCodexDraft({ prompt, schema: { type: 'object', additionalProperties: false }, signal: new AbortController().signal });
    await childStarted();
    const [command, args, options] = vi.mocked(spawn).mock.calls[0]!;
    expect(command).toBe('codex');
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
    const pending = runCodexDraft({ prompt: 'a dragon', schema: {}, signal: new AbortController().signal });
    await childStarted();
    child.stderr.write('x'.repeat(256 * 1024 + 1));
    await expect(pending).rejects.toThrow('output budget');
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
  });

  it('rejects failed CLI runs without exposing stderr', async () => {
    const child = fakeChild();
    const pending = runCodexDraft({ prompt: 'a dragon', schema: {}, signal: new AbortController().signal });
    await childStarted();
    child.stderr.write('secret diagnostic');
    child.emit('close', 1);
    await expect(pending).rejects.toThrow('could not complete');
  });
});
