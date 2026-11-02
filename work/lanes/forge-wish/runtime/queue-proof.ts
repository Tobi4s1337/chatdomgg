import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { clearTimeout } from 'node:timers';
import { FileForgeWishQueue, ForgeWishQueueError,
  type ForgeWishReceipt, type ForgeWishStage } from '../../../../apps/codex/src/wish-queue';
import { WORLD_FIXTURE_KINGDOM, WORLD_FIXTURE_PERSON } from '../../../../packages/shared/src/world-fixtures';

// Authored fixture words, never loaded from real wishes or written to the public evidence report.
const privateWords = 'A copper moon lantern with a little blue star, beside my door.';
const privateCheckpoint = 'private-recovery-snapshot-sentinel';
const stages = ['arrival', 'words', 'drafting', 'result', 'commit'] as const;
const scenarios = [
  ...stages.map(stage => ({ stage, pendingCall: false })),
  ...(['words', 'drafting', 'result'] as const).map(stage => ({ stage, pendingCall: true })),
];
type Exit = { code: number | null; signal: NodeJS.Signals | null };
const active = new Map<ChildProcess, Promise<Exit>>();
let canceled = false;
const check = () => { if (canceled) throw new Error('The recovery proof was interrupted.'); };
interface Ready { readonly kind: 'ready'; readonly receipt: ForgeWishReceipt }

function send(message: unknown): void { if (process.send) process.send(message); }

async function occupant(directory: string, stage: ForgeWishStage, pendingCall: boolean): Promise<void> {
  const queue = await FileForgeWishQueue.open({ directory, origin: 'simulated', maxConcurrent: 2 });
  const arrival = await queue.enqueue({ kingdomId: WORLD_FIXTURE_KINGDOM, personId: WORLD_FIXTURE_PERSON,
    messageId: 'authored-process-recovery-fixture', slot: 7, observedAt: 1_793_570_000_000, words: privateWords });
  if (stage === 'arrival') send({ kind: 'ready', receipt: arrival.receipt });
  else {
    const claim = await queue.claimNext(); assert(claim);
    for (const current of ['words', 'drafting', 'result'] as const) {
      await queue.beginModelCall(claim, current);
      if (current === stage && pendingCall) {
        send({ kind: 'ready', receipt: await queue.get(claim.receipt.key) }); break;
      }
      const receipt = await queue.checkpoint(claim, { id: `${current}-complete`, stage: current,
        data: { privateCheckpoint, stage: current } });
      if (current === stage) { send({ kind: 'ready', receipt }); break; }
    }
    if (stage === 'commit') send({ kind: 'ready', receipt: await queue.checkpoint(claim,
      { id: 'commit-request', stage: 'commit', data: { privateCheckpoint, exactRequestSaved: true } }) });
  }
  // The parent kills this process; do not gracefully close/requeue, which would disguise crash recovery.
  process.on('message', () => {});
  process.on('disconnect', () => { void queue.close().finally(() => process.exit(1)); });
}

async function contender(directory: string): Promise<void> {
  try {
    const queue = await FileForgeWishQueue.open({ directory, origin: 'simulated' });
    await queue.close(); send({ kind: 'unexpected-owner' }); process.exitCode = 1;
  } catch (error) {
    if (!(error instanceof ForgeWishQueueError) || error.code !== 'busy') {
      // Child diagnostics may contain private operands; only this finite classification crosses the boundary.
      // eslint-disable-next-line preserve-caught-error
      throw new Error('Unexpected queue contention result.');
    }
    send({ kind: 'busy' });
  }
  process.disconnect?.();
}

function start(args: readonly string[]): { child: ChildProcess; message: Promise<unknown>; closed: Promise<Exit> } {
  check();
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), ...args], {
    env: process.env, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  // Child diagnostics are intentionally discarded, including assertion operands and private paths/words.
  child.stdout?.resume(); child.stderr?.resume();
  const closed = new Promise<Exit>((resolve, reject) => {
    child.once('error', () => { active.delete(child); reject(new Error('The recovery proof child could not start.')); });
    child.once('close', (code, signal) => { active.delete(child); resolve({ code, signal }); });
  });
  active.set(child, closed);
  const message = new Promise<unknown>((resolve, reject) => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('The recovery proof child did not reach its barrier.')); }, 15_000);
    child.once('message', value => { clearTimeout(timer); resolve(value); });
    void closed.then(() => { clearTimeout(timer); reject(new Error('The recovery proof child ended before its barrier.')); }, reject);
  });
  return { child, message, closed };
}

async function reopen(directory: string): Promise<FileForgeWishQueue> {
  // The killed process is confirmed terminal before this call. A still-busy lock may only be retried;
  // never steal a live owner's lock or delete its inode.
  const until = performance.now() + 5_000;
  while (true) {
    check();
    try { return await FileForgeWishQueue.open({ directory, origin: 'simulated' }); }
    catch (error) {
      if (!(error instanceof ForgeWishQueueError) || error.code !== 'busy' || performance.now() >= until) throw error;
      await new Promise<void>(resolve => setTimeout(resolve, 20));
    }
  }
}

