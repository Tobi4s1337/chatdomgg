import { RoadLedger } from './ledger';
import { backfillRoads } from './backfill';
import { backfillPairs } from './backfill-pairs';
import { pullRoadPage, roadFeedUrl } from './pull';
import { ZodError } from 'zod';
import { setTimeout as pause } from 'node:timers/promises';
import type { AtlasRaid } from '@chatdom/shared';
import { collectorProvenance } from './provenance';
import { recoverRecorder, type RecorderRecovery } from './recorder';
import { streamSurveyorRaids, surveyorBaseUrl, SurveyorStreamError } from './surveyor-stream';

/** Operator diagnostics contain fixed codes only: never source URLs, payloads or transport error text. */
function failureReason(error: unknown): string {
  if (error instanceof ZodError) return 'invalid-schema';
  if (error instanceof SurveyorStreamError) return error.code;
  if (!(error instanceof Error)) return 'unavailable';
  if (error.name === 'TimeoutError' || error.name === 'AbortError') return 'timeout';
  const code = (error as NodeJS.ErrnoException).code;
  if (code === 'inventory-invalid') return 'invalid-rows';
  if (code === 'source-schema') return 'invalid-schema';
  if (code === 'inventory-missing') return 'source-unavailable';
  if (code === 'ENOENT') return 'missing-import';
  if (code === 'EACCES' || code === 'EPERM') return 'read-denied';
  if (code === 'EIO' || code === 'ENOSPC') return 'disk-unavailable';
  const http = /^Road feed answered HTTP ([0-9]{3})\.$/.exec(error.message);
  if (http) return `http-${http[1]}`;
  if (/^Recorder backfill .*mismatch\.$/.test(error.message)) return 'invalid-import';
  if (/^Recorder backfill record exceeds byte limit\.$/.test(error.message)) return 'record-too-large';
  if (/^Road feed page exceeds byte limit\.$/.test(error.message)) return 'page-too-large';
  if (/^The road ledger is poisoned/.test(error.message)) return 'uncertain-ledger-write';
  if (/^Conflicting road raid ID /.test(error.message)) return 'conflicting-raid';
  if (/^(Road feed |Empty road feed |Nonempty road feed |Recorder backfill must )/.test(error.message)) return 'invalid-source';
  return 'unavailable';
}

export interface RoadRuntimeOptions {
  /** Full raid-show feed URL. Null means no producer is connected, never an empty history claim. */
  feedUrl?: string | null;
  pollMs?: number;
  timeoutMs?: number;
  fetch?: typeof fetch;
  /** Explicit collector pairing. Null disables this source; defaults come only from environment. */
  surveyorBase?: string | null;
  recorderPath?: string | null;
  recorderPollMs?: number;
  reconnectMs?: number;
  streamIdleMs?: number;
  now?: () => number;
  /** Fresh original SSE only, after durable storage and current gap recovery. Never called by backfill. */
  onLiveRaid?: (raid: AtlasRaid) => void;
  /**
   * Herald raids the raid-show pull newly stored, after durable storage. The first pass after start is restart
   * catch-up and never reports; the receiver still applies its own freshness rule to each raid.
   */
  onHeraldRaid?: (raid: AtlasRaid) => void;
}

