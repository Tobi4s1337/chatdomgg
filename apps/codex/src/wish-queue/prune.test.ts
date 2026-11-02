import { afterEach, expect, it } from 'vitest';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { KingdomIdSchema, PersonIdSchema } from '@chatdom/shared';
import { FileForgeWishQueue } from './index';

const directories: string[] = [], queues: FileForgeWishQueue[] = [];
afterEach(async () => {
  await Promise.all(queues.splice(0).map(queue => queue.close()));
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});
const wish = (messageId: string, personId: string, observedAt: number) => ({ kingdomId: KingdomIdSchema.parse('910001'),
  personId: PersonIdSchema.parse(personId), messageId, slot: 2, words: 'A small moon lantern', observedAt });

it('forgets only finished wishes whose maker heard the outcome, and keeps the line working after a reopen', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'forge-wish-prune-')); directories.push(directory);
  const queue = await FileForgeWishQueue.open({ directory, origin: 'simulated' }); queues.push(queue);
  await queue.enqueue(wish('heard', '910002', 100));
  await queue.enqueue(wish('unheard', '910003', 100));
  await queue.enqueue(wish('waiting', '910004', 100));
  await queue.enqueue(wish('recent', '910005', 5_000));
  for (const id of ['heard', 'unheard', 'recent']) {
    const claim = (await queue.claimNext({ excludeKeys: new Set((await queue.list()).filter(r => r.messageId === 'waiting').map(r => r.key)) }))!;
    expect(claim.command.messageId).toBe(id);
    const done = await queue.complete(claim, { terminal: { kind: 'cold' }, message: 'The forge fire needs another moment.' });
    if (id !== 'unheard') await queue.acknowledgeOwner(done.kingdomId, done.personId, { key: done.key, attemptId: done.attemptId, replyId: done.delivery!.replyId });
  }
  expect(await queue.prune(1_000)).toBe(1);
  expect((await queue.list()).map(receipt => receipt.messageId).sort()).toEqual(['recent', 'unheard', 'waiting']);
  expect((await readdir(directory)).filter(name => name.startsWith('wish-'))).toHaveLength(3);
  await queue.close(); queues.length = 0;
  const reopened = await FileForgeWishQueue.open({ directory, origin: 'simulated' }); queues.push(reopened);
  expect((await reopened.list()).map(receipt => receipt.messageId).sort()).toEqual(['recent', 'unheard', 'waiting']);
  expect((await reopened.enqueue(wish('next', '910006', 6_000))).receipt.sequence).toBeGreaterThan(4);
});
