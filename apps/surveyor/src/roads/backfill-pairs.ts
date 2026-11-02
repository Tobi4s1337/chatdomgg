import { createHash } from 'node:crypto';
import { open } from 'node:fs/promises';
import { join } from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { RaidPairSchema, type RaidPair } from '../export/schema';
import { readCurrent, readManifest, revisionDir } from '../store/revisions';
import { collectorProvenance } from './provenance';
import type { RoadLedger } from './ledger';

/** Independent checkpoint also upgrades ledgers whose recorder import was completed before aggregate support. */
export async function backfillPairs(dataDir: string, ledger: RoadLedger, signal: AbortSignal): Promise<{ stored: number; duplicates: number }> {
  signal.throwIfAborted();
  const pointer = readCurrent(dataDir);
  if (!pointer) return { stored: 0, duplicates: 0 };
  const source = 'surveyor-pair-import';
  const after = ledger.checkpoint(source);
  if (after === pointer.revision) return { stored: 0, duplicates: 0 };
  const read = readManifest(dataDir, pointer.revision);
  if (read.sha256 !== pointer.manifestSha256) throw new Error('Pair backfill manifest mismatch.');
  const provenance = collectorProvenance(read.manifest.source.http.base, read.manifest.source.database.path);
  const file = read.manifest.files.raidPairs;
  const handle = await open(join(revisionDir(dataDir, pointer.revision), file.path), 'r');
  let stored = 0, duplicates = 0;
  async function* records() {
    const chunk = Buffer.alloc(64 * 1024);
    const decoder = new TextDecoder('utf-8', { fatal: true });
    const hash = createHash('sha256');
    let size = 0, count = 0, pending = '';
    for (;;) {
      signal.throwIfAborted();
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, size);
      signal.throwIfAborted();
      if (!bytesRead) break;
      const bytes = chunk.subarray(0, bytesRead);
      size += bytesRead;
      if (size > file.bytes) throw new Error('Pair backfill file length mismatch.');
      hash.update(bytes);
      pending += decoder.decode(bytes, { stream: true });
      let newline: number;
      while ((newline = pending.indexOf('\n')) !== -1) {
        const line = pending.slice(0, newline);
        pending = pending.slice(newline + 1);
        if (!line || Buffer.byteLength(line) > 8192) throw new Error('Pair backfill record length mismatch.');
        const pair = RaidPairSchema.parse(JSON.parse(line));
        if (pair.lastAt > read.manifest.source.database.openedAt) throw new Error('Pair backfill source cut mismatch.');
        count++;
        yield pair;
      }
      if (Buffer.byteLength(pending) > 8192) throw new Error('Pair backfill record length mismatch.');
    }
    pending += decoder.decode();
    if (pending || size !== file.bytes || count !== file.records || hash.digest('hex') !== file.sha256) throw new Error('Pair backfill hash/length/count mismatch.');
  }
  try {
    if ((await handle.stat()).size !== file.bytes) throw new Error('Pair backfill file length mismatch.');
    let checked = 0;
    for await (const pair of records()) {
      void pair;
      if (++checked % 128 === 0) { await setImmediate(); signal.throwIfAborted(); }
    }
    let batch: RaidPair[] = [];
    const flush = async () => {
      signal.throwIfAborted();
      const result = ledger.reconcile(batch, {
        provenance, cutAt: read.manifest.source.database.openedAt,
        reference: `${pointer.revision}:${pointer.manifestSha256}`,
      });
      stored += result.stored; duplicates += result.duplicates;
      batch = [];
      await setImmediate(); signal.throwIfAborted();
    };
    for await (const pair of records()) {
      batch.push(pair);
      if (batch.length === 128) await flush();
    }
    if (batch.length) await flush();
  } finally { await handle.close(); }
  signal.throwIfAborted();
  ledger.advance(source, after, pointer.revision);
  return { stored, duplicates };
}

