import type { KingdomId } from '@chatdom/shared';
import { KingdomPresenceFrameSchema } from '@chatdom/shared';
import type { RealmPublicDelivery } from '@chatdom/shared/realm';
import { RealmWriterFencedError, describeStorageFailure } from '../persistence/database';
import type { RealmOutboxRow } from '../persistence/postgres-repository';
import { OUTBOX_DISPATCH_BATCH } from './store';

/** A failed read or acknowledgement is retried after this long, redelivering the same rows. */
export const OUTBOX_RETRY_MS = 1_000;

export interface OutboxDispatcherOptions {
  readonly kingdomId: KingdomId;
  readonly writerEpoch: string;
  /** The durable cursor this writer resumes from. Rows after it are delivered again with their original event IDs. */
  readonly delivered: number;
  /** The newest committed row id known at open. */
  readonly committed?: number;
  readonly read: (afterId: number, limit: number) => Promise<RealmOutboxRow[]>;
  readonly acknowledge: (throughId: number) => Promise<void>;
  /** Fold a committed row into the synchronous bootstrap prefix before its delivery. */
  readonly project: (row: RealmOutboxRow) => void;
  readonly current: () => boolean;
  readonly fenced: () => void;
  readonly log: (line: string) => void;
}

/**
 * Hands committed public outbox rows to the transport in commit order, then records that on the durable cursor.
 *
 * Delivery is at-least-once, never exactly-once. The cursor moves only after the transport took a batch, so a failed
 * acknowledgement or a crash between the two means those rows go out again — from this writer on its next pass, or
 * from whichever writer opens the kingdom next — with the same `eventId` and `sequence`. Receivers dedupe on those;
 * a ritual is never replayed as new. Nothing that has not committed reaches this class.
 */
export class OutboxDispatcher {
  private delivered: number;
  private chain: Promise<void> = Promise.resolve();
  private retry: ReturnType<typeof setTimeout> | null = null;
  private readonly listeners = new Set<(delivery: RealmPublicDelivery) => void>();
  /** Rows handed to the transport, including redeliveries. */
  deliveries = 0;
  redeliveries = 0;
  /** The most rows one pass handed to the transport (bounded by the dispatch batch). */
  largestBatch = 0;
  private highest = 0;
  /** The newest committed row id this writer has read: `cursor` equals it once everything committed was delivered. */
  newest: number;

  constructor(private readonly options: OutboxDispatcherOptions) {
    this.delivered = options.delivered;
    this.highest = options.delivered;
    this.newest = Math.max(options.delivered, options.committed ?? 0);
  }

  get cursor(): number { return this.delivered; }

  subscribe(listener: (delivery: RealmPublicDelivery) => void): () => void {
    this.listeners.add(listener);
    void this.kick();
    return () => { this.listeners.delete(listener); };
  }

  kick(): Promise<void> { return this.serial(() => this.pump()); }

  stop() {
    if (this.retry) clearTimeout(this.retry);
    this.retry = null;
    this.listeners.clear();
  }

  private serial(work: () => Promise<void>): Promise<void> {
    const run = this.chain.then(work, work);
    this.chain = run.catch(() => {});
    return run;
  }

  private async pump(): Promise<void> {
    for (;;) {
      if (!this.options.current()) return;
      let rows: RealmOutboxRow[];
      try { rows = await this.options.read(this.delivered, OUTBOX_DISPATCH_BATCH); }
      catch (error) { this.later(`outbox read failed: ${describeStorageFailure(error)}`); return; }
      if (rows.length) this.newest = Math.max(this.newest, rows.at(-1)!.id);
      if (rows.length === 0 || !await this.hand(rows)) return;
    }
  }

  /** One batch: hand every row to the transport, then acknowledge. False means stop and retry later. */
  private async hand(rows: readonly RealmOutboxRow[]): Promise<boolean> {
    if (!this.options.current()) return false;
    if (this.listeners.size === 0) return false;
    for (const row of rows) {
      if (!this.options.current()) return false;
      const delivery = this.delivery(row);
      if (!delivery) { this.later(`outbox row ${row.id} is not a public message; delivery holds`); return false; }
      this.options.project(row);
      if (row.id <= this.highest) this.redeliveries++;
      this.highest = Math.max(this.highest, row.id);
      this.deliveries++;
      for (const listener of this.listeners) {
        try { listener(delivery); } catch (error) { this.options.log(`delivery listener failed: ${(error as Error).name}`); }
      }
    }
    this.largestBatch = Math.max(this.largestBatch, rows.length);
    const through = rows.at(-1)!.id;
    try {
      await this.options.acknowledge(through);
    } catch (error) {
      if (error instanceof RealmWriterFencedError) { this.options.fenced(); return false; }
      this.later(`outbox acknowledgement failed, will redeliver from ${this.delivered}: ${describeStorageFailure(error)}`);
      return false;
    }
    this.delivered = Math.max(this.delivered, through);
    return true;
  }

  /** The public allowlist, checked again at the door: only the three public kinds, and presence frames by their schema. */
  private delivery(row: RealmOutboxRow): RealmPublicDelivery | null {
    const message = row.message;
    if (message.type === 'presence' && !KingdomPresenceFrameSchema.safeParse(message.frame).success) return null;
    if (message.type !== 'presence' && message.type !== 'forge' && message.type !== 'home') return null;
    return { version: 1, kingdomId: this.options.kingdomId, writerEpoch: this.options.writerEpoch, sequence: row.sequence, cursor: row.id, eventId: row.eventId, message };
  }

  private later(line: string) {
    this.options.log(line);
    if (this.retry || !this.options.current()) return;
    this.retry = setTimeout(() => { this.retry = null; void this.kick(); }, OUTBOX_RETRY_MS);
    this.retry.unref?.();
  }
}
