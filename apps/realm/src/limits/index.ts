import { REALM_MESSAGE_LIMIT, REALM_PATCH_MS, WALK_HZ } from '@chatdom/shared/realm';
import { REALM_DATABASE_LIMITS } from '../persistence/database';
import { REALM_LEASE_MS } from '../persistence/postgres-repository';
import { REALM_COMMAND_QUEUE_WAIT_MS, REALM_DISPOSE_WAIT_MS, REALM_PENDING_COMMANDS } from '../persistence/kingdom';
import { OUTBOX_DISPATCH_BATCH } from '../outbox/store';
import { OUTBOX_RETRY_MS } from '../outbox/dispatcher';
import { TRANSIENT_PER_SECOND } from '../outbox/transient';
import { INGRESS_DRAIN_BATCH, INGRESS_INBOX_CAPACITY } from '../ingress/inbox';
import { INGRESS_BODY_LIMIT } from '../ingress/http';

/**
 * Every queue, socket and wait in the realm has a finite ceiling (spec 34 R9). This is the one catalogue: values
 * owned elsewhere are referenced, never copied, and the README's limits table is written from it.
 */

/** Walking: the frozen shared rates. 30 Hz is the only integration rate; one input per walker per tick. */
export const REALM_ROOM_LIMITS = {
  walkHz: WALK_HZ,
  patchMs: REALM_PATCH_MS,
  /** Incoming protocol frames per client per second (inputs, messages, intents). Colyseus closes the excess sender with 4002. */
  messagesPerSecond: REALM_MESSAGE_LIMIT,
  /** Pending walk inputs per walker. The oldest is dropped on overflow, and each tick consumes at most one. */
  inputBuffer: 8,
  /** Walkers plus reconnect seats held through their grace: Colyseus counts both against this. */
  maxClients: 300,
  reconnectGraceSeconds: 30,
  /** Session recheck cadence; a check that does not answer in time ends the entry. */
  authCheckMs: 1_000,
  authCheckTimeoutMs: 3_000,
  /** Actions (intents) one walker may have in flight. More get an immediate `held` receipt, never a queued promise. */
  actionsPerWalker: 1,
  /** An action without an answer by then gets an `unavailable` receipt; its slot frees only when the work settles. */
  actionReplyMs: 8_000,
} as const;

/** The uWebSockets transport. Inbound frames carry bounded build operations; a reader that stops reading is closed. */
export const REALM_TRANSPORT_LIMITS = {
  /** Largest inbound WebSocket frame. Bigger frames close the socket before they are buffered. */
  maxPayloadLength: 16 * 1024,
  /** Outbound bytes buffered per socket. A send past this is dropped, and the socket is closed rather than left stale. */
  maxBackpressure: 1024 * 1024,
  closeOnBackpressureLimit: true,
  /** How often socket buffers are sampled for the backpressure high-water mark. */
  sampleMs: 100,
} as const;

/** The kingdom's single writer. */
export const REALM_WRITER_LIMITS = {
  leaseMs: REALM_LEASE_MS,
  /** Commands waiting for the writer. A full queue answers `realm.busy` at once. */
  pendingCommands: REALM_PENDING_COMMANDS,
  /** A command that has not started by then is refused unstarted (`realm.busy`); nothing was written. */
  queueWaitMs: REALM_COMMAND_QUEUE_WAIT_MS,
  /** Shutdown waits this long for queued commits and the last delivery, then releases only its own lease. */
  disposeWaitMs: REALM_DISPOSE_WAIT_MS,
} as const;

/** Public delivery and transient relay. */
export const REALM_DELIVERY_LIMITS = {
  outboxBatch: OUTBOX_DISPATCH_BATCH,
  outboxRetryMs: OUTBOX_RETRY_MS,
  transientPerSecond: TRANSIENT_PER_SECOND,
} as const;

/** Service ingress (Herald, panel). */
export const REALM_INGRESS_LIMITS = {
  bodyBytes: INGRESS_BODY_LIMIT,
  inboxCapacity: INGRESS_INBOX_CAPACITY,
  drainBatch: INGRESS_DRAIN_BATCH,
} as const;

/** Readiness probes. A probe that does not answer in time counts as not ready. */
export const REALM_READINESS_LIMITS = {
  probeEveryMs: 2_000,
  probeTimeoutMs: 1_500,
  /** Consecutive failed probes before owned actions are held. One slow answer is not an outage. */
  holdAfterFailures: 2,
} as const;

export const REALM_LIMITS = {
  room: REALM_ROOM_LIMITS,
  transport: REALM_TRANSPORT_LIMITS,
  writer: REALM_WRITER_LIMITS,
  delivery: REALM_DELIVERY_LIMITS,
  ingress: REALM_INGRESS_LIMITS,
  database: REALM_DATABASE_LIMITS,
  readiness: REALM_READINESS_LIMITS,
} as const;

/**
 * Settles with the work's own result, or rejects with `timeout()` once `ms` passes. The work keeps running: callers
 * that bound concurrency must hold their slot until `work` itself settles, not until this does.
 */
export function within<T>(work: Promise<T>, ms: number, timeout: () => Error): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(timeout()), ms); timer.unref?.(); });
  return Promise.race([work, late]).finally(() => clearTimeout(timer));
}
