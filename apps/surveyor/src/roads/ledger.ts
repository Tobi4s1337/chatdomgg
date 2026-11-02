import { createHash } from 'node:crypto';
import {
  closeSync, existsSync, fsyncSync, ftruncateSync, mkdirSync, openSync, readSync, writeSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { AtlasRaidSchema, EpochMsSchema, type AtlasRaid } from '@chatdom/shared';
import { z } from 'zod';
import { RaidPairSchema, type RaidPair } from '../export/schema';

/** Receipt-time SSE and timestamped observations can describe the same public raid. */
export const ROAD_DEDUPE_WINDOW_MS = 30_000;

export interface RoadReceipt {
  kind: 'stored' | 'duplicate';
  /** Echoes this delivery's ID; retained cross-source aliases stay internal. */
  raidId: string;
  road: string;
  raids: number;
}

/** Raids one way along a road, under the same lower-bound rules as the road's own totals. */
export interface RoadDirection {
  raids: number;
  viewers: number;
}

export interface RoadSummary {
  key: string;
  /** Decimal channel IDs, in lexicographic order; direction lives in events and in forward/backward. */
  from: string;
  to: string;
  raids: number;
  viewers: number;
  /** Raids from `from` to `to`; with aggregate evidence, a lower bound like the totals. */
  forward: RoadDirection;
  /** Raids from `to` to `from`. */
  backward: RoadDirection;
  /** Historical start is unknown when aggregate evidence includes unlocated raids. */
  firstAt: number | null;
  firstObservedEventAt: number | null;
  /** True describes the retained observation set only; any aggregate makes lifetime history unknown. */
  historyStartKnown: boolean;
  lastAt: number;
  observedRaids: number;
  observedViewers: number;
  countBasis: 'observations' | 'at-least';
  /** Canonical observations only, in durable observation order. */
  events: readonly AtlasRaid[];
}

/** A road without its observations: what list reads return, so a listing never copies whole histories. */
export type RoadLine = Omit<RoadSummary, 'events'>;

function line(summary: RoadSummary): RoadLine {
  return {
    key: summary.key, from: summary.from, to: summary.to, raids: summary.raids, viewers: summary.viewers,
    forward: { ...summary.forward }, backward: { ...summary.backward },
    firstAt: summary.firstAt, firstObservedEventAt: summary.firstObservedEventAt, historyStartKnown: summary.historyStartKnown,
    lastAt: summary.lastAt, observedRaids: summary.observedRaids, observedViewers: summary.observedViewers, countBasis: summary.countBasis,
  };
}

/** Strongest first: most raids, most travellers, the latest, then the key. */
function stronger(a: RoadSummary, b: RoadSummary): number {
  return b.raids - a.raids || b.viewers - a.viewers || b.lastAt - a.lastAt || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
}

const CursorSourceSchema = z.string().min(1).max(512);
const CursorSchema = z.string().min(1).max(4096);
const CheckpointSchema = z.strictObject({
  source: CursorSourceSchema,
  after: CursorSchema.nullable(),
  cursor: CursorSchema,
});
type Checkpoint = z.infer<typeof CheckpointSchema>;
const ProvenanceSchema = z.string().min(1).max(128).regex(/^[\x20-\x7e]+$/);
const ReferenceSchema = z.string().min(1).max(256);
export interface RoadObservationOptions {
  checkpoint?: Checkpoint;
  recovered?: boolean;
  /** Opaque identity of the collector, shared with its aggregate snapshots. */
  provenance?: string;
}
export interface RoadReconcileOptions {
  provenance: string;
  cutAt: number;
  reference: string;
  checkpoint?: Checkpoint;
}

const AggregateSchema = z.strictObject({
  kind: z.literal('aggregate'),
  pair: RaidPairSchema,
  provenance: ProvenanceSchema,
  cutAt: EpochMsSchema,
  reference: ReferenceSchema,
  checkpoint: CheckpointSchema.optional(),
}).refine((body) => body.cutAt >= body.pair.lastAt, 'An aggregate cut cannot precede its last raid.');
type Aggregate = z.infer<typeof AggregateSchema>;

const BodySchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('observation'),
    raid: AtlasRaidSchema,
    canonicalId: z.string().min(1).max(128),
    recovered: z.boolean(),
    provenance: ProvenanceSchema.optional(),
    checkpoint: CheckpointSchema.optional(),
  }),
  AggregateSchema,
  z.strictObject({ kind: z.literal('checkpoint'), checkpoint: CheckpointSchema }),
]);
type Body = z.infer<typeof BodySchema>;
const HashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const LineSchema = z.strictObject({
  version: z.literal(1),
  seq: z.number().int().nonnegative().safe(),
  previous: HashSchema,
  body: BodySchema,
  hash: HashSchema,
});
const GENESIS = digest('chatdom-road-ledger:1');
// Two 4096-code-unit cursors plus source/raid fields fit even with JSON's six-byte control escapes.
const MAX_LINE_BYTES = 65_536;
const READ_CHUNK_BYTES = 16_384;

