import { SignJWT } from 'jose';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import { extensionKey } from '../public/panel/token';
import { parseConfigurationReading } from './configuration';

export interface PanelConfigurationPublisherOptions {
  readonly realm: (path: string, body: unknown) => Promise<Record<string, unknown>>;
  readonly extensionId?: string;
  readonly extensionSecret?: string;
  readonly ownerId?: string;
  /** Explicit opt-in; supplied, development and simulated compositions must leave this false. */
  readonly enabled?: boolean;
  readonly fetch?: typeof fetch;
  readonly pollMs?: number;
  readonly concurrency?: number;
  readonly now?: () => number;
}
const BASE = 'https://api.twitch.tv/helix/extensions/configurations';
const CLAIM = '/internal/realm/panel/settings-mirror-claim';
const FINISH = '/internal/realm/panel/settings-mirror-finish';
const PERMIT = '/internal/realm/panel/settings-mirror-permit';
const ACTIVATE = '/internal/realm/panel/settings-mirror-activate';
const ID = /^[1-9][0-9]{0,31}$/;
const Segment = z.strictObject({ broadcaster_id: z.string(), segment: z.literal('broadcaster'), version: z.string(), content: z.string() });

/** Size-bound the actual response stream, including chunked responses without Content-Length. */
async function boundedJson(response: Response, signal: AbortSignal): Promise<unknown> {
  if (Number(response.headers.get('content-length') ?? 0) > 8192 || !response.body) throw new Error('Invalid configuration response.');
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  let bytes = 0;
  try {
    for (;;) {
      const part = await reader.read(); if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > 8192) throw new Error('Configuration response exceeds its budget.');
      chunks.push(part.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } finally { signal.removeEventListener('abort', cancel); cancel(); reader.releaseLock(); }
}

/** Abort is also a local deadline: a faulty injected transport cannot hold a worker forever. */
async function deadline<T>(controller: AbortController, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const budget = new AbortController(), signal = AbortSignal.any([controller.signal, budget.signal]);
  const timer = setTimeout(() => budget.abort(), 5000); timer.unref?.();
  let abort!: () => void;
  const stopped = new Promise<never>((_resolve, reject) => {
    abort = () => reject(new Error('Configuration request stopped.'));
    if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true });
  });
  try { return await Promise.race([work(signal), stopped]); }
  finally { clearTimeout(timer); signal.removeEventListener('abort', abort); }
}

