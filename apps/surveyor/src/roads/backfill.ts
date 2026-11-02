import { createHash } from 'node:crypto';
import { open, type FileHandle } from 'node:fs/promises';
import { join } from 'node:path';
import { setImmediate } from 'node:timers/promises';
import type { AtlasRaid } from '@chatdom/shared';
import { RaidObservationSchema, type SnapshotManifest } from '../export/schema';
import { readCurrent, readManifest, revisionDir } from '../store/revisions';
import type { RoadLedger } from './ledger';

const SOURCE = 'surveyor-recorder';
const MAX_RECORD_BYTES = 8192;

/** Bounded chunks and lines, with the same pinned open file used for validation and application. */
async function* records(handle: FileHandle, file: SnapshotManifest['files']['raidObservations'], signal: AbortSignal) {
  const chunk = Buffer.alloc(64 * 1024);
  const hash = createHash('sha256');
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let size = 0, count = 0, pending = '';
  for (;;) {
    signal.throwIfAborted();
    const { bytesRead } = await handle.read(chunk, 0, chunk.length, size);
    signal.throwIfAborted();
    if (bytesRead === 0) break;
    const bytes = chunk.subarray(0, bytesRead);
    size += bytes.byteLength;
    if (size > file.bytes) throw new Error('Recorder backfill file length mismatch.');
    hash.update(bytes);
    pending += decoder.decode(bytes, { stream: true });
    let newline: number;
    while ((newline = pending.indexOf('\n')) !== -1) {
      const line = pending.slice(0, newline);
      pending = pending.slice(newline + 1);
      if (!line || Buffer.byteLength(line) > MAX_RECORD_BYTES) throw new Error('Recorder backfill record length mismatch.');
      const raid = RaidObservationSchema.parse(JSON.parse(line)).raid;
      if (raid.source !== 'surveyor-recorder' || raid.evidence.kind !== 'observed' || raid.delivery !== 'resumable') {
        throw new Error('Recorder backfill must contain witnessed, resumable recorder observations.');
      }
      count++;
      yield raid;
    }
    if (Buffer.byteLength(pending) > MAX_RECORD_BYTES) throw new Error('Recorder backfill record exceeds byte limit.');
  }
  pending += decoder.decode();
  if (pending || size !== file.bytes || count !== file.records || hash.digest('hex') !== file.sha256) {
    throw new Error('Recorder backfill hash/length/count mismatch.');
  }
}

/**
 * Consume the current verified local import, not the collector's writable database. This includes recorder raids
 * witnessed during an Atlas outage. Validate bytes, count and every observation before writing any of them.
 * The source checkpoint follows the import revision, never the event clock (late observations remain valid).
 */
export async function backfillRoads(dataDir: string, ledger: RoadLedger, signal: AbortSignal): Promise<{ revision: string | null; stored: number; duplicates: number }> {
  signal.throwIfAborted();
  const pointer = readCurrent(dataDir);
  if (!pointer) return { revision: null, stored: 0, duplicates: 0 };
  const after = ledger.checkpoint(SOURCE);
  if (after === pointer.revision) return { revision: pointer.revision, stored: 0, duplicates: 0 };
  const read = readManifest(dataDir, pointer.revision);
  if (read.sha256 !== pointer.manifestSha256) throw new Error('Recorder backfill manifest hash mismatch.');
  const file = read.manifest.files.raidObservations;
  const path = join(revisionDir(dataDir, pointer.revision), file.path);
  const handle = await open(path, 'r');
  let stored = 0;
  let duplicates = 0;
  try {
    if ((await handle.stat()).size !== file.bytes) throw new Error('Recorder backfill file length mismatch.');
    // First pass verifies the entire history without accumulating it in memory or exposing a partial import.
    let checked = 0;
    for await (const _raid of records(handle, file, signal)) {
      void _raid; // Consume and validate without retaining a growing history in memory.
      if (++checked % 128 === 0) await setImmediate(undefined, { signal });
    }
    let batch: AtlasRaid[] = [];
    const flush = async () => {
      signal.throwIfAborted();
      const receipts = ledger.observeBatch(batch, { recovered: true });
      for (const receipt of receipts) {
        if (receipt.kind === 'stored') stored++;
        else duplicates++;
      }
      batch = [];
      signal.throwIfAborted();
      await setImmediate(undefined, { signal });
    };
    for await (const raid of records(handle, file, signal)) {
      batch.push(raid);
      if (batch.length === 32) await flush();
    }
    if (batch.length) await flush();
  } finally {
    await handle.close();
  }
  // A crash before this append retries the import; durable IDs make that harmless.
  signal.throwIfAborted();
  ledger.advance(SOURCE, after, pointer.revision);
  return { revision: pointer.revision, stored, duplicates };
}
