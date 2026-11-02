import { afterEach, describe, expect, it, vi } from 'vitest';
import { lstat, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { KingdomIdSchema, PersonIdSchema } from '@chatdom/shared';
import type { KingdomForgeCommand } from '@chatdom/shared/realm';
import { FileForgeWishQueue, type ForgeWishClaim } from './index';
import { PrivateWishFiles } from './files';

const kingdom = (id = '910001') => KingdomIdSchema.parse(id);
const person = (id = '910002') => PersonIdSchema.parse(id);
const command = (messageId: string, who = '910002', where = '910001', observedAt = 100): KingdomForgeCommand => ({
  kingdomId: kingdom(where), personId: person(who), messageId, slot: 2,
  words: `Private wish words for ${messageId}`, observedAt,
});
const queues: FileForgeWishQueue[] = [], directories: string[] = [];
async function open(directory: string, maxConcurrent = 4) {
  const queue = await FileForgeWishQueue.open({ directory, origin: 'simulated', maxConcurrent });
  queues.push(queue); return queue;
}
async function setup() {
  const directory = await mkdtemp(join(tmpdir(), 'forge-lifecycle-')); directories.push(directory);
  return { directory, queue: await open(directory) };
}
async function claim(queue: FileForgeWishQueue): Promise<ForgeWishClaim> {
  const current = await queue.claimNext(); expect(current).not.toBeNull(); return current!;
}
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(queues.splice(0).map(queue => queue.close().catch(() => {})));
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});

describe('durable wish withdrawal', () => {
  it('remembers message, person and kingdom withdrawals before arrival and after reopening', async () => {
    const { directory, queue } = await setup();
    await queue.withdraw({ kingdomId: kingdom(), reason: 'deleted', scope: { kind: 'message', messageId: 'deleted' } });
    await queue.withdraw({ kingdomId: kingdom(), reason: 'moderated', scope: { kind: 'person', personId: person(), through: 100 } });
    await queue.withdraw({ kingdomId: kingdom('910010'), reason: 'offline', scope: { kind: 'kingdom', through: 200 } });
    await queue.close(); const recovered = await open(directory);
    const inputs = [command('deleted', '910003', '910001', 999), command('old', '910002', '910001', 100),
      command('future', '910002', '910001', 101), command('other-person', '910003'),
      command('old-kingdom', '910004', '910010', 200), command('future-kingdom', '910004', '910010', 201),
      command('other-kingdom', '910002', '910011', 100)];
    const receipts = await Promise.all(inputs.map(input => recovered.enqueue(input)));
    expect(receipts.map(({ receipt }) => recovered.isWithdrawn(receipt))).toEqual([true, true, false, false, true, false, false]);
    await recovered.close(); const again = await open(directory);
    expect((await again.list()).map(receipt => again.isWithdrawn(receipt))).toEqual([true, true, false, false, true, false, false]);
  });

  it('raises a synchronous withdrawal barrier while its durable write is held, preserving the claim for cleanup', async () => {
    const { queue } = await setup(); await queue.enqueue(command('barrier')); const current = await claim(queue);
    let entered!: () => void, resume!: () => void;
    const waiting = new Promise<void>(resolve => { entered = resolve; });
    const held = new Promise<void>(resolve => { resume = resolve; });
    const write = PrivateWishFiles.prototype.write;
    vi.spyOn(PrivateWishFiles.prototype, 'write').mockImplementationOnce(async function (this: PrivateWishFiles, name, bytes) {
      entered(); await held; await write.call(this, name, bytes);
    });
    const withdrawal = queue.withdraw({ kingdomId: kingdom(), reason: 'deleted', scope: { kind: 'message', messageId: 'barrier' } });
    expect(current.withdrawal.aborted).toBe(true);
    expect(queue.isWithdrawn(current.receipt)).toBe(true);
    expect(current.signal.aborted).toBe(false); expect(current.current()).toBe(true);
    await waiting; resume(); await withdrawal;
    expect(current.current()).toBe(true);
    await queue.complete(current, { terminal: { kind: 'canceled' }, message: 'The wish was withdrawn.' });
    expect((await queue.get(current.receipt.key))?.state).toBe('finished');
  });

  it('does not acknowledge a failed withdrawal and poisons the owner', async () => {
    const { queue, directory } = await setup(); await queue.enqueue(command('failed')); const current = await claim(queue);
    vi.spyOn(PrivateWishFiles.prototype, 'write').mockRejectedValueOnce(new Error('private storage detail'));
    const pending = queue.withdraw({ kingdomId: kingdom(), reason: 'deleted', scope: { kind: 'message', messageId: 'failed' } });
    expect(current.withdrawal.aborted).toBe(true);
    await expect(pending).rejects.toMatchObject({ code: 'unavailable' });
    await expect(queue.list()).rejects.toMatchObject({ code: 'unavailable' });
    await queue.close(); const recovered = await open(directory);
    expect(recovered.isWithdrawn((await recovered.list())[0]!)).toBe(false);
  });
});

describe('durable owner completion', () => {
  it('atomically removes words and checkpoints, keeps the private reply, and preserves duplicate identity', async () => {
    const { queue, directory } = await setup(); const input = command('complete');
    const admitted = await queue.enqueue(input), current = await claim(queue);
    await queue.checkpoint(current, { id: 'private-checkpoint', stage: 'words', data: { evidence: 'secret checkpoint value' } });
    await queue.complete(current, { terminal: { kind: 'held' }, message: 'The forge is resting.' });
    const duplicate = await queue.enqueue(input);
    expect(duplicate.kind).toBe('existing'); expect(duplicate.receipt.attemptId).toBe(admitted.receipt.attemptId);
    expect(duplicate.receipt.state).toBe('finished');
    await queue.close(); const recovered = await open(directory);
    expect(await recovered.claimNext()).toBeNull();
    const outcomes = await recovered.ownerOutcomes(kingdom(), person());
    expect(outcomes).toHaveLength(1);
    expect(JSON.stringify(outcomes)).toContain('The forge is resting.');
    for (const name of await readdir(directory)) {
      const path = join(directory, name), info = await lstat(path);
      expect(info.mode & 0o777).toBe(0o600);
      const bytes = await readFile(path, 'utf8');
      expect(bytes).not.toContain(input.words); expect(bytes).not.toContain('secret checkpoint value');
    }
  });

  it('recovers a committed completion after its durable acknowledgement is lost', async () => {
    const { queue, directory } = await setup(); const input = command('lost-complete');
    const admitted = await queue.enqueue(input), current = await claim(queue);
    const write = PrivateWishFiles.prototype.write;
    vi.spyOn(PrivateWishFiles.prototype, 'write').mockImplementationOnce(async function (this: PrivateWishFiles, name, bytes) {
      await write.call(this, name, bytes); throw new Error('lost acknowledgement');
    });
    await expect(queue.complete(current, { terminal: { kind: 'committed', runId: 'run-one', committedAt: 123 },
      message: 'Your piece is home.' })).rejects.toMatchObject({ code: 'unavailable' });
    await queue.close(); const recovered = await open(directory);
    expect((await recovered.get(admitted.receipt.key))?.outcome).toEqual({ kind: 'committed', runId: 'run-one', committedAt: 123 });
    expect(await recovered.claimNext()).toBeNull();
    expect(JSON.stringify(await recovered.ownerOutcomes(kingdom(), person()))).toContain('Your piece is home.');
    expect((await recovered.enqueue(input)).receipt.attemptId).toBe(admitted.receipt.attemptId);
  });
});
