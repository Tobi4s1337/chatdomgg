import { afterEach, describe, expect, it } from 'vitest';
import { chmod, link, lstat, mkdir, mkdtemp, open as openFile, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { execFile } from 'node:child_process';
import { clearTimeout } from 'node:timers';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { KingdomIdSchema, PersonIdSchema } from '@chatdom/shared';
import type { KingdomForgeCommand } from '@chatdom/shared/realm';
import { FileForgeWishQueue } from './index';

const directories: string[] = [];
const queues: FileForgeWishQueue[] = [];
afterEach(async () => {
  for (const queue of queues.splice(0)) await queue.close().catch(() => {});
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true });
});

const wish: KingdomForgeCommand = {
  kingdomId: KingdomIdSchema.parse('123'), personId: PersonIdSchema.parse('456'),
  messageId: 'adversarial-message', slot: 19, observedAt: 2_000_000,
  words: 'Private words: a purple badger by the old oak',
};
async function directory() {
  const path = await mkdtemp(join(tmpdir(), 'forge-queue-adversarial-'));
  directories.push(path);
  return path;
}
async function open(path: string, origin: 'live' | 'simulated' = 'live') {
  const queue = await FileForgeWishQueue.open({ directory: path, origin, now: () => 2_000_000 });
  queues.push(queue);
  return queue;
}
async function close(queue: FileForgeWishQueue) {
  await queue.close();
  queues.splice(queues.indexOf(queue), 1);
}
async function claim(queue: FileForgeWishQueue) {
  const result = await queue.claimNext();
  expect(result).not.toBeNull();
  if (!result) throw new Error('Expected a claim');
  return result;
}

/** Inspect every regular spool file rather than a known filename: an obsolete temporary is still a leak. */
async function spoolContents(path: string): Promise<string> {
  const contents: string[] = [];
  for (const name of await readdir(path)) {
    const file = join(path, name), stat = await lstat(file);
    expect(stat.isFile()).toBe(true);
    expect(stat.mode & 0o777).toBe(0o600);
    contents.push(await readFile(file, 'utf8'));
  }
  return contents.join('\n');
}

