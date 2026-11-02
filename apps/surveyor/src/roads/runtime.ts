import { RoadLedger } from './ledger';
import { backfillRoads } from './backfill';
import { pullRoadPage, roadFeedUrl } from './pull';
import { ZodError } from 'zod';

/** Operator diagnostics contain fixed codes only: never source URLs, payloads or transport error text. */
function failureReason(error: unknown): string {
  if (error instanceof ZodError) return 'invalid-schema';
  if (!(error instanceof Error)) return 'unavailable';
  if (error.name === 'TimeoutError' || error.name === 'AbortError') return 'timeout';
  const code = (error as NodeJS.ErrnoException).code;
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
}

/** Lives and stops with the Atlas service. One bounded page per pass, no overlapping polls or retry storm. */
export function createRoadRuntime(dataDir: string, options: RoadRuntimeOptions = {}, log: (line: string) => void = () => {}) {
  const configured = options.feedUrl === undefined ? process.env.ATLAS_RAID_FEED_URL : options.feedUrl;
  const endpoint = configured ? roadFeedUrl(configured) : null;
  const pollMs = options.pollMs ?? 15_000;
  const timeoutMs = options.timeoutMs ?? 8_000;
  if (!Number.isInteger(pollMs) || pollMs < 10 || pollMs > 600_000 || !Number.isInteger(timeoutMs) || timeoutMs < 10 || timeoutMs > 60_000) {
    throw new Error('Road runtime polling/timeout interval is outside its bounds.');
  }
  const ledger = new RoadLedger(dataDir);
  const stop = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: Promise<void>;
  let lastStatus = '';
  let status: 'starting' | 'unconnected' | 'connected' | 'unavailable' | 'stopped' = 'starting';
  function report(next: typeof status, failures: string[] = []) {
    status = next;
    const detail = failures.length ? ` (${failures.join(', ')})` : '';
    if (lastStatus !== `${next}${detail}`) log(`roads ${next}${detail}`);
    lastStatus = `${next}${detail}`;
  }
  async function step() {
    if (stop.signal.aborted) return;
    // A failed recorder source never starves the independent durable feed (or vice versa).
    const failures: string[] = [];
    try { await backfillRoads(dataDir, ledger, stop.signal); } catch (error) { failures.push(`recorder:${failureReason(error)}`); }
    if (endpoint && !stop.signal.aborted) {
      try { await pullRoadPage(ledger, endpoint, AbortSignal.any([stop.signal, AbortSignal.timeout(timeoutMs)]), options.fetch); }
      catch (error) { failures.push(`raid-show:${failureReason(error)}`); }
    }
    if (stop.signal.aborted) return;
    report(failures.length ? 'unavailable' : endpoint ? 'connected' : 'unconnected', failures);
    timer = setTimeout(() => { pending = step(); }, pollMs);
    timer.unref();
  }
  // Start outside the service constructor so a synchronous setup failure cannot leave a polling loop behind.
  pending = Promise.resolve().then(step);
  let closed: Promise<void> | undefined;
  return {
    ledger,
    status: () => status,
    close(): Promise<void> {
      return closed ??= (async () => {
        stop.abort();
        clearTimeout(timer);
        await pending;
        ledger.close();
        report('stopped');
      })();
    },
  };
}
