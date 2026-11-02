import { spawn } from 'node:child_process';
import { constants, type Stats } from 'node:fs';
import { lstat, mkdir, open, readdir, rename, unlink, type FileHandle } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, join, parse, resolve } from 'node:path';
import { ForgeWishQueueError } from './types';

const nofollow = constants.O_NOFOLLOW;
const isCode = (error: unknown, code: string) => error instanceof Error && 'code' in error && error.code === code;
const privateFile = (info: Stats) => info.isFile() && info.nlink === 1
  && (info.mode & 0o777) === 0o600 && (process.getuid === undefined || info.uid === process.getuid());

/** A dedicated local spool. All child paths are anchored to its open directory, even if its name moves. */
export class PrivateWishFiles {
  private constructor(private readonly root: FileHandle, private readonly owner: FileHandle) {}
  private path(name: string) {
    if (!/^(?:owner\.lock|queue\.json|queue\.key|wish-[a-f0-9]{64}\.json|\.pending-[a-f0-9-]{36}\.json)$/.test(name))
      throw new ForgeWishQueueError('invalid');
    return `/proc/self/fd/${this.root.fd}/${name}`;
  }

  static async open(directory: string): Promise<PrivateWishFiles> {
    if (!directory.trim() || process.platform !== 'linux') throw new ForgeWishQueueError('invalid');
    const target = resolve(directory), anchor = parse(target).root;
    if (target === anchor) throw new ForgeWishQueueError('invalid');
    let cursor = anchor;
    // Reject symlink ancestors rather than letting a configured path silently name another spool.
    for (const component of target.slice(anchor.length).split('/')) {
      cursor = join(cursor, component);
      let created = false;
      try { await mkdir(cursor, { mode: 0o700 }); created = true; }
      catch (error) { if (!isCode(error, 'EEXIST')) throw new ForgeWishQueueError('unavailable'); }
      const info = await lstat(cursor).catch(() => { throw new ForgeWishQueueError('unavailable'); });
      if (!info.isDirectory() || info.isSymbolicLink()) throw new ForgeWishQueueError('invalid');
      if (cursor === target && ((info.mode & 0o777) !== 0o700
        || process.getuid !== undefined && info.uid !== process.getuid())) throw new ForgeWishQueueError('invalid');
      if (created) {
        const parent = await open(dirname(cursor), constants.O_RDONLY | constants.O_DIRECTORY | nofollow);
        try { await parent.sync(); } finally { await parent.close(); }
      }
    }
    let root: FileHandle | undefined, owner: FileHandle | undefined;
    try {
      root = await open(target, constants.O_RDONLY | constants.O_DIRECTORY | nofollow);
      owner = await open(`/proc/self/fd/${root.fd}/owner.lock`, constants.O_RDWR | constants.O_CREAT | nofollow, 0o600);
      if (!privateFile(await owner.stat())) throw new ForgeWishQueueError('invalid');
      // flock locks the inherited open-file description. The parent descriptor keeps the lock after this
      // tiny child exits; killing the owner releases it in the kernel, without stale PID or timeout guesses.
      const code = await new Promise<number | null>((resolveCode, reject) => {
        const child = spawn('flock', ['--exclusive', '--nonblock', '3'], { stdio: ['ignore', 'ignore', 'ignore', owner!.fd] });
        child.once('error', () => reject(new ForgeWishQueueError('unavailable')));
        child.once('close', resolveCode);
      });
      if (code !== 0) throw new ForgeWishQueueError(code === 1 ? 'busy' : 'unavailable');
      await root.sync();
      // Persist creation of the spool itself as well as its children.
      const parent = await open(dirname(target), constants.O_RDONLY | constants.O_DIRECTORY | nofollow);
      try { await parent.sync(); } finally { await parent.close(); }
      return new PrivateWishFiles(root, owner);
    } catch (error) {
      await owner?.close().catch(() => {}); await root?.close().catch(() => {});
      throw error instanceof ForgeWishQueueError ? error : new ForgeWishQueueError('unavailable');
    }
  }

  async names(): Promise<string[]> { return readdir(`/proc/self/fd/${this.root.fd}`); }

  async read(name: string, maximum: number): Promise<string | null> {
    let file: FileHandle;
    try { file = await open(this.path(name), constants.O_RDONLY | constants.O_NONBLOCK | nofollow); }
    catch (error) { if (isCode(error, 'ENOENT')) return null; throw new ForgeWishQueueError('corrupt'); }
    try {
      const info = await file.stat();
      if (!privateFile(info) || info.size > maximum) throw new ForgeWishQueueError('corrupt');
      const bytes = await file.readFile('utf8');
      if (Buffer.byteLength(bytes) > maximum) throw new ForgeWishQueueError('corrupt');
      return bytes;
    } finally { await file.close(); }
  }

  async write(name: string, bytes: string): Promise<void> {
    const temporary = `.pending-${randomUUID()}.json`;
    let file: FileHandle | undefined;
    let failed = false;
    try {
      file = await open(this.path(temporary), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | nofollow, 0o600);
      await file.writeFile(bytes, 'utf8'); await file.sync(); await file.close(); file = undefined;
      await rename(this.path(temporary), this.path(name));
      await this.root.sync();
    } catch { failed = true; }
    try { await file?.close(); } catch { failed = true; }
    // A crash before rename leaves an unacknowledged private temporary; startup removes it under the lock.
    try { await unlink(this.path(temporary)); await this.root.sync(); }
    catch (error) { if (!isCode(error, 'ENOENT')) failed = true; }
    // A cleanup failure is also an uncertain write. Keep all diagnostics private, revoke the owner above.
    if (failed) throw new ForgeWishQueueError('unavailable');
  }

  async clearTemporary(name: string): Promise<void> {
    if (!/^\.pending-[a-f0-9-]{36}\.json$/.test(name)) throw new ForgeWishQueueError('corrupt');
    // Refuse links/unexpected modes before deleting anything, even an abandoned temporary.
    await this.read(name, 1_100_000);
    await unlink(this.path(name)); await this.root.sync();
  }

  async close(): Promise<void> {
    try { await this.owner.close(); } finally { await this.root.close(); }
  }
}
