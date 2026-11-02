import type { uWebSocketsTransport } from '@colyseus/uwebsockets-transport';
import { RaidCrierClaimReplySchema, RaidCrierClaimRequestSchema, RaidCrierReceiptSchema,
  RAID_CRIER_CLAIM_ROUTE, RAID_CRIER_RECEIPT_ROUTE } from '../../../api/src/raid-gate/crier-contracts';
import { IngressGate, type IngressCredentials } from '../ingress/gate';
import { CrierError, RaidCrierAuthority } from './crier';

export const RAID_CRIER_BODY_LIMIT = 2_048;
interface CrierServiceOptions {
  readonly authority: RaidCrierAuthority;
  readonly credentials: IngressCredentials;
  readonly origin: 'live' | 'simulated';
  readonly recoverEveryMs?: number;
}
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
});
const refuse = (status: number) => json(status, { version: 1, status: status === 503 ? 'unavailable' : 'refused' });

export function createRaidCrierService(options: CrierServiceOptions) {
  const gate = new IngressGate(options.credentials, options.origin), pending = new Set<Promise<Response>>();
  let closed = false, recoveryFault = false;
  let recovering: Promise<unknown> | null = null;
  const recover = () => {
    if (closed || recovering) return;
    const run = options.authority.recover().then(() => { recoveryFault = false; }, () => { recoveryFault = true; })
      .finally(() => { if (recovering === run) recovering = null; });
    recovering = run;
  };
  const cadence = options.recoverEveryMs ?? 1_000;
  const timer = cadence > 0 ? setInterval(recover, cadence) : null;
  timer?.unref();
  if (cadence > 0) recover();
  const accept = async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    if (![RAID_CRIER_CLAIM_ROUTE, RAID_CRIER_RECEIPT_ROUTE].includes(url.pathname)) return refuse(404);
    if (request.method !== 'POST') return refuse(405);
    if (gate.authenticate(request.headers.get('authorization') ?? undefined) !== 'herald') return refuse(401);
    if (url.search) return refuse(400);
    if (!/^application\/json(?:;|$)/iu.test(request.headers.get('content-type') ?? '')) return refuse(415);
    if (Number(request.headers.get('content-length') ?? 0) > RAID_CRIER_BODY_LIMIT) return refuse(413);
    const reader = request.body?.getReader();
    if (!reader) return refuse(400);
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.byteLength;
        if (size > RAID_CRIER_BODY_LIMIT) { await reader.cancel(); return refuse(413); }
        chunks.push(part.value);
      }
    } finally { reader.releaseLock(); }
    let raw: unknown;
    try { raw = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return refuse(400); }
    if (url.pathname === RAID_CRIER_CLAIM_ROUTE) {
      const input = RaidCrierClaimRequestSchema.safeParse(raw);
      if (!input.success) return refuse(400);
      if (input.data.origin !== options.origin) return refuse(403);
      const claim = await options.authority.claim(input.data);
      return json(200, RaidCrierClaimReplySchema.parse({ version: 1, claim }));
    }
    const input = RaidCrierReceiptSchema.safeParse(raw);
    if (!input.success) return refuse(400);
    if (input.data.origin !== options.origin) return refuse(403);
    return json(202, { version: 1, status: await options.authority.receipt(input.data) });
  };
  return {
    health: () => ({ closed, pending: pending.size, recoveryFault }),
    handle(request: Request): Promise<Response> {
      if (closed || pending.size >= 32) return Promise.resolve(refuse(503));
      const run = accept(request).catch(error => {
        if (error instanceof CrierError) return refuse(error.kind === 'origin' ? 403 : error.kind === 'conflict' ? 409 : error.kind === 'invalid' ? 400 : 503);
        return refuse(503);
      }).finally(() => { pending.delete(run); });
      pending.add(run); return run;
    },
    async close() {
      closed = true;
      if (timer) clearInterval(timer);
      await Promise.allSettled([...pending]);
      await recovering;
    },
  };
}

export function mountRaidCrierRoutes(app: uWebSocketsTransport['app'], options: CrierServiceOptions) {
  const service = createRaidCrierService(options);
  for (const path of [RAID_CRIER_CLAIM_ROUTE, RAID_CRIER_RECEIPT_ROUTE]) app.post(path, (res, req) => {
    const query = req.getQuery(), url = `http://realm.internal${req.getUrl()}${query ? `?${query}` : ''}`;
    const headers = new Headers();
    for (const name of ['authorization', 'content-type', 'content-length']) { const value = req.getHeader(name); if (value) headers.set(name, value); }
    let aborted = false, finished = false, size = 0;
    res.onAborted(() => { aborted = true; });
    const reply = async (answer: Response) => {
      const body = await answer.text();
      if (!aborted) res.cork(() => {
        res.writeStatus(`${answer.status} ${STATUS[answer.status] ?? 'Error'}`);
        answer.headers.forEach((value, name) => res.writeHeader(name, value)); res.end(body);
      });
    };
    if (Number(headers.get('content-length') ?? 0) > RAID_CRIER_BODY_LIMIT) { void reply(refuse(413)); return; }
    const chunks: Buffer[] = [];
    res.onData((chunk, last) => {
      if (finished) return;
      size += chunk.byteLength;
      if (size > RAID_CRIER_BODY_LIMIT) { finished = true; void reply(refuse(413)); return; }
      chunks.push(Buffer.from(chunk.slice(0)));
      if (!last) return;
      finished = true;
      void service.handle(new Request(url, { method: 'POST', headers, body: Buffer.concat(chunks).toString('utf8') })).then(reply);
    });
  });
  return service;
}
const STATUS: Readonly<Record<number, string>> = { 200: 'OK', 202: 'Accepted', 400: 'Bad Request', 401: 'Unauthorized',
  403: 'Forbidden', 404: 'Not Found', 405: 'Method Not Allowed', 409: 'Conflict', 413: 'Payload Too Large',
  415: 'Unsupported Media Type', 503: 'Service Unavailable' };
