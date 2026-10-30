import { REALM_LIMITS } from '../limits';

/** What the kingdom room reports while it enforces its limits. Counts and codes only; never names, tokens or text. */
export interface RealmRoomObserver {
  /** Pending inputs for one walker, read just before the tick consumes one. */
  inputDepth(depth: number): void;
  /** One walker's actions in flight after admitting another. */
  actionStarted(inFlight: number): void;
  /** An action answered without running (`held`), or answered `unavailable` because its work outlived the reply limit. */
  actionRefused(cause: 'busy' | 'late'): void;
  /** A connection ended. `phase` is the Colyseus hook that saw it; `code` is the WebSocket/Colyseus close code. */
  closed(phase: 'drop' | 'leave', code: number | undefined): void;
}

/** Secret-safe close reasons: the code's meaning, never the message that went with it. */
export type RealmCloseReason = 'left' | 'normal' | 'going-away' | 'connection-lost' | 'frame-too-large' | 'server-shutdown'
  | 'protocol-or-rate' | 'entry-ended' | 'reconnect-failed' | 'other';

export function closeReason(code: number | undefined): RealmCloseReason {
  switch (code) {
    case 4000: return 'left';
    case 1000: return 'normal';
    case 1001: return 'going-away';
    case 1005: case 1006: case undefined: return 'connection-lost';
    case 1009: return 'frame-too-large';
    case 4001: return 'server-shutdown';
    case 4002: return 'protocol-or-rate';
    case 4003: return 'entry-ended';
    case 4010: return 'reconnect-failed';
    default: return 'other';
  }
}

/** A raw uWS socket, as the transport keeps it: only the buffered byte count is read. */
interface BufferedSocket { getBufferedAmount(): number }
interface PoolGauge { readonly totalCount: number; readonly idleCount: number; readonly waitingCount: number }
export interface KingdomGauge {
  readonly kingdomId: string;
  readonly commands: { readonly pending: number; readonly highWater: number; readonly refused: Readonly<Record<'busy' | 'held' | 'expired', number>> };
  readonly delivery: { readonly delivered: number; readonly committed: number; readonly largestBatch: number; readonly droppedTransient: number };
}

/**
 * Measured high-water marks and refusals for one realm process. Everything here is a count, a byte size or a
 * reason category, safe to show an operator or a public status page. Limits come from `REALM_LIMITS`, so a report
 * always pairs each mark with the ceiling it was held to.
 */
export class RealmDiagnostics implements RealmRoomObserver {
  private inputQueueHigh = 0;
  private actionsHigh = 0;
  private backpressureHigh = 0;
  private poolWaitingHigh = 0;
  private poolTotalHigh = 0;
  private droppedSends = 0;
  private readonly refusals = { busy: 0, late: 0 };
  private readonly closes = new Map<string, number>();
  private readonly writerClosures = new Map<string, number>();
  /** Kingdoms that have closed keep their last marks here, so a report outlives them. */
  private readonly closedKingdoms = { pendingHigh: 0, largestBatch: 0, refused: { busy: 0, held: 0, expired: 0 }, droppedTransient: 0 };
  private timer: ReturnType<typeof setInterval> | null = null;

  inputDepth(depth: number) { if (depth > this.inputQueueHigh) this.inputQueueHigh = depth; }
  actionStarted(inFlight: number) { if (inFlight > this.actionsHigh) this.actionsHigh = inFlight; }
  actionRefused(cause: 'busy' | 'late') { this.refusals[cause]++; }
  closed(phase: 'drop' | 'leave', code: number | undefined) {
    const key = `${phase}:${closeReason(code)}`;
    this.closes.set(key, (this.closes.get(key) ?? 0) + 1);
  }

  /**
   * uWS `dropped`: a send past `maxBackpressure`, with the bytes that socket still buffers at that moment (the true
   * peak, which periodic sampling can miss). With `closeOnBackpressureLimit` the socket closes right after.
   */
  dropped(buffered = 0) {
    this.droppedSends++;
    if (buffered > this.backpressureHigh) this.backpressureHigh = buffered;
  }

