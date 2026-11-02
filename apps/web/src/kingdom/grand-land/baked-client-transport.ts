export function abortError(): DOMException { return new DOMException('The kingdom closed', 'AbortError'); }
export function checkSignal(signal: AbortSignal): void { if (signal.aborted) throw abortError(); }

/** Never buffers more than the advertised output. Overflow cancels the producer, including gunzip. */
export async function readBounded(stream: ReadableStream<Uint8Array> | null, limit: number, signal: AbortSignal,
  onBytes?: (bytes: number) => void): Promise<Uint8Array> {
  checkSignal(signal);
  if (!stream) throw new Error('Baked land response has no body');
  const reader = stream.getReader(), output = new Uint8Array(limit);
  let length = 0;
  const cancel = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener('abort', cancel, { once: true });
  try {
    while (true) {
      checkSignal(signal);
      const { done, value } = await reader.read();
      checkSignal(signal);
      if (done) break;
      onBytes?.(value.byteLength);
      if (value.byteLength > limit - length) throw new RangeError('Baked land stream exceeded its byte budget');
      output.set(value, length); length += value.byteLength;
    }
    return length === limit ? output : output.slice(0, length);
  } catch (error) { cancel(); throw error; }
  finally { signal.removeEventListener('abort', cancel); reader.releaseLock(); }
}

export async function gunzipBounded(bytes: Uint8Array, limit: number, signal: AbortSignal): Promise<Uint8Array> {
  checkSignal(signal);
  const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(bytes); controller.close(); } });
  return readBounded(stream.pipeThrough(new DecompressionStream('gzip') as ReadableWritablePair<Uint8Array, Uint8Array>), limit, signal);
}

interface Waiting {
  readonly bytes: number; readonly signal: AbortSignal;
  readonly resolve: (release: () => void) => void; readonly reject: (error: Error) => void; readonly abort: () => void;
}
/** Reservations cover cache reads, fetch, decompression and validation, until the caller owns the result.
 * Renderer reservations separately cover its decoded mesh install queue (16 MiB). */
export class BakedRequestGate {
  private readonly queue: Waiting[] = [];
  private active = 0;
  private bytes = 0;
  constructor(private readonly maxRequests: number, private readonly byteBudget: number,
    private readonly changed: (active: number, bytes: number, queued: number) => void) {}
  acquire(bytes: number, signal: AbortSignal): Promise<() => void> {
    checkSignal(signal);
    if (!Number.isSafeInteger(bytes) || bytes < 1 || bytes > this.byteBudget) return Promise.reject(new RangeError('Baked request exceeds its reservation budget'));
    if (this.queue.length >= 64) return Promise.reject(new RangeError('Baked request queue is full'));
    return new Promise((resolve, reject) => {
      const waiting: Waiting = { bytes, signal, resolve, reject, abort: () => {
        const index = this.queue.indexOf(waiting);
        if (index < 0) return;
        this.queue.splice(index, 1); reject(abortError()); this.pump();
      } };
      this.queue.push(waiting); signal.addEventListener('abort', waiting.abort, { once: true }); this.pump();
    });
  }
  private pump(): void {
    while (this.queue.length && this.active < this.maxRequests) {
      const item = this.queue[0]!;
      if (this.bytes + item.bytes > this.byteBudget) break;
      this.queue.shift(); item.signal.removeEventListener('abort', item.abort);
      if (item.signal.aborted) { item.reject(abortError()); continue; }
      this.active++; this.bytes += item.bytes;
      let released = false;
      item.resolve(() => { if (released) return; released = true; this.active--; this.bytes -= item.bytes; this.pump(); });
    }
    this.changed(this.active, this.bytes, this.queue.length);
  }
}
