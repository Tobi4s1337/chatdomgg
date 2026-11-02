import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { KingdomIdSchema, PersonIdSchema } from '@chatdom/shared';
import type { KingdomForgeCommand } from '@chatdom/shared/realm';
import { FileForgeWishQueue } from './index';
import { PrivateWishFiles } from './files';

const kingdomId = KingdomIdSchema.parse('920001');
const personId = PersonIdSchema.parse('920002');
const otherPerson = PersonIdSchema.parse('920003');
const otherKingdom = KingdomIdSchema.parse('920004');
const command = (messageId: string, observedAt: number, person = personId, kingdom = kingdomId): KingdomForgeCommand => ({
  kingdomId: kingdom, personId: person, messageId, observedAt, slot: 2, words: 'A private authored wish',
});
const directories: string[] = [], queues: FileForgeWishQueue[] = [];
async function open(directory: string) {
  const queue = await FileForgeWishQueue.open({ directory, origin: 'simulated' }); queues.push(queue); return queue;
}
async function setup() {
  const directory = await mkdtemp(join(tmpdir(), 'forge-withdrawal-hardening-')); directories.push(directory);
  return { directory, queue: await open(directory) };
}
async function withdrawalFile(directory: string) {
  const matches = (await readdir(directory)).filter(name => /^withdrawal-[a-f0-9]{64}\.json$/.test(name));
  expect(matches).toHaveLength(1); return join(directory, matches[0]!);
}
afterEach(async () => {
  vi.restoreAllMocks();
  for (const queue of queues.splice(0).reverse()) await queue.close().catch(() => {});
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});

it('retains the greatest person and kingdom source cutoffs across duplicate and reordered writes and reopen', async () => {
  const { directory, queue } = await setup();
  const person = (through: number) => queue.withdraw({ kingdomId, reason: 'moderated', scope: { kind: 'person', personId, through } });
  const realm = (through: number) => queue.withdraw({ kingdomId: otherKingdom, reason: 'coverage', scope: { kind: 'kingdom', through } });
  await Promise.all([person(300), person(100), person(300), person(250), realm(700), realm(200), realm(700), realm(600)]);
  await queue.close(); const recovered = await open(directory);
  const inputs = [command('person-old', 299), command('person-boundary', 300), command('person-new', 301),
    command('other-person', 1, otherPerson), command('realm-old', 699, otherPerson, otherKingdom),
    command('realm-boundary', 700, personId, otherKingdom), command('realm-new', 701, personId, otherKingdom)];
  const receipts = await Promise.all(inputs.map(input => recovered.enqueue(input)));
  expect(receipts.map(item => recovered.isWithdrawn(item.receipt))).toEqual([true, true, false, false, true, true, false]);
  await recovered.withdraw({ kingdomId, reason: 'moderated', scope: { kind: 'person', personId, through: 200 } });
  await recovered.withdraw({ kingdomId: otherKingdom, reason: 'offline', scope: { kind: 'kingdom', through: 500 } });
  await recovered.close(); const again = await open(directory);
  expect((await again.list()).map(receipt => again.isWithdrawn(receipt))).toEqual([true, true, false, false, true, true, false]);
});

it('blocks model calls, reservations and commits for a prearrival withdrawal, but allows canceled cleanup', async () => {
  const { directory, queue } = await setup();
  await queue.withdraw({ kingdomId, reason: 'deleted', scope: { kind: 'message', messageId: 'prearrival' } });
  await queue.close(); const recovered = await open(directory);
  const admitted = await recovered.enqueue(command('prearrival', 100));
  const claim = await recovered.claimNext(); expect(claim).not.toBeNull();
  expect(claim!.withdrawal.aborted).toBe(true);
  expect(claim!.current()).toBe(true);
  expect(recovered.canReserve(claim!)).toBe(false);
  expect(recovered.canCommit(claim!)).toBe(false);
  await expect(recovered.beginModelCall(claim!, 'words')).rejects.toMatchObject({ code: 'stale' });
  await recovered.complete(claim!, { terminal: { kind: 'canceled' }, message: 'Your wish has stopped.' });
  const receipt = await recovered.get(admitted.receipt.key);
  expect(receipt).toMatchObject({ state: 'finished', modelCalls: 0, outcome: { kind: 'canceled' },
    delivery: { acknowledged: false, message: 'Your wish has stopped.' } });
});

it.each(['tampered contents', 'wrong target filename'] as const)(
  'fails closed on reopening a withdrawal with %s', async mode => {
    const { directory, queue } = await setup();
    await queue.enqueue(command('private', 100));
    await queue.withdraw({ kingdomId, reason: 'moderated', scope: { kind: 'person', personId, through: 100 } });
    await queue.close(); const path = await withdrawalFile(directory);
    if (mode === 'tampered contents') {
      const saved = JSON.parse(await readFile(path, 'utf8')) as { payload: { withdrawal: { scope: { through: number } } }; mac: string };
      saved.payload.withdrawal.scope.through = 0;
      await writeFile(path, JSON.stringify(saved), { mode: 0o600 });
    } else await rename(path, join(directory, `withdrawal-${'0'.repeat(64)}.json`));
    const error = await FileForgeWishQueue.open({ directory, origin: 'simulated' }).then(async unexpected => {
      await unexpected.close(); return null;
    }, reason => reason as Error & { code?: string });
    expect(error).toMatchObject({ code: 'corrupt' });
    expect(String(error)).not.toContain('A private authored wish');
  },
);

it('raises the withdrawal fence while an earlier checkpoint write holds the queue', async () => {
  const { queue } = await setup(); await queue.enqueue(command('queued-barrier', 100));
  const claim = await queue.claimNext(); expect(claim).not.toBeNull();
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const hold = new Promise<void>(resolve => { release = resolve; });
  const original = PrivateWishFiles.prototype.write;
  vi.spyOn(PrivateWishFiles.prototype, 'write').mockImplementationOnce(async function (this: PrivateWishFiles, name, bytes) {
    entered(); await hold; await original.call(this, name, bytes);
  });
  const checkpoint = queue.checkpoint(claim!, { id: 'before-withdrawal', stage: 'words', data: { completed: true } });
  await started;
  try {
    const withdrawal = queue.withdraw({ kingdomId, reason: 'deleted', scope: { kind: 'message', messageId: 'queued-barrier' } });
    expect(claim!.withdrawal.aborted).toBe(true);
    expect(claim!.current()).toBe(true);
    expect(queue.canReserve(claim!)).toBe(false);
    expect(queue.canCommit(claim!)).toBe(false);
    release(); await checkpoint; await withdrawal;
    await expect(queue.beginModelCall(claim!, 'words')).rejects.toMatchObject({ code: 'stale' });
    await queue.complete(claim!, { terminal: { kind: 'canceled' }, message: 'Your wish has stopped.' });
  } finally { release(); await checkpoint.catch(() => {}); }
});
