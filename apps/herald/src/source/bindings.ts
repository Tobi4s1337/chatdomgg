import { KingdomIdSchema, PersonIdSchema, type KingdomId } from '@chatdom/shared';
import type { PresenceBinding } from '@chatdom/world';
import { randomBytes } from 'node:crypto';
import { constants, type FileHandle, link, open, readFile, rename, rm, stat, mkdir, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { z } from 'zod';

/** Why a binding table cannot be used. Every one of these fails closed: no slot ever changes because of it. */
export type BindingStoreFault = 'corrupt' | 'unwritable' | 'locked' | 'insecure' | 'inside_repository';

export class BindingStoreError extends Error {
  override readonly name = 'BindingStoreError';
  constructor(readonly fault: BindingStoreFault) {
    super(`presence binding table ${fault.replace('_', ' ')}`);
  }
}

/**
 * The private, durable person → window slot table for one kingdom. It holds nothing else: no names, no
 * history, no chat. `save` must be durable before it resolves, because a slot is published only after the
 * binding that places it has been kept.
 */
export interface BindingStore {
  readonly kind: 'file' | 'memory';
  load(): Promise<readonly PresenceBinding[]>;
  save(bindings: readonly PresenceBinding[]): Promise<void>;
  /** Broadcaster revocation: the kingdom's Twitch-derived private bindings are deleted. */
  erase(): Promise<void>;
  close(): Promise<void>;
}

/** Simulated sources keep their bindings in memory; synthetic people never reach a real data directory. */
export class MemoryBindingStore implements BindingStore {
  readonly kind = 'memory' as const;
  #bindings: readonly PresenceBinding[] = [];

  async load(): Promise<readonly PresenceBinding[]> {
    return this.#bindings;
  }

  async save(bindings: readonly PresenceBinding[]): Promise<void> {
    this.#bindings = [...bindings];
  }

  async erase(): Promise<void> {
    this.#bindings = [];
  }

  async close(): Promise<void> {}
}

const TABLE_VERSION = 1;
const MAX_BINDINGS = 65_535;
const TableSchema = z.strictObject({
  version: z.literal(TABLE_VERSION),
  kingdomId: KingdomIdSchema,
  /** [personId, slot] pairs: the minimum that keeps a window stable. */
  bindings: z.array(z.tuple([PersonIdSchema, z.number().int().min(0).max(65_534)])).max(MAX_BINDINGS),
}).superRefine((table, ctx) => {
  if (new Set(table.bindings.map(([person]) => person)).size !== table.bindings.length) ctx.addIssue({ code: 'custom', message: 'duplicate person' });
  if (new Set(table.bindings.map(([, slot]) => slot)).size !== table.bindings.length) ctx.addIssue({ code: 'custom', message: 'duplicate slot' });
});

export interface FileBindingStoreOptions {
  /** Absolute directory outside the repository, owned by this user only. */
  readonly dataDir: string;
  readonly kingdomId: KingdomId;
  /** A repository root the data directory must not be inside. */
  readonly repositoryRoot?: string | null;
  /** Liveness probe for a lock holder; defaults to signal 0. */
  readonly processAlive?: (pid: number) => boolean;
  /** Start identity of a running process, so a reused PID is not mistaken for the holder; defaults to /proc. */
  readonly processStart?: (pid: number) => Promise<string | null>;
}

/** Lock files this process holds. A second store in the same process must not share a table with the first. */
const HELD_LOCKS = new Set<string>();

/** The lock text is `<pid> <start> <nonce>`: the writer, that PID's incarnation, and the store instance. */
interface LockOwner {
  readonly pid: number;
  readonly start: string;
}

/**
 * One kingdom's binding table in `<dataDir>/presence/<kingdomId>.json`, mode 0600 in a 0700 directory.
 * A lock file makes this store the table's only writer; writes go to a temporary file that is synced and
 * renamed over the table, then the directory is synced, so a crash leaves either the old or the new table.
 */
export class FileBindingStore implements BindingStore {
  readonly kind = 'file' as const;
  readonly #dir: string;
  readonly #table: string;
  readonly #lock: string;
  readonly #options: FileBindingStoreOptions;
  /** The exact lock text this store wrote; set only while it holds the table. */
  #token: string | null = null;
  #fault: BindingStoreFault | null = null;

  constructor(options: FileBindingStoreOptions) {
    this.#options = options;
    this.#dir = join(options.dataDir, 'presence');
    this.#table = join(this.#dir, `${KingdomIdSchema.parse(options.kingdomId)}.json`);
    this.#lock = resolve(`${this.#table}.lock`);
  }

  get fault(): BindingStoreFault | null {
    return this.#fault;
  }

  async load(): Promise<readonly PresenceBinding[]> {
    return this.#guard(async () => {
      const { dataDir, repositoryRoot } = this.#options;
      if (!isAbsolute(dataDir)) throw new BindingStoreError('unwritable');
      if (repositoryRoot && isInside(resolve(repositoryRoot), resolve(dataDir))) throw new BindingStoreError('inside_repository');
      await mkdir(this.#dir, { recursive: true, mode: 0o700 }).catch(() => {
        throw new BindingStoreError('unwritable');
      });
      const mode = await stat(this.#dir).then(info => info.mode, () => null);
      if (mode === null) throw new BindingStoreError('unwritable');
      if ((mode & 0o077) !== 0) throw new BindingStoreError('insecure');
      await this.#acquire();
      let text: string;
      try {
        const mode = (await stat(this.#table)).mode;
        if ((mode & 0o077) !== 0) throw new BindingStoreError('insecure');
        text = await readFile(this.#table, 'utf8');
      } catch (error) {
        if (error instanceof BindingStoreError) throw error;
        if (isCode(error, 'ENOENT')) return [];
        throw new BindingStoreError('unwritable');
      }
      let parsed: z.infer<typeof TableSchema>;
      try {
        parsed = TableSchema.parse(JSON.parse(text));
      } catch {
        throw new BindingStoreError('corrupt');
      }
      if (parsed.kingdomId !== this.#options.kingdomId) throw new BindingStoreError('corrupt');
      return parsed.bindings.map(([personId, slot]) => ({ personId, slot }));
    });
  }

  async save(bindings: readonly PresenceBinding[]): Promise<void> {
    return this.#guard(async () => {
      await this.#confirmOwnership();
      const table = TableSchema.parse({
        version: TABLE_VERSION, kingdomId: this.#options.kingdomId,
        bindings: bindings.map(binding => [binding.personId, binding.slot]),
      });
      const temporary = `${this.#table}.${randomBytes(6).toString('hex')}.tmp`;
      let handle: FileHandle | null = null;
      try {
        handle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
        await handle.writeFile(`${JSON.stringify(table)}\n`, 'utf8');
        await handle.sync();
        await handle.close();
        handle = null;
        await rename(temporary, this.#table);
        await syncDirectory(this.#dir);
      } catch {
        await handle?.close().catch(() => undefined);
        await rm(temporary, { force: true }).catch(() => undefined);
        throw new BindingStoreError('unwritable');
      }
    });
  }

  async erase(): Promise<void> {
    return this.#guard(async () => {
      await this.#confirmOwnership();
      try {
        await rm(this.#table, { force: true });
        await syncDirectory(this.#dir);
      } catch {
        throw new BindingStoreError('unwritable');
      }
    });
  }

  async close(): Promise<void> {
    const token = this.#token;
    if (token === null) return;
    this.#token = null;
    HELD_LOCKS.delete(this.#lock);
    // Remove the lock only while it is still ours; a successor's lock is never touched.
    if (await readFile(this.#lock, 'utf8').catch(() => null) === token) await rm(this.#lock, { force: true }).catch(() => undefined);
  }

  /**
   * Takes the table's lock. The lock appears atomically with its owner already written (hard link of a
   * finished file), so no reader ever sees an empty lock. A holder is live while its PID runs as the same
   * incarnation; the same PID only counts as stale when no store in this process holds the lock, which means
   * an earlier process that had this PID left it behind.
   */
  async #acquire(): Promise<void> {
    if (this.#token !== null) return;
    // Claimed synchronously, before any await, so two stores in one process cannot both pass this point.
    if (HELD_LOCKS.has(this.#lock)) throw new BindingStoreError('locked');
    HELD_LOCKS.add(this.#lock);
    try {
      const start = await this.#start(process.pid) ?? '-';
      const token = `${process.pid} ${start} ${randomBytes(9).toString('hex')}\n`;
      for (let attempt = 0; attempt < 2; attempt++) {
        if (await this.#create(token)) {
          this.#token = token;
          return;
        }
        const seen = await readFile(this.#lock, 'utf8').catch(() => null);
        if (seen === null) continue; // Released between our attempt and our read.
        if (!await this.#stale(seen)) break;
        await this.#reclaim(seen);
      }
      throw new BindingStoreError('locked');
    } catch (error) {
      HELD_LOCKS.delete(this.#lock);
      throw error;
    }
  }

  async #create(token: string): Promise<boolean> {
    const draft = `${this.#lock}.${randomBytes(6).toString('hex')}.tmp`;
    try {
      await writeFile(draft, token, { mode: 0o600, flag: 'wx' });
      await link(draft, this.#lock);
      return true;
    } catch (error) {
      if (isCode(error, 'EEXIST')) return false;
      throw new BindingStoreError('unwritable');
    } finally {
      await rm(draft, { force: true }).catch(() => undefined);
    }
  }

  async #stale(text: string): Promise<boolean> {
    const owner = parseLock(text);
    // A lock this code cannot read is not provably abandoned; leave it to an operator.
    if (!owner) return false;
    if (owner.pid === process.pid) return true; // HELD_LOCKS proved no store here holds it.
    if (!(this.#options.processAlive ?? processAlive)(owner.pid)) return true;
    const start = owner.start === '-' ? null : await this.#start(owner.pid);
    return start !== null && start !== owner.start;
  }

  /**
   * Moves a stale lock aside, then confirms the moved file is the one judged stale. If another process
   * replaced it in between, its lock goes back and this store refuses the table.
   */
  async #reclaim(stale: string): Promise<void> {
    const aside = `${this.#lock}.${randomBytes(6).toString('hex')}.stale`;
    try {
      await rename(this.#lock, aside);
    } catch (error) {
      if (isCode(error, 'ENOENT')) return;
      throw new BindingStoreError('unwritable');
    }
    try {
      if (await readFile(aside, 'utf8').catch(() => null) === stale) return;
      await link(aside, this.#lock).catch(() => undefined);
      throw new BindingStoreError('locked');
    } finally {
      await rm(aside, { force: true }).catch(() => undefined);
    }
  }

  /** Every write first confirms the lock still names this instance; a lost lock stops the writer. */
  async #confirmOwnership(): Promise<void> {
    const token = this.#token;
    if (token === null || await readFile(this.#lock, 'utf8').catch(() => null) !== token) throw new BindingStoreError('locked');
  }

  #start(pid: number): Promise<string | null> {
    return (this.#options.processStart ?? processStart)(pid);
  }

  async #guard<T>(work: () => Promise<T>): Promise<T> {
    if (this.#fault) throw new BindingStoreError(this.#fault);
    try {
      return await work();
    } catch (error) {
      const fault = error instanceof BindingStoreError ? error.fault : 'unwritable';
      // A table that cannot be trusted stays untrusted until an operator restarts Herald.
      if (fault !== 'locked') this.#fault = fault;
      throw error instanceof BindingStoreError ? error : new BindingStoreError(fault);
    }
  }
}

async function syncDirectory(dir: string): Promise<void> {
  const handle = await open(dir, constants.O_RDONLY);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function parseLock(text: string): LockOwner | null {
  // A bare `<pid>` line is the first table version's lock; it carries no incarnation.
  const match = /^([1-9][0-9]{0,9})(?: (-|[0-9]{1,20}) ([0-9a-f]{18}))?\n$/.exec(text);
  if (!match) return null;
  const pid = Number(match[1]);
  return Number.isSafeInteger(pid) ? { pid, start: match[2] ?? '-' } : null;
}

/** The kernel's start time for a PID (field 22 of /proc/<pid>/stat), or null where /proc is unavailable. */
async function processStart(pid: number): Promise<string | null> {
  const text = await readFile(`/proc/${pid}/stat`, 'utf8').catch(() => null);
  if (text === null) return null;
  // The command name may contain spaces or parentheses; fields resume after its last ')'.
  const fields = text.slice(text.lastIndexOf(')') + 2).split(' ');
  const start = fields[19];
  return start && /^[0-9]{1,20}$/.test(start) ? start : null;
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return isCode(error, 'EPERM');
  }
}

/** Whether `child` is `parent` or lies inside it; the guard that keeps private tables out of the repository. */
export function isInside(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return path === '' || (!path.startsWith('..') && !isAbsolute(path));
}

function isCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code: unknown }).code === code;
}
