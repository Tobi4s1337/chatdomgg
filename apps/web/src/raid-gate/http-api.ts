/**
 * `RaidGateApi` over the gate's one URL (`apps/api/src/raid-gate/http.ts`). The session rides on the page's own
 * cookie; the browser never holds a token, a role or a person ID. Every reply is re-read with the strict contract
 * reader, and anything malformed counts as a transport failure, never as an answer.
 *
 * The stream is read with `fetch` rather than `EventSource` so it shares the abort signal and the injected
 * transport. It reconnects on its own with a widening pause; an ended session stops it until the host asks again.
 */
import { readGateReply, type GateReply } from '../../../api/src/raid-gate/contracts';
import type { RaidGateApi } from './ports';

export type HttpRaidGateOptions = Readonly<{
  /** The gate's URL on this site, for example `/api/raid-gate`. */
  url: string;
  /** Must match the server's `origin`: `simulated` whenever any transport behind it is controlled. */
  origin: 'live' | 'simulated';
  fetch?: typeof fetch;
  /** Pause before reconnecting a dropped stream; doubles up to `maxRetryMs`. */
  retryMs?: number;
  maxRetryMs?: number;
}>;

const RETRY_MS = 1000;
const MAX_RETRY_MS = 30_000;

export function createHttpRaidGateApi(options: HttpRaidGateOptions): RaidGateApi {
  const send = options.fetch ?? globalThis.fetch.bind(globalThis);
  const base = options.url;

  async function request(command: unknown, signal: AbortSignal): Promise<GateReply> {
    const response = await send(base, {
      method: 'POST', credentials: 'same-origin', signal, cache: 'no-store',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(command),
    });
    const body: unknown = /^application\/json\b/i.test(response.headers.get('content-type') ?? '') ? await response.json().catch(() => undefined) : undefined;
    const reply = readGateReply(body);
    // A refusal is an answer at any status; anything else must be a 200 the reader accepts.
    if (reply && (response.ok || reply.kind === 'denied')) return reply;
    throw new Error(`raid gate transport answered ${response.status}`);
  }

  function subscribe(requestId: string | null, onReply: (reply: GateReply) => void, signal: AbortSignal): void {
    const url = requestId === null ? base : `${base}${base.includes('?') ? '&' : '?'}request=${encodeURIComponent(requestId)}`;
    const firstPause = options.retryMs ?? RETRY_MS;
    const maxPause = options.maxRetryMs ?? MAX_RETRY_MS;
    let pause = firstPause;

    const wait = (ms: number) => new Promise<void>(resolve => {
      const timer = setTimeout(done, ms);
      function done() { clearTimeout(timer); signal.removeEventListener('abort', done); resolve(); }
      signal.addEventListener('abort', done, { once: true });
    });

    /** Reads one connection to its end. Returns false when the session has ended and retrying cannot help. */
    async function listen(): Promise<boolean> {
      const response = await send(url, { method: 'GET', credentials: 'same-origin', signal, cache: 'no-store', headers: { accept: 'text/event-stream' } });
      if (response.status === 401 || response.status === 403) return false;
      if (!response.ok || !response.body || !/^text\/event-stream\b/i.test(response.headers.get('content-type') ?? '')) return true;
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = '';
      let data: string[] = [];
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return true;
        buffer += value;
        let newline: number;
        while ((newline = buffer.search(/\r\n|\r|\n/)) >= 0) {
          const line = buffer.slice(0, newline);
          buffer = buffer.slice(newline + (buffer.startsWith('\r\n', newline) ? 2 : 1));
          if (line === '') {
            if (data.length > 0) {
              const reply = readGateReply(safeParse(data.join('\n')));
              data = [];
              if (reply && !signal.aborted) {
                pause = firstPause;
                onReply(reply);
                if (reply.kind === 'denied' && reply.code === 'unauthorized') return false;
              }
            }
          } else if (line.startsWith('data:')) {
            data.push(line.slice(line.startsWith('data: ') ? 6 : 5));
          }
          // `retry:`, `event:`, `id:` and `:` comments carry nothing the gate needs.
        }
      }
    }

    void (async () => {
      while (!signal.aborted) {
        let again = true;
        try { again = await listen(); } catch { /* dropped; the pause below decides when to ask again */ }
        if (!again || signal.aborted) return;
        await wait(pause);
        pause = Math.min(maxPause, pause * 2);
      }
    })();
  }

  return { origin: options.origin, request, subscribe };
}

function safeParse(text: string): unknown {
  try { return JSON.parse(text); } catch { return undefined; }
}
