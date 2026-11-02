import {
  AtlasManifestSchema, atlasFreshness, assertAtlasAlignment, decodeDabsV1, decodeLiveStartsV1, decodeLiveV2,
  type AtlasAlignment, type AtlasDab, type AtlasManifest,
} from '@chatdom/shared';
import type { PreviewSource, PreviewWorld } from '../data/preview';
import { validateCaravan, type CaravanRaid } from '../data/roads';

/**
 * The live layer's transport (Spec 01 R11). It reads one land's live pointer, then the three artifacts its manifest
 * names, and decodes them only with the shared codecs. A frame replaces the shown one only when it is complete,
 * aligned with this land, verified byte for byte and observed later than the frame already shown. Anything else
 * (a partial sweep, a stale or corrupt asset, an older manifest, a dropped stream) keeps the last coherent frame
 * and its own observation time: nothing is ever shown as offline or as fresh because a read failed.
 */

export type SourceState = 'complete' | 'partial' | 'incoherent' | 'future' | 'empty' | 'unavailable' | 'moderation-unreadable';

/** What the producer last saw of the source, published apart from the frame. */
export interface LiveSource {
  state: SourceState;
  checkedAt: number | null;
  sweepAt: number | null;
  completeAt: number | null;
  gapBefore: boolean;
}

export interface LiveFrame {
  /** When the sweep behind it was observed, and when it was published (never the time it was fetched). */
  asOf: number;
  publishedAt: number;
  /** Interleaved [class, spectacle] per settler ordinal, owned by this frame. */
  slots: Uint8Array;
  /** Real stream starts by ordinal; null when the source did not know. */
  starts: Map<number, number | null>;
  dabs: AtlasDab[];
  path: string;
}

export type Transport = 'connecting' | 'streaming' | 'polling' | 'closed';

export interface LiveStatus {
  /** fresh/stale/clock-skew from the shared freshness rule, or `none` before the first frame. */
  freshness: 'none' | 'fresh' | 'stale' | 'clock-skew';
  frameAsOf: number | null;
  source: LiveSource | null;
  transport: Transport;
  /** Why the last offered frame was not taken, if it was not. Never shown raw; the UI words it. */
  refused: 'alignment' | 'partial' | 'corrupt' | 'unreachable' | null;
}

export interface EventSourceLike {
  addEventListener(type: string, listener: (event: MessageEvent<string>) => void): void;
  close(): void;
  onerror: ((event: Event) => void) | null;
  onopen: ((event: Event) => void) | null;
}