function digest(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function syncDirectory(path: string): void {
  const fd = openSync(path, 'r');
  try { fsyncSync(fd); } finally { closeSync(fd); }
}

function roadKey(from: string, to: string): string {
  return from < to ? `${from}~${to}` : `${to}~${from}`;
}

function raidTime(raid: AtlasRaid): number {
  return raid.occurredAt ?? raid.observedAt;
}

function assertWitnessed(raid: AtlasRaid): void {
  if (raid.source === 'simulation' || raid.evidence.kind !== 'observed') {
    throw new Error('A road requires a witnessed raid, never a simulation.');
  }
}

function sameFact(first: AtlasRaid, next: AtlasRaid): boolean {
  return first.fromKingdomId === next.fromKingdomId && first.toKingdomId === next.toKingdomId
    && first.viewers === next.viewers && first.observedAt === next.observedAt && first.occurredAt === next.occurredAt;
}

interface Canonical {
  raid: AtlasRaid;
  /** All delivery sources already represented, including retained aliases. */
  sources: Set<AtlasRaid['source']>;
  /** Original SSE witnesses survive aliases whose canonical representative has another clock. */
  sseWitnesses: { raid: AtlasRaid; provenance: string }[];
}

function aggregateId(body: Aggregate): string {
  return digest(JSON.stringify([body.provenance, body.reference, body.pair.fromKingdomId, body.pair.toKingdomId]));
}

function sameAggregate(first: Aggregate, next: Aggregate): boolean {
  return first.cutAt === next.cutAt && first.pair.raids === next.pair.raids
    && first.pair.viewersTotal === next.pair.viewersTotal && first.pair.lastAt === next.pair.lastAt;
}

function witnessKey(raid: AtlasRaid, provenance?: string): string {
  return JSON.stringify([raid.source, provenance ?? null]);
}

function safeAdd(first: number, second: number): number {
  const total = first + second;
  if (!Number.isSafeInteger(total)) throw new Error('A road total exceeds the safe integer limit.');
  return total;
}

/**
 * One durable writer, an append-only checksummed NDJSON source of truth, and rebuildable indexes.
 * SQLite is used solely for its process-scoped OS file lock: BEGIN EXCLUSIVE remains open until close(),
 * releases on process death, and avoids stale PID/PID-reuse and unlink races. Never unlink .writer.sqlite.
 * This requires a local filesystem with working SQLite locks and fsync; network filesystems are unsupported.
 * SHA-256 detects corruption, not a malicious operator able to rewrite the entire ledger and its hashes.
 */
export class RoadLedger {
  private readonly lease: DatabaseSync;
  private fd: number | null = null;
  private closed = false;
  private poisoned = false;
  private head = GENESIS;
  private seq = 0;
  private readonly ids = new Map<string, { raid: AtlasRaid; canonical: Canonical; witnesses: Set<string> }>();
  private readonly canonical = new Map<string, Canonical>();
  private readonly directed = new Map<string, Canonical[]>();
  private readonly aggregates = new Map<string, Aggregate>();
  private readonly directedAggregates = new Map<string, Aggregate[]>();
  private readonly summaries = new Map<string, RoadSummary>();
  /** Road keys by channel, so one channel's roads never scan the whole ledger. */
  private readonly byChannel = new Map<string, Set<string>>();
  private readonly checkpoints = new Map<string, string>();
  /** Bumped on every summary change; the cached ranking is rebuilt only after one. */
  private version = 0;
  private ranking: { version: number; roads: RoadSummary[] } | null = null;
  private earliest: number | null = null;

  constructor(dataDir: string) {
    const dataExisted = existsSync(dataDir);
    mkdirSync(dataDir, { recursive: true });
    if (!dataExisted) syncDirectory(dirname(dataDir));
    const directory = join(dataDir, 'roads');
    const roadsExisted = existsSync(directory);
    mkdirSync(directory, { recursive: true });
    if (!roadsExisted) syncDirectory(dataDir);
    this.lease = new DatabaseSync(join(directory, '.writer.sqlite'));
    try {
      this.lease.exec('PRAGMA busy_timeout = 0; BEGIN EXCLUSIVE;');
      const path = join(directory, 'ledger.ndjson');
      const existed = existsSync(path);
      this.fd = openSync(path, 'a+');
      if (!existed) {
        fsyncSync(this.fd);
        syncDirectory(directory);
      }
      const chunk = Buffer.alloc(READ_CHUNK_BYTES);
      const pending = Buffer.alloc(MAX_LINE_BYTES);
      const decoder = new TextDecoder('utf-8', { fatal: true });
      let position = 0;
      let verifiedEnd = 0;
      let pendingLength = 0;
      let oversized = false;
      for (;;) {
        // Explicit offsets leave append positioning independent of the restart reader.
        const count = readSync(this.fd, chunk, 0, chunk.length, position);
        if (count === 0) break;
        let start = 0;
        while (start < count) {
          const nextNewline = chunk.indexOf(10, start);
          const newline = nextNewline < count ? nextNewline : -1;
          const end = newline === -1 ? count : newline;
          const length = end - start;
          if (pendingLength + length > MAX_LINE_BYTES) oversized = true;
          if (!oversized) {
            chunk.copy(pending, pendingLength, start, end);
            pendingLength += length;
          }
          if (newline === -1) break;
          if (oversized) throw new Error(`Corrupt road ledger record ${this.seq + 1}: oversized complete record.`);
          this.replay(decoder.decode(pending.subarray(0, pendingLength)));
          verifiedEnd = position + newline + 1;
          pendingLength = 0;
          oversized = false;
          start = newline + 1;
        }
        position += count;
      }
      // Complete-prefix faults throw above without touching even an interrupted trailing append.
      // A fragment may itself exceed the record limit; discard it without allocating more memory.
      if (verifiedEnd < position) {
        ftruncateSync(this.fd, verifiedEnd);
        fsyncSync(this.fd);
      }
    } catch (error) {
      if (this.fd !== null) closeSync(this.fd);
      this.fd = null;
      this.lease.close();
      throw error;
    }
  }

  observe(input: unknown, options: RoadObservationOptions = {}): RoadReceipt {
    this.assertOpen();
    const raid = AtlasRaidSchema.parse(input);
    assertWitnessed(raid);
    const checkpoint = options.checkpoint === undefined ? undefined : CheckpointSchema.parse(options.checkpoint);
    const provenance = options.provenance === undefined ? undefined : ProvenanceSchema.parse(options.provenance);
    return this.observeInternal(raid, {
      recovered: z.boolean().parse(options.recovered ?? false), ...(checkpoint ? { checkpoint } : {}),
      ...(provenance === undefined ? {} : { provenance }),
    }, true);
  }

  /**
   * Bounded backfill group commit. Parsing finishes before the first append; the private synchronous loop
   * has no yield, callback or public observe() call, so no other JS stack can inspect its temporary indexes.
   * One final fsync precedes every returned receipt. An uncertain prefix poisons all reads and writes.
   */
  observeBatch(inputs: readonly unknown[], options: RoadObservationOptions = {}): RoadReceipt[] {
    this.assertOpen();
    if (!Array.isArray(inputs) || inputs.length < 1 || inputs.length > 200) {
      throw new Error('A road observation batch must contain between 1 and 200 raids.');
    }
    const raids: AtlasRaid[] = [];
    for (let index = 0; index < inputs.length; index++) {
      const raid = AtlasRaidSchema.parse(inputs[index]);
      assertWitnessed(raid);
      raids.push(raid);
    }
    const checkpoint = options.checkpoint === undefined ? undefined : CheckpointSchema.parse(options.checkpoint);
    const recovered = z.boolean().parse(options.recovered ?? false);
    const provenance = options.provenance === undefined ? undefined : ProvenanceSchema.parse(options.provenance);
    if (checkpoint) this.assertCheckpoint(checkpoint);
    const initialSeq = this.seq;
    let flushing = false;
    try {
      const receipts: RoadReceipt[] = [];
      for (let index = 0; index < raids.length; index++) {
        receipts.push(this.observeInternal(raids[index]!, {
          recovered, ...(checkpoint && index === raids.length - 1 ? { checkpoint } : {}),
          ...(provenance === undefined ? {} : { provenance }),
        }, false));
      }
      flushing = true;
      fsyncSync(this.fd!);
      return receipts;
    } catch (error) {
      if (flushing || this.seq !== initialSeq) this.poisoned = true;
      throw error;
    }
  }

  private observeInternal(raid: AtlasRaid, options: RoadObservationOptions & { recovered: boolean }, sync: boolean): RoadReceipt {
    const checkpoint = options.checkpoint;
    if (checkpoint) this.assertCheckpoint(checkpoint);
    const existing = this.ids.get(raid.id);
    const canonical = this.match(raid);
    const canonicalId = canonical?.raid.id ?? raid.id;
    // An already durable delivery needs no new record unless its source or cursor adds information.
    if (!existing?.witnesses.has(witnessKey(raid, options.provenance)) || (checkpoint && checkpoint.cursor !== checkpoint.after)) {
      const body: Body = {
        kind: 'observation', raid, canonicalId, recovered: options.recovered ?? false,
        ...(checkpoint ? { checkpoint } : {}),
        ...(options.provenance === undefined ? {} : { provenance: options.provenance }),
      };
      this.append(body, sync);
    }
    const summary = this.summaries.get(roadKey(raid.fromKingdomId, raid.toKingdomId))!;
    return { kind: canonical ? 'duplicate' : 'stored', raidId: raid.id, road: summary.key, raids: summary.raids };
  }

  /**
   * Retain immutable snapshot baselines with their own cuts; never fabricate individual raids.
   * A dominated envelope adds no evidence and is not accepted as a stored identity. Only stored
   * identities carry the immutable-facts conflict guarantee; duplicate receipts may also mean dominated.
   */
  reconcile(pairs: readonly RaidPair[], options: RoadReconcileOptions): { stored: number; duplicates: number } {
    this.assertOpen();
    if (!Array.isArray(pairs) || pairs.length < 1 || pairs.length > 200) {
      throw new Error('A road aggregate batch must contain between 1 and 200 pairs.');
    }
    const provenance = ProvenanceSchema.parse(options.provenance);
    const cutAt = EpochMsSchema.parse(options.cutAt);
    const reference = ReferenceSchema.parse(options.reference);
    const checkpoint = options.checkpoint === undefined ? undefined : CheckpointSchema.parse(options.checkpoint);
    if (checkpoint) this.assertCheckpoint(checkpoint);
    const pending = new Map<string, Aggregate>();
    const bodies = pairs.map((pair) => {
      const body = AggregateSchema.parse({ kind: 'aggregate', pair, provenance, cutAt, reference });
      const id = aggregateId(body);
      const existing = pending.get(id) ?? this.aggregates.get(id);
      if (existing && !sameAggregate(existing, body)) throw new Error('Conflicting road aggregate identity.');
      pending.set(id, body);
      return body;
    });
    const initialSeq = this.seq;
    let flushing = false;
    try {
      let stored = 0;
      let duplicates = 0;
      for (let index = 0; index < bodies.length; index++) {
        const body = bodies[index]!;
        const existing = this.aggregates.has(aggregateId(body));
        const baselines = this.directedAggregates.get(`${body.pair.fromKingdomId}>${body.pair.toKingdomId}`) ?? [];
        const dominated = baselines.some((baseline) => baseline.provenance === body.provenance
          && baseline.cutAt <= body.cutAt && baseline.pair.raids >= body.pair.raids
          && baseline.pair.viewersTotal >= body.pair.viewersTotal && baseline.pair.lastAt >= body.pair.lastAt);
        const duplicate = existing || dominated;
        if (duplicate) duplicates++; else stored++;
        const tail = checkpoint && index === bodies.length - 1 ? checkpoint : undefined;
        if (!duplicate) {
          this.append({ ...body, ...(tail ? { checkpoint: tail } : {}) }, false);
        } else if (tail && tail.cursor !== tail.after) {
          this.append({ kind: 'checkpoint', checkpoint: tail }, false);
        }
      }
      flushing = true;
      if (this.seq !== initialSeq) fsyncSync(this.fd!);
      return { stored, duplicates };
    } catch (error) {
      if (flushing || this.seq !== initialSeq) this.poisoned = true;
      throw error;
    }
  }

  /** A feed may advance without observing an event; CAS prevents racing or stale pollers. */
  advance(source: string, after: string | null, cursor: string): void {
    this.assertOpen();
    const checkpoint = CheckpointSchema.parse({ source, after, cursor });
    this.assertCheckpoint(checkpoint);
    if (after !== cursor) this.append({ kind: 'checkpoint', checkpoint });
  }

  checkpoint(source: string): string | null {
    this.assertOpen();
    CursorSourceSchema.parse(source);
    return this.checkpoints.get(source) ?? null;
  }

  road(from: string, to: string): RoadSummary | null {
    this.assertOpen();
    const summary = this.summaries.get(roadKey(from, to));
    return summary ? structuredClone(summary) : null;
  }

  roads(channelId?: string): RoadSummary[] {
    this.assertOpen();
    return this.select(channelId).map((road) => structuredClone(road));
  }

  /** One channel's roads (or every road) without their observations, in key order. */
  lines(channelId?: string): RoadLine[] {
    this.assertOpen();
    return this.select(channelId).map(line);
  }

  /** The newest canonical observations of one road, newest event first. */
  recent(from: string, to: string, limit: number): AtlasRaid[] {
    this.assertOpen();
    const events = this.summaries.get(roadKey(from, to))?.events ?? [];
    return [...events].sort((a, b) => raidTime(b) - raidTime(a) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .slice(0, Math.max(0, limit)).map((raid) => structuredClone(raid));
  }

  /**
   * The strongest roads that `accept` lets through, at most `limit`. The ranking is computed once per change of
   * the ledger, so repeated reads between raids only walk it.
   */
  busiest(limit: number, accept: (road: RoadLine) => boolean = () => true): RoadLine[] {
    this.assertOpen();
    if (this.ranking?.version !== this.version) {
      this.ranking = { version: this.version, roads: [...this.summaries.values()].sort(stronger) };
    }
    const chosen: RoadLine[] = [];
    for (const road of this.ranking.roads) {
      if (chosen.length >= limit) break;
      const candidate = line(road);
      if (accept(candidate)) chosen.push(candidate);
    }
    return chosen;
  }

  /** The earliest event time among canonical observations, or null before the first. */
  earliestEventAt(): number | null {
    this.assertOpen();
    return this.earliest;
  }

  private select(channelId?: string): RoadSummary[] {
    const keys = channelId === undefined ? [...this.summaries.keys()] : [...this.byChannel.get(channelId) ?? []];
    return keys.sort().map((key) => this.summaries.get(key)!);
  }

  private put(summary: RoadSummary): void {
    if (!this.summaries.has(summary.key)) {
      for (const channel of [summary.from, summary.to]) {
        let keys = this.byChannel.get(channel);
        if (!keys) {
          keys = new Set();
          this.byChannel.set(channel, keys);
        }
        keys.add(summary.key);
      }
    }
    this.summaries.set(summary.key, summary);
    this.version++;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    try {
      if (this.fd !== null) closeSync(this.fd);
    } finally {
      this.fd = null;
      this.lease.close();
    }
  }

  private assertOpen(): void {
    if (this.closed) throw new Error('The road ledger is closed.');
    if (this.poisoned) throw new Error('The road ledger is poisoned after an uncertain write; close and reopen it.');
  }

  private assertCheckpoint(checkpoint: Checkpoint): void {
    if ((this.checkpoints.get(checkpoint.source) ?? null) !== checkpoint.after) {
      throw new Error(`Stale road checkpoint for ${checkpoint.source}.`);
    }
  }

  /** Same-source distinct IDs never collapse, even through another source's alias. */
  private match(raid: AtlasRaid): Canonical | undefined {
    const existing = this.ids.get(raid.id);
    if (existing) {
      if (!sameFact(existing.raid, raid)) throw new Error(`Conflicting road raid ID ${raid.id}.`);
      return existing.canonical;
    }
    let best: Canonical | undefined;
    let distance = Infinity;
    for (const item of this.directed.get(`${raid.fromKingdomId}>${raid.toKingdomId}`) ?? []) {
      if (item.sources.has(raid.source)) continue;
      const delta = Math.abs(raidTime(item.raid) - raidTime(raid));
      if (delta <= ROAD_DEDUPE_WINDOW_MS && delta < distance) { best = item; distance = delta; }
    }
    return best;
  }

  private append(body: Body, sync = true): void {
    body = BodySchema.parse(body);
    this.assertSafeTotals(body);
    const payload = { version: 1 as const, seq: this.seq, previous: this.head, body };
    const hash = digest(JSON.stringify(payload));
    const bytes = Buffer.from(`${JSON.stringify({ ...payload, hash })}\n`);
    if (bytes.length - 1 > MAX_LINE_BYTES) throw new Error('The road ledger record exceeds its byte limit.');
    try {
      // writeSync may short-write. Batch-only temporary indexes stay within observeBatch's synchronous stack.
      let offset = 0;
      while (offset < bytes.length) {
        const count = writeSync(this.fd!, bytes, offset, bytes.length - offset);
        if (count <= 0) throw new Error('The road ledger append made no progress.');
        offset += count;
      }
      if (sync) fsyncSync(this.fd!);
      this.apply(body);
      this.head = hash;
      this.seq++;
    } catch (error) {
      this.poisoned = true;
      throw error;
    }
  }

  private replay(raw: string): void {
    try {
      const line = LineSchema.parse(JSON.parse(raw));
      const { hash, ...payload } = line;
      if (line.seq !== this.seq || line.previous !== this.head || digest(JSON.stringify(payload)) !== hash
        || JSON.stringify(line) !== raw) throw new Error('Invalid road ledger hash chain or noncanonical record.');
      if (line.body.kind === 'observation') {
        assertWitnessed(line.body.raid);
        const matched = this.match(line.body.raid);
        if ((matched?.raid.id ?? line.body.raid.id) !== line.body.canonicalId) {
          throw new Error('Invalid road ledger alias.');
        }
      } else if (line.body.kind === 'aggregate') {
        const existing = this.aggregates.get(aggregateId(line.body));
        if (existing && !sameAggregate(existing, line.body)) throw new Error('Conflicting road aggregate identity.');
      }
      if (line.body.checkpoint) this.assertCheckpoint(line.body.checkpoint);
      this.apply(line.body);
      this.head = hash;
      this.seq++;
    } catch (error) {
      throw new Error(`Corrupt road ledger record ${this.seq + 1}.`, { cause: error });
    }
  }

  private apply(body: Body): void {
    if (body.kind === 'observation') {
      const { raid, canonicalId } = body;
      let canonical = this.canonical.get(canonicalId);
      if (!canonical) {
        canonical = { raid, sources: new Set(), sseWitnesses: [] };
        this.canonical.set(raid.id, canonical);
        const directedKey = `${raid.fromKingdomId}>${raid.toKingdomId}`;
        const directed = this.directed.get(directedKey) ?? [];
        directed.push(canonical);
        this.directed.set(directedKey, directed);
        const key = roadKey(raid.fromKingdomId, raid.toKingdomId);
        const previous = this.summaries.get(key);
        const time = raidTime(raid);
        const [from, to] = key.split('~') as [string, string];
        const firstObservedEventAt = Math.min(previous?.firstObservedEventAt ?? time, time);
        const observedRaids = (previous?.observedRaids ?? 0) + 1;
        const observedViewers = (previous?.observedViewers ?? 0) + raid.viewers;
        const ahead = raid.fromKingdomId === from;
        const forward = previous?.forward ?? { raids: 0, viewers: 0 };
        const backward = previous?.backward ?? { raids: 0, viewers: 0 };
        this.earliest = Math.min(this.earliest ?? time, time);
        // Aggregate roads are recomputed below; this incremental tally is exact for observation-only roads.
        this.put({
          key, from, to, raids: observedRaids, viewers: observedViewers,
          forward: ahead ? { raids: forward.raids + 1, viewers: forward.viewers + raid.viewers } : { ...forward },
          backward: ahead ? { ...backward } : { raids: backward.raids + 1, viewers: backward.viewers + raid.viewers },
          firstAt: firstObservedEventAt, firstObservedEventAt, historyStartKnown: true,
          observedRaids, observedViewers, countBasis: 'observations',
          lastAt: Math.max(previous?.lastAt ?? time, time),
          events: [...(previous?.events ?? []), raid],
        });
      }
      canonical.sources.add(raid.source);
      let delivery = this.ids.get(raid.id);
      if (!delivery) {
        delivery = { raid, canonical, witnesses: new Set() };
        this.ids.set(raid.id, delivery);
      }
      const witness = witnessKey(raid, body.provenance);
      if (!delivery.witnesses.has(witness)) {
        delivery.witnesses.add(witness);
        if (raid.source === 'surveyor-sse' && body.provenance !== undefined) {
          canonical.sseWitnesses.push({ raid, provenance: body.provenance });
        }
      }
      this.refreshAggregateSummary(raid.fromKingdomId, raid.toKingdomId);
    } else if (body.kind === 'aggregate') {
      const id = aggregateId(body);
      if (!this.aggregates.has(id)) {
        this.aggregates.set(id, body);
        const key = `${body.pair.fromKingdomId}>${body.pair.toKingdomId}`;
        const directed = this.directedAggregates.get(key) ?? [];
        directed.push(body);
        this.directedAggregates.set(key, directed);
        this.refreshAggregateSummary(body.pair.fromKingdomId, body.pair.toKingdomId);
      }
    }
    if (body.checkpoint) this.checkpoints.set(body.checkpoint.source, body.checkpoint.cursor);
  }

  /** Only the changed undirected road is revisited; event-only roads keep their incremental fast path. */
  private refreshAggregateSummary(first: string, second: string): void {
    const forward = this.directedAggregates.get(`${first}>${second}`) ?? [];
    const reverse = this.directedAggregates.get(`${second}>${first}`) ?? [];
    if (forward.length === 0 && reverse.length === 0) return;
    const key = roadKey(first, second);
    const previous = this.summaries.get(key);
    const totals = this.aggregateTotals(first, second);
    const [from, to] = key.split('~') as [string, string];
    const firstObservedEventAt = previous?.firstObservedEventAt ?? null;
    this.put({
      key, from, to, ...totals, firstObservedEventAt,
      firstAt: totals.historyStartKnown ? firstObservedEventAt : null,
      observedRaids: previous?.observedRaids ?? 0,
      observedViewers: previous?.observedViewers ?? 0,
      countBasis: 'at-least', events: previous?.events ?? [],
    });
  }

  private assertSafeTotals(body: Body): void {
    if (body.kind === 'checkpoint') return;
    const fact = body.kind === 'observation' ? body.raid : body.pair;
    const previous = this.summaries.get(roadKey(fact.fromKingdomId, fact.toKingdomId));
    if (body.kind === 'observation' && !this.canonical.has(body.canonicalId)) {
      safeAdd(previous?.observedRaids ?? 0, 1);
      safeAdd(previous?.observedViewers ?? 0, body.raid.viewers);
    }
    if (body.kind === 'aggregate'
      || this.directedAggregates.has(`${fact.fromKingdomId}>${fact.toKingdomId}`)
      || this.directedAggregates.has(`${fact.toKingdomId}>${fact.fromKingdomId}`)) {
      this.aggregateTotals(fact.fromKingdomId, fact.toKingdomId, body);
    }
  }

  /** A candidate projection lets overflow fail before any bytes are appended. */
  private aggregateTotals(first: string, second: string, candidate?: Exclude<Body, { kind: 'checkpoint' }>): {
    raids: number; viewers: number; lastAt: number; historyStartKnown: boolean; forward: RoadDirection; backward: RoadDirection;
  } {
    let raids = 0;
    let viewers = 0;
    const [keyFrom] = roadKey(first, second).split('~') as [string, string];
    let forward: RoadDirection = { raids: 0, viewers: 0 };
    let backward: RoadDirection = { raids: 0, viewers: 0 };
    let lastAt = this.summaries.get(roadKey(first, second))?.lastAt ?? 0;
    let historyStartKnown = true;
    for (const [from, to] of [[first, second], [second, first]] as const) {
      const directedKey = `${from}>${to}`;
      let observations = this.directed.get(directedKey) ?? [];
      let baselines = this.directedAggregates.get(directedKey) ?? [];
      const fact = candidate?.kind === 'observation' ? candidate.raid : candidate?.pair;
      if (fact?.fromKingdomId === from && fact.toKingdomId === to) {
        if (candidate?.kind === 'aggregate' && !this.aggregates.has(aggregateId(candidate))) {
          baselines = [...baselines, candidate];
        } else if (candidate?.kind === 'observation') {
          const current = this.canonical.get(candidate.canonicalId);
          const witnesses = [...(current?.sseWitnesses ?? [])];
          if (candidate.raid.source === 'surveyor-sse' && candidate.provenance !== undefined) {
            witnesses.push({ raid: candidate.raid, provenance: candidate.provenance });
          }
          const next: Canonical = { raid: current?.raid ?? candidate.raid, sources: current?.sources ?? new Set(), sseWitnesses: witnesses };
          observations = current ? observations.map((item) => item === current ? next : item) : [...observations, next];
          lastAt = Math.max(lastAt, raidTime(next.raid));
        }
      }
      const observedViewers = observations.reduce((sum, item) => safeAdd(sum, item.raid.viewers), 0);
      if (baselines.length > 0) historyStartKnown = false;
      let directedRaids = observations.length;
      let directedViewers = observedViewers;
      for (const baseline of baselines) {
        let postCutRaids = 0;
        let postCutViewers = 0;
        for (const canonical of observations) {
          // A recorder or herald clock cannot establish that the collector saw this after its own cut.
          let witnessedViewers: number | null = null;
          for (const witness of canonical.sseWitnesses) {
            if (witness.provenance === baseline.provenance && witness.raid.observedAt > baseline.cutAt) {
              witnessedViewers = Math.max(witnessedViewers ?? 0, witness.raid.viewers);
            }
          }
          if (witnessedViewers !== null) {
            postCutRaids++;
            postCutViewers = safeAdd(postCutViewers, witnessedViewers);
          }
        }
        directedRaids = Math.max(directedRaids, safeAdd(baseline.pair.raids, postCutRaids));
        directedViewers = Math.max(directedViewers, safeAdd(baseline.pair.viewersTotal, postCutViewers));
        lastAt = Math.max(lastAt, baseline.pair.lastAt);
      }
      raids = safeAdd(raids, directedRaids);
      viewers = safeAdd(viewers, directedViewers);
      if (from === keyFrom) forward = { raids: directedRaids, viewers: directedViewers };
      else backward = { raids: directedRaids, viewers: directedViewers };
    }
    return { raids, viewers, lastAt, historyStartKnown, forward, backward };
  }
}
