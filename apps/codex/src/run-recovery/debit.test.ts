import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHome } from '@chatdom/content';
import { forgeStyleKit } from '@chatdom/forge';
import { KingdomIdSchema, PersonIdSchema, type ForgeRunEvent } from '@chatdom/shared';
import { createForgeProviders } from '../providers';
import { runForge, type ForgeRunRecord } from '../run';
import { FileForgeWishQueue, ForgeWishQueueError } from '../wish-queue';
import { createQueuedForgeRunRecovery } from './index';

const queues: FileForgeWishQueue[] = [], directories: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const queue of queues.splice(0)) await queue.close();
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});

it.each([false, true])('settles a delayed durable debit before a provider timeout snapshot (failed=%s)', async failed => {
  const directory = await mkdtemp(join(tmpdir(), 'forge-debit-deadline-')); directories.push(directory);
  const queue = await FileForgeWishQueue.open({ directory, origin: 'simulated' }); queues.push(queue);
  const words = 'A little moon lantern beside my hearth';
  const request = { words, family: 'hearth' as const, home: createHome('house', 'hearth', 0) };
  await queue.enqueue({ kingdomId: KingdomIdSchema.parse('1101'), personId: PersonIdSchema.parse('1102'),
    messageId: 'deadline', slot: 1, observedAt: Date.now(), words });
  const claim = (await queue.claimNext())!;
  let entered!: () => void, release!: () => void;
  const waiting = new Promise<void>(resolve => { entered = resolve; });
  const barrier = new Promise<void>(resolve => { release = resolve; });
  const begin = queue.beginModelCall.bind(queue);
  vi.spyOn(queue, 'beginModelCall').mockImplementationOnce(async (owned, stage) => {
    const ordinal = await begin(owned, stage); entered(); await barrier;
    if (failed) throw new ForgeWishQueueError('unavailable');
    return ordinal;
  });
  const runner = vi.fn(async () => { throw new Error('No timed-out model request may begin'); });
  const providers = createForgeProviders({ runCodex: runner, judgeTimeoutMs: 20 });
  const events: ForgeRunEvent[] = [], records: ForgeRunRecord[] = [];
  const context = { safetyIdentifier: 'private-stable-citizen-0001', styleKit: forgeStyleKit('hearth'),
    recovery: createQueuedForgeRunRecovery(queue, claim) };
  const running = runForge(request, providers, event => events.push(event), async value => { records.push(value); }, claim.signal, context);
  // Attach rejection observation immediately, while keeping the actual result for the assertion below.
  const observed = running.then(() => null, error => error as unknown);
  await waiting;
  await new Promise<void>(resolve => setTimeout(resolve, 50));
  const premature = events.some(event => event.type === 'stopped');
  release(); const error = await observed;
  expect(premature).toBe(false); expect(runner).not.toHaveBeenCalled();
  if (failed) {
    expect(error).toMatchObject({ code: 'unavailable' }); expect(records).toEqual([]);
    expect(events.some(event => event.type === 'stopped')).toBe(false);
  } else {
    expect(error).toBeNull(); expect(records.at(-1)).toMatchObject({ modelCalls: 1, outcome: 'cold' });
  }
  await queue.close();
  const reopened = await FileForgeWishQueue.open({ directory, origin: 'simulated' }); queues.push(reopened);
  const next = (await reopened.claimNext())!;
  expect(next.receipt.modelCalls).toBe(1);
  const recovery = createQueuedForgeRunRecovery(reopened, next);
  const restored = await recovery.restore({ request, safetyIdentifier: context.safetyIdentifier, styleKit: context.styleKit });
  expect(restored.phase).toBe(failed ? 'words' : 'stopped');
});
