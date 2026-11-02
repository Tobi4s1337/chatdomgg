import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { constants } from 'node:fs';
import { access, mkdir, mkdtemp, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { delimiter, dirname, isAbsolute, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { StringDecoder } from 'node:string_decoder';

export type CodexDraftFailure = 'configuration' | 'authentication' | 'model-unavailable' | 'transport' | 'spawn' | 'output-budget' | 'unknown';

export interface CodexDraftCompletion {
  model: NonNullable<CodexDraftRun['model']>;
  effort: NonNullable<CodexDraftRun['effort']>;
  elapsedMs: number;
  outcome: 'complete' | 'failed' | 'canceled' | 'usage-limit';
  /** Present only for a failed run; raw diagnostics never leave the transport. */
  failure?: CodexDraftFailure;
  usage?: { totalTokens?: number; inputTokens?: number; outputTokens?: number };
}

export interface CodexDraftRun {
  prompt: string;
  schema: Record<string, unknown>;
  signal: AbortSignal;
  model?: 'gpt-6-luna' | 'gpt-6.1-terra';
  effort?: 'low' | 'medium' | 'high';
  /** Inline evidence, never an arbitrary caller-supplied filesystem path. */
  image?: string;
  /** Private numeric accounting only; never receives model content or diagnostics. */
  onComplete?: (completion: CodexDraftCompletion) => void;
}
export type CodexDraftRunner = (input: CodexDraftRun) => Promise<string>;

const MAX_OUTPUT_BYTES = 256 * 1024;
const MAX_DIAGNOSTIC_CHARS = 16 * 1024;

export interface CodexExecutable {
  command: string;
  path: string | undefined;
  source: 'path' | 'node-adjacent' | 'missing';
}

/** Resolve without shell lookup, relative PATH entries, or global environment changes. */
export async function resolveCodexExecutable(pathValue: string | undefined, nodeExecutable = process.execPath): Promise<CodexExecutable> {
  const executable = async (candidate: string) => {
    try {
      await access(candidate, constants.X_OK);
      return (await stat(candidate)).isFile();
    } catch {
      return false;
    }
  };
  for (const directory of pathValue?.split(delimiter) ?? []) {
    if (!isAbsolute(directory)) continue;
    const command = join(directory, 'codex');
    if (await executable(command)) return { command, path: pathValue, source: 'path' };
  }
  if (isAbsolute(nodeExecutable)) {
    const nodeBin = dirname(nodeExecutable);
    const command = join(nodeBin, 'codex');
    if (await executable(command)) {
      return { command, path: `${nodeBin}${pathValue === undefined ? '' : `${delimiter}${pathValue}`}`, source: 'node-adjacent' };
    }
  }
  return { command: 'codex', path: pathValue, source: 'missing' };
}

export class ForgeUsageLimitError extends Error {
  readonly code = 'FORGE_USAGE_LIMIT';

  constructor() {
    super('The Forge is waiting for its Codex usage limit to reset.');
    this.name = 'ForgeUsageLimitError';
  }
}

function hasUsageLimit(diagnostics: string): boolean {
  return /(?:^|\n)[ \t]*(?:ERROR:[ \t]*)?(?:you(?:'ve| have) (?:hit|reached) your usage limit|(?:usage|rate) limit (?:reached|exceeded)|too many requests)(?:\b|[.!])/i.test(diagnostics)
    || /(?:^|\n)[^\n]*\bERROR\b[^\n]*(?:\b429\b[^\n]*too many requests|\b(?:usage_limit_reached|rate_limit_exceeded|rate_limit_reached)\b)/i.test(diagnostics);
}

function reportedFailure(diagnostics: string): CodexDraftFailure | undefined {
  const errors = diagnostics.split(/\r?\n/).filter(line =>
    /^(?:[ \t]*(?:error|fatal)\b[: \t]|\d{4}-\d{2}-\d{2}T\S+[ \t]+ERROR\b)/i.test(line)).join('\n');
  if (/\b(?:config(?:uration)?|toml|overrides|unexpected argument|unrecognized option|unknown (?:option|argument|feature|field|variant)|unsupported (?:flag|option|feature)|invalid (?:value|type))\b/i.test(errors)) return 'configuration';
  if (/\b(?:authentication|unauthorized|unauthenticated|not logged in|login required|please (?:log|sign) in|invalid (?:access |refresh )?token|token (?:refresh|expired)|refresh(?:ing)? (?:the )?(?:access |auth(?:entication)? )?token|api key|401)\b/i.test(errors)) return 'authentication';
  if (/\bmodel\b[^\n]*\b(?:unavailable|not (?:found|supported|available)|does not exist|unsupported|not have access)\b|\b(?:unsupported|unknown) model\b|\bmodel_not_found\b/i.test(errors)) return 'model-unavailable';
  if (/\b(?:network|connection|dns|timed? out|timeout|tls|ssl|certificate|stream disconnected|request failed|failed to (?:send|connect)|error sending request|ECONNRESET|ECONNREFUSED|ENOTFOUND|ETIMEDOUT)\b|\bstatus[ :]+5\d{2}\b/i.test(errors)) return 'transport';
  return undefined;
}

function reportedUsage(diagnostics: string): CodexDraftCompletion['usage'] {
  const usage: NonNullable<CodexDraftCompletion['usage']> = {};
  const labels = { 'tokens used': 'totalTokens', 'total tokens': 'totalTokens', 'input tokens': 'inputTokens', 'output tokens': 'outputTokens' } as const;
  const tokens = /(?:^|\n)[ \t]*(tokens used|total tokens|input tokens|output tokens)[ \t]*(?::[ \t]*|\r?\n[ \t]*)(\d{1,3}(?:,\d{3})+|\d+)[ \t]*(?=\r?$)/gim;
  for (const match of diagnostics.matchAll(tokens)) {
    const value = Number(match[2]!.replaceAll(',', ''));
    if (Number.isSafeInteger(value) && value >= 0) usage[labels[match[1]!.toLowerCase() as keyof typeof labels]] = value;
  }
  return Object.keys(usage).length ? usage : undefined;
}

/** No shell is involved. The model receives no local filesystem or connector tools. */
export const runCodexDraft: CodexDraftRunner = async ({ prompt, schema, signal, model = 'gpt-6.1-terra', effort = 'medium', image, onComplete }) => {
  const started = performance.now();
  let outcome: CodexDraftCompletion['outcome'] = 'failed';
  let usage: CodexDraftCompletion['usage'];
  let failureCategory: CodexDraftFailure = 'unknown';
  let interrupted = signal.aborted;
  try {
    signal.throwIfAborted();
    const scratch = await mkdtemp(join(tmpdir(), 'chatdom-forge-'));
    const cwd = join(scratch, 'work');
    let result: string;
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
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
          failureCategory = 'authentication';
          throw new Error('Codex authentication is unavailable.', { cause: error });
        }
      }
      const schemaPath = join(cwd, 'draft.schema.json');
      await writeFile(schemaPath, JSON.stringify(schema), { mode: 0o600 });
      const imageArgs: string[] = [];
      if (image !== undefined) {
        if (!/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(image) || image.length > 4_000_000) throw new Error('A bounded PNG contact sheet is required.');
        const bytes = Buffer.from(image.slice('data:image/png;base64,'.length), 'base64');
        if (!bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error('Invalid PNG evidence.');
        const imagePath = join(cwd, 'evidence.png');
        await writeFile(imagePath, bytes, { mode: 0o600 });
        imageArgs.push('--image', imagePath);
      }
      const args = ['--no-daemon', 'exec', '--ignore-user-config', '--ignore-rules', '--ephemeral',
        '--skip-git-repo-check', '--sandbox', 'read-only', '--model', model,
        '--config', `model_reasoning_effort="${effort}"`, '--config', 'approval_policy="never"',
        '--config', 'web_search="disabled"', '--config', 'tools.view_image=false',
        '--config', 'mcp_servers={}', '--config', 'project_doc_max_bytes=0',
        ...['shell_tool', 'unified_exec', 'shell_snapshot', 'apps', 'plugins', 'remote_plugin',
          'multi_agent', 'browser_use', 'browser_use_external', 'computer_use', 'image_generation',
          'code_mode', 'code_mode_host', 'memories', 'hooks', 'skill_search'].flatMap(feature => ['--disable', feature]),
        ...imageArgs, '--output-schema', schemaPath, '--color', 'never', '-'];
      // Withhold unrelated service credentials and inherited user configuration.
      const env: NodeJS.ProcessEnv = {};
      for (const key of ['PATH', 'HOME', 'LANG', 'LC_ALL', 'TMPDIR', 'SSL_CERT_FILE', 'SSL_CERT_DIR']) {
        if (process.env[key]) env[key] = process.env[key];
      }
      env.CODEX_HOME = authHome;
      const executable = await resolveCodexExecutable(process.env.PATH);
      if (signal.aborted) { interrupted = true; signal.throwIfAborted(); }
      if (executable.source === 'missing') {
        failureCategory = 'spawn';
        throw new Error('Codex is unavailable.');
      }
      if (executable.path !== undefined) env.PATH = executable.path;
      result = await new Promise<string>((resolve, reject) => {
        let child: ChildProcessWithoutNullStreams;
        try {
          child = spawn(executable.command, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'], detached: true });
        } catch {
          failureCategory = 'spawn';
          reject(new Error('Codex is unavailable.'));
          return;
        }
        let stdout = '';
        const decoder = new StringDecoder('utf8');
        const diagnosticDecoder = new StringDecoder('utf8');
        let diagnostics = '';
        let bytes = 0;
        let failure: Error | undefined;
        const kill = () => {
          try { if (child.pid) process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL'); } catch {
            try { child.kill('SIGKILL'); } catch { /* The child may already have exited. */ }
          }
        };
        const abort = () => {
          if (!failure) { interrupted = true; failure = new Error('Forge drafting was interrupted.'); }
          kill();
        };
        const consume = (chunk: Buffer, keep: boolean) => {
          if (failure) return;
          bytes += chunk.length;
          if (bytes > MAX_OUTPUT_BYTES) { failureCategory = 'output-budget'; failure = new Error('Forge draft exceeded its output budget.'); kill(); }
          else if (keep) stdout += decoder.write(chunk);
          else {
            const received = diagnostics + diagnosticDecoder.write(chunk);
            failureCategory = reportedFailure(received) ?? failureCategory;
            usage = { ...usage, ...reportedUsage(received.slice(0, received.lastIndexOf('\n') + 1)) };
            if (!Object.keys(usage).length) usage = undefined;
            diagnostics = received.slice(-MAX_DIAGNOSTIC_CHARS);
            if (hasUsageLimit(received)) { failure = new ForgeUsageLimitError(); kill(); }
          }
        };
        child.stdout.on('data', (chunk: Buffer) => consume(chunk, true));
        // Diagnostics may contain prompts or account details: never return or persist them.
        child.stderr.on('data', (chunk: Buffer) => consume(chunk, false));
        child.stdin.on('error', () => {
          if (!failure) { failureCategory = 'transport'; failure = new Error('Forge drafting input failed.'); }
          kill();
        });
        child.on('error', () => {
          if (!failure) { failureCategory = 'spawn'; failure = new Error('Codex is unavailable.'); }
        });
        child.on('close', code => {
          signal.removeEventListener('abort', abort);
          usage = { ...usage, ...reportedUsage(diagnostics + diagnosticDecoder.end()) };
          if (!Object.keys(usage).length) usage = undefined;
          if (failure || code !== 0) reject(failure ?? new Error('Codex could not complete the Forge draft.'));
          else resolve((stdout + decoder.end()).trim());
        });
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) abort();
        else child.stdin.end(prompt);
      });
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
    outcome = 'complete';
    return result;
  } catch (error) {
    outcome = error instanceof ForgeUsageLimitError ? 'usage-limit' : interrupted ? 'canceled' : 'failed';
    throw error;
  } finally {
    const elapsedMs = performance.now() - started;
    try {
      onComplete?.({ model, effort, elapsedMs: Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0,
        outcome, ...(outcome === 'failed' ? { failure: failureCategory } : {}), ...(usage ? { usage } : {}) });
    } catch { /* Accounting must never change the provider result. */ }
  }
};
