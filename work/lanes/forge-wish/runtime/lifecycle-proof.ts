import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { chmod, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { KingdomIdSchema, PersonIdSchema } from '../../../../packages/shared/src';
import type { KingdomForgeCommand } from '../../../../packages/shared/src/realm';
import { FileForgeWishQueue, ForgeWishQueueError, type ForgeWishWithdrawal } from '../../../../apps/codex/src/wish-queue';
import { PrivateWishFiles } from '../../../../apps/codex/src/wish-queue/files';

// These are lane-authored fixtures. Child diagnostics and fixture values never enter the evidence file.
const words = 'A brass star above a small blue lantern.';
const checkpoint = 'private-lifecycle-checkpoint-sentinel';
const kingdomId = KingdomIdSchema.parse('930001'), personId = PersonIdSchema.parse('930002');
const command = (messageId: string, observedAt: number): KingdomForgeCommand => ({
  kingdomId, personId, messageId, observedAt, slot: 7, words,
});
const cases = ['message', 'person', 'kingdom', 'completion', 'acknowledgement'] as const;
type Case = typeof cases[number];
type Exit = { code: number | null; signal: NodeJS.Signals | null };
type Barrier = { kind: 'ready'; key?: string; attemptId?: string };
const active = new Map<ChildProcess, Promise<Exit>>();
let canceled = false;
const check = () => { if (canceled) throw new Error('The lifecycle proof was interrupted.'); };

function withdrawal(which: Case): ForgeWishWithdrawal {
  if (which === 'message') return { kingdomId, reason: 'deleted', scope: { kind: 'message', messageId: 'authored-old' } };
  if (which === 'person') return { kingdomId, reason: 'moderated', scope: { kind: 'person', personId, through: 300 } };
  return { kingdomId, reason: 'coverage', scope: { kind: 'kingdom', through: 300 } };
}
function send(barrier: Barrier) { process.send?.(barrier); }

async function occupant(directory: string, which: Case) {
  const queue = await FileForgeWishQueue.open({ directory, origin: 'simulated' });
  // Keep the IPC channel alive until the supervisor performs the deliberate kill.
  process.on('message', () => {});
  if (which === 'message' || which === 'person' || which === 'kingdom') {
    await queue.withdraw(withdrawal(which));
    send({ kind: 'ready' });
    // The supervisor must kill an owner which did not gracefully release its filesystem lock.
    return;
  }
  const input = command('authored-complete', 100);
  const admitted = await queue.enqueue(input), claim = await queue.claimNext(); assert(claim);
  await queue.checkpoint(claim, { id: 'private-evidence', stage: 'words', data: { checkpoint } });
  if (which === 'acknowledgement') {
    const completed = await queue.complete(claim, { terminal: { kind: 'held' }, message: 'Your coal stays yours.' });
    assert(completed.delivery);
    const original = PrivateWishFiles.prototype.write;
    PrivateWishFiles.prototype.write = async function (name, bytes) {
      await original.call(this, name, bytes);
      send({ kind: 'ready', key: admitted.receipt.key, attemptId: admitted.receipt.attemptId });
      await new Promise<void>(() => {});
    };
    await queue.acknowledgeOwner(kingdomId, personId, { key: completed.key, attemptId: completed.attemptId,
      replyId: completed.delivery.replyId });
  } else {
    const original = PrivateWishFiles.prototype.write;
    PrivateWishFiles.prototype.write = async function (name, bytes) {
      await original.call(this, name, bytes);
      send({ kind: 'ready', key: admitted.receipt.key, attemptId: admitted.receipt.attemptId });
      await new Promise<void>(() => {});
    };
    await queue.complete(claim, { terminal: { kind: 'held' }, message: 'Your coal stays yours.' });
  }
  throw new Error('The process was not stopped at the durable-write barrier.');
}

function start(directory: string, which: Case) {
  check();
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), 'occupant', directory, which], {
    env: process.env, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  // Assertion operands and paths may be private; never relay child diagnostics.
  child.stdout?.resume(); child.stderr?.resume();
  const closed = new Promise<Exit>((done, reject) => {
    child.once('error', () => { active.delete(child); reject(new Error('The lifecycle child could not start.')); });
    child.once('close', (code, signal) => { active.delete(child); done({ code, signal }); });
  });
  active.set(child, closed);
  const message = new Promise<Barrier>((done, reject) => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('The lifecycle barrier was not reached.')); }, 15_000);
    child.once('message', value => { clearTimeout(timer); done(value as Barrier); });
    void closed.then(() => { clearTimeout(timer); reject(new Error('The lifecycle child ended before its barrier.')); }, reject);
  });
  return { child, message, closed };
}

