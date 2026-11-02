import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { KingdomIdSchema, PersonIdSchema } from '@chatdom/shared';
import type { KingdomForgeCommand } from '@chatdom/shared/realm';
import { FileForgeWishQueue, type ForgeWishClaim } from './index';

const kingdom = (id = '910001') => KingdomIdSchema.parse(id);
const person = (id = '910002') => PersonIdSchema.parse(id);
const command = (messageId: string, who = '910002', where = '910001'): KingdomForgeCommand => ({
  kingdomId: kingdom(where), personId: person(who), messageId, slot: 2,
  words: `A private wish for ${messageId}`, observedAt: 100,
});
const queues: FileForgeWishQueue[] = [], directories: string[] = [];
async function setup(options: { maxConcurrent?: number; claimMs?: number; now?: () => number } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'forge-adversarial-')); directories.push(directory);
  const queue = await FileForgeWishQueue.open({ directory, origin: 'simulated', maxConcurrent: 4, ...options });
  queues.push(queue); return queue;
}
async function claim(queue: FileForgeWishQueue, excludeKeys?: ReadonlySet<string>): Promise<ForgeWishClaim> {
  const current = await queue.claimNext(excludeKeys ? { excludeKeys } : {}); expect(current).not.toBeNull(); return current!;
}
afterEach(async () => {
  await Promise.all(queues.splice(0).map(queue => queue.close().catch(() => {})));
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});

describe('owner delivery', () => {
  it('requires the exact owner and reply triple, and reading never acknowledges a reply', async () => {
    const queue = await setup(); await queue.enqueue(command('one')); const current = await claim(queue);
    const finished = await queue.complete(current, { terminal: { kind: 'held' }, message: 'Please try again.' });
    const delivery = finished.delivery!;
    expect(delivery.acknowledged).toBe(false); expect(delivery.replyId).toMatch(/^forge:[a-f0-9]{48}$/);
    const identity = { key: finished.key, attemptId: finished.attemptId, replyId: delivery.replyId };
    expect(await queue.ownerOutcomes(kingdom(), person('910003'))).toEqual([]);
    expect(await queue.ownerOutcomes(kingdom('910010'), person())).toEqual([]);
    for (const [where, who, triple] of [
      [kingdom(), person('910003'), identity], [kingdom('910010'), person(), identity],
      [kingdom(), person(), { ...identity, attemptId: 'attempt-other' }],
      [kingdom(), person(), { ...identity, replyId: `forge:${'0'.repeat(48)}` }],
    ] as const) await expect(queue.acknowledgeOwner(where, who, triple)).rejects.toMatchObject({ code: 'conflict' });
    expect((await queue.ownerOutcomes(kingdom(), person()))[0]?.delivery?.acknowledged).toBe(false);
    expect((await queue.ownerOutcomes(kingdom(), person()))[0]?.delivery?.acknowledged).toBe(false);
    await queue.acknowledgeOwner(kingdom(), person(), identity);
    await queue.acknowledgeOwner(kingdom(), person(), identity);
    expect((await queue.ownerOutcomes(kingdom(), person()))[0]?.delivery).toEqual({ ...delivery, acknowledged: true });
  });

  it('orders and pages only the requested owner’s finished deliveries without consuming them', async () => {
    const queue = await setup();
    for (let i = 0; i < 35; i++) {
      await queue.enqueue(command(`page-${i}`)); const current = await claim(queue);
      await queue.complete(current, { terminal: { kind: 'cold' }, message: `Reply ${i}` });
    }
    await queue.enqueue(command('other', '910003')); const other = await claim(queue);
    await queue.complete(other, { terminal: { kind: 'held' }, message: 'Other owner.' });
    await queue.enqueue(command('unfinished'));
    const first = await queue.ownerOutcomes(kingdom(), person());
    expect(first).toHaveLength(32);
    expect(first.map(row => row.delivery?.message)).toEqual(Array.from({ length: 32 }, (_, i) => `Reply ${i}`));
    const last = await queue.ownerOutcomes(kingdom(), person(), { afterSequence: first[31]!.sequence, limit: 3 });
    expect(last.map(row => row.delivery?.message)).toEqual(['Reply 32', 'Reply 33', 'Reply 34']);
    expect(await queue.ownerOutcomes(kingdom(), person(), { afterSequence: last[2]!.sequence })).toEqual([]);
    expect(await queue.ownerOutcomes(kingdom(), person())).toEqual(first);
  });
});

describe('commit ordering and claim fencing', () => {
  it('blocks later work only in the same kingdom and releases the barrier on completion', async () => {
    const queue = await setup();
    await queue.enqueue(command('first')); await queue.enqueue(command('same-maker'));
    await queue.enqueue(command('other-maker', '910003')); await queue.enqueue(command('other-kingdom', '910004', '910010'));
    const first = await claim(queue), next = await claim(queue), elsewhere = await claim(queue);
    expect([first.command.messageId, next.command.messageId, elsewhere.command.messageId]).toEqual(['first', 'other-maker', 'other-kingdom']);
    expect(await queue.claimNext()).toBeNull();
    expect(queue.canCommit(first)).toBe(true); expect(queue.canCommit(next)).toBe(false); expect(queue.canCommit(elsewhere)).toBe(true);
    await queue.complete(first, { terminal: { kind: 'held' }, message: 'Waiting.' });
    const sameMaker = await claim(queue);
    expect(sameMaker.command.messageId).toBe('same-maker'); expect(queue.canCommit(sameMaker)).toBe(true);
    expect(queue.canCommit(next)).toBe(false);
    await queue.complete(sameMaker, { terminal: { kind: 'held' }, message: 'Waiting too.' });
    expect(queue.canCommit(next)).toBe(true);
  });

  it('parks excluded work without losing its attempt or spent calls and fences expired claims', async () => {
    let now = 1_000;
    const queue = await setup({ now: () => now, claimMs: 1_000 });
    const admitted = await queue.enqueue(command('parked'));
    await queue.enqueue(command('later', '910003'));
    const first = await claim(queue); await queue.beginModelCall(first, 'words'); await queue.retry(first);
    const later = await claim(queue, new Set([admitted.receipt.key]));
    expect(later.command.messageId).toBe('later'); expect(queue.canCommit(later)).toBe(false);
    const resumed = await claim(queue);
    expect(resumed.attempt).toEqual(first.attempt); expect(resumed.receipt.modelCalls).toBe(1);
    expect(queue.canCommit(first)).toBe(false); expect(queue.canCommit(resumed)).toBe(true);
    now = 2_000;
    expect(queue.canCommit(resumed)).toBe(false);
    const replacement = await claim(queue);
    expect(replacement.attempt).toEqual(resumed.attempt); expect(replacement.receipt.modelCalls).toBe(1);
    expect(queue.canCommit(replacement)).toBe(true);
    await expect(queue.complete(resumed, { terminal: { kind: 'held' }, message: 'Stale.' })).rejects.toMatchObject({ code: 'stale' });
  });
});