/** A bounded EBS worker; SQL owns ordering/retries, so restarts need no in-memory channel registry. */
export function createPanelConfigurationPublisher(options: PanelConfigurationPublisherOptions) {
  const fetcher = options.fetch ?? fetch, now = options.now ?? Date.now;
  const parallel = Math.max(1, Math.min(4, Math.floor(options.concurrency ?? 2)));
  const pollMs = Math.max(1000, Math.min(60_000, options.pollMs ?? 1000));
  let key: Uint8Array | undefined;
  if (options.enabled === true && /^[a-zA-Z0-9]{1,100}$/.test(options.extensionId ?? '') && ID.test(options.ownerId ?? '')) {
    try { key = extensionKey(options.extensionSecret ?? ''); } catch { /* Setup health reports missing owner/secret. */ }
  }
  let disposed = false, started = false, ticking = false;
  let bindingId: string | undefined, fenced = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const controllers = new Set<AbortController>();

  type Claim = { kingdomId: string; claimId: string; extensionId: string; bindingId: string };
  const request = async (claim: Claim, controller: AbortController, content?: string) => {
    if (!key || disposed || controller.signal.aborted) throw new Error('Configuration publisher stopped.');
    // Shared durable quota across processes and channels. No unbounded waiter or stale-claim HTTP.
    for (let attempt = 0; ; attempt++) {
      const permit = await options.realm(PERMIT, claim);
      if (disposed || controller.signal.aborted || permit.version !== 1 || permit.status !== 'permit') throw new Error('Configuration claim unavailable.');
      if (permit.allowed === true) break;
      if (attempt >= 8 || !Number.isSafeInteger(permit.retryAfterMs) || Number(permit.retryAfterMs) <= 0 || Number(permit.retryAfterMs) > 3100) throw new Error('Configuration claim expired.');
      await delay(Number(permit.retryAfterMs) + 10, undefined, { signal: controller.signal });
    }
    // Fresh owner-signed JWT for every request; never borrow a viewer or broadcaster's Helper token.
    const token = await new SignJWT({ role: 'external', user_id: options.ownerId })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' }).setExpirationTime(Math.floor(now() / 1000) + 60).sign(key);
    if (disposed || controller.signal.aborted) throw new Error('Configuration publisher stopped.');
    const url = new URL(BASE);
    if (content === undefined) {
      url.searchParams.set('extension_id', options.extensionId!); url.searchParams.set('broadcaster_id', claim.kingdomId); url.searchParams.set('segment', 'broadcaster');
    }
    return deadline(controller, async signal => {
      const response = await fetcher(url, { method: content === undefined ? 'GET' : 'PUT', redirect: 'error',
        headers: { authorization: `Bearer ${token}`, 'client-id': options.extensionId!, 'content-type': 'application/json' },
        ...(content === undefined ? {} : { body: JSON.stringify({ extension_id: options.extensionId, broadcaster_id: claim.kingdomId, segment: 'broadcaster', version: '1', content }) }), signal });
      if (content === undefined && response.status === 200) return { status: response.status, body: await boundedJson(response, signal) };
      void response.body?.cancel().catch(() => {});
      return { status: response.status, body: undefined };
    });
  };

  const read = async (claim: Claim, controller: AbortController): Promise<string | null> => {
    const response = await request(claim, controller);
    if (response.status !== 200) throw new Error('Configuration read unavailable.');
    const result = z.strictObject({ data: z.array(Segment).max(1) }).parse(response.body);
    const segment = result.data[0];
    if (!segment) return null;
    if (segment.broadcaster_id !== claim.kingdomId || Buffer.byteLength(segment.content, 'utf8') > 3072) throw new Error('Invalid configuration segment.');
    if (segment.version === '' && segment.content === '') return null;
    if (segment.version !== '1') throw new Error('Unsupported configuration version.');
    // Unknown fields never authorize a verification. The trusted realm may repair malformed old content.
    try { return parseConfigurationReading(JSON.parse(segment.content) as unknown) ? segment.content : null; }
    catch { return null; }
  };

  const one = async () => {
    let claim: Claim | undefined;
    const controller = new AbortController(); controllers.add(controller);
    try {
      const job = await options.realm(CLAIM, { extensionId: options.extensionId, bindingId });
      if (job.status === 'fenced') fenced = true;
      if (disposed || job.version !== 1 || job.status !== 'claimed') return;
      if (typeof job.kingdomId !== 'string' || !ID.test(job.kingdomId) || !z.uuid().safeParse(job.claimId).success) return;
      claim = { kingdomId: job.kingdomId, claimId: job.claimId as string, extensionId: options.extensionId!, bindingId: bindingId! };
      const reading = parseConfigurationReading(job.reading);
      if (!reading) throw new Error('Invalid authoritative settings.');
      const content = JSON.stringify(reading);
      if (Buffer.byteLength(content, 'utf8') > 3072) throw new Error('Configuration exceeds its budget.');
      let observed = await read(claim, controller);
      if (observed !== content) {
        const response = await request(claim, controller, content);
        if (response.status !== 204) throw new Error('Configuration update unconfirmed.');
        observed = await read(claim, controller);
      }
      if (disposed || observed !== content) throw new Error('Configuration readback did not match.');
      await options.realm(FINISH, { ...claim, content: observed });
    } catch {
      // A timeout is uncertain, never success. The durable lease/periodic audit repairs late remote writes.
      if (claim && !disposed) await options.realm(FINISH, claim).catch(() => {});
    } finally { controllers.delete(controller); }
  };
  const tick = async () => {
    if (!key || disposed || ticking || fenced) return;
    ticking = true;
    try {
      if (!bindingId) {
        const active = await options.realm(ACTIVATE, { extensionId: options.extensionId });
        if (active.version !== 1 || active.status !== 'activated' || !z.uuid().safeParse(active.bindingId).success) return;
        bindingId = active.bindingId as string;
      }
      if (!disposed) await Promise.all(Array.from({ length: parallel }, one));
    } catch { /* Startup can retry activation. A fenced running worker never reactivates itself. */ }
    finally { ticking = false; }
  };
  const dispose = () => { disposed = true; started = false; clearTimeout(timer); for (const controller of controllers) controller.abort(); };
  const start = () => {
    if (!key || disposed || started) return dispose;
    started = true;
    const loop = () => { if (!started || disposed) return; void tick().finally(() => {
      if (started && !disposed) { timer = setTimeout(loop, pollMs); timer.unref?.(); }
    }); };
    loop();
    return dispose;
  };
  return { tick, start, dispose };
}
