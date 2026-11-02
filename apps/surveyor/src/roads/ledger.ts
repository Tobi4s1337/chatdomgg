import { createHash } from 'node:crypto';
import {
  closeSync, existsSync, fsyncSync, ftruncateSync, mkdirSync, openSync, readSync, writeSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { AtlasRaidSchema, type AtlasRaid } from '@chatdom/shared';
import { z } from 'zod';

/** Receipt-time SSE and timestamped observations can describe the same public raid. */
export const ROAD_DEDUPE_WINDOW_MS = 30_000;

export interface RoadReceipt {
  kind: 'stored' | 'duplicate';
  /** Echoes this delivery's ID; retained cross-source aliases stay internal. */
  raidId: string;
  road: string;
  raids: number;
}

export interface RoadSummary {
  key: string;
  /** Decimal channel IDs, in lexicographic order; direction lives in events. */
  from: string;
  to: string;
  raids: number;
  viewers: number;
  firstAt: number;
  lastAt: number;
  /** Canonical observations only, in durable observation order. */
  events: readonly AtlasRaid[];
}

const CursorSourceSchema = z.string().min(1).max(512);
const CursorSchema = z.string().min(1).max(4096);
const CheckpointSchema = z.strictObject({
  source: CursorSourceSchema,
  after: CursorSchema.nullable(),
  cursor: CursorSchema,
});
type Checkpoint = z.infer<typeof CheckpointSchema>;

const BodySchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('observation'),
    raid: AtlasRaidSchema,
    canonicalId: z.string().min(1).max(128),
    recovered: z.boolean(),
    checkpoint: CheckpointSchema.optional(),
  }),
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
  private readonly ids = new Map<string, { raid: AtlasRaid; canonical: Canonical }>();
  private readonly canonical = new Map<string, Canonical>();
  private readonly directed = new Map<string, Canonical[]>();
  private readonly summaries = new Map<string, RoadSummary>();
  private readonly checkpoints = new Map<string, string>();

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

  observe(input: unknown, options: { checkpoint?: Checkpoint; recovered?: boolean } = {}): RoadReceipt {
    this.assertOpen();
    const raid = AtlasRaidSchema.parse(input);
    assertWitnessed(raid);
    const checkpoint = options.checkpoint === undefined ? undefined : CheckpointSchema.parse(options.checkpoint);
    return this.observeInternal(raid, {
      recovered: z.boolean().parse(options.recovered ?? false), ...(checkpoint ? { checkpoint } : {}),
    }, true);
  }

  /**
   * Bounded backfill group commit. Parsing finishes before the first append; the private synchronous loop
   * has no yield, callback or public observe() call, so no other JS stack can inspect its temporary indexes.
   * One final fsync precedes every returned receipt. An uncertain prefix poisons all reads and writes.
   */
  observeBatch(inputs: readonly unknown[], options: { checkpoint?: Checkpoint; recovered?: boolean } = {}): RoadReceipt[] {
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
    if (checkpoint) this.assertCheckpoint(checkpoint);
    const initialSeq = this.seq;
    let flushing = false;
    try {
      const receipts: RoadReceipt[] = [];
      for (let index = 0; index < raids.length; index++) {
        receipts.push(this.observeInternal(raids[index]!, {
          recovered, ...(checkpoint && index === raids.length - 1 ? { checkpoint } : {}),
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

  private observeInternal(raid: AtlasRaid, options: { checkpoint?: Checkpoint; recovered: boolean }, sync: boolean): RoadReceipt {
    const checkpoint = options.checkpoint;
    if (checkpoint) this.assertCheckpoint(checkpoint);
    const existing = this.ids.get(raid.id);
    const canonical = this.match(raid);
    const canonicalId = canonical?.raid.id ?? raid.id;
    // An already durable delivery needs no new record unless its source or cursor adds information.
    if (!existing || !existing.canonical.sources.has(raid.source) || (checkpoint && checkpoint.cursor !== checkpoint.after)) {
      const body: Body = {
        kind: 'observation', raid, canonicalId, recovered: options.recovered ?? false,
        ...(checkpoint ? { checkpoint } : {}),
      };
      this.append(body, sync);
    }
    const summary = this.summaries.get(roadKey(raid.fromKingdomId, raid.toKingdomId))!;
    return { kind: canonical ? 'duplicate' : 'stored', raidId: raid.id, road: summary.key, raids: summary.raids };
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
    return [...this.summaries.values()]
      .filter((road) => channelId === undefined || road.from === channelId || road.to === channelId)
      .sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
      .map((road) => structuredClone(road));
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
        canonical = { raid, sources: new Set() };
        this.canonical.set(raid.id, canonical);
        const directedKey = `${raid.fromKingdomId}>${raid.toKingdomId}`;
        const directed = this.directed.get(directedKey) ?? [];
        directed.push(canonical);
        this.directed.set(directedKey, directed);
        const key = roadKey(raid.fromKingdomId, raid.toKingdomId);
        const previous = this.summaries.get(key);
        const time = raidTime(raid);
        const [from, to] = key.split('~') as [string, string];
        this.summaries.set(key, {
          key, from, to, raids: (previous?.raids ?? 0) + 1, viewers: (previous?.viewers ?? 0) + raid.viewers,
          firstAt: Math.min(previous?.firstAt ?? time, time), lastAt: Math.max(previous?.lastAt ?? time, time),
          events: [...(previous?.events ?? []), raid],
        });
      }
      canonical.sources.add(raid.source);
      if (!this.ids.has(raid.id)) this.ids.set(raid.id, { raid, canonical });
    }
    if (body.checkpoint) this.checkpoints.set(body.checkpoint.source, body.checkpoint.cursor);
  }
}