async function reopen(directory: string) {
  const deadline = performance.now() + 5_000;
  while (true) {
    check();
    try { return await FileForgeWishQueue.open({ directory, origin: 'simulated' }); }
    catch (error) {
      if (!(error instanceof ForgeWishQueueError) || error.code !== 'busy' || performance.now() >= deadline) throw error;
      await new Promise<void>(done => setTimeout(done, 20));
    }
  }
}

async function inspect(directory: string) {
  assert.equal((await stat(directory)).mode & 0o777, 0o700);
  for (const name of await readdir(directory)) {
    const path = join(directory, name), info = await stat(path);
    assert(info.isFile()); assert.equal(info.mode & 0o777, 0o600);
    const bytes = await readFile(path);
    assert(!bytes.includes(Buffer.from(words))); assert(!bytes.includes(Buffer.from(checkpoint)));
  }
}

async function proveOne(directory: string, which: Case) {
  const worker = start(directory, which), ready = await worker.message;
  assert.equal(ready.kind, 'ready');
  assert(worker.child.kill('SIGKILL'));
  assert.deepEqual(await worker.closed, { code: null, signal: 'SIGKILL' });
  const queue = await reopen(directory);
  try {
    if (which === 'message' || which === 'person' || which === 'kingdom') {
      const old = await queue.enqueue(command('authored-old', 100));
      await queue.enqueue(command('authored-new', 301));
      const claim = await queue.claimNext(); assert(claim);
      assert.equal(claim.receipt.key, old.receipt.key);
      assert.equal(claim.withdrawal.aborted, true); assert.equal(claim.current(), true);
      assert.equal(queue.canReserve(claim), false); assert.equal(queue.canCommit(claim), false);
      await assert.rejects(queue.beginModelCall(claim, 'words'), { code: 'stale' });
      await queue.complete(claim, { terminal: { kind: 'canceled' }, message: 'Your wish has stopped.' });
      const later = await queue.claimNext(); assert(later);
      assert.equal(later.withdrawal.aborted, false);
      assert.equal(queue.canReserve(later), true); assert.equal(queue.canCommit(later), true);
      await queue.complete(later, { terminal: { kind: 'held' }, message: 'Your coal stays yours.' });
      assert.equal(await queue.claimNext(), null);
    } else {
      assert(ready.key && ready.attemptId);
      const receipt = await queue.get(ready.key); assert(receipt?.delivery);
      assert.equal(receipt.state, 'finished'); assert.deepEqual(receipt.outcome, { kind: 'held' });
      assert.equal(receipt.attemptId, ready.attemptId);
      assert.equal(receipt.delivery.acknowledged, which === 'acknowledgement');
      assert.equal(receipt.delivery.message, 'Your coal stays yours.');
      assert.equal(await queue.claimNext(), null);
      const duplicate = await queue.enqueue(command('authored-complete', 100));
      assert.equal(duplicate.kind, 'existing'); assert.equal(duplicate.receipt.attemptId, ready.attemptId);
      assert.deepEqual(duplicate.receipt.delivery, receipt.delivery);
      const owned = await queue.ownerOutcomes(kingdomId, personId);
      assert.equal(owned.length, 1); assert.deepEqual(owned[0]?.delivery, receipt.delivery);
    }
  } finally { await queue.close(); }
  await inspect(directory);
}

async function prove(directory: string) {
  try {
    const results: { case: number; killed: boolean; recovered: boolean; privateErasure: boolean }[] = [];
    for (const [index, which] of cases.entries()) {
      check(); await proveOne(join(directory, `case-${index + 1}`), which);
      results.push({ case: index + 1, killed: true, recovered: true, privateErasure: true });
    }
    check();
    const report = { version: 1, ok: true, scenarios: results, modelCalls: 0, ports: 0, processKills: results.length };
    const bytes = JSON.stringify(report, null, 2) + '\n';
    await writeFile(join(directory, 'summary.json'), bytes, { mode: 0o600 });
    await chmod(join(directory, 'summary.json'), 0o600);
    check(); await writeFile(resolve('work/evidence/forge-wish/fw11-lifecycle-process.json'), bytes);
    process.stdout.write(JSON.stringify({ ok: true, scenarios: results.length, privateDirectory: directory }) + '\n');
  } finally {
    const closing = [...active.values()];
    for (const child of active.keys()) child.kill('SIGKILL');
    await Promise.allSettled(closing);
  }
}

const shutdown = () => { canceled = true; for (const child of active.keys()) child.kill('SIGKILL'); };
process.once('SIGINT', shutdown); process.once('SIGTERM', shutdown);
try {
  const [mode, directory, which] = process.argv.slice(2);
  if (mode === 'occupant' && directory && cases.includes(which as Case)) await occupant(directory, which as Case);
  else if (mode && directory === undefined) await prove(mode);
  else throw new Error('Invalid lifecycle proof mode.');
} catch {
  shutdown(); process.stderr.write('The private lifecycle proof failed; no fixture diagnostics were exported.\n'); process.exitCode = 1;
}