async function inspect(directory: string, terminal: boolean): Promise<void> {
  const walk = async (path: string): Promise<void> => {
    check();
    const info = await stat(path);
    if (info.isDirectory()) {
      assert.equal(info.mode & 0o777, 0o700);
      for (const child of await readdir(path)) await walk(join(path, child));
    } else {
      assert.equal(info.mode & 0o777, 0o600);
      const bytes = await readFile(path);
      if (terminal) {
        assert(!bytes.includes(Buffer.from(privateWords)));
        assert(!bytes.includes(Buffer.from(privateCheckpoint)));
      }
    }
  };
  await walk(directory);
}

async function proveCore(): Promise<void> {
  const root = '/tmp/chatdom-forge-wish'; await mkdir(root, { recursive: true, mode: 0o700 });
  const directory = await mkdtemp(join(root, 'queue-process-'));
  const results: unknown[] = [];
  for (const { stage, pendingCall } of scenarios) {
    check();
    const path = join(directory, `${stage}-${pendingCall ? 'pending' : 'complete'}`);
    const worker = start(['occupant', path, stage, pendingCall ? 'pending' : 'complete']);
    const ready = await worker.message as Ready;
    assert.equal(ready.kind, 'ready');
    assert.equal(ready.receipt.stage, stage);
    const duplicate = start(['contender', path]);
    assert.deepEqual(await duplicate.message, { kind: 'busy' });
    assert.deepEqual(await duplicate.closed, { code: 0, signal: null });
    await inspect(path, false);
    assert(worker.child.kill('SIGKILL'));
    assert.deepEqual(await worker.closed, { code: null, signal: 'SIGKILL' });
    const queue = await reopen(path);
    try {
      const stored = await queue.get(ready.receipt.key); assert(stored);
      const claim = await queue.claimNext(); assert(claim);
      assert.equal(claim.receipt.key, ready.receipt.key);
      assert.equal(claim.attempt.attemptId, ready.receipt.attemptId);
      assert.equal(claim.receipt.stage, stage);
      assert.equal(claim.receipt.modelCalls, ready.receipt.modelCalls);
      assert.equal(claim.command.words, privateWords);
      const expectedCalls = stage === 'arrival' ? 0 : stage === 'words' ? 1 : stage === 'drafting' ? 2 : 3;
      assert.equal(claim.receipt.modelCalls, expectedCalls);
      assert.equal(claim.checkpoints.length, expectedCalls + Number(stage === 'commit') - Number(pendingCall));
      for (const checkpoint of claim.checkpoints) {
        assert.equal((checkpoint.data as { privateCheckpoint: string }).privateCheckpoint, privateCheckpoint);
      }
      check(); await queue.finish(claim, { kind: 'held' });
      assert.equal(claim.current(), false); assert.equal(claim.signal.aborted, true);
      const terminal = await queue.get(ready.receipt.key); assert.equal(terminal?.state, 'finished');
      assert.deepEqual(terminal?.outcome, { kind: 'held' });
      assert.equal(await queue.claimNext(), null);
      await inspect(path, true);
      results.push({ stage, pendingCall, termination: 'SIGKILL', stableAttempt: true, stablePayload: true,
        durableDebits: expectedCalls, checkpoints: claim.checkpoints.length, liveContenderRejected: true,
        terminalWordsErased: true, privateModes: true });
    } finally { await queue.close(); }
  }
  const report = { version: 1, scope: 'private-file-queue-core', ok: true, scenarios: results,
    modelCalls: 0, providerCalls: 0, ports: [],
    limits: ['No served realm or Forge restart exercised.', 'No authority, coal, outbox or private delivery exercised.',
      'Stage snapshots and durable debits are controlled fixtures, not model outputs.', 'No warm worker or latency proof.'] };
  check(); await writeFile(join(directory, 'summary.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  const evidence = resolve('work/evidence/forge-wish/fw11-queue-process.json');
  check();
  await writeFile(evidence, JSON.stringify(report, null, 2) + '\n');
  check();
  process.stdout.write(JSON.stringify({ ok: true, scenarios: results.length, evidence, privateDirectory: directory }) + '\n');
}

async function prove(): Promise<void> {
  try { await proveCore(); }
  finally {
    const closing = [...active.values()];
    for (const child of active.keys()) child.kill('SIGKILL');
    await Promise.allSettled(closing);
  }
}

const shutdown = () => { canceled = true; for (const child of active.keys()) child.kill('SIGKILL'); };
process.once('SIGTERM', () => { shutdown(); process.exitCode = 1; });
process.once('SIGINT', () => { shutdown(); process.exitCode = 1; });
try {
  const [mode, directory, stage, state] = process.argv.slice(2);
  if (mode === 'occupant' && directory && stages.includes(stage as ForgeWishStage)) await occupant(directory, stage as ForgeWishStage, state === 'pending');
  else if (mode === 'contender' && directory) await contender(directory);
  else if (mode === undefined) await prove();
  else throw new Error('Invalid recovery proof mode.');
} catch {
  shutdown(); process.stderr.write('The private queue recovery proof failed; no private diagnostics were exported.\n'); process.exitCode = 1;
}
