import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { KingdomIdSchema, PersonIdSchema } from '@chatdom/shared';
import type { KingdomForgeCommand } from '@chatdom/shared/realm';
import { FileForgeWishQueue, type ForgeWishClaim, type ForgeWishJson } from './index';
import { PrivateWishFiles } from './files';

const queues: FileForgeWishQueue[] = [], directories: string[] = [];
const command = (messageId: string, personId = '910002'): KingdomForgeCommand => ({
  kingdomId: KingdomIdSchema.parse('910001'), personId: PersonIdSchema.parse(personId),
  messageId, slot: 2, words: 'A small moon lantern with brass edges', observedAt: 100,
});
async function setup(options: { maxConcurrent?: number; maxPending?: number; now?: () => number; claimMs?: number } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'forge-wish-queue-')); directories.push(directory);
  const queue = await FileForgeWishQueue.open({ directory, origin: 'simulated', ...options }); queues.push(queue);
  return { directory, queue };
}
async function reopen(directory: string) {
  const queue = await FileForgeWishQueue.open({ directory, origin: 'simulated' }); queues.push(queue); return queue;
}
async function claim(queue: FileForgeWishQueue): Promise<ForgeWishClaim> {
  const value = await queue.claimNext(); expect(value).not.toBeNull(); return value!;
}
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(queues.splice(0).map(queue => queue.close()));
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});

