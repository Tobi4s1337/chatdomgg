import type { BakedBlobRef } from '../../../../../packages/world/src/grand/baked/types';
import { abortError, checkSignal } from './baked-client-transport';
import { verifyAndDecode, type BakedDecodeContext, type BakedDecoded, type BakedDecodeReply } from './baked-client-decode';

interface Job {
  readonly id: number; readonly bytes: Uint8Array; readonly ref: BakedBlobRef; readonly context: BakedDecodeContext;
  readonly signal: AbortSignal; readonly abort: () => void;
  readonly resolve: (result: BakedDecoded) => void; readonly reject: (error: Error) => void;
}
interface Slot { readonly worker: Worker; job: Job | null }

/** At most two decode workers. Compressed ownership transfers into the worker and back for cache writes;
 * the source's 8 MiB compressed reservation covers jobs waiting here as well as active worker jobs.
 * Cancelling active work terminates that worker, releasing its raw allocation before the reservation. */
export class BakedDecoder {
  private readonly slots: Slot[] = [];
  private readonly queue: Job[] = [];
  private sequence = 0;
  private stopped = false;
  async decode(bytes: Uint8Array, ref: BakedBlobRef, context: BakedDecodeContext, signal: AbortSignal): Promise<BakedDecoded> {
    checkSignal(signal);
    if (this.stopped) throw abortError();
    // Node-based contract tests exercise the exact worker implementation without DOM workers.
    if (typeof Worker === 'undefined') return verifyAndDecode(bytes, ref, context, signal);
    return new Promise((resolve, reject) => {
      const job: Job = { id: ++this.sequence, bytes, ref, context, signal, resolve, reject,
        abort: () => {
          const queued = this.queue.indexOf(job);
          if (queued >= 0) this.queue.splice(queued, 1);
          const slot = this.slots.find(slot => slot.job === job);
          if (slot) { slot.worker.terminate(); this.slots.splice(this.slots.indexOf(slot), 1); slot.job = null; }
          signal.removeEventListener('abort', job.abort); reject(abortError()); this.pump();
        } };
      this.queue.push(job); signal.addEventListener('abort', job.abort, { once: true }); this.pump();
    });
  }
  dispose(): void {
    if (this.stopped) return;
    this.stopped = true;
    for (const slot of this.slots) {
      slot.worker.terminate();
      if (slot.job) { slot.job.signal.removeEventListener('abort', slot.job.abort); slot.job.reject(abortError()); slot.job = null; }
    }
    for (const job of this.queue) { job.signal.removeEventListener('abort', job.abort); job.reject(abortError()); }
    this.slots.length = 0; this.queue.length = 0;
  }
  private spawn(): Slot {
    const worker = new Worker(new URL('./baked-client-worker.ts', import.meta.url), { type: 'module', name: 'baked-land-decoder' });
    const slot: Slot = { worker, job: null };
    worker.onmessage = (event: MessageEvent<BakedDecodeReply>) => {
      const job = slot.job;
      if (!job || job.id !== event.data.id) return;
      slot.job = null; job.signal.removeEventListener('abort', job.abort);
      if (job.signal.aborted) job.reject(abortError());
      else if ('error' in event.data) job.reject(new Error(event.data.error));
      else job.resolve(event.data.result);
      this.pump();
    };
    const fail = (message: string) => {
      const index = this.slots.indexOf(slot);
      if (index < 0) return;
      const job = slot.job; slot.job = null; worker.terminate(); this.slots.splice(index, 1);
      if (job) { job.signal.removeEventListener('abort', job.abort); job.reject(new Error(message)); }
      this.pump();
    };
    worker.onerror = event => fail(event.message || 'The baked land decoder stopped');
    worker.onmessageerror = () => fail('The baked land decoder returned unreadable data');
    this.slots.push(slot); return slot;
  }
  private pump(): void {
    if (this.stopped) return;
    while (this.queue.length) {
      let slot = this.slots.find(slot => !slot.job);
      if (!slot && this.slots.length >= 2) return;
      const job = this.queue.shift()!;
      if (job.signal.aborted) { job.signal.removeEventListener('abort', job.abort); job.reject(abortError()); continue; }
      try {
        slot ??= this.spawn(); slot.job = job;
        slot.worker.postMessage({ id: job.id, bytes: job.bytes, ref: job.ref, context: job.context }, [job.bytes.buffer as ArrayBuffer]);
      } catch (error) {
        if (slot) { slot.worker.terminate(); this.slots.splice(this.slots.indexOf(slot), 1); slot.job = null; }
        job.signal.removeEventListener('abort', job.abort); job.reject(error instanceof Error ? error : new Error(String(error)));
      }
    }
  }
}