describe('the private wish spool under adversarial recovery', () => {
  it('keeps the source ID bound to the exact payload after restart and after erasure', async () => {
    const path = await directory();
    let queue = await open(path);
    const first = await queue.enqueue(wish);
    expect(first.kind).toBe('queued');
    await close(queue);
    queue = await open(path);
    const duplicate = await queue.enqueue({ ...wish });
    expect(duplicate.kind).toBe('existing');
    expect(duplicate.receipt.key).toBe(first.receipt.key);
    for (const changed of [
      { ...wish, words: 'Another private wish' },
      { ...wish, personId: PersonIdSchema.parse('457') },
      { ...wish, slot: wish.slot + 1 },
      { ...wish, observedAt: wish.observedAt + 1 },
    ]) await expect(queue.enqueue(changed)).rejects.toMatchObject({ code: 'conflict' });
    await queue.finish(await claim(queue), { kind: 'held' });
    await close(queue);
    queue = await open(path);
    expect((await queue.enqueue({ ...wish })).kind).toBe('existing');
    await expect(queue.enqueue({ ...wish, words: 'A later altered wish' })).rejects.toMatchObject({ code: 'conflict' });
    expect(await queue.claimNext()).toBeNull();
    expect(await spoolContents(path)).not.toContain(wish.words);
  });

  it('does not open a live spool as simulated or vice versa', async () => {
    const path = await directory();
    const queue = await open(path, 'live');
    await queue.enqueue(wish);
    await close(queue);
    await expect(FileForgeWishQueue.open({ directory: path, origin: 'simulated' })).rejects.toMatchObject({ code: 'conflict' });
    const reopened = await open(path, 'live');
    expect((await reopened.enqueue(wish)).kind).toBe('existing');
  });

  it.each([
    { kind: 'held' }, { kind: 'cold' }, { kind: 'canceled' }, { kind: 'refused' },
    { kind: 'committed', runId: 'run-123', committedAt: 2_000_001 },
  ] as const)('erases words and private checkpoint data after $kind, including on reopen', async outcome => {
    const path = await directory();
    let queue = await open(path);
    await queue.enqueue(wish);
    const active = await claim(queue);
    const artifact = 'private-checkpoint-artifact-unique-to-this-wish';
    await queue.checkpoint(active, { id: 'words-result', stage: 'words', data: { privateArtifact: artifact } });
    const before = await spoolContents(path);
    expect(before).toContain(wish.words);
    expect(before).toContain(artifact);
    await queue.finish(active, outcome);
    for (const secret of [wish.words, artifact]) expect(await spoolContents(path)).not.toContain(secret);
    await close(queue);
    queue = await open(path);
    expect(await queue.claimNext()).toBeNull();
    for (const secret of [wish.words, artifact]) expect(await spoolContents(path)).not.toContain(secret);
  });

  it('rejects symlinked spool ancestors and unsafe file links without changing their targets', async () => {
    const parent = await directory(), target = join(parent, 'target'), alias = join(parent, 'alias');
    await mkdir(target, { mode: 0o700 });
    await symlink(target, alias);
    await expect(FileForgeWishQueue.open({ directory: join(alias, 'spool'), origin: 'live' })).rejects.toMatchObject({ code: 'invalid' });
    const path = join(parent, 'spool');
    const queue = await open(path);
    await queue.enqueue(wish);
    await close(queue);
    const queueFile = join(path, 'queue.json'), external = join(parent, 'external.json');
    const original = await readFile(queueFile, 'utf8');
    await rm(queueFile);
    await writeFile(external, original, { mode: 0o600 });
    await symlink(external, queueFile);
    await expect(FileForgeWishQueue.open({ directory: path, origin: 'live' })).rejects.toMatchObject({ code: 'corrupt' });
    expect(await readFile(external, 'utf8')).toBe(original);
    await rm(queueFile);
    await link(external, queueFile);
    await expect(FileForgeWishQueue.open({ directory: path, origin: 'live' })).rejects.toMatchObject({ code: 'corrupt' });
    expect(await readFile(external, 'utf8')).toBe(original);
    await rm(queueFile);
    await writeFile(queueFile, original, { mode: 0o600 });
    await chmod(queueFile, 0o644);
    await expect(FileForgeWishQueue.open({ directory: path, origin: 'live' })).rejects.toMatchObject({ code: 'corrupt' });
  });

  it('fences the old worker after retry and does not let it consume budget or finish a newer claim', async () => {
    const path = await directory(), queue = await open(path);
    await queue.enqueue(wish);
    const old = await claim(queue);
    expect(await queue.beginModelCall(old, 'words')).toBe(1);
    await queue.retry(old);
    const current = await claim(queue);
    expect(current.receipt.modelCalls).toBe(1);
    expect(current.receipt.attemptId).toBe(old.receipt.attemptId);
    expect(old.current()).toBe(false);
    await expect(queue.beginModelCall(old, 'words')).rejects.toMatchObject({ code: 'stale' });
    await expect(queue.checkpoint(old, { id: 'late', stage: 'words', data: {} })).rejects.toMatchObject({ code: 'stale' });
    await expect(queue.finish(old, { kind: 'held' })).rejects.toMatchObject({ code: 'stale' });
    expect(await queue.beginModelCall(current, 'words')).toBe(2);
  });

  it('rejects a named pipe as corrupt without waiting for a writer', async () => {
    const path = await directory(), queue = await open(path);
    await close(queue);
    const queueFile = join(path, 'queue.json');
    await rm(queueFile);
    await new Promise<void>((resolve, reject) => {
      execFile('mkfifo', ['-m', '600', queueFile], error => error ? reject(error) : resolve());
    });
    const pending = FileForgeWishQueue.open({ directory: path, origin: 'live' });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await expect(Promise.race([pending, new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('A corrupt pipe blocked queue startup.')), 2_000);
      })])).rejects.toMatchObject({ code: 'corrupt' });
    } finally {
      clearTimeout(timer);
      // Unblock a regressed blocking read before fixture cleanup, so a failing test cannot strand a worker.
      const unblock = await openFile(queueFile, constants.O_RDWR | constants.O_NONBLOCK);
      await unblock.close();
      await pending.catch(() => {});
    }
  });

  it('never resets the call budget on retry or reopen and accepts only explicit extension reasons', async () => {
    const path = await directory();
    let queue = await open(path);
    await queue.enqueue(wish);
    let current = await claim(queue);
    for (let ordinal = 1; ordinal <= 5; ordinal++) expect(await queue.beginModelCall(current, 'words')).toBe(ordinal);
    await expect(queue.beginModelCall(current, 'words')).rejects.toMatchObject({ code: 'budget' });
    await expect(queue.extendBudget(current, 'ordinary-retry' as never)).rejects.toMatchObject({ code: 'invalid' });
    await queue.retry(current);
    await close(queue);
    queue = await open(path);
    current = await claim(queue);
    expect(current.receipt.modelCalls).toBe(5);
    expect(current.receipt.callLimit).toBe(5);
    await expect(queue.beginModelCall(current, 'words')).rejects.toMatchObject({ code: 'budget' });
    await queue.extendBudget(current, 'fit');
    expect(await queue.beginModelCall(current, 'drafting')).toBe(6);
    expect(await queue.beginModelCall(current, 'result')).toBe(7);
    await queue.extendBudget(current, 'vocabulary');
    await expect(queue.beginModelCall(current, 'result')).rejects.toMatchObject({ code: 'budget' });
  });
});
