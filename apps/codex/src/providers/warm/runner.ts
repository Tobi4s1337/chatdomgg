import { spawn as nodeSpawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { access, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import {
  ForgeUsageLimitError, resolveCodexExecutable, runCodexDraft,
  type CodexDraftCompletion, type CodexDraftFailure, type CodexDraftRun, type CodexDraftRunner,
} from '../codex-cli';
import { AppServerConnection, ConnectionLost, RpcRejected } from './connection';
import {
  DISABLED_FEATURES, QUIET_NOTIFICATIONS, classifyTurnError, readId, readRecord, readUsage, type UserInput,
} from './protocol';

export type WarmCodexState = 'starting' | 'warm' | 'cold' | 'closed';

export type WarmSpawn = (command: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv; detached: true }) => ChildProcessWithoutNullStreams;

export interface WarmCodexRunnerOptions {
  /** Runs any call the warm server cannot take before its turn starts. Defaults to the cold provider. */
  fallback?: CodexDraftRunner;
  /** Parent folder for the private per-server state folders. Defaults to the system temporary folder. */
  stateDirectory?: string;
  /** Turns in flight on the warm server at once; later calls queue. Default 4. */
  maxConcurrent?: number;
  /** Replace the server after this long without calls; 0 disables. Default 20 minutes. */
  idleRestartMs?: number;
  /** First delay before retrying a warm start after a failure; doubles up to `maxRetryDelayMs`. Default 5 s. */
  retryDelayMs?: number;
  /** Default 2 minutes. */
  maxRetryDelayMs?: number;
  /** Process launcher, injectable for tests. */
  spawn?: WarmSpawn;
}

export interface WarmCodexRunner extends CodexDraftRunner {
  (input: CodexDraftRun): Promise<string>;
  /** Stop the server, kill its process group and remove its private state. */
  close(): Promise<void>;
  readonly state: WarmCodexState;
}

const MAX_OUTPUT_BYTES = 256 * 1024;
const START_TIMEOUT_MS = 20_000;
const REQUEST_TIMEOUT_MS = 15_000;
/** How long an interrupted or abandoned turn may take to report completion before the server is replaced. */
const INTERRUPT_GRACE_MS = 10_000;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

const defaultSpawn: WarmSpawn = (command, args, options) => nodeSpawn(command, args, { ...options, stdio: ['pipe', 'pipe', 'pipe'] });

/** Thrown when a call never reached `turn/start`; such a call is not spent and may run cold. */
class NotStarted extends Error {
  constructor() {
    super('The warm Forge server could not take this call.');
    this.name = 'NotStarted';
  }
}

interface TurnListener {
  notification(method: string, params: Record<string, unknown>): void;
}

/** One live `codex app-server` child with its private state folder. */
class WarmServer {
  retired = false;
  private readonly listeners = new Map<string, TurnListener>();

  constructor(readonly root: string, readonly scratch: string, readonly connection: AppServerConnection) {
    connection.onNotification = (method, params) => {
      const fields = readRecord(params);
      const threadId = fields?.threadId;
      if (fields && typeof threadId === 'string') this.listeners.get(threadId)?.notification(method, fields);
    };
  }

  listen(threadId: string, listener: TurnListener): () => void {
    this.listeners.set(threadId, listener);
    return () => { if (this.listeners.get(threadId) === listener) this.listeners.delete(threadId); };
  }

  fail() {
    this.connection.kill();
  }
}

function validImage(image: string | undefined): Buffer | undefined {
  if (image === undefined) return undefined;
  if (!/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(image) || image.length > 4_000_000) throw new Error('A bounded PNG contact sheet is required.');
  const bytes = Buffer.from(image.slice('data:image/png;base64,'.length), 'base64');
  if (!bytes.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error('Invalid PNG evidence.');
  return bytes;
}

function abortError(signal: AbortSignal): unknown {
  return signal.reason ?? new Error('Forge drafting was interrupted.');
}

function untilAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(abortError(signal));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError(signal));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      value => { signal.removeEventListener('abort', onAbort); resolve(value); },
      (error: unknown) => { signal.removeEventListener('abort', onAbort); reject(error); },
    );
  });
}

