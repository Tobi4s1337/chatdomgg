import { adaptSurveyorRaid, type AtlasRaid } from '@chatdom/shared';

const FRAME_BYTES = 32 * 1024;
const CHUNK_BYTES = 256 * 1024;

export class SurveyorStreamError extends Error {
  constructor(readonly code: 'http' | 'format' | 'too-large' | 'invalid' | 'closed' | 'idle' | 'headers') {
    super(`Surveyor raid stream ${code}.`);
  }
}

/** Original collector base, configured explicitly; the legacy /raids stream has no replay cursor. */
export function surveyorBaseUrl(input: string): URL {
  const url = new URL(input.endsWith('/') ? input : `${input}/`);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('SURVEYOR_BASE_URL must be an HTTP(S) base without credentials, query or fragment.');
  }
  return url;
}

export interface SurveyorStreamOptions {
  signal: AbortSignal;
  onRaid: (raid: AtlasRaid) => void;
  onOpen?: () => void;
  fetch?: typeof fetch;
  headerMs?: number;
  idleMs?: number;
}

function readAbortable(reader: ReadableStreamDefaultReader<Uint8Array>, signal: AbortSignal) {
  signal.throwIfAborted();
  return new Promise<ReadableStreamReadResult<Uint8Array>>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    reader.read().then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

/**
 * One connection, with bounded framing and original observation clocks. Every normalized observation reaches
 * the synchronous durable callback before reading more data. EOF/idle always reports a gap to the caller.
 */
export async function streamSurveyorRaids(base: URL, options: SurveyorStreamOptions): Promise<void> {
  const controller = new AbortController();
  const signal = AbortSignal.any([options.signal, controller.signal]);
  signal.throwIfAborted();
  const headerMs = options.headerMs ?? 8000, idleMs = options.idleMs ?? 45_000;
  if (!Number.isFinite(headerMs) || headerMs < 1 || !Number.isFinite(idleMs) || idleMs < 1) throw new Error('Invalid raid stream deadlines.');
  let timer = setTimeout(() => controller.abort(new SurveyorStreamError('headers')), headerMs);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const touch = () => {
    clearTimeout(timer);
    timer = setTimeout(() => controller.abort(new SurveyorStreamError('idle')), idleMs);
    timer.unref();
  };
  try {
    const response = await (options.fetch ?? fetch)(new URL('raids', base), {
      signal, redirect: 'error', headers: { accept: 'text/event-stream', 'cache-control': 'no-cache' },
    });
    signal.throwIfAborted();
    clearTimeout(timer);
    if (!response.ok) {
      await response.body?.cancel();
      throw new SurveyorStreamError('http');
    }
    if (!response.body || !/^text\/event-stream(?:;|$)/i.test(response.headers.get('content-type') ?? '')) {
      await response.body?.cancel();
      throw new SurveyorStreamError('format');
    }
    reader = response.body.getReader();
    touch();
    options.onOpen?.();
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let pending = '', event = '', size = 0;
    let data: string[] = [];
    function line(value: string) {
      if (value.endsWith('\r')) value = value.slice(0, -1);
      if (Buffer.byteLength(value) > FRAME_BYTES) throw new SurveyorStreamError('too-large');
      if (value === '') {
        if (event === 'raid' && data.length) {
          let raid: AtlasRaid;
          try { raid = adaptSurveyorRaid(JSON.parse(data.join('\n'))); }
          catch { throw new SurveyorStreamError('invalid'); }
          signal.throwIfAborted();
          options.onRaid(raid);
        }
        event = ''; data = []; size = 0;
        return;
      }
      if (value.startsWith(':')) return;
      const colon = value.indexOf(':');
      const field = colon < 0 ? value : value.slice(0, colon);
      let content = colon < 0 ? '' : value.slice(colon + 1);
      if (content.startsWith(' ')) content = content.slice(1);
      if (field === 'event') {
        if (content.length > 64) throw new SurveyorStreamError('too-large');
        event = content;
      } else if (field === 'data') {
        size += Buffer.byteLength(content) + 1;
        if (size > FRAME_BYTES) throw new SurveyorStreamError('too-large');
        data.push(content);
      }
      // id/retry cannot turn this legacy source into a resumable event stream.
    }
    for (;;) {
      const chunk = await readAbortable(reader, signal);
      signal.throwIfAborted();
      if (chunk.done) throw new SurveyorStreamError('closed');
      if (chunk.value.byteLength > CHUNK_BYTES) throw new SurveyorStreamError('too-large');
      touch();
      try { pending += decoder.decode(chunk.value, { stream: true }); }
      catch { throw new SurveyorStreamError('invalid'); }
      let newline: number;
      while ((newline = pending.indexOf('\n')) !== -1) {
        const value = pending.slice(0, newline);
        pending = pending.slice(newline + 1);
        line(value);
      }
      if (Buffer.byteLength(pending) > FRAME_BYTES) throw new SurveyorStreamError('too-large');
    }
  } finally {
    clearTimeout(timer);
    controller.abort();
    if (reader) {
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
  }
}