/** Lives and stops with the Atlas service. One bounded page per pass, no overlapping polls or retry storm. */
export function createRoadRuntime(dataDir: string, options: RoadRuntimeOptions = {}, log: (line: string) => void = () => {}) {
  const configured = options.feedUrl === undefined ? process.env.ATLAS_RAID_FEED_URL : options.feedUrl;
  const endpoint = configured ? roadFeedUrl(configured) : null;
  const baseInput = options.surveyorBase === undefined ? process.env.SURVEYOR_BASE_URL : options.surveyorBase;
  const base = baseInput ? surveyorBaseUrl(baseInput) : null;
  const recorderPath = options.recorderPath === undefined ? process.env.SURVEYOR_DB_PATH ?? null : options.recorderPath;
  const provenance = collectorProvenance(base?.href ?? null, recorderPath || null);
  const now = options.now ?? Date.now;
  const pollMs = options.pollMs ?? 15_000;
  const timeoutMs = options.timeoutMs ?? 8_000;
  const recorderPollMs = options.recorderPollMs ?? 60_000;
  const reconnectMs = options.reconnectMs ?? 5000;
  if (!Number.isInteger(pollMs) || pollMs < 10 || pollMs > 600_000 || !Number.isInteger(timeoutMs) || timeoutMs < 10 || timeoutMs > 60_000) {
    throw new Error('Road runtime polling/timeout interval is outside its bounds.');
  }
  if (!Number.isInteger(recorderPollMs) || recorderPollMs < 10 || recorderPollMs > 600_000 || !Number.isInteger(reconnectMs) || reconnectMs < 10 || reconnectMs > 60_000) {
    throw new Error('Recorder/reconnect interval is outside its bounds.');
  }
  const ledger = new RoadLedger(dataDir);
  const stop = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: Promise<void>;
  let polling = false, recoveryNeeded = true, nextRecorderAt = 0, pulledOnce = false;
  let generation = 0, readyGeneration = -1;
  let streamConnected = false, connectedAt: number | null = null, lastObservedAt: number | null = null;
  let gapSince: number | null = base ? now() : null;
  let streamState: 'unconnected' | 'connecting' | 'catching-up' | 'connected' | 'gap' | 'stopped' = base ? 'connecting' : 'unconnected';
  let recorder: RecorderRecovery | null = null;
  let lastStatus = '';
  let status: 'starting' | 'unconnected' | 'connected' | 'unavailable' | 'stopped' = 'starting';
  function report(next: typeof status, failures: string[] = []) {
    status = next;
    const detail = failures.length ? ` (${failures.join(', ')})` : '';
    if (lastStatus !== `${next}${detail}`) log(`roads ${next}${detail}`);
    lastStatus = `${next}${detail}`;
  }
  async function step() {
    if (stop.signal.aborted || polling) return;
    polling = true;
    // A failed recorder source never starves the independent durable feed (or vice versa).
    const failures: string[] = [];
    try { await backfillRoads(dataDir, ledger, stop.signal); } catch (error) { failures.push(`recorder:${failureReason(error)}`); }
    if (!stop.signal.aborted) {
      try { await backfillPairs(dataDir, ledger, stop.signal); } catch (error) { failures.push(`pair-import:${failureReason(error)}`); }
    }
    if (recorderPath && !stop.signal.aborted && (recoveryNeeded || now() >= nextRecorderAt)) {
      recoveryNeeded = false;
      const sourceGeneration = generation;
      const connectedAtRecoveryStart = streamConnected;
      try {
        recorder = await recoverRecorder(ledger, recorderPath, provenance, stop.signal, { now });
        nextRecorderAt = now() + recorderPollMs;
        if (connectedAtRecoveryStart && streamConnected && sourceGeneration === generation && recorder.futureRows === 0) {
          readyGeneration = generation;
          streamState = 'connected';
          gapSince = null;
        }
        if (recorder.futureRows > 0) {
          readyGeneration = -1;
          nextRecorderAt = now() + pollMs;
          if (streamConnected) streamState = 'gap';
          failures.push('recorder:future-rows');
        }
      } catch (error) {
        nextRecorderAt = now() + pollMs;
        readyGeneration = -1;
        if (streamConnected) streamState = 'gap';
        failures.push(`recorder-db:${failureReason(error)}`);
      }
    }
    if (endpoint && !stop.signal.aborted) {
      const announce = pulledOnce && options.onHeraldRaid;
      try {
        await pullRoadPage(ledger, endpoint, AbortSignal.any([stop.signal, AbortSignal.timeout(timeoutMs)]), options.fetch, {
          onStored: (raids) => { if (announce) for (const raid of raids) announce(raid); },
        });
        pulledOnce = true;
      } catch (error) { failures.push(`raid-show:${failureReason(error)}`); }
    }
    polling = false;
    if (stop.signal.aborted) return;
    report(failures.length ? 'unavailable' : endpoint || readyGeneration === generation ? 'connected' : 'unconnected', failures);
    timer = setTimeout(() => { pending = step(); }, recorderPath && recoveryNeeded ? 0 : pollMs);
    timer.unref();
  }
  function requestRecovery() {
    recoveryNeeded = true;
    if (polling || stop.signal.aborted) return;
    clearTimeout(timer);
    pending = step();
  }
  async function streamLoop() {
    if (!base) return;
    let failures = 0;
    while (!stop.signal.aborted) {
      const thisGeneration = ++generation;
      connectedAt = null;
      streamState = 'connecting';
      try {
        await streamSurveyorRaids(base, {
          signal: stop.signal,
          ...(options.fetch ? { fetch: options.fetch } : {}),
          ...(options.streamIdleMs === undefined ? {} : { idleMs: options.streamIdleMs }),
          headerMs: timeoutMs,
          onOpen: () => {
            streamConnected = true;
            connectedAt = now();
            streamState = 'catching-up';
            requestRecovery();
          },
          onRaid: raid => {
            if (raid.observedAt > now() + 5000) throw new SurveyorStreamError('invalid');
            const receipt = ledger.observe(raid, { provenance });
            lastObservedAt = Math.max(lastObservedAt ?? raid.observedAt, raid.observedAt);
            // Catch-up, stale deliveries and already witnessed aliases can only repair memory.
            if (receipt.kind === 'stored' && streamConnected && readyGeneration === thisGeneration && now() - raid.observedAt <= 30_000) {
              options.onLiveRaid?.(raid);
            }
          },
        });
      } catch (error) {
        if (!stop.signal.aborted) log(`roads SSE gap (${failureReason(error)})`);
      }
      streamConnected = false;
      readyGeneration = -1;
      gapSince ??= now();
      if (stop.signal.aborted) break;
      streamState = 'gap';
      requestRecovery();
      // A stable connection resets backoff; rapid failures remain bounded, including quiet EOF loops.
      failures = connectedAt !== null && now() - connectedAt >= 30_000 ? 0 : Math.min(failures + 1, 5);
      const delay = Math.min(60_000, reconnectMs * 2 ** Math.max(0, failures - 1));
      try { await pause(delay, undefined, { signal: stop.signal }); } catch { /* close owns cancellation */ }
    }
    streamState = 'stopped';
  }
  // Start outside the service constructor so a synchronous setup failure cannot leave a polling loop behind.
  pending = Promise.resolve().then(step);
  const streaming = Promise.resolve().then(streamLoop);
  let closed: Promise<void> | undefined;
  return {
    ledger,
    status: () => status,
    coverage: () => ({ state: streamState, connectedAt, lastObservedAt, gapSince, recorder: recorder ? { ...recorder } : null }),
    close(): Promise<void> {
      return closed ??= (async () => {
        stop.abort();
        clearTimeout(timer);
        await Promise.all([pending, streaming]);
        ledger.close();
        report('stopped');
      })();
    },
  };
}
