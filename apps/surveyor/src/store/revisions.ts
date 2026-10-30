import {
  closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, writeSync,
} from 'node:fs';
import { join } from 'node:path';
import { AtlasError, bound } from '../errors';
import { sha256, type ProjectedSnapshot } from '../export/project';
import {
  CurrentPointerSchema, LedgerEntrySchema, RevisionIdSchema, SNAPSHOT_FILE_NAMES, SNAPSHOT_FILES, SnapshotManifestSchema,
  type CurrentPointer, type LedgerEntry, type SnapshotManifest,
} from '../export/schema';

/**
 * ATLAS_DATA_DIR layout. Everything this service writes lives here; nothing is ever written next to the source.
 *
 *   current.json                    pointer to the last good revision, replaced by an atomic rename
 *   revisions/<revision>/           immutable revision: import.json + ndjson observation files
 *   ledger/imports.ndjson           append-only record of every import attempt
 *   .staging/                       temporary revisions being written and verified
 *   .import.lock                    one import at a time
 */
export function layout(dataDir: string) {
  return {
    dataDir,
    current: join(dataDir, 'current.json'),
    revisions: join(dataDir, 'revisions'),
    staging: join(dataDir, '.staging'),
    ledger: join(dataDir, 'ledger', 'imports.ndjson'),
    lock: join(dataDir, '.import.lock'),
  };
}

export const MANIFEST_FILE = 'import.json';

function writeDurable(path: string, bytes: Uint8Array | string): void {
  const fd = openSync(path, 'wx');
  try {
    writeSync(fd, typeof bytes === 'string' ? Buffer.from(bytes) : bytes);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function fsyncDir(path: string): void {
  const fd = openSync(path, 'r');
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function lockHolder(lock: string): number {
  try {
    return Number((JSON.parse(readFileSync(lock, 'utf8')) as { pid?: unknown }).pid) || 0;
  } catch {
    return 0;
  }
}

/** Exclusive import lock; a lock left by a dead process is reclaimed rather than blocking forever. */
export function acquireLock(dataDir: string): () => void {
  const { lock } = layout(dataDir);
  mkdirSync(dataDir, { recursive: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      writeDurable(lock, JSON.stringify({ pid: process.pid }));
      return () => rmSync(lock, { force: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      const holder = lockHolder(lock);
      if (holder && holder !== process.pid && pidAlive(holder)) {
        throw new AtlasError('store', `Another import (pid ${holder}) is writing ATLAS_DATA_DIR.`);
      }
      rmSync(lock, { force: true });
    }
  }
  throw new AtlasError('store', 'Could not take the import lock.');
}

export function readCurrent(dataDir: string): CurrentPointer | null {
  const { current } = layout(dataDir);
  if (!existsSync(current)) return null;
  return CurrentPointerSchema.parse(JSON.parse(readFileSync(current, 'utf8')));
}

export function revisionDir(dataDir: string, revision: string): string {
  return join(layout(dataDir).revisions, RevisionIdSchema.parse(revision));
}

export function readManifest(dataDir: string, revision: string): { manifest: SnapshotManifest; sha256: string } {
  const bytes = readFileSync(join(revisionDir(dataDir, revision), MANIFEST_FILE));
  return { manifest: SnapshotManifestSchema.parse(JSON.parse(bytes.toString('utf8'))), sha256: sha256(bytes) };
}

export function appendLedger(dataDir: string, entry: Omit<LedgerEntry, 'version'>): void {
  const { ledger } = layout(dataDir);
  mkdirSync(join(dataDir, 'ledger'), { recursive: true });
  const line = LedgerEntrySchema.parse({
    version: 1, ...entry,
    message: entry.message === null ? null : bound(entry.message, 700),
    details: entry.details.slice(0, 6).map((detail) => bound(detail, 220)),
  });
  const fd = openSync(ledger, 'a');
  try {
    writeSync(fd, `${JSON.stringify(line)}\n`);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

export function readLedger(dataDir: string): LedgerEntry[] {
  const { ledger } = layout(dataDir);
  if (!existsSync(ledger)) return [];
  return readFileSync(ledger, 'utf8').split('\n').filter(Boolean).map((line) => LedgerEntrySchema.parse(JSON.parse(line)));
}

export interface PublishResult {
  outcome: 'published' | 'unchanged';
  revision: string;
  pruned: string[];
}

/**
 * Writes a whole revision into staging, re-reads and verifies every file against its manifest, then renames it into
 * place and finally swaps current.json. Until that last rename, readers keep seeing the previous good revision; a
 * crash at any earlier point leaves only an orphaned staging folder, which the next import clears.
 */
export function publishRevision(dataDir: string, snapshot: ProjectedSnapshot, opts: { now: () => number; keepRevisions: number; verify: (dir: string) => void }): PublishResult {
  const paths = layout(dataDir);
  const { manifest } = snapshot;
  mkdirSync(paths.revisions, { recursive: true });
  rmSync(paths.staging, { recursive: true, force: true });
  mkdirSync(paths.staging, { recursive: true });

  const target = revisionDir(dataDir, manifest.revision);
  const current = readCurrent(dataDir);
  if (existsSync(target)) {
    // Same content as an existing revision: verify it is intact, then point at it if it is not already current.
    opts.verify(target);
    if (current?.revision === manifest.revision) return { outcome: 'unchanged', revision: manifest.revision, pruned: [] };
  } else {
    const staged = join(paths.staging, `${manifest.revision}-${process.pid}`);
    mkdirSync(staged);
    for (const file of SNAPSHOT_FILES) writeDurable(join(staged, SNAPSHOT_FILE_NAMES[file]), snapshot.files.bytes[file]);
    writeDurable(join(staged, MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`);
    fsyncDir(staged);
    opts.verify(staged);
    renameSync(staged, target);
    fsyncDir(paths.revisions);
  }

  const { sha256: manifestSha256 } = readManifest(dataDir, manifest.revision);
  const pointer = CurrentPointerSchema.parse({ version: 1, revision: manifest.revision, manifestSha256, switchedAt: opts.now() });
  const tmp = `${paths.current}.${process.pid}.tmp`;
  rmSync(tmp, { force: true });
  writeDurable(tmp, `${JSON.stringify(pointer, null, 2)}\n`);
  renameSync(tmp, paths.current);
  fsyncDir(dataDir);
  rmSync(paths.staging, { recursive: true, force: true });
  return { outcome: 'published', revision: manifest.revision, pruned: pruneRevisions(dataDir, opts.keepRevisions) };
}

/**
 * Retention: keep the newest revisions by observation cut, always including the current one. Older revisions hold
 * raw names and titles past their useful life, so they are removed rather than accumulated.
 */
export function pruneRevisions(dataDir: string, keep: number): string[] {
  const paths = layout(dataDir);
  const current = readCurrent(dataDir)?.revision;
  const revisions = readdirSync(paths.revisions).filter((name) => RevisionIdSchema.safeParse(name).success);
  const dated = revisions.map((revision) => {
    try {
      return { revision, asOf: readManifest(dataDir, revision).manifest.asOf };
    } catch {
      return { revision, asOf: 0 };
    }
  }).sort((a, b) => b.asOf - a.asOf || (a.revision < b.revision ? 1 : -1));
  const keepSet = new Set(dated.slice(0, keep).map((entry) => entry.revision));
  if (current) keepSet.add(current);
  const pruned: string[] = [];
  for (const { revision } of dated) {
    if (keepSet.has(revision)) continue;
    rmSync(join(paths.revisions, revision), { recursive: true, force: true });
    pruned.push(revision);
  }
  return pruned;
}