describe('private durable wish queue', () => {
  it('admits concurrent deliveries once with one durable sequence and attempt', async () => {
    const { queue, directory } = await setup();
    const receipts = await Promise.all(Array.from({ length: 12 }, () => queue.enqueue(command('one'))));
    expect(receipts.filter(receipt => receipt.kind === 'queued')).toHaveLength(1);
    expect(new Set(receipts.map(receipt => receipt.receipt.attemptId)).size).toBe(1);
    expect(new Set(receipts.map(receipt => receipt.receipt.sequence))).toEqual(new Set([1]));
    expect((await readdir(directory)).filter(name => name.startsWith('wish-'))).toHaveLength(1);
    expect(JSON.stringify(await queue.list())).not.toContain(command('one').words);
  });

  it('respects global capacity and one active wish per citizen while allowing the next maker', async () => {
    const { queue } = await setup({ maxConcurrent: 2 });
    await queue.enqueue(command('first')); await queue.enqueue(command('same-maker'));
    await queue.enqueue(command('next-maker', '910003'));
    const first = await claim(queue), other = await claim(queue);
    expect(first.command.messageId).toBe('first'); expect(other.command.messageId).toBe('next-maker');
    expect(await queue.claimNext()).toBeNull();
    await queue.finish(first, { kind: 'held' });
    expect((await claim(queue)).command.messageId).toBe('same-maker');
  });

  it('restores immutable checkpoints and every spent call after reopening', async () => {
    const { queue, directory } = await setup();
    await queue.enqueue(command('resume')); const original = await claim(queue);
    expect(await queue.beginModelCall(original, 'words')).toBe(1);
    await queue.checkpoint(original, { id: 'words-read', stage: 'words', data: { verdict: 'pass', policy: 'fixture-policy' } });
    expect(await queue.beginModelCall(original, 'drafting')).toBe(2);
    // The second call's answer was never persisted. Recovery must still count its debit.
    await queue.close(); const recovered = await reopen(directory), next = await claim(recovered);
    expect(next.attempt).toEqual(original.attempt); expect(next.receipt.generation).toBe(original.receipt.generation + 1);
    expect(next.receipt.modelCalls).toBe(2); expect(next.receipt.stage).toBe('drafting');
    expect(next.checkpoints).toEqual([{ id: 'words-read', stage: 'words', modelCalls: 1,
      data: { policy: 'fixture-policy', verdict: 'pass' } }]);
    expect(await recovered.beginModelCall(next, 'drafting')).toBe(3);
  });

  it('keeps a snapshot immutable across an identical retry and refuses a changed result', async () => {
    const { queue } = await setup(); await queue.enqueue(command('immutable')); const current = await claim(queue);
    const checkpoint = { id: 'word-read', stage: 'words' as const, data: { pass: true } };
    await queue.beginModelCall(current, 'words'); await queue.checkpoint(current, checkpoint);
    await queue.beginModelCall(current, 'drafting'); await queue.checkpoint(current, checkpoint);
    await expect(queue.checkpoint(current, { ...checkpoint, data: { pass: false } })).rejects.toMatchObject({ code: 'conflict' });
    await queue.retry(current); const next = await claim(queue);
    expect(next.checkpoints).toEqual([{ ...checkpoint, modelCalls: 1 }]);
    expect(next.receipt.modelCalls).toBe(2);
  });

  it('fences an expired worker before admitting its replacement and preserves budget', async () => {
    let at = 1_000;
    const { queue } = await setup({ now: () => at, claimMs: 1_000 });
    await queue.enqueue(command('expiration')); const first = await claim(queue);
    await queue.beginModelCall(first, 'words'); at = 2_000;
    expect(first.current()).toBe(false);
    const replacement = await claim(queue);
    expect(first.signal.aborted).toBe(true); expect(replacement.attempt).toEqual(first.attempt);
    expect(replacement.receipt.modelCalls).toBe(1);
    await expect(queue.finish(first, { kind: 'held' })).rejects.toMatchObject({ code: 'stale' });
    expect(replacement.current()).toBe(true);
  });

  it('rejects changed signed bytes even when the edited document remains valid JSON', async () => {
    const { queue, directory } = await setup(); await queue.enqueue(command('corruption')); await queue.close();
    const name = (await readdir(directory)).find(name => name.startsWith('wish-'))!;
    const path = join(directory, name), record = JSON.parse(await readFile(path, 'utf8')) as { payload: { slot: number } };
    record.payload.slot = 3; await writeFile(path, JSON.stringify(record), { mode: 0o600 });
    await expect(reopen(directory)).rejects.toMatchObject({ code: 'corrupt' });
  });

  it('cleans only abandoned owned temporary files before recovering accepted records', async () => {
    const { queue, directory } = await setup(); const accepted = await queue.enqueue(command('temporary')); await queue.close();
    const pending = join(directory, '.pending-00000000-0000-4000-8000-000000000000.json');
    await writeFile(pending, 'Unacknowledged private checkpoint bytes', { mode: 0o600 });
    const recovered = await reopen(directory);
    expect((await recovered.get(accepted.receipt.key))?.state).toBe('queued');
    expect(await readdir(directory)).not.toContain('.pending-00000000-0000-4000-8000-000000000000.json');
  });

  it('rejects nonfinite, executable, sparse, accessor and oversized checkpoint data without invoking it', async () => {
    const { queue } = await setup(); await queue.enqueue(command('private-data')); const current = await claim(queue);
    let invoked = 0;
    const object = Object.defineProperty({}, 'secret', { enumerable: true, get: () => { invoked++; return 'private'; } });
    const array = [1]; Object.defineProperty(array, '0', { enumerable: true, get: () => { invoked++; return 1; } });
    const values: unknown[] = [NaN, Infinity, undefined, () => {}, new Date(), new Array(2), object, array, 'x'.repeat(65_537)];
    for (const data of values) await expect(queue.checkpoint(current,
      { id: 'invalid', stage: 'words', data: data as ForgeWishJson })).rejects.toMatchObject({ code: 'invalid' });
    expect(invoked).toBe(0); expect((await queue.get(current.receipt.key))?.stage).toBe('arrival');
  });

  it('closing rejects queued work and revokes all current leases before ownership is released', async () => {
    const { queue, directory } = await setup(); await queue.enqueue(command('close')); const current = await claim(queue);
    const queued = queue.beginModelCall(current, 'words'), closing = queue.close();
    await expect(queued).rejects.toMatchObject({ code: 'closed' }); await closing;
    expect(current.signal.aborted).toBe(true); expect(current.current()).toBe(false);
    await expect(queue.list()).rejects.toMatchObject({ code: 'closed' });
    expect((await claim(await reopen(directory))).receipt.modelCalls).toBe(0);
  });

  it('revokes a claim whose durable write finishes after closing has already begun', async () => {
    const { queue, directory } = await setup(); await queue.enqueue(command('closing-write'));
    let entered!: () => void, resume!: () => void;
    const waiting = new Promise<void>(resolve => { entered = resolve; });
    const continued = new Promise<void>(resolve => { resume = resolve; });
    const write = PrivateWishFiles.prototype.write;
    vi.spyOn(PrivateWishFiles.prototype, 'write').mockImplementationOnce(async function (this: PrivateWishFiles, name, bytes) {
      await write.call(this, name, bytes); entered(); await continued;
    });
    const claiming = queue.claimNext(); await waiting;
    const closing = queue.close(); resume();
    const current = (await claiming)!; await closing;
    expect(current).not.toBeNull(); expect(current.signal.aborted).toBe(true); expect(current.current()).toBe(false);
    const recovered = await claim(await reopen(directory));
    expect(recovered.attempt).toEqual(current.attempt); expect(recovered.receipt.generation).toBe(current.receipt.generation + 1);
  });

  it.each(['debit', 'terminal'] as const)('recovers a persisted %s after its acknowledgement is lost', async stage => {
    const { queue, directory } = await setup(); const admitted = await queue.enqueue(command(`lost-${stage}`));
    const current = await claim(queue), write = PrivateWishFiles.prototype.write;
    vi.spyOn(PrivateWishFiles.prototype, 'write').mockImplementationOnce(async function (this: PrivateWishFiles, name, bytes) {
      await write.call(this, name, bytes);
      throw new Error('A private dependency detail must not escape');
    });
    const result = stage === 'debit' ? queue.beginModelCall(current, 'words') : queue.finish(current, { kind: 'held' });
    await expect(result).rejects.toMatchObject({ code: 'unavailable', message: 'The private wish queue is unavailable.' });
    expect(current.signal.aborted).toBe(true);
    await expect(queue.list()).rejects.toMatchObject({ code: 'unavailable' });
    await queue.close(); const reopened = await reopen(directory);
    if (stage === 'debit') expect((await claim(reopened)).receipt.modelCalls).toBe(1);
    else {
      expect((await reopened.get(admitted.receipt.key))?.outcome).toEqual({ kind: 'held' });
      expect(await reopened.claimNext()).toBeNull();
      for (const name of await readdir(directory)) expect(await readFile(join(directory, name), 'utf8')).not.toContain(command('unused').words);
    }
  });

  it('never acknowledges an admission that failed before its durable write', async () => {
    const { queue, directory } = await setup();
    vi.spyOn(PrivateWishFiles.prototype, 'write').mockRejectedValueOnce(new Error('Private filesystem detail'));
    await expect(queue.enqueue(command('failed-admission'))).rejects.toMatchObject({ code: 'unavailable' });
    await queue.close();
    expect(await (await reopen(directory)).list()).toEqual([]);
  });

  it('sanitizes a failed shutdown acknowledgement and keeps the previous worker fenced', async () => {
    const { queue, directory } = await setup(); await queue.enqueue(command('close-failure'));
    const current = await claim(queue), close = PrivateWishFiles.prototype.close;
    vi.spyOn(PrivateWishFiles.prototype, 'close').mockImplementationOnce(async function (this: PrivateWishFiles) {
      await close.call(this);
      throw new Error('Private shutdown detail must not escape');
    });
    await expect(queue.close()).rejects.toMatchObject({ code: 'unavailable', message: 'The private wish queue is unavailable.' });
    expect(current.current()).toBe(false); expect(current.signal.aborted).toBe(true);
    queues.splice(queues.indexOf(queue), 1);
    expect((await claim(await reopen(directory))).attempt).toEqual(current.attempt);
  });
});
