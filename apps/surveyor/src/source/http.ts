import type { z } from 'zod';
import {
  SurveyorRecentRaidsSchema, SurveyorStatusSchema,
  type SurveyorRecentRaidPair, type SurveyorStatus,
} from '@chatdom/shared';
import { AtlasError, zodDetails } from '../errors';

/** The running Surveyor's only HTTP inventories. Everything else comes from the read-only database adapter. */
export interface SurveyorHttpRead {
  /** Origin and path only; credentials are refused by config. */
  base: string;
  status: SurveyorStatus;
  recentPairs: SurveyorRecentRaidPair[];
  /** Local receipt time of the status response; it says when we asked, not when anything was observed. */
  readAt: number;
}

export interface HttpOptions {
  timeoutMs: number;
  /** Attempts per endpoint, including the first. Small and fixed: no retry storm against a production collector. */
  attempts?: number;
  backoffMs?: number;
  maxBytes?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

const DEFAULT_MAX_BYTES = 512 * 1024;

async function readBounded(response: Response, maxBytes: number): Promise<string> {
  const declared = Number(response.headers.get('content-length') ?? '0');
  if (declared > maxBytes) throw new AtlasError('source-http', `Response declares ${declared} bytes, above the ${maxBytes} byte limit.`);
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new AtlasError('source-http', `Response exceeded the ${maxBytes} byte limit.`);
    }
    chunks.push(value);
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
}

function transportError(url: URL, error: unknown, timeoutMs: number): AtlasError {
  if (error instanceof AtlasError) return error;
  const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
  return new AtlasError('source-http', `GET ${url.pathname} ${timedOut ? `timed out after ${timeoutMs} ms` : 'could not be reached'}.`);
}

async function getJson<T>(url: URL, schema: z.ZodType<T>, options: HttpOptions): Promise<T> {
  const attempts = options.attempts ?? 2;
  const fetchImpl = options.fetchImpl ?? fetch;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)));
  let last = new AtlasError('source-http', `GET ${url.pathname} failed.`);
  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (attempt > 1) await sleep((options.backoffMs ?? 750) * (attempt - 1));
    let text: string;
    try {
      const response = await fetchImpl(url, {
        signal: AbortSignal.timeout(options.timeoutMs),
        headers: { accept: 'application/json' },
        redirect: 'error',
      });
      if (!response.ok) {
        await response.body?.cancel();
        last = new AtlasError('source-http', `GET ${url.pathname} answered HTTP ${response.status}.`);
        // A 4xx is an answer, not a transient fault; retrying it only adds load to the collector.
        if (response.status < 500) throw last;
        continue;
      }
      text = await readBounded(response, options.maxBytes ?? DEFAULT_MAX_BYTES);
    } catch (error) {
      last = transportError(url, error, options.timeoutMs);
      if (error instanceof AtlasError) throw last;
      continue;
    }
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new AtlasError('source-schema', `GET ${url.pathname} did not return JSON.`);
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) throw new AtlasError('source-schema', `GET ${url.pathname} failed the shared schema.`, zodDetails(parsed.error));
    return parsed.data;
  }
  throw last;
}

export async function readSurveyorHttp(baseUrl: URL, options: HttpOptions): Promise<SurveyorHttpRead> {
  const now = options.now ?? Date.now;
  const status = await getJson(new URL('status', baseUrl), SurveyorStatusSchema, options);
  const readAt = now();
  // Aggregates: cumulative per pair, no IDs. Evidence for reconciliation, never individual caravans.
  const recentPairs = await getJson(new URL('raids/recent', baseUrl), SurveyorRecentRaidsSchema, options);
  return { base: `${baseUrl.origin}${baseUrl.pathname}`, status, recentPairs, readAt };
}
