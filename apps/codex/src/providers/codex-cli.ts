import { spawn } from 'node:child_process';
import { access, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { StringDecoder } from 'node:string_decoder';

export interface CodexDraftRun {
  prompt: string;
  schema: Record<string, unknown>;
  signal: AbortSignal;
}
export type CodexDraftRunner = (input: CodexDraftRun) => Promise<string>;

const MAX_OUTPUT_BYTES = 256 * 1024;

/** No shell is involved. The model receives no local filesystem or connector tools. */
export const runCodexDraft: CodexDraftRunner = async ({ prompt, schema, signal }) => {
  signal.throwIfAborted();
  const scratch = await mkdtemp(join(tmpdir(), 'chatdom-forge-'));
  const cwd = join(scratch, 'work');
  try {
    await mkdir(cwd, { mode: 0o700 });
    const authHome = join(scratch, 'auth');
    await mkdir(authHome, { mode: 0o700 });
    // Keep auth in its existing read-only location. Only CLI runtime state lives
    // here; no config, connectors, skills, memory or project files are inherited.
    try {
      const authPath = join(process.env.CODEX_HOME ?? join(homedir(), '.codex'), 'auth.json');
      await access(authPath);
      await symlink(authPath, join(authHome, 'auth.json'));
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw new Error('Codex authentication is unavailable.', { cause: error });
    }
    const schemaPath = join(cwd, 'draft.schema.json');
    await writeFile(schemaPath, JSON.stringify(schema), { mode: 0o600 });
    const args = ['--no-daemon', 'exec', '--ignore-user-config', '--ignore-rules', '--ephemeral',
      '--skip-git-repo-check', '--sandbox', 'read-only', '--model', 'gpt-6.1-terra',
      '--config', 'model_reasoning_effort="medium"', '--config', 'approval_policy="never"',
      '--config', 'web_search="disabled"', '--config', 'tools.view_image=false',
      '--config', 'mcp_servers={}', '--config', 'project_doc_max_bytes=0',
      ...['shell_tool', 'unified_exec', 'shell_snapshot', 'apps', 'plugins', 'remote_plugin',
        'multi_agent', 'browser_use', 'browser_use_external', 'computer_use', 'image_generation',
        'code_mode', 'code_mode_host', 'memories', 'hooks', 'skill_search'].flatMap(feature => ['--disable', feature]),
      '--output-schema', schemaPath, '--color', 'never', '-'];
    // Withhold unrelated service credentials and inherited user configuration.
    const env: NodeJS.ProcessEnv = {};
    for (const key of ['PATH', 'HOME', 'LANG', 'LC_ALL', 'TMPDIR', 'SSL_CERT_FILE', 'SSL_CERT_DIR']) {
      if (process.env[key]) env[key] = process.env[key];
    }
    env.CODEX_HOME = authHome;
    return await new Promise<string>((resolve, reject) => {
      const child = spawn('codex', args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'], detached: true });
      let stdout = '';
      const decoder = new StringDecoder('utf8');
      let bytes = 0;
      let failure: Error | undefined;
      const kill = () => {
        try { if (child.pid) process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL'); } catch { child.kill('SIGKILL'); }
      };
      const abort = () => { failure = new Error('Forge drafting was interrupted.'); kill(); };
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
      const consume = (chunk: Buffer, keep: boolean) => {
        bytes += chunk.length;
        if (bytes > MAX_OUTPUT_BYTES) { failure = new Error('Forge draft exceeded its output budget.'); kill(); }
        else if (keep) stdout += decoder.write(chunk);
      };
      child.stdout.on('data', (chunk: Buffer) => consume(chunk, true));
      // Diagnostics may contain prompts or account details: never return or persist them.
      child.stderr.on('data', (chunk: Buffer) => consume(chunk, false));
      child.stdin.on('error', () => { failure ??= new Error('Forge drafting input failed.'); });
      child.on('error', () => { failure = new Error('Codex is unavailable.'); });
      child.on('close', code => {
        signal.removeEventListener('abort', abort);
        if (failure || code !== 0) reject(failure ?? new Error('Codex could not complete the Forge draft.'));
        else resolve((stdout + decoder.end()).trim());
      });
      child.stdin.end(prompt);
    });
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
};
