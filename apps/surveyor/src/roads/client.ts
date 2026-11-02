import type { AtlasRaid } from '@chatdom/shared';
import type { AtlasRoadIngress } from '../../../api/src/raid-gate/ports';

/**
 * The client side of the Atlas's private road ingest, for raid-show's outbox. Free of Node-only imports so the api
 * can bundle it. `observe()` resolves only when the Atlas answers that the raid is durably in its road ledger
 * (stored, or already there); every other answer rejects, and the outbox tries again later.
 */
export const INGEST_ROUTE = '/v1/roads/observe';
const DEFAULT_TIMEOUT_MS = 5_000;

export interface AtlasRoadIngressOptions {
  /** The ingest's base URL (`http://127.0.0.1:<port>`) or its full `/v1/roads/observe` endpoint. */
  url: string;
  /** The bearer token the Atlas was configured with, if any. */
  token?: string | null;
  fetch?: typeof fetch;
  /** Deadline for one attempt, on top of the caller's own signal. */
  timeoutMs?: number;
}

export type AtlasRoadIngressFailure = 'invalid' | 'unauthorized' | 'unavailable' | 'too-large' | 'unexpected' | 'network' | 'timeout' | 'aborted';

export class AtlasRoadIngressError extends Error {
  constructor(readonly reason: AtlasRoadIngressFailure, readonly status: number | null, readonly detail: string | null = null) {
    super(`Atlas road ingest ${reason}${status === null ? '' : ` (HTTP ${status})`}${detail ? `: ${detail}` : ''}`);
    this.name = 'AtlasRoadIngressError';
  }
}

function endpoint(input: string): URL {
  const url = new URL(input);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('The Atlas road ingest URL must be HTTP(S).');
  if (url.username || url.password || url.search || url.hash) throw new Error('The Atlas road ingest URL carries no credentials, query or fragment.');
  if (!url.pathname.endsWith(INGEST_ROUTE)) url.pathname = `${url.pathname.replace(/\/+$/, '')}${INGEST_ROUTE}`;
  return url;
}

const REASONS: Record<number, AtlasRoadIngressFailure> = { 401: 'unauthorized', 413: 'too-large', 422: 'invalid', 503: 'unavailable' };

export function createAtlasRoadIngress(options: AtlasRoadIngressOptions): AtlasRoadIngress {
  const target = endpoint(options.url);
  const fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const headers: Record<string, string> = { 'content-type': 'application/json', accept: 'application/json' };
  if (options.token) headers.authorization = `Bearer ${options.token}`;
  return {
    origin: 'live',
    async observe(raid: AtlasRaid, signal: AbortSignal): Promise<void> {
      if (signal.aborted) throw new AtlasRoadIngressError('aborted', null);
      const deadline = AbortSignal.timeout(timeoutMs);
      let response: Response;
      try {
        response = await fetchImpl(target, {
          method: 'POST', headers, body: JSON.stringify(raid), redirect: 'error', signal: AbortSignal.any([signal, deadline]),
        });
      } catch {
        if (signal.aborted) throw new AtlasRoadIngressError('aborted', null);
        if (deadline.aborted) throw new AtlasRoadIngressError('timeout', null);
        throw new AtlasRoadIngressError('network', null);
      }
      let body: unknown = null;
      try {
        body = await response.json();
      } catch {
        if (signal.aborted) throw new AtlasRoadIngressError('aborted', response.status);
        if (deadline.aborted) throw new AtlasRoadIngressError('timeout', response.status);
      }
      const reply = (typeof body === 'object' && body !== null ? body : {}) as { kind?: unknown; raidId?: unknown; reason?: unknown };
      if (response.status === 200 && (reply.kind === 'stored' || reply.kind === 'duplicate') && reply.raidId === raid.id) return;
      const reason = REASONS[response.status] ?? 'unexpected';
      throw new AtlasRoadIngressError(reason, response.status, reason === 'invalid' && typeof reply.reason === 'string' ? reply.reason.slice(0, 32) : null);
    },
  };
}