interface CallTrack {
  failure: CodexDraftFailure;
  interrupted: boolean;
  usage?: CodexDraftCompletion['usage'];
}

async function launch(options: { stateDirectory: string | undefined; spawn: WarmSpawn },
  own: (connection: AppServerConnection, root: string) => void): Promise<WarmServer> {
  const parent = options.stateDirectory ?? tmpdir();
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const root = await mkdtemp(join(parent, 'chatdom-forge-warm-'));
  let connection: AppServerConnection | undefined;
  try {
    const home = join(root, 'home');
    const scratch = join(root, 'scratch');
    await mkdir(home, { mode: 0o700 });
    await mkdir(scratch, { mode: 0o700 });
    // The same read-only auth link the cold provider makes: credentials are never copied or read here.
    try {
      const authPath = join(process.env.CODEX_HOME ?? join(homedir(), '.codex'), 'auth.json');
      await access(authPath);
      await symlink(authPath, join(home, 'auth.json'));
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
    }
    const executable = await resolveCodexExecutable(process.env.PATH);
    if (executable.source === 'missing') throw new Error('Codex is unavailable.');
    const env: NodeJS.ProcessEnv = {};
    for (const key of ['PATH', 'HOME', 'LANG', 'LC_ALL', 'TMPDIR', 'SSL_CERT_FILE', 'SSL_CERT_DIR']) {
      if (process.env[key]) env[key] = process.env[key];
    }
    if (executable.path !== undefined) env.PATH = executable.path;
    // CODEX_HOME holds only the auth link: no user config, rules, skills, memories or connectors exist here.
    env.CODEX_HOME = home;
    // `--no-daemon` keeps this an owned child: it never attaches to or starts a shared background server.
    const args = ['--no-daemon', 'app-server', '--listen', 'stdio://',
      ...DISABLED_FEATURES.flatMap(feature => ['--disable', feature]),
      '--config', 'approval_policy="never"', '--config', 'sandbox_mode="read-only"',
      '--config', 'web_search="disabled"', '--config', 'tools.view_image=false',
      '--config', 'mcp_servers={}', '--config', 'project_doc_max_bytes=0'];
    connection = new AppServerConnection(options.spawn(executable.command, args, { cwd: scratch, env, detached: true }));
    own(connection, root);
    await connection.request('initialize', {
      clientInfo: { name: 'chatdom_forge', title: null, version: '1.0.0' },
      capabilities: { experimentalApi: false, requestAttestation: false, optOutNotificationMethods: QUIET_NOTIFICATIONS },
    }, START_TIMEOUT_MS);
    connection.notify('initialized');
    const server = new WarmServer(root, scratch, connection);
    const removeState = () => { void rm(root, { recursive: true, force: true }).catch(() => undefined); };
    connection.onLost(removeState);
    return server;
  } catch (error) {
    connection?.kill();
    await connection?.exited;
    await rm(root, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

/** One fresh ephemeral thread and exactly one strict-schema turn. */
async function runTurn(server: WarmServer, input: CodexDraftRun, image: Buffer | undefined, track: CallTrack): Promise<string> {
  const { prompt, schema, signal, model = 'gpt-6.1-terra', effort = 'medium' } = input;
  const connection = server.connection;
  const release = connection.hold();
  let dir: string | undefined;
  let threadId: string | undefined;
  try {
    const items: UserInput[] = [{ type: 'text', text: prompt, text_elements: [] }];
    let cwd: string;
    try {
      dir = await mkdtemp(join(server.scratch, 'call-'));
      cwd = join(dir, 'work');
      await mkdir(cwd, { mode: 0o700 });
      if (image) {
        const imagePath = join(dir, 'evidence.png');
        await writeFile(imagePath, image, { mode: 0o600, flag: 'wx' });
        items.push({ type: 'localImage', path: imagePath });
      }
    } catch {
      // The private scratch area is gone (for example the server was just replaced); nothing was sent.
      throw new NotStarted();
    }
    if (signal.aborted) { track.interrupted = true; signal.throwIfAborted(); }

    let started: unknown;
    try {
      started = await connection.request('thread/start', {
        model, cwd, ephemeral: true, sandbox: 'read-only', approvalPolicy: 'never',
        config: { model_reasoning_effort: effort },
      }, REQUEST_TIMEOUT_MS);
    } catch (error) {
      // A declined request leaves a healthy server; a hang or loss means the server is broken.
      if (!(error instanceof RpcRejected)) server.fail();
      throw new NotStarted();
    }
    threadId = readId(started, 'thread');
    if (!threadId) { server.fail(); throw new NotStarted(); }
    if (signal.aborted) { track.interrupted = true; signal.throwIfAborted(); }

    const thread = threadId;
    return await new Promise<string>((resolve, reject) => {
      let turnId: string | undefined;
      let finalText: string | undefined;
      let lastText: string | undefined;
      let outputBytes = 0;
      let lastError: unknown;
      let failure: Error | undefined;
      let interruptSent = false;
      let grace: ReturnType<typeof setTimeout> | undefined;
      let settled = false;
      let unlisten: () => void = () => undefined;
      let unlost: () => void = () => undefined;

      const settle = (action: () => void) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener('abort', onAbort);
        if (grace) clearTimeout(grace);
        unlisten();
        unlost();
        action();
      };
      const interrupt = () => {
        if (interruptSent || !turnId) return;
        interruptSent = true;
        connection.request('turn/interrupt', { threadId: thread, turnId }, REQUEST_TIMEOUT_MS).catch(() => undefined);
      };
      // Stop the turn and wait for the server to confirm; a server that never confirms is replaced.
      const stop = (error: Error) => {
        failure ??= error;
        interrupt();
        grace ??= setTimeout(() => server.fail(), INTERRUPT_GRACE_MS);
      };
      const onAbort = () => {
        track.interrupted = true;
        stop(new Error('Forge drafting was interrupted.'));
      };
      const learnTurn = (id: string | undefined) => {
        if (turnId || !id) return;
        turnId = id;
        if (failure) interrupt();
      };

      unlisten = server.listen(thread, {
        notification(method, params) {
          if (turnId && typeof params.turnId === 'string' && params.turnId !== turnId) return;
          switch (method) {
            case 'turn/started':
              learnTurn(readId(params, 'turn'));
              break;
            case 'item/completed': {
              const item = readRecord(params.item);
              if (item?.type !== 'agentMessage' || typeof item.text !== 'string') break;
              outputBytes += Buffer.byteLength(item.text);
              if (outputBytes > MAX_OUTPUT_BYTES) {
                track.failure = 'output-budget';
                stop(new Error('Forge draft exceeded its output budget.'));
                break;
              }
              lastText = item.text;
              if (item.phase === 'final_answer') finalText = item.text;
              break;
            }
            case 'thread/tokenUsage/updated':
              track.usage = readUsage(params) ?? track.usage;
              break;
            case 'error': {
              const classified = classifyTurnError(params.error);
              if (classified.usageLimit) stop(new ForgeUsageLimitError());
              else if (params.willRetry !== true) lastError = params.error;
              break;
            }
            case 'turn/completed': {
              const turn = readRecord(params.turn);
              if (turnId && turn?.id !== turnId) break;
              settle(() => {
                if (failure) { reject(failure); return; }
                if (turn?.status === 'completed') {
                  const text = finalText ?? lastText;
                  if (text === undefined) { track.failure = 'unknown'; reject(new Error('Codex could not complete the Forge draft.')); }
                  else resolve(text.trim());
                  return;
                }
                const classified = classifyTurnError(turn?.error ?? lastError);
                if (classified.usageLimit) { reject(new ForgeUsageLimitError()); return; }
                track.failure = classified.failure;
                reject(new Error('Codex could not complete the Forge draft.'));
              });
              break;
            }
          }
        },
      });
      // The turn request is on the wire: from here the call is spent, whatever happens to the server.
      unlost = connection.onLost(() => settle(() => {
        if (!failure) track.failure = 'transport';
        reject(failure ?? new Error('The Forge drafting connection was lost.'));
      }));
      if (connection.lost) { settle(() => reject(new NotStarted())); return; }
      signal.addEventListener('abort', onAbort, { once: true });
      connection.request('turn/start', {
        threadId: thread, input: items, outputSchema: schema, model, effort,
        approvalPolicy: 'never', sandboxPolicy: { type: 'readOnly', networkAccess: false },
      }).then(
        response => learnTurn(readId(response, 'turn')),
        (error: unknown) => {
          // Only an explicit refusal proves no turn exists; a lost connection is handled above.
          if (error instanceof RpcRejected) settle(() => reject(new NotStarted()));
        },
      );
      if (signal.aborted) onAbort();
    });
  } finally {
    if (threadId && !connection.lost) {
      // Ephemeral threads cannot be deleted; unsubscribing lets the server unload them.
      connection.request('thread/unsubscribe', { threadId }, REQUEST_TIMEOUT_MS).catch(() => undefined);
    }
    release();
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/**
 * A drop-in Forge draft runner backed by one owned, long-lived `codex app-server` child. Each call is a
 * fresh ephemeral thread with one turn; no history is shared between calls. Calls the warm server cannot
 * take before their turn starts run through the fallback runner instead.
 */
export function createWarmCodexRunner(options: WarmCodexRunnerOptions = {}): WarmCodexRunner {
  const fallback = options.fallback ?? runCodexDraft;
  const spawn = options.spawn ?? defaultSpawn;
  const maxConcurrent = Math.max(1, Math.min(16, Math.floor(options.maxConcurrent ?? 4)));
  const idleRestartMs = Math.max(0, options.idleRestartMs ?? 20 * 60_000);
  const retryInitial = Math.max(1, options.retryDelayMs ?? 5_000);
  const retryMax = Math.max(retryInitial, options.maxRetryDelayMs ?? 120_000);

  let state: WarmCodexState = 'starting';
  let live: WarmServer | undefined;
  let starting: Promise<WarmServer | undefined> | undefined;
  let retryDelay = retryInitial;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let active = 0;
  const waiting: Array<() => void> = [];
  /** Every child this runner spawned, until it has exited and its state folder is gone. */
  const owned = new Map<AppServerConnection, string>();
  const own = (connection: AppServerConnection, root: string) => {
    owned.set(connection, root);
    void connection.exited.then(() => owned.delete(connection));
  };

  // A function, so checks after an await see the current state rather than a narrowed one.
  const closed = () => state === 'closed';
  const clearIdle = () => { if (idleTimer) { clearTimeout(idleTimer); idleTimer = undefined; } };

  const goCold = () => {
    if (state === 'closed') return;
    state = 'cold';
    live = undefined;
    clearIdle();
    if (retryTimer) return;
    const delay = retryDelay;
    retryDelay = Math.min(retryDelay * 2, retryMax);
    retryTimer = setTimeout(() => { retryTimer = undefined; void start(); }, delay);
    retryTimer.unref();
  };

  const armIdle = () => {
    clearIdle();
    if (!idleRestartMs || state !== 'warm' || active > 0 || waiting.length) return;
    idleTimer = setTimeout(() => {
      idleTimer = undefined;
      const server = live;
      if (!server || state !== 'warm' || active > 0 || waiting.length) return;
      server.retired = true;
      live = undefined;
      server.fail();
      void start();
    }, idleRestartMs);
    idleTimer.unref();
  };

  function start(): Promise<WarmServer | undefined> {
    if (state === 'closed') return Promise.resolve(undefined);
    if (starting) return starting;
    state = 'starting';
    const attempt = launch({ stateDirectory: options.stateDirectory, spawn }, own).then(
      server => {
        server.connection.onLost(() => {
          if (live === server) {
            live = undefined;
            if (!server.retired) goCold();
          }
        });
        if (state === 'closed') { server.fail(); return undefined; }
        if (server.connection.lost) { goCold(); return undefined; }
        live = server;
        state = 'warm';
        retryDelay = retryInitial;
        armIdle();
        return server;
      },
      () => { goCold(); return undefined; },
    ).finally(() => { if (starting === attempt) starting = undefined; });
    starting = attempt;
    return attempt;
  }

  async function ready(signal: AbortSignal): Promise<WarmServer | undefined> {
    if (state === 'warm' && live && !live.connection.lost) return live;
    if (state === 'starting' && starting) return untilAborted(starting, signal);
    return undefined;
  }

  function acquire(signal: AbortSignal): Promise<void> {
    clearIdle();
    if (active < maxConcurrent) { active++; return Promise.resolve(); }
    return new Promise<void>((resolve, reject) => {
      const take = () => { signal.removeEventListener('abort', onAbort); active++; resolve(); };
      const onAbort = () => {
        const index = waiting.indexOf(take);
        if (index >= 0) waiting.splice(index, 1);
        reject(abortError(signal));
      };
      waiting.push(take);
      signal.addEventListener('abort', onAbort, { once: true });
    });
  }

  function releaseSlot() {
    active--;
    const next = waiting.shift();
    if (next) next();
    else if (active === 0) armIdle();
  }

  const run = async (input: CodexDraftRun): Promise<string> => {
    const started = performance.now();
    const model = input.model ?? 'gpt-6.1-terra';
    const effort = input.effort ?? 'medium';
    const track: CallTrack = { failure: 'unknown', interrupted: input.signal.aborted };
    let outcome: CodexDraftCompletion['outcome'] = 'failed';
    let delegated = false;
    try {
      if (state === 'closed') { track.failure = 'spawn'; throw new Error('Codex is unavailable.'); }
      input.signal.throwIfAborted();
      const image = validImage(input.image);
      if (await ready(input.signal)) {
        await acquire(input.signal);
        try {
          // The server may have been replaced while this call waited for a slot.
          const server = state === 'warm' && live && !live.connection.lost ? live : undefined;
          if (server) {
            const result = await runTurn(server, { ...input, model, effort }, image, track);
            outcome = 'complete';
            return result;
          }
        } catch (error) {
          if (!(error instanceof NotStarted)) throw error;
        } finally {
          releaseSlot();
        }
      }
      if (closed()) { track.failure = 'spawn'; throw new Error('Codex is unavailable.'); }
      input.signal.throwIfAborted();
      delegated = true;
      const before = performance.now() - started;
      const onComplete = input.onComplete;
      return await fallback({
        ...input,
        ...(onComplete ? { onComplete: (completion: CodexDraftCompletion) => onComplete({ ...completion, elapsedMs: completion.elapsedMs + before }) } : {}),
      });
    } catch (error) {
      if (!delegated) {
        if (input.signal.aborted) track.interrupted = true;
        outcome = error instanceof ForgeUsageLimitError ? 'usage-limit' : track.interrupted ? 'canceled' : 'failed';
        if (error instanceof ConnectionLost) track.failure = 'transport';
      }
      throw error;
    } finally {
      if (!delegated) {
        const elapsedMs = performance.now() - started;
        try {
          input.onComplete?.({ model, effort, elapsedMs: Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0,
            outcome, ...(outcome === 'failed' ? { failure: track.failure } : {}), ...(track.usage ? { usage: track.usage } : {}) });
        } catch { /* Accounting must never change the provider result. */ }
      }
    }
  };

  const runner = run as WarmCodexRunner;
  Object.defineProperty(runner, 'state', { get: () => state, enumerable: true });
  Object.defineProperty(runner, 'close', {
    value: async () => {
      if (state === 'closed') return;
      state = 'closed';
      if (retryTimer) clearTimeout(retryTimer);
      clearIdle();
      live = undefined;
      const children = new Map(owned);
      for (const [connection] of children) connection.kill();
      // A start already under way finishes (or fails) first, so its child is in the final sweep too.
      await starting;
      for (const [connection, root] of owned) children.set(connection, root);
      await Promise.all([...children].map(async ([connection, root]) => {
        connection.kill();
        await connection.exited;
        await rm(root, { recursive: true, force: true }).catch(() => undefined);
      }));
    },
  });
  void start();
  return runner;
}
