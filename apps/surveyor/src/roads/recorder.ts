import { setImmediate } from 'node:timers/promises';
import { readRoadSource } from '../source/road-source';
import type { RoadLedger } from './ledger';

export interface RecorderRecovery {
  cutAt: number;
  stored: number;
  duplicates: number;
  aggregates: number;
  firstAt: number | null;
  lastAt: number | null;
  events: number;
  futureRows: number;
}

/** Yield between fsynced batches, preserving the caller's original abort reason. */
async function yieldRecovery(signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  await setImmediate();
  signal.throwIfAborted();
}

/**
 * Re-scan retained recorder rows on every pass: receipt timestamps are never a recovery cursor. The final
 * checkpoint names a complete snapshot only, so an interrupted prefix retries safely through durable IDs.
 * Recovered evidence has no live-caravan callback and aggregate rows never manufacture individual events.
 */
export async function recoverRecorder(
  ledger: RoadLedger,
  path: string,
  provenance: string,
  signal: AbortSignal,
  options: { now?: () => number } = {},
): Promise<RecorderRecovery> {
  signal.throwIfAborted();
  if (!/^[\x20-\x7e]{1,128}$/.test(provenance)) throw new Error('Invalid recorder recovery provenance.');
  const snapshot = readRoadSource(path, options);
  signal.throwIfAborted();
  const source = `recorder-db:${provenance}`;
  const after = ledger.checkpoint(source);
  const result: RecorderRecovery = {
    cutAt: snapshot.cutAt, stored: 0, duplicates: 0, aggregates: 0,
    firstAt: snapshot.firstAt, lastAt: snapshot.lastAt, events: snapshot.raids.length, futureRows: snapshot.futureRows,
  };
  if (after === snapshot.reference) return result;
  for (let offset = 0; offset < snapshot.raids.length; offset += 32) {
    signal.throwIfAborted();
    const receipts = ledger.observeBatch(snapshot.raids.slice(offset, offset + 32), { recovered: true, provenance });
    for (const receipt of receipts) {
      if (receipt.kind === 'stored') result.stored++;
      else result.duplicates++;
    }
    await yieldRecovery(signal);
  }
  for (let offset = 0; offset < snapshot.pairs.length; offset += 128) {
    signal.throwIfAborted();
    const reconciled = ledger.reconcile(snapshot.pairs.slice(offset, offset + 128), {
      provenance, cutAt: snapshot.cutAt, reference: snapshot.reference,
    });
    result.aggregates += reconciled.stored;
    await yieldRecovery(signal);
  }
  signal.throwIfAborted();
  ledger.advance(source, after, snapshot.reference);
  return result;
}