export interface FeedOptions {
  now?: () => number;
  /** Reconcile by polling even while the stream is open (R11: every 60 s). */
  reconcileMs?: number;
  openStream?: ((url: string) => EventSourceLike) | null;
  setTimer?: (run: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  /**
   * A fresh witnessed raid the stream announced at the moment it was stored. Announced once and never replayed: a
   * reconnect or a reload hears only raids stored after it. A malformed event is dropped without a word.
   */
  onRaid?: (raid: CaravanRaid) => void;
}

export const RECONCILE_MS = 60_000;
export const ASSET_TIMEOUT_MS = 20_000;
const POINTER_KINDS = ['complete', 'partial', 'incoherent', 'future', 'empty', 'unavailable', 'moderation-unreadable'] as const;

/** Settler ordinals follow the preview's own order: `world.head`, then each region's chunk in region order. */
export function settlerCount(world: Pick<PreviewWorld, 'head' | 'regions'>): number {
  return world.regions.reduce((sum, region) => sum + region.chunk.records, world.head.ids.length);
}

/** First ordinal of each region's chunk. */
export function regionOffsets(world: Pick<PreviewWorld, 'head' | 'regions'>): number[] {
  const offsets: number[] = [];
  let next = world.head.ids.length;
  for (const region of world.regions) {
    offsets.push(next);
    next += region.chunk.records;
  }
  return offsets;
}

/**
 * Whether a manifest replaces the shown frame: a later observation, or the same sweep published again later (the
 * producer re-gates a published frame when a channel is withheld between sweeps).
 */
const newer = (asOf: number, publishedAt: number, shown: LiveFrame) => asOf > shown.asOf || (asOf === shown.asOf && publishedAt > shown.publishedAt);

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const epochOrNull = (value: unknown) => value === null || (typeof value === 'number' && Number.isInteger(value) && value >= 0);

/** The pointer is not a shared contract: validate it strictly here; its manifest is validated by the shared schema. */
export function parsePointer(value: unknown, previewId: string): { manifest: AtlasManifest | null; source: LiveSource } {
  if (!isObject(value) || value.version !== 1 || value.kind !== 'chatdom-atlas-live-pointer' || value.preview !== previewId) {
    throw new Error('Not this land’s live pointer.');
  }
  const source = value.source;
  if (!isObject(source) || !POINTER_KINDS.includes(source.state as SourceState) || !epochOrNull(source.checkedAt) ||
    !epochOrNull(source.sweepAt) || !epochOrNull(source.completeAt) || typeof source.gapBefore !== 'boolean') {
    throw new Error('The live pointer’s source state is malformed.');
  }
  const manifest = value.manifest === null ? null : AtlasManifestSchema.parse(value.manifest);
  return {
    manifest,
    source: {
      state: source.state as SourceState, checkedAt: source.checkedAt as number | null, sweepAt: source.sweepAt as number | null,
      completeAt: source.completeAt as number | null, gapBefore: source.gapBefore,
    },
  };
}

async function fetchBytes(source: PreviewSource, url: string, signal: AbortSignal): Promise<Uint8Array> {
  const local = new AbortController();
  const timer = setTimeout(() => local.abort(), ASSET_TIMEOUT_MS);
  const forward = () => local.abort();
  signal.addEventListener('abort', forward, { once: true });
  try {
    const response = await source.fetch(url, { signal: local.signal, credentials: 'omit' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return new Uint8Array(await response.arrayBuffer());
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', forward);
  }
}

export class LiveFeed {
  private frame: LiveFrame | null = null;
  private source: LiveSource | null = null;
  private transport: Transport = 'connecting';
  private refused: LiveStatus['refused'] = null;
  private stream: EventSourceLike | null = null;
  private timer: unknown = null;
  private readonly controller = new AbortController();
  /** The settler order this land was first seen with; any other order is refused for the life of the feed. */
  private orderHash: string | null = null;
  private applying: Promise<void> = Promise.resolve();
  private readonly now: () => number;

  constructor(
    private readonly src: PreviewSource,
    private readonly world: PreviewWorld,
    private readonly worldSha256: string,
    private readonly onChange: (frame: LiveFrame | null, status: LiveStatus) => void,
    private readonly options: FeedOptions = {},
  ) {
    this.now = options.now ?? Date.now;
  }

  /** The alignment this land demands. Edition, world hash and count come from the drawn land itself. */
  expected(manifest: AtlasManifest): AtlasAlignment {
    return {
      editionId: this.world.id,
      worldHash: this.worldSha256,
      settlerOrderHash: this.orderHash ?? manifest.alignment.settlerOrderHash,
      settlerCount: settlerCount(this.world),
    };
  }

  status(): LiveStatus {
    let freshness: LiveStatus['freshness'] = 'none';
    if (this.frame) {
      const verdict = atlasFreshness({ kind: 'observed', asOf: this.frame.asOf }, this.now());
      freshness = verdict === 'fresh' || verdict === 'stale' || verdict === 'clock-skew' ? verdict : 'stale';
    }
    return { freshness, frameAsOf: this.frame?.asOf ?? null, source: this.source, transport: this.transport, refused: this.refused };
  }

  current(): LiveFrame | null {
    return this.frame;
  }

  private emit(): void {
    if (!this.controller.signal.aborted) this.onChange(this.frame, this.status());
  }

  start(): void {
    void this.reconcile();
    const open = this.options.openStream === undefined
      ? (typeof EventSource === 'function' ? (url: string) => new EventSource(url) as unknown as EventSourceLike : null)
      : this.options.openStream;
    if (open) {
      try {
        // Subscribe once. EventSource reconnects on its own; while it is down the reconcile timer carries on.
        const stream = open(`${this.src.base}/v1/live/${this.world.id}/events`);
        stream.addEventListener('live', (event) => {
          try {
            this.offer(JSON.parse(event.data) as unknown);
          } catch {
            this.refused = 'corrupt';
            this.emit();
          }
        });
        stream.addEventListener('raid', (event) => {
          if (this.controller.signal.aborted || !this.options.onRaid) return;
          let raid: CaravanRaid;
          try {
            raid = validateCaravan(JSON.parse(event.data) as unknown);
          } catch {
            return;
          }
          this.options.onRaid(raid);
        });
        stream.onopen = () => {
          this.transport = 'streaming';
          this.emit();
        };
        stream.onerror = () => {
          this.transport = 'polling';
          this.emit();
        };
        this.stream = stream;
      } catch {
        this.transport = 'polling';
      }
    } else {
      this.transport = 'polling';
    }
    this.schedule();
  }

  private schedule(): void {
    // A reconcile that was in flight at dispose must not leave a timer behind.
    if (this.controller.signal.aborted) return;
    const set = this.options.setTimer ?? ((run: () => void, ms: number) => setTimeout(run, ms));
    this.timer = set(() => {
      if (this.controller.signal.aborted) return;
      void this.reconcile().finally(() => this.schedule());
    }, this.options.reconcileMs ?? RECONCILE_MS);
  }

  /** Re-read the pointer. A failed read changes nothing but the transport note. */
  async reconcile(): Promise<void> {
    let bytes: Uint8Array;
    try {
      bytes = await fetchBytes(this.src, `${this.src.base}/v1/live/${this.world.id}`, this.controller.signal);
    } catch {
      if (this.controller.signal.aborted) return;
      this.refused = this.frame ? this.refused : 'unreachable';
      if (this.transport !== 'streaming') this.transport = 'polling';
      this.emit();
      return;
    }
    let value: unknown;
    try {
      value = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    } catch {
      // It answered, but not with a pointer: a damaged reply, not an unreachable service.
      this.refused = 'corrupt';
      this.emit();
      return;
    }
    this.offer(value);
    await this.applying;
  }

  /** Offers a pointer (from the stream or a reconcile). Applied in order; a later offer waits for an earlier one. */
  offer(value: unknown): void {
    this.applying = this.applying.then(() => this.apply(value)).catch(() => undefined);
  }

  private async apply(value: unknown): Promise<void> {
    if (this.controller.signal.aborted) return;
    let parsed: ReturnType<typeof parsePointer>;
    try {
      parsed = parsePointer(value, this.world.id);
    } catch {
      this.refused = 'corrupt';
      this.emit();
      return;
    }
    this.source = parsed.source;
    // The service answered with a well-formed pointer, so it is no longer unreachable, frame or not.
    if (this.refused === 'unreachable') this.refused = null;
    const manifest = parsed.manifest;
    if (!manifest || (this.frame && !newer(manifest.evidence.asOf, manifest.publishedAt, this.frame))) {
      // No frame yet, or nothing newer: an older or equal manifest never rolls the map back.
      this.emit();
      return;
    }
    if (manifest.coverage !== 'complete-sweep') {
      this.refused = 'partial';
      this.emit();
      return;
    }
    const expected = this.expected(manifest);
    try {
      assertAtlasAlignment(manifest.alignment, expected);
      // Realm indexes in the dabs must name this land's realms; the count is not part of the alignment, so check it.
      if (manifest.realmCount !== this.world.realms.length) throw new Error('Realm count differs from the land.');
    } catch {
      this.refused = 'alignment';
      this.emit();
      return;
    }
    let frame: LiveFrame;
    try {
      const signal = this.controller.signal;
      const url = (path: string) => `${this.src.base}${path}`;
      const [liveBytes, startBytes, dabBytes] = await Promise.all([
        fetchBytes(this.src, url(manifest.live.path), signal),
        fetchBytes(this.src, url(manifest.starts.path), signal),
        fetchBytes(this.src, url(manifest.dabs.path), signal),
      ]);
      const slots = await decodeLiveV2(liveBytes, manifest, expected);
      const starts = await decodeLiveStartsV1(startBytes, manifest, expected, liveBytes);
      const dabs = await decodeDabsV1(dabBytes, manifest, expected);
      frame = {
        asOf: manifest.evidence.asOf, publishedAt: manifest.publishedAt, slots,
        starts: new Map(starts.entries.map((entry) => [entry.ordinal, entry.startedAt])), dabs, path: manifest.live.path,
      };
    } catch {
      if (this.controller.signal.aborted) return;
      this.refused = 'corrupt';
      this.emit();
      return;
    }
    // Two reads can race; the later observation wins, whichever finished first.
    if (this.frame && !newer(frame.asOf, frame.publishedAt, this.frame)) return;
    this.orderHash = manifest.alignment.settlerOrderHash;
    this.frame = frame;
    this.refused = null;
    this.emit();
  }

  dispose(): void {
    this.controller.abort();
    this.stream?.close();
    this.stream = null;
    this.transport = 'closed';
    if (this.timer !== null) (this.options.clearTimer ?? ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>)))(this.timer);
  }
}
