import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { KingdomIdSchema, PersonIdSchema } from '@chatdom/shared';
import type { KingdomForgeCommand, KingdomForgeLease } from '@chatdom/shared/realm';
import type { KingdomForgeResult } from '../kingdom-forge/application';
import { FileForgeWishQueue, type ForgeWishClaim } from '../wish-queue';
import { ForgeWishWorker, type ForgeWishExecutionControl } from './index';

const kingdomId = KingdomIdSchema.parse('910001');
const personId = PersonIdSchema.parse('910002');
const command = (messageId: string, person = personId): KingdomForgeCommand => ({
  kingdomId, personId: person, messageId, slot: 2, words: `Private wish for ${messageId}`, observedAt: 100,
});
const pending = (claim: ForgeWishClaim): KingdomForgeResult => ({ kind: 'recovery-needed', ...claim.attempt });
const pause = (ms = 10) => new Promise<void>(resolve => setTimeout(resolve, ms));
async function until(check: () => boolean | Promise<boolean>) {
  const deadline = Date.now() + 5_000;
  while (!await check()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for the worker.');
    await pause();
  }
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
const dirs: string[] = [], queues: FileForgeWishQueue[] = [], workers: ForgeWishWorker[] = [];
const releases: (() => void)[] = [];
async function open(directory: string) {
  const queue = await FileForgeWishQueue.open({ directory, origin: 'simulated', maxConcurrent: 2 });
  queues.push(queue); return queue;
}
async function setup() {
  const directory = await mkdtemp(join(tmpdir(), 'forge-worker-')); dirs.push(directory);
  return { directory, queue: await open(directory) };
}
function worker(options: ConstructorParameters<typeof ForgeWishWorker>[0]) {
  const value = new ForgeWishWorker(options); workers.push(value); return value;
}
afterEach(async () => {
  for (const release of releases.splice(0)) release();
  for (const value of workers.splice(0).reverse()) await value.stop().catch(() => {});
  for (const queue of queues.splice(0).reverse()) await queue.close().catch(() => {});
  for (const directory of dirs.splice(0)) await rm(directory, { recursive: true, force: true });
  vi.restoreAllMocks();
});

it('bounds concurrent work, parks retries under their original attempt, and keeps each maker in arrival order', async () => {
  const { queue } = await setup();
  const other = PersonIdSchema.parse('910003'), third = PersonIdSchema.parse('910004');
  const starts: { claim: ForgeWishClaim; control: ForgeWishExecutionControl; result: ReturnType<typeof deferred<KingdomForgeResult>> }[] = [];
  let concurrent = 0, peak = 0;
  const service = worker({ queue, retryMs: 100, maxConcurrent: 2, execute: async (claim, control) => {
    concurrent++; peak = Math.max(peak, concurrent);
    const result = deferred<KingdomForgeResult>();
    releases.push(() => result.resolve(pending(claim)));
    starts.push({ claim, control, result });
    try { return await result.promise; } finally { concurrent--; }
  } });
  const a = await service.admit(command('first'));
  await service.admit(command('second'));
  await service.admit(command('other', other));
  await service.admit(command('third', third));
  await service.start();
  await until(() => starts.length === 2);
  expect(starts.map(item => item.claim.command.messageId)).toEqual(['first', 'other']);
  expect(starts.map(item => item.control.canCommit())).toEqual([true, false]);
  starts[1]!.result.resolve({ kind: 'held' });
  await until(() => starts.length === 3);
  expect(starts[2]!.claim.command.messageId).toBe('third');
  expect(starts[2]!.control.canCommit()).toBe(false);
  starts[2]!.result.resolve({ kind: 'held' });
  starts[0]!.result.resolve(pending(starts[0]!.claim));
  await until(() => starts.length === 4);
  expect(starts[3]!.claim.command.messageId).toBe('first');
  expect(starts[3]!.claim.attempt).toEqual({ key: a.receipt.key, attemptId: a.receipt.attemptId });
  expect(starts.some(item => item.claim.command.messageId === 'second')).toBe(false);
  starts[3]!.result.resolve({ kind: 'held' });
  await until(() => starts.length === 5);
  expect(starts[4]!.claim.command.messageId).toBe('second');
  expect(starts[4]!.control.canCommit()).toBe(true);
  starts[4]!.result.resolve({ kind: 'held' });
  await until(async () => (await queue.list()).every(receipt => receipt.state === 'finished'));
  expect(peak).toBe(2);
});

it('suspends on shutdown and preserves its attempt, while a withdrawal separately fences live work', async () => {
  const { directory, queue } = await setup();
  const firstStarted = deferred<void>();
  let firstClaim: ForgeWishClaim | undefined;
  const service = worker({ queue, retryMs: 100, execute: async (claim, control) => {
    firstClaim = claim; firstStarted.resolve();
    await new Promise<void>(resolve => control.lease.signal.addEventListener('abort', () => resolve(), { once: true }));
    expect(control.withdrawal.aborted).toBe(false);
    return pending(claim);
  } });
  const admitted = await service.admit(command('shutdown')); await service.start(); await firstStarted.promise;
  await service.stop();
  expect((await queue.get(admitted.receipt.key))?.state).toBe('queued');
  expect(firstClaim?.withdrawal.aborted).toBe(false);
  await queue.close(); const recovered = await open(directory);
  const resumed = deferred<{ claim: ForgeWishClaim; control: ForgeWishExecutionControl }>();
  const resumeService = worker({ queue: recovered, retryMs: 100, execute: async (claim, control) => {
    resumed.resolve({ claim, control });
    await new Promise<void>(resolve => {
      releases.push(resolve);
      control.withdrawal.addEventListener('abort', () => resolve(), { once: true });
    });
    expect(control.lease.current()).toBe(true);
    expect(control.canCommit()).toBe(false);
    return { kind: 'canceled' };
  } });
  await resumeService.start(); const active = await resumed.promise;
  expect(active.claim.attempt).toEqual({ key: admitted.receipt.key, attemptId: admitted.receipt.attemptId });
  const withdrawal = resumeService.withdraw({ kingdomId, reason: 'deleted', scope: { kind: 'message', messageId: 'shutdown' } });
  expect(active.control.withdrawal.aborted).toBe(true);
  await withdrawal;
  await until(async () => (await recovered.get(admitted.receipt.key))?.state === 'finished');
  expect((await recovered.get(admitted.receipt.key))?.outcome).toEqual({ kind: 'canceled' });
});

it('retains a word-free private outcome across failed notification and restart until the owner explicitly acknowledges it', async () => {
  const { directory, queue } = await setup(); const input = command('reply');
  const execute = vi.fn(async (): Promise<KingdomForgeResult> => ({ kind: 'held', privateMessage: 'Your coal stays yours.' }));
  const failed = vi.fn(async () => { throw new Error('offline'); });
  const first = worker({ queue, execute, completed: failed, retryMs: 100 });
  const admitted = await first.admit(input); await first.start();
  await until(async () => failed.mock.calls.length > 0 && (await queue.get(admitted.receipt.key))?.state === 'finished');
  await first.stop(); await queue.close();
  for (const file of await readdir(directory)) expect(await readFile(join(directory, file), 'utf8')).not.toContain(input.words);
  const recovered = await open(directory), delivered = vi.fn(async () => {});
  const second = worker({ queue: recovered, execute, completed: delivered, retryMs: 100 });
  await second.start(); await until(() => delivered.mock.calls.length === 1);
  expect(execute).toHaveBeenCalledTimes(1);
  const outcome = (await recovered.ownerOutcomes(kingdomId, personId))[0]!;
  expect(outcome.delivery).toMatchObject({ message: 'Your coal stays yours.', acknowledged: false });
  await recovered.acknowledgeOwner(kingdomId, personId, { key: outcome.key, attemptId: outcome.attemptId,
    replyId: outcome.delivery!.replyId });
  await second.stop(); await recovered.close();
  const finalQueue = await open(directory), afterAck = vi.fn(async () => {});
  const finalWorker = worker({ queue: finalQueue, execute, completed: afterAck });
  await finalWorker.start(); await pause(150);
  expect(afterAck).not.toHaveBeenCalled();
  expect((await finalQueue.ownerOutcomes(kingdomId, personId))[0]?.delivery?.acknowledged).toBe(true);
  expect(execute).toHaveBeenCalledTimes(1);
});

it('does not stall other wishes or start duplicate callbacks when a private projection hangs', async () => {
  const { queue } = await setup(), held = deferred<void>();
  releases.push(() => held.resolve());
  const started: string[] = [], notified: string[] = [];
  const service = worker({ queue, retryMs: 100,
    execute: async claim => { started.push(claim.command.messageId); return { kind: 'held' }; },
    completed: async receipt => {
      notified.push(receipt.messageId);
      if (receipt.messageId === 'slow') await held.promise;
    },
  });
  await service.admit(command('slow')); await service.start();
  await until(() => notified.includes('slow'));
  const second = await service.admit(command('next', PersonIdSchema.parse('910003')));
  await until(async () => (await queue.get(second.receipt.key))?.state === 'finished');
  await pause(350);
  expect(started).toEqual(['slow', 'next']);
  expect(notified.filter(id => id === 'slow')).toHaveLength(1);
  expect((await queue.get(second.receipt.key))?.delivery?.acknowledged).toBe(false);
  held.resolve();
});

it('backs off immediately rejected private projections instead of retrying in a tight loop', async () => {
  const { queue } = await setup();
  const failed = vi.fn(async () => { throw new Error('unavailable'); });
  const service = worker({ queue, retryMs: 100, execute: async () => ({ kind: 'held' }), completed: failed });
  const admitted = await service.admit(command('backoff')); await service.start();
  await until(() => failed.mock.calls.length > 0);
  await pause(350);
  expect(failed.mock.calls.length).toBeGreaterThanOrEqual(2);
  expect(failed.mock.calls.length).toBeLessThanOrEqual(5);
  expect((await queue.get(admitted.receipt.key))?.delivery?.acknowledged).toBe(false);
});

it('bounds concurrent hanging projections, executes other wishes, and revokes callback leases on shutdown', async () => {
  const { queue } = await setup(), held = deferred<void>(); releases.push(() => held.resolve());
  let inCallback = 0, peak = 0;
  const leases: KingdomForgeLease[] = [], callbacks: string[] = [], executions: string[] = [];
  const service = worker({ queue, maxConcurrent: 2, retryMs: 100,
    execute: async claim => { executions.push(claim.command.messageId); return { kind: 'held' }; },
    completed: async (receipt, lease) => {
      callbacks.push(receipt.messageId); leases.push(lease); inCallback++; peak = Math.max(peak, inCallback);
      try { await held.promise; } finally { inCallback--; }
    },
  });
  for (let n = 0; n < 4; n++) await service.admit(command(`callback-${n}`, PersonIdSchema.parse(`${910002 + n}`)));
  await service.start();
  await until(async () => (await queue.list()).every(receipt => receipt.state === 'finished') && callbacks.length === 2);
  await pause(350);
  expect(executions).toHaveLength(4);
  expect(callbacks).toHaveLength(2); expect(peak).toBe(2);
  expect(leases.every(lease => lease.current() && !lease.signal.aborted)).toBe(true);
  await service.stop();
  expect(leases.every(lease => !lease.current() && lease.signal.aborted)).toBe(true);
  expect((await queue.list()).every(receipt => receipt.delivery?.acknowledged === false)).toBe(true);
  held.resolve();
});

it('does not execute an expired claim again while the old execution is still running', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'forge-worker-expiry-')); dirs.push(directory);
  let now = 10_000;
  const queue = await FileForgeWishQueue.open({ directory, origin: 'simulated', maxConcurrent: 2,
    claimMs: 1_000, now: () => now }); queues.push(queue);
  const held = deferred<KingdomForgeResult>(); releases.push(() => held.resolve({ kind: 'held' }));
  const starts: string[] = []; let inExecution = 0, peak = 0;
  const service = worker({ queue, maxConcurrent: 2, retryMs: 100, now: () => now,
    execute: async claim => {
      starts.push(claim.command.messageId); inExecution++; peak = Math.max(peak, inExecution);
      try {
        if (claim.command.messageId === 'expired' && starts.filter(id => id === 'expired').length === 1) return await held.promise;
        return { kind: 'held' };
      } finally { inExecution--; }
    },
  });
  await service.admit(command('expired')); await service.start(); await until(() => starts.length === 1);
  now += 1_001;
  const second = await service.admit(command('independent', PersonIdSchema.parse('910003')));
  await until(async () => (await queue.get(second.receipt.key))?.state === 'finished');
  await pause(250);
  expect(starts.filter(id => id === 'expired')).toHaveLength(1);
  expect(peak).toBeLessThanOrEqual(2);
  held.resolve({ kind: 'held' });
  await until(() => starts.filter(id => id === 'expired').length === 2);
  await until(async () => (await queue.list()).every(receipt => receipt.state === 'finished'));
  expect(peak).toBeLessThanOrEqual(2);
});