  /** A kingdom's writer closed. Reasons are the kingdom's own fixed phrases (fenced, deadline, disposed). */
  writerClosed(kingdom: KingdomGauge, reason: string) {
    const category = /fenced/.test(reason) ? 'fenced' : /deadline|expired/.test(reason) ? 'lease-expired' : reason === 'disposed' ? 'disposed' : 'other';
    this.writerClosures.set(category, (this.writerClosures.get(category) ?? 0) + 1);
    const c = this.closedKingdoms;
    c.pendingHigh = Math.max(c.pendingHigh, kingdom.commands.highWater);
    c.largestBatch = Math.max(c.largestBatch, kingdom.delivery.largestBatch);
    for (const key of ['busy', 'held', 'expired'] as const) c.refused[key] += kingdom.commands.refused[key];
    c.droppedTransient += kingdom.delivery.droppedTransient;
  }

  private sources: { sockets?: () => Iterable<BufferedSocket>; pool?: PoolGauge } = {};

  /** Adds sources (sockets, database pool) and samples them every `sampleMs` until stopped. */
  watch(sources: { readonly sockets?: () => Iterable<BufferedSocket>; readonly pool?: PoolGauge }) {
    this.sources = { ...this.sources, ...sources };
    if (this.timer) return;
    this.timer = setInterval(() => this.sample(), REALM_LIMITS.transport.sampleMs);
    this.timer.unref?.();
  }

  sample() {
    const { sockets, pool } = this.sources;
    if (sockets) {
      for (const socket of sockets()) {
        let buffered: number;
        // A socket closing under us throws; it no longer holds bytes.
        try { buffered = socket.getBufferedAmount(); } catch { continue; }
        if (buffered > this.backpressureHigh) this.backpressureHigh = buffered;
      }
    }
    if (pool) {
      this.poolWaitingHigh = Math.max(this.poolWaitingHigh, pool.waitingCount);
      this.poolTotalHigh = Math.max(this.poolTotalHigh, pool.totalCount);
    }
  }

  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }

  /** The measured report, each mark beside its ceiling. */
  report(kingdoms: Iterable<KingdomGauge> = []) {
    const open = [...kingdoms];
    const c = this.closedKingdoms;
    const refused = { ...c.refused };
    for (const k of open) for (const key of ['busy', 'held', 'expired'] as const) refused[key] += k.commands.refused[key];
    return {
      version: 1 as const,
      highWater: {
        inputQueue: { value: this.inputQueueHigh, limit: REALM_LIMITS.room.inputBuffer },
        actionsPerWalker: { value: this.actionsHigh, limit: REALM_LIMITS.room.actionsPerWalker },
        socketBackpressureBytes: { value: this.backpressureHigh, limit: REALM_LIMITS.transport.maxBackpressure },
        pendingCommands: { value: Math.max(c.pendingHigh, ...open.map(k => k.commands.highWater)), limit: REALM_LIMITS.writer.pendingCommands },
        outboxBatch: { value: Math.max(c.largestBatch, ...open.map(k => k.delivery.largestBatch)), limit: REALM_LIMITS.delivery.outboxBatch },
        databaseConnections: { value: this.poolTotalHigh, limit: REALM_LIMITS.database.poolSize },
        databaseWaiting: { value: this.poolWaitingHigh },
      },
      refused: {
        droppedSends: this.droppedSends,
        actionsHeld: this.refusals.busy,
        actionsLate: this.refusals.late,
        commands: refused,
        droppedTransient: c.droppedTransient + open.reduce((n, k) => n + k.delivery.droppedTransient, 0),
      },
      closes: Object.fromEntries([...this.closes].sort()),
      writerClosures: Object.fromEntries([...this.writerClosures].sort()),
      kingdoms: open.map(k => ({ kingdomId: k.kingdomId, pendingCommands: k.commands.pending, delivered: k.delivery.delivered, committed: k.delivery.committed })),
    };
  }
}

export type RealmDiagnosticsReport = ReturnType<RealmDiagnostics['report']>;
